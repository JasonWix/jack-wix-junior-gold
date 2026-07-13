#!/usr/bin/env python3
"""Update Jack Wix's Junior Gold dashboard from official Bowl.com PDFs."""
from __future__ import annotations
import io, json, re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
import requests
import pdfplumber
from bs4 import BeautifulSoup

RESULTS_PAGE = "https://bowl.com/youth/youth-tournaments/junior-gold-championships/2026-results"
ATHLETE = "Jack Wix"
ROUNDS = ["Qualifying Round 1","Qualifying Round 2","Qualifying Round 3","Qualifying Round 4"]

EXPECTED_U18B_SQUADS={1,2,11,12,21,22,31,32}

def parse_field_size(text):
    """Return the number of unique U18B competitors listed in a report."""
    usbc_ids=set(re.findall(r"\b\d{2,4}-\d{3,6}\b",text))
    ranks=[]
    for line in text.splitlines():
        match=re.match(r"^\s*(\d{1,4})(?:T)?\s+.+?\b\d{2,4}-\d{3,6}\b",line)
        if match:
            ranks.append(int(match.group(1)))
    candidates=[len(usbc_ids)]
    if ranks:
        candidates.append(max(ranks))
    return max(candidates) if any(candidates) else None

def parse_reported_u18b_squads(text):
    """Return U18B squad numbers represented in the report."""
    return {
        int(value)
        for value in re.findall(r"\bSquad\s+(\d+)\s+Day\s+1\b",text,re.I)
    }

DATA = Path(__file__).resolve().parents[1] / "data" / "dashboard.json"

def discover_pdf_links():
    html=requests.get(RESULTS_PAGE,timeout=30).text
    soup=BeautifulSoup(html,"html.parser")
    links={}
    u18=soup.find(string=re.compile(r"U18 DIVISION",re.I))
    scope=u18.parent.parent if u18 else soup
    for a in scope.find_all("a",href=True):
        txt=" ".join(a.get_text(" ",strip=True).split())
        href=a["href"]
        if "Qualifying_Round" in href and "U18Boys" in href:
            m=re.search(r"Round%20?(\d)|Round(\d)",href,re.I)
            if m:
                n=int(next(x for x in m.groups() if x))
                links[n]=href
    # Stable fallback URLs
    for n in range(1,5):
        links.setdefault(n,f"https://scores.bowl.com/2026-JG/Qualifying_Round%20{n}_U18Boys.pdf?v=new")
    return links

def extract_pdf(url):
    r=requests.get(url,timeout=45)
    r.raise_for_status()
    with pdfplumber.open(io.BytesIO(r.content)) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


def parse_source_updated_at(text):
    """Return the official Bowl.com report 'as of' timestamp in Central Time."""
    match=re.search(
        r"Unofficial Results\s*-\s*as of:\s*"
        r"([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)",
        text,
        re.I
    )
    if not match:
        return None
    parsed=datetime.strptime(match.group(1), "%b %d, %Y %I:%M %p")
    return parsed.replace(tzinfo=ZoneInfo("America/Chicago"))

def parse_athlete(text):
    """Return the four game scores from Jack's standings row.

    The report also includes total and decimal average values after the games.
    Parsing the last four small numbers mistakenly treats parts of the average
    as game scores, so only read the first four integers after the hometown.
    """
    for line in text.splitlines():
        if ATHLETE.lower() not in line.lower():
            continue
        hometown=re.search(r",\s*AL\s+(?P<tail>.+)$", line, re.I)
        tail=hometown.group("tail") if hometown else line.split(ATHLETE,1)[-1]
        values=[int(x) for x in re.findall(r"(?<![.\d])\d{1,3}(?![.\d])", tail)]
        scores=[n for n in values if 0 <= n <= 300]
        if len(scores) >= 4:
            return scores[:4]
    return []

def parse_alabama_bowlers(text, round_number):
    """Parse Alabama rows and preserve the four posted scores for this round."""
    bowlers=[]
    lines=[" ".join(line.split()) for line in text.splitlines()]
    for line in lines:
        if ", AL " not in line and not line.endswith(", AL"):
            continue

        match=re.match(
            r"^(?P<rank>\d+)(?P<tied>T)?\s+"
            r"(?P<name>.+?)\s+"
            r"(?P<usbc>\d{2,4}-\d+)\s+"
            r"(?P<city>.+?, AL)\s+"
            r"(?P<numbers>.+)$",
            line
        )
        if not match:
            continue

        number_text=match.group("numbers")
        integers=[int(x) for x in re.findall(r"(?<![.\d])\d{1,4}(?![.\d])",number_text)]
        game_candidates=[n for n in integers if 0 <= n <= 300]
        games=game_candidates[:4]
        totals=[n for n in integers if n > 300]
        total=totals[-1] if totals else (sum(games) if games else None)
        if total is None:
            continue

        games_complete=max(round_number*4, len(games))
        average=round(total/games_complete,2) if games_complete else None

        bowlers.append({
            "rank":int(match.group("rank")),
            "tied":bool(match.group("tied")),
            "name":match.group("name").strip(),
            "hometown":match.group("city"),
            "games_complete":games_complete,
            "total":total,
            "average":average,
            "block":{
                "round":round_number,
                "games":games,
                "total":sum(games) if games else None
            }
        })
    return bowlers

def merge_alabama_bowlers(existing, incoming):
    """Merge successive round reports into one bowler profile per name."""
    profiles={b["name"].lower():b for b in existing}
    for row in incoming:
        key=row["name"].lower()
        profile=profiles.get(key,{
            "name":row["name"],
            "hometown":row["hometown"],
            "blocks":[]
        })

        profile.update({
            "rank":row["rank"],
            "tied":row["tied"],
            "name":row["name"],
            "hometown":row["hometown"],
            "games_complete":row["games_complete"],
            "total":row["total"],
            "average":row["average"]
        })

        block=row.get("block")
        if block:
            blocks=[b for b in profile.get("blocks",[]) if b.get("round") != block.get("round")]
            blocks.append(block)
            profile["blocks"]=sorted(blocks,key=lambda b:b.get("round",0))

        profiles[key]=profile

    return sorted(profiles.values(),key=lambda b:(b.get("rank",99999),b.get("name","")))


def estimate_cut(text, cut_place=192):
    # Parse lines beginning with place. Return total for cut place when available.
    for line in text.splitlines():
        if re.match(rf"^\s*{cut_place}(?:T)?\s",line):
            nums=[int(x) for x in re.findall(r"\b\d{3,4}\b",line)]
            if nums: return nums[-1]
    return None

def main():
    data=json.loads(DATA.read_text())
    links=discover_pdf_links()
    all_games=[]; cut_total=None; alabama=[]
    latest_source_time=None; latest_source_round=None; latest_source_url=None
    successful_fetches=0
    field_size=None; reported_u18b_squads=set()
    for n in range(1,5):
        try:
            text=extract_pdf(links[n])
            successful_fetches += 1
            source_time=parse_source_updated_at(text)
            parsed_field_size=parse_field_size(text)
            if parsed_field_size and (field_size is None or parsed_field_size > field_size):
                field_size=parsed_field_size
            if n==1:
                reported_u18b_squads |= parse_reported_u18b_squads(text)
            if source_time and (latest_source_time is None or source_time > latest_source_time):
                latest_source_time=source_time
                latest_source_round=ROUNDS[n-1]
                latest_source_url=links[n]
            games=parse_athlete(text)
            data["blocks"][n-1]["games"]=games
            data["blocks"][n-1]["total"]=sum(games) if games else None
            if n==1: cut_total=estimate_cut(text)
            found_alabama=parse_alabama_bowlers(text,n)
            if found_alabama: alabama=merge_alabama_bowlers(alabama,found_alabama)
            all_games.extend(games)
        except Exception as exc:
            print(f"Round {n}: {exc}")
    total=sum(all_games); count=len(all_games)
    current=data["current"]
    current["total"]=total
    current["games_complete"]=count
    current["average"]=round(total/count,2) if count else None
    if cut_total is not None:
        current["pins_from_cut"]=total-cut_total
    target=190*16
    remaining=16-count
    current["needed_average"]=round((target-total)/remaining,1) if remaining else None
    if field_size:
        current["field_size"]=field_size
        field_is_final=EXPECTED_U18B_SQUADS.issubset(reported_u18b_squads)
        data["field_size"]={
            "current_report":field_size,
            "is_final":field_is_final,
            "reported_squads":sorted(reported_u18b_squads),
            "expected_squads":sorted(EXPECTED_U18B_SQUADS),
            "note":(
                "Total U18B participants."
                if field_is_final
                else "Participants posted in the latest Round 1 report. The count will increase as remaining Day 1 squads are posted."
            )
        }
    data["cut_projection"]={
        "status":"placeholder",
        "official":False,
        "label":"Placeholder estimate",
        "title":"There is no official cut yet",
        "explanation":"The official U18 Boys first cut is set only after every competitor completes all 16 qualifying games. The values shown are temporary planning aids and may move substantially as more squads and rounds are posted.",
        "gap_basis":"Temporary comparison to 192nd place in the Round 1 report",
        "needed_average_basis":"Temporary calculation using a fixed 190.0 final-average target",
        "warning":"Do not present these values as the official advancement cut."
    }
    if alabama:
        data["alabama_bowlers"]=alabama
        jack=next((b for b in alabama if b["name"].lower()=="jack wix"),None)
        if jack:
            current["position"]=jack["rank"]
    checked_at=datetime.now(ZoneInfo("America/Chicago"))
    alabama_complete_after=datetime(2026,7,14,0,0,tzinfo=ZoneInfo("America/Chicago"))
    alabama_is_complete=checked_at >= alabama_complete_after
    data["alabama_status"]={
        "status":"complete" if alabama_is_complete else "partial",
        "complete_after":alabama_complete_after.isoformat(),
        "partial_note":"Additional Alabama U18 Boys are scheduled to bowl later today. This list will expand as Bowl.com posts their scores and will be complete after today's squads.",
        "complete_note":"The Alabama U18 Boys list is complete for the field and reflects the latest Bowl.com report."
    }
    previous_source=data.get("source_status", {})
    if latest_source_time:
        age_minutes=max(0, int((checked_at-latest_source_time).total_seconds()/60))
        # During active competition, flag a report older than three hours as delayed.
        source_state="current" if age_minutes <= 180 else "delayed"
        data["source_status"]={
            "status":source_state,
            "last_updated_at":latest_source_time.isoformat(),
            "last_checked_at":checked_at.isoformat(),
            "report":latest_source_round,
            "source_url":latest_source_url,
            "age_minutes":age_minutes
        }
    elif successful_fetches:
        data["source_status"]={
            **previous_source,
            "status":"unknown",
            "last_checked_at":checked_at.isoformat()
        }
    else:
        data["source_status"]={
            **previous_source,
            "status":"unavailable",
            "last_checked_at":checked_at.isoformat()
        }
    data["updated_at"]=checked_at.isoformat()
    DATA.write_text(json.dumps(data,indent=2)+"\n")
if __name__=="__main__": main()
