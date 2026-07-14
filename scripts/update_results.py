#!/usr/bin/env python3
"""Refresh the Junior Gold dashboard from official Bowl.com U18 Boys PDFs."""
from __future__ import annotations

import argparse
import io
import json
import math
import re
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import pdfplumber
import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


RESULTS_PAGE = "https://bowl.com/youth/youth-tournaments/junior-gold-championships/2026-results"
REPORT_BASE = "https://scores.bowl.com/2026-JG/"
ATHLETE = "Jack Wix"
ROUNDS = [f"Qualifying Round {number}" for number in range(1, 5)]
EXPECTED_U18B_SQUADS = {1, 2, 11, 12, 21, 22, 31, 32}
CENTRAL = ZoneInfo("America/Chicago")
DATA = Path(__file__).resolve().parents[1] / "data" / "dashboard.json"
HISTORY_LIMIT = 96

REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; JackWixJuniorGoldDashboard/2.0)",
    "Accept": "text/html,application/pdf;q=0.9,*/*;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

ROW_RE = re.compile(
    r"^(?P<rank>\d{1,4})(?P<tied>T)?\s+"
    r"(?P<name>.+?)\s*"
    r"(?P<usbc>\d{1,6}-\d{1,6})\s+"
    r"(?P<hometown>.+?)\s+"
    r"Squad\s+(?P<squad>\d+)\s+Day\s+(?P<day>\d+)\s+"
    r"(?P<tail>.+)$",
    re.I,
)


@dataclass(frozen=True)
class Report:
    round_number: int
    url: str
    text: str
    updated_at: datetime
    rows: list[dict]


def build_session() -> requests.Session:
    retry = Retry(
        total=4,
        connect=4,
        read=4,
        backoff_factor=1.0,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
    )
    session = requests.Session()
    session.headers.update(REQUEST_HEADERS)
    session.mount("https://", HTTPAdapter(max_retries=retry))
    return session


def canonical_report_url(url: str) -> tuple[int, str] | None:
    """Recognize Bowl.com's encoded or literal-space U18 Boys report links."""
    absolute = urljoin(RESULTS_PAGE, url.strip())
    parts = urlsplit(absolute)
    decoded_path = unquote(parts.path)
    match = re.search(
        r"Qualifying_Round\s*(?P<round>[1-4])_U18Boys\.pdf$",
        decoded_path,
        re.I,
    )
    if not match:
        return None
    round_number = int(match.group("round"))
    encoded_path = quote(decoded_path, safe="/-_.~")
    return round_number, urlunsplit((parts.scheme or "https", parts.netloc, encoded_path, "", ""))


def discover_pdf_links(session: requests.Session | None = None) -> dict[int, str]:
    """Discover the four reports from the results page, with stable fallbacks."""
    session = session or build_session()
    links: dict[int, str] = {}
    try:
        response = session.get(RESULTS_PAGE, timeout=30)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        for anchor in soup.find_all("a", href=True):
            parsed = canonical_report_url(anchor["href"])
            if parsed:
                round_number, url = parsed
                links[round_number] = url
    except requests.RequestException as exc:
        print(f"Results page discovery failed; using stable report URLs: {exc}")

    for round_number in range(1, 5):
        links.setdefault(
            round_number,
            f"{REPORT_BASE}Qualifying_Round%20{round_number}_U18Boys.pdf",
        )
    return links


def extract_pdf(url: str, session: requests.Session | None = None) -> str:
    """Download a report without accepting cached or non-report placeholders."""
    session = session or build_session()
    separator = "&" if "?" in url else "?"
    cache_busted_url = f"{url}{separator}v={int(time.time())}"
    response = session.get(cache_busted_url, timeout=60)
    response.raise_for_status()
    content_type = response.headers.get("content-type", "").lower()
    if not response.content.startswith(b"%PDF"):
        raise ValueError(f"Bowl.com returned non-PDF content ({content_type or 'unknown type'})")
    with pdfplumber.open(io.BytesIO(response.content)) as pdf:
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)
    if re.search(r"Results\s+Coming\s+Soon", text, re.I):
        raise ValueError("report has not been published yet")
    return text


def parse_source_updated_at(text: str) -> datetime | None:
    match = re.search(
        r"Unofficial Results\s*-\s*as of:\s*"
        r"([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)",
        text,
        re.I,
    )
    if not match:
        return None
    parsed = datetime.strptime(match.group(1), "%b %d, %Y %I:%M %p")
    return parsed.replace(tzinfo=CENTRAL)


def _parse_row(line: str, report_round: int) -> dict | None:
    """Parse one standings row and validate the four-game block arithmetically."""
    normalized = " ".join(line.split())
    match = ROW_RE.match(normalized)
    if not match or int(match.group("day")) != report_round:
        return None

    tokens = match.group("tail").split()
    # Tail layout: [previous total on Day 2+] G1 G2 G3 G4 block grand avg +/-.
    if len(tokens) < 8:
        return None
    try:
        average = float(tokens[-2])
        grand_total = int(tokens[-3])
        block_total = int(tokens[-4])
        prefix = [int(token) for token in tokens[:-4]]
    except ValueError:
        return None
    if len(prefix) < 4:
        return None
    games = prefix[-4:]
    previous_total = prefix[-5] if len(prefix) >= 5 else 0
    if any(score < 0 or score > 300 for score in games):
        return None
    if sum(games) != block_total:
        return None
    if previous_total + block_total != grand_total:
        return None

    games_complete = report_round * 4
    if abs(average - (grand_total / games_complete)) > 0.02:
        return None
    hometown = re.sub(r"\s+", " ", match.group("hometown")).strip()
    state_match = re.search(r",\s*([A-Z]{2})$", hometown, re.I)
    return {
        "rank": int(match.group("rank")),
        "tied": bool(match.group("tied")),
        "name": match.group("name").strip(),
        "usbc_id": match.group("usbc"),
        "hometown": hometown,
        "state": state_match.group(1).upper() if state_match else "",
        "squad": int(match.group("squad")),
        "round": report_round,
        "games": games,
        "block_total": block_total,
        "grand_total": grand_total,
        "average": round(average, 2),
        "games_complete": games_complete,
    }


def parse_standings(text: str, report_round: int) -> list[dict]:
    rows = [row for line in text.splitlines() if (row := _parse_row(line, report_round))]
    rank_counts: dict[int, int] = {}
    for row in rows:
        rank_counts[row["rank"]] = rank_counts.get(row["rank"], 0) + 1
    for row in rows:
        row["tied"] = row["tied"] or rank_counts[row["rank"]] > 1
    return rows


def parse_reported_u18b_squads(rows: list[dict]) -> set[int]:
    return {row["squad"] for row in rows if row["round"] == 1}


def row_for_athlete(rows: list[dict], athlete: str = ATHLETE) -> dict | None:
    wanted = athlete.casefold()
    return next((row for row in rows if row["name"].casefold() == wanted), None)


def fetch_reports(session: requests.Session | None = None) -> tuple[list[Report], dict[int, str]]:
    session = session or build_session()
    links = discover_pdf_links(session)
    reports: list[Report] = []
    for round_number in range(1, 5):
        try:
            text = extract_pdf(links[round_number], session)
            updated_at = parse_source_updated_at(text)
            rows = parse_standings(text, round_number)
            if updated_at is None or not rows:
                raise ValueError("PDF does not contain a valid U18 Boys standings table")
            reports.append(Report(round_number, links[round_number], text, updated_at, rows))
            print(
                f"Round {round_number}: {len(rows)} bowlers; "
                f"official timestamp {updated_at.isoformat()}"
            )
        except Exception as exc:
            print(f"Round {round_number}: {exc}")
    return reports, links


def build_alabama_profiles(reports: list[Report]) -> list[dict]:
    blocks_by_id: dict[str, list[dict]] = {}
    newest_by_id: dict[str, dict] = {}
    for report in sorted(reports, key=lambda item: (item.round_number, item.updated_at)):
        for row in report.rows:
            if row["state"] != "AL":
                continue
            newest_by_id[row["usbc_id"]] = row
            blocks_by_id.setdefault(row["usbc_id"], []).append(
                {
                    "round": report.round_number,
                    "games": row["games"],
                    "total": row["block_total"],
                }
            )

    profiles = []
    for usbc_id, row in newest_by_id.items():
        profiles.append(
            {
                "rank": row["rank"],
                "tied": row["tied"],
                "name": row["name"],
                "hometown": row["hometown"],
                "games_complete": row["games_complete"],
                "total": row["grand_total"],
                "average": row["average"],
                "blocks": sorted(blocks_by_id.get(usbc_id, []), key=lambda item: item["round"]),
            }
        )
    return sorted(profiles, key=lambda row: (row["rank"], row["name"]))


def provisional_cut(latest: Report) -> dict | None:
    """Return a clearly labeled current-pace comparison, never an official cut."""
    field_size = len({row["usbc_id"] for row in latest.rows})
    if not field_size:
        return None
    advancing_place = math.ceil(field_size / 7)
    ordered = sorted(latest.rows, key=lambda row: (-row["grand_total"], row["name"]))
    cut_row = ordered[min(advancing_place - 1, len(ordered) - 1)]
    pace_average = cut_row["grand_total"] / cut_row["games_complete"]
    return {
        "advancing_place": advancing_place,
        "current_score": cut_row["grand_total"],
        "projected_final_total": round(pace_average * 16),
        "games_basis": cut_row["games_complete"],
    }


def build_history_snapshot(
    current: dict,
    cut_projection: dict,
    report: Report,
    checked_at: datetime,
) -> dict:
    projected_total = cut_projection.get("projected_final_total")
    return {
        "observed_at": checked_at.isoformat(),
        "source_updated_at": report.updated_at.isoformat(),
        "report": ROUNDS[report.round_number - 1],
        "source_url": f"{report.url}?v=new",
        "games_complete": current.get("games_complete"),
        "position": current.get("position"),
        "field_size": current.get("field_size"),
        "total": current.get("total"),
        "average": current.get("average"),
        "pins_from_cut": current.get("pins_from_cut"),
        "needed_average": current.get("needed_average"),
        "projected_cut_total": projected_total,
        "cut_pace_average": (
            round(projected_total / 16, 2) if projected_total is not None else None
        ),
    }


def append_history_snapshot(data: dict, snapshot: dict) -> bool:
    """Append only meaningful official changes and keep the payload bounded."""
    history = [item for item in data.get("history", []) if isinstance(item, dict)]
    comparison_keys = (
        "source_updated_at",
        "report",
        "games_complete",
        "position",
        "field_size",
        "total",
        "average",
        "pins_from_cut",
        "needed_average",
        "projected_cut_total",
    )
    if history and all(history[-1].get(key) == snapshot.get(key) for key in comparison_keys):
        data["history"] = history[-HISTORY_LIMIT:]
        return False
    history.append(snapshot)
    data["history"] = history[-HISTORY_LIMIT:]
    return True


def update_dashboard(data: dict, reports: list[Report], checked_at: datetime) -> dict:
    previous_source = data.get("source_status", {})
    if not reports:
        data["source_status"] = {
            **previous_source,
            "status": "unavailable",
            "last_checked_at": checked_at.isoformat(),
        }
        data["updated_at"] = checked_at.isoformat()
        return data

    latest = max(reports, key=lambda report: (report.round_number, report.updated_at))
    jack_reports = [report for report in reports if row_for_athlete(report.rows)]
    if not jack_reports:
        raise RuntimeError(f"{ATHLETE} was not found in any valid report")
    jack_report = max(jack_reports, key=lambda report: (report.round_number, report.updated_at))
    jack_latest = row_for_athlete(jack_report.rows)

    for report in reports:
        jack = row_for_athlete(report.rows)
        if jack:
            block = data["blocks"][report.round_number - 1]
            block["games"] = jack["games"]
            block["total"] = jack["block_total"]

    # A newly published round can initially contain only early squads. Never let
    # that partial report shrink the published Day 1 participant count.
    field_size = max(len({row["usbc_id"] for row in report.rows}) for report in reports)
    current = data["current"]
    current.update(
        {
            "position": jack_latest["rank"],
            "total": jack_latest["grand_total"],
            "average": jack_latest["average"],
            "games_complete": jack_latest["games_complete"],
            "field_size": field_size,
        }
    )

    round_one = next((report for report in reports if report.round_number == 1), None)
    reported_squads = parse_reported_u18b_squads(round_one.rows) if round_one else set()
    field_is_final = EXPECTED_U18B_SQUADS.issubset(reported_squads)
    data["field_size"] = {
        "current_report": field_size,
        "is_final": field_is_final,
        "reported_squads": sorted(reported_squads),
        "expected_squads": sorted(EXPECTED_U18B_SQUADS),
        "note": (
            "Total U18B participants."
            if field_is_final
            else "Participants currently published in the latest official U18 Boys report. The count can increase as remaining Day 1 squads are posted."
        ),
    }

    # Compare like with like if a newer round is live before Jack bowls it.
    cut = provisional_cut(jack_report)
    remaining = max(0, 16 - jack_latest["games_complete"])
    if cut:
        current["pins_from_cut"] = jack_latest["grand_total"] - cut["current_score"]
        current["needed_average"] = (
            round((cut["projected_final_total"] - jack_latest["grand_total"]) / remaining, 1)
            if remaining
            else None
        )
    data["cut_projection"] = {
        "status": "placeholder",
        "official": False,
        "label": "Current-pace estimate",
        "title": "There is no official cut yet",
        "explanation": "The official U18 Boys first cut is set only after every competitor completes all 16 qualifying games. These values compare Jack with the current report at the provisional 1-in-7 advancing position and project that pace over 16 games.",
        "gap_basis": (
            f"Temporary comparison to place {cut['advancing_place']} in the latest {jack_report.round_number * 4}-game report containing Jack"
            if cut
            else "Temporary comparison unavailable"
        ),
        "needed_average_basis": (
            f"Temporary 16-game pace projection of {cut['projected_final_total']} pins"
            if cut
            else "Temporary projection unavailable"
        ),
        "warning": "This is a planning estimate, not the official advancement cut.",
        **(cut or {}),
    }

    data["alabama_bowlers"] = build_alabama_profiles(reports)
    data["alabama_status"] = {
        "status": "complete" if field_is_final else "partial",
        "complete_after": "2026-07-14T00:00:00-05:00",
        "partial_note": "Additional Alabama U18 Boys may appear as Bowl.com posts the remaining Day 1 squads. The list is derived from the latest official report.",
        "complete_note": "All expected Day 1 U18 Boys squads are represented; this Alabama list reflects the latest official report.",
    }

    age_minutes = max(0, int((checked_at - latest.updated_at).total_seconds() / 60))
    data["source_status"] = {
        "status": "current" if age_minutes <= 180 else "delayed",
        "last_updated_at": latest.updated_at.isoformat(),
        "last_checked_at": checked_at.isoformat(),
        "report": ROUNDS[latest.round_number - 1],
        "source_url": f"{latest.url}?v=new",
        "age_minutes": age_minutes,
        "valid_reports": [report.round_number for report in reports],
    }
    append_history_snapshot(
        data,
        build_history_snapshot(current, data["cut_projection"], jack_report, checked_at),
    )
    data["updated_at"] = checked_at.isoformat()
    return data


def write_json_atomic(path: Path, data: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    json.loads(temporary.read_text(encoding="utf-8"))
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=DATA, help="dashboard JSON path")
    args = parser.parse_args()

    data = json.loads(args.data.read_text(encoding="utf-8"))
    checked_at = datetime.now(CENTRAL)
    reports, _ = fetch_reports()
    update_dashboard(data, reports, checked_at)
    write_json_atomic(args.data, data)

    status = data.get("source_status", {}).get("status")
    current = data.get("current", {})
    print(
        f"Dashboard status={status}; Jack rank={current.get('position')}; "
        f"games={current.get('games_complete')}; total={current.get('total')}; "
        f"field={current.get('field_size')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
