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

def parse_alabama_bowlers(text):
    """Parse rows for bowlers whose hometown ends in Alabama (AL)."""
    bowlers=[]
    # pdfplumber generally keeps each standings row together. Normalize whitespace.
    lines=[" ".join(line.split()) for line in text.splitlines()]
    for line in lines:
        if ", AL " not in line and not line.endswith(", AL"):
            continue
        # Rank, name, USBC ID, hometown, then four or more score/total fields.
        match=re.match(
            r"^(?P<rank>\d+)(?P<tied>T)?\s+"
            r"(?P<name>.+?)\s+"
            r"(?P<usbc>\d{2,4}-\d+)\s+"
            r"(?P<city>.+?, AL)\s+"
            r"(?P<numbers>(?:\d+\s+)+[+-]?\d+)$",
            line
        )
        if not match:
            continue
        nums=[int(x) for x in re.findall(r"\b\d{2,4}\b",match.group("numbers"))]
        # The largest plausible value near the end is the cumulative total.
        totals=[n for n in nums if n>300]
        total=totals[-1] if totals else None
        games=[n for n in nums if 0<=n<=300]
        if total is None:
            continue
        # Infer games completed from total and scores when possible.
        games_complete=len(games)
        if games_complete not in (4,8,12,16):
            # Report rows can wrap; cumulative average gives a safer estimate.
            games_complete=max(4, round(total / max(sum(games)/len(games),1))) if games else 4
            games_complete=min(16, max(4, 4*round(games_complete/4)))
        bowlers.append({
            "rank":int(match.group("rank")),
            "tied":bool(match.group("tied")),
            "name":match.group("name").strip(),
            "hometown":match.group("city"),
            "games_complete":games_complete,
            "total":total,
            "average":round(total/games_complete,2)
        })
    # Remove duplicate wrapped rows and sort by rank/name.
    unique={}
    for b in bowlers:
        unique[(b["name"],b["total"])]=b
    return sorted(unique.values(), key=lambda b:(b["rank"],b["name"]))

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
    for n in range(1,5):
        try:
            text=extract_pdf(links[n])
            successful_fetches += 1
            source_time=parse_source_updated_at(text)
            if source_time and (latest_source_time is None or source_time > latest_source_time):
                latest_source_time=source_time
                latest_source_round=ROUNDS[n-1]
                latest_source_url=links[n]
            games=parse_athlete(text)
            data["blocks"][n-1]["games"]=games
            data["blocks"][n-1]["total"]=sum(games) if games else None
            if n==1: cut_total=estimate_cut(text)
            found_alabama=parse_alabama_bowlers(text)
            if found_alabama: alabama=found_alabama
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
