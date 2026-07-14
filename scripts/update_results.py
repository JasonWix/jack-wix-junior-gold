#!/usr/bin/env python3
"""Refresh Junior Gold profiles from official registration and results PDFs."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
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
EXPLORER_DATA = Path(__file__).resolve().parents[1] / "data" / "bowlers.json"
REGISTRATION_DATA = Path(__file__).resolve().parents[1] / "data" / "registration.json"
HISTORY_LIMIT = 96
DIVISIONS = {
    "U12B": "U12 Boys",
    "U12G": "U12 Girls",
    "U14B": "U14 Boys",
    "U14G": "U14 Girls",
    "U16B": "U16 Boys",
    "U16G": "U16 Girls",
    "U18B": "U18 Boys",
    "U18G": "U18 Girls",
}

REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; JackWixJuniorGoldDashboard/2.0)",
    "Accept": "text/html,application/pdf;q=0.9,*/*;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

ROW_RE = re.compile(
    r"^(?P<rank>\d{1,4})(?P<tied>T)?\s+"
    r"(?P<name>.+?)\s*"
    r"(?P<usbc>\d{1,6}-\d{1,10})\s+"
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
    division_code: str = "U18B"


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


def canonical_division_report_url(url: str) -> tuple[str, int, str] | None:
    """Recognize an official qualifying report for any supported division."""
    absolute = urljoin(RESULTS_PAGE, url.strip())
    parts = urlsplit(absolute)
    decoded_path = unquote(parts.path)
    match = re.search(
        r"Qualifying_Round\s*(?P<round>[1-4])_(?P<age>U(?:12|14|16|18))(?P<gender>Boys|Girls)\.pdf$",
        decoded_path,
        re.I,
    )
    if not match:
        return None
    round_number = int(match.group("round"))
    division_code = f"{match.group('age')}{'B' if match.group('gender').lower() == 'boys' else 'G'}"
    encoded_path = quote(decoded_path, safe="/-_.~")
    return division_code, round_number, urlunsplit((parts.scheme or "https", parts.netloc, encoded_path, "", ""))


def canonical_report_url(url: str) -> tuple[int, str] | None:
    """Backward-compatible U18 Boys report recognizer used by parser tests."""
    parsed = canonical_division_report_url(url)
    if not parsed or parsed[0] != "U18B":
        return None
    return parsed[1], parsed[2]


def discover_pdf_links(
    session: requests.Session | None = None,
    division_code: str = "U18B",
) -> dict[int, str]:
    """Discover a division's four reports, with stable URL fallbacks."""
    session = session or build_session()
    links: dict[int, str] = {}
    try:
        response = session.get(RESULTS_PAGE, timeout=30)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        for anchor in soup.find_all("a", href=True):
            parsed = canonical_division_report_url(anchor["href"])
            if parsed and parsed[0] == division_code:
                _, round_number, url = parsed
                links[round_number] = url
    except requests.RequestException as exc:
        print(f"Results page discovery failed; using stable report URLs: {exc}")

    for round_number in range(1, 5):
        links.setdefault(
            round_number,
            f"{REPORT_BASE}Qualifying_Round%20{round_number}_{DIVISIONS[division_code].replace(' ', '')}.pdf",
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


def _parse_row(line: str, report_round: int, allow_partial: bool = False) -> dict | None:
    """Parse one standings row and validate the four-game block arithmetically."""
    normalized = " ".join(line.split())
    normalized = re.sub(r"(?<=[A-Za-z,])Squad\s+", " Squad ", normalized, flags=re.I)
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
    if allow_partial:
        possible_counts = [
            count
            for count in range(max(1, (report_round - 1) * 4), (report_round * 4) + 1)
            if abs(average - (grand_total / count)) <= 0.02
        ]
        if possible_counts:
            games_complete = max(possible_counts)
    if games_complete <= 0:
        return None
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
        "previous_total": previous_total,
        "block_total": block_total,
        "grand_total": grand_total,
        "average": round(average, 2),
        "games_complete": games_complete,
    }


def parse_standings(
    text: str,
    report_round: int,
    allow_partial: bool = False,
) -> list[dict]:
    rows = [
        row
        for line in text.splitlines()
        if (row := _parse_row(line, report_round, allow_partial=allow_partial))
    ]
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


def fetch_reports(
    session: requests.Session | None = None,
    division_code: str = "U18B",
) -> tuple[list[Report], dict[int, str]]:
    session = session or build_session()
    links = discover_pdf_links(session, division_code)
    reports: list[Report] = []
    for round_number in range(1, 5):
        try:
            text = extract_pdf(links[round_number], session)
            updated_at = parse_source_updated_at(text)
            rows = parse_standings(text, round_number)
            if updated_at is None or not rows:
                raise ValueError(f"PDF does not contain a valid {DIVISIONS[division_code]} standings table")
            reports.append(Report(round_number, links[round_number], text, updated_at, rows, division_code))
            print(
                f"Round {round_number}: {len(rows)} bowlers; "
                f"official timestamp {updated_at.isoformat()}"
            )
        except Exception as exc:
            print(f"Round {round_number}: {exc}")
    return reports, links


def fetch_all_division_reports() -> tuple[dict[str, list[Report]], dict[str, dict[int, str]]]:
    """Fetch all eight divisions concurrently while keeping each session isolated."""
    reports_by_division: dict[str, list[Report]] = {}
    links_by_division: dict[str, dict[int, str]] = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_reports, None, code): code for code in DIVISIONS}
        for future in as_completed(futures):
            code = futures[future]
            try:
                reports, links = future.result()
            except Exception as exc:
                print(f"{code}: division refresh failed: {exc}")
                reports, links = [], discover_pdf_links(build_session(), code)
            reports_by_division[code] = reports
            links_by_division[code] = links
    return reports_by_division, links_by_division


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


def build_all_bowler_profiles(
    reports: list[Report],
    *,
    year: int,
    source_page: str,
    checked_at: datetime,
    field_size: int | None = None,
    status: str = "live",
    derive_missing_blocks: bool = False,
    division_code: str = "U18B",
) -> dict:
    """Build the compact source-backed dataset used by the Bowler Explorer."""
    ordered_reports = sorted(reports, key=lambda item: (item.round_number, item.updated_at))
    report_by_round = {report.round_number: report for report in ordered_reports}
    rows_by_id: dict[str, dict[int, dict]] = {}
    for report in ordered_reports:
        for row in report.rows:
            rows_by_id.setdefault(row["usbc_id"], {})[report.round_number] = row

    if field_size is None:
        field_size = len(rows_by_id)
    report_field_sizes = {
        report.round_number: len({row["usbc_id"] for row in report.rows})
        for report in ordered_reports
    }

    profiles: list[dict] = []
    for usbc_id, rows_for_bowler in rows_by_id.items():
        latest_round = max(rows_for_bowler)
        latest = rows_for_bowler[latest_round]
        blocks: dict[int, dict] = {}

        for round_number, row in sorted(rows_for_bowler.items()):
            posted_games = [score for score in row["games"] if score > 0]
            if not posted_games and row["block_total"] == 0:
                continue
            report = report_by_round[round_number]
            blocks[round_number] = {
                "round": round_number,
                "games": posted_games,
                "total": row["block_total"],
                "cumulative_total": row["grand_total"],
                "cumulative_average": row["average"],
                "position": row["rank"],
                "tied": row["tied"],
            }

        if derive_missing_blocks:
            round_two = rows_for_bowler.get(2)
            round_four = rows_for_bowler.get(4)

            # Some 2025 PDFs wrap long rows and omit game-level extraction. The
            # official cumulative totals still let us preserve the block total.
            if 1 not in blocks and round_two and round_two["previous_total"] >= 0:
                blocks[1] = {
                    "round": 1,
                    "games": [],
                    "total": round_two["previous_total"],
                    "cumulative_total": round_two["previous_total"],
                    "cumulative_average": round(round_two["previous_total"] / 4, 2),
                    "position": None,
                    "tied": False,
                    "derived": True,
                }

            if 3 not in blocks and round_two and round_four:
                day_three_total = round_four["previous_total"] - round_two["grand_total"]
                if day_three_total > 0:
                    blocks[3] = {
                        "round": 3,
                        "games": [],
                        "total": day_three_total,
                        "cumulative_total": round_four["previous_total"],
                        "cumulative_average": round(round_four["previous_total"] / 12, 2),
                        "position": None,
                        "tied": False,
                        "derived": True,
                    }

        profiles.append(
            {
                "id": usbc_id,
                "usbc_id": usbc_id,
                "name": latest["name"],
                "hometown": latest["hometown"],
                "state": latest["state"],
                "squad": latest["squad"],
                "latest_round": latest_round,
                "rank": latest["rank"],
                "tied": latest["tied"],
                "games_complete": latest["games_complete"],
                "total": latest["grand_total"],
                "average": latest["average"],
                "field_size": field_size,
                "blocks": sorted(blocks.values(), key=lambda item: item["round"]),
                "division_code": division_code,
                "division": DIVISIONS[division_code],
            }
        )

    newest_report = max(ordered_reports, key=lambda report: report.updated_at)
    return {
        "year": year,
        "division_code": division_code,
        "division": DIVISIONS[division_code],
        "status": status,
        "generated_at": checked_at.isoformat(),
        "source_page": source_page,
        "source_updated_at": newest_report.updated_at.isoformat(),
        "field_size": field_size,
        "result_profile_count": len(profiles),
        "reports": [
            {
                "round": report.round_number,
                "source_url": f"{report.url}?v=new",
                "source_updated_at": report.updated_at.isoformat(),
                "parsed_bowlers": report_field_sizes[report.round_number],
            }
            for report in ordered_reports
        ],
        "bowlers": sorted(profiles, key=lambda profile: (profile["name"].casefold(), profile["id"])),
    }


def _identity_name(value: str) -> str:
    tokens = re.findall(r"[a-z0-9]+", str(value or "").casefold())
    suffixes = {"jr", "sr", "ii", "iii", "iv", "v"}
    while tokens and tokens[-1] in suffixes:
        tokens.pop()
    # Registration reports omit middle initials; official standings often add them.
    return " ".join((tokens[0], tokens[-1])) if len(tokens) >= 2 else " ".join(tokens)


def _identity_city(value: str) -> str:
    city = str(value or "").split(",", 1)[0]
    return " ".join(re.findall(r"[a-z0-9]+", city.casefold()))


def merge_registration_and_results(registration: dict, results: dict | None) -> dict:
    """Return every registered participant, enriched with standings when matched."""
    code = registration["division_code"]
    registration_profiles = [dict(profile) for profile in registration.get("bowlers", [])]
    result_profiles = [dict(profile) for profile in (results or {}).get("bowlers", [])]
    candidates: dict[tuple[str, str], list[dict]] = {}
    candidates_by_name: dict[str, list[dict]] = {}
    for profile in registration_profiles:
        name_key = _identity_name(profile["name"])
        candidates.setdefault((name_key, profile.get("state", "")), []).append(profile)
        candidates_by_name.setdefault(name_key, []).append(profile)

    matched_registration_ids: set[str] = set()
    enriched_results: list[dict] = []
    for result in result_profiles:
        name_key = _identity_name(result["name"])
        matches = candidates.get((name_key, result.get("state", "")), [])
        if not matches and len(candidates_by_name.get(name_key, [])) == 1:
            # Results PDFs sometimes omit a state at the end of a wrapped row,
            # and hometowns can change between registration and competition.
            matches = candidates_by_name[name_key]
        if len(matches) > 1:
            city = _identity_city(result.get("hometown", ""))
            city_matches = [profile for profile in matches if _identity_city(profile.get("hometown", "")) == city]
            if city_matches:
                matches = city_matches
        match = matches[0] if len(matches) == 1 else None
        if match:
            matched_registration_ids.add(match["id"])
            result.update(
                {
                    "registration_id": match["id"],
                    "qualification_event": match.get("qualification_event"),
                    "waiver_status": match.get("waiver_status"),
                    "registration_source_url": registration.get("source_url"),
                    "registration_source_as_of": registration.get("source_as_of"),
                }
            )
        enriched_results.append(result)

    registration_only = []
    for profile in registration_profiles:
        if profile["id"] in matched_registration_ids:
            continue
        registration_only.append(
            {
                **profile,
                "registration_source_url": registration.get("source_url"),
                "registration_source_as_of": registration.get("source_as_of"),
                "latest_round": None,
                "rank": None,
                "tied": False,
                "games_complete": 0,
                "total": None,
                "average": None,
                "field_size": (results or {}).get("field_size"),
                "blocks": [],
            }
        )

    profiles = enriched_results + registration_only
    reports = (results or {}).get("reports", [])
    source_updated_at = (results or {}).get("source_updated_at")
    return {
        "year": 2026,
        "division_code": code,
        "division": registration["division"],
        "status": "live",
        "generated_at": (results or {}).get("generated_at"),
        "source_page": RESULTS_PAGE,
        "source_updated_at": source_updated_at,
        "field_size": (results or {}).get("field_size", 0),
        "result_profile_count": len(enriched_results),
        "registration_count": registration.get("participant_count", len(registration_profiles)),
        "profile_count": len(profiles),
        "reports": reports,
        "registration_source": {
            "source_url": registration.get("source_url"),
            "source_as_of": registration.get("source_as_of"),
        },
        "bowlers": sorted(profiles, key=lambda profile: (profile["name"].casefold(), profile["id"])),
    }


def update_bowler_explorer_data(
    data: dict,
    reports: list[Report] | dict[str, list[Report]],
    checked_at: datetime,
    registration_data: dict | None = None,
) -> dict:
    """Update all 2026 divisions while preserving the verified 2025 archive."""
    reports_by_division = reports if isinstance(reports, dict) else {"U18B": reports}
    registration_data = registration_data or json.loads(REGISTRATION_DATA.read_text(encoding="utf-8"))
    existing_2026 = data.get("years", {}).get("2026", {})
    existing_divisions = existing_2026.get("divisions", {})
    divisions: dict[str, dict] = {}

    for code in DIVISIONS:
        division_reports = reports_by_division.get(code, [])
        results = None
        if division_reports:
            field_size = max(len({row["usbc_id"] for row in report.rows}) for report in division_reports)
            results = build_all_bowler_profiles(
                division_reports,
                year=2026,
                source_page=RESULTS_PAGE,
                checked_at=checked_at,
                field_size=field_size,
                status="live",
                division_code=code,
            )
        elif existing_divisions.get(code):
            # A transient division-specific download failure must not turn
            # registration-only rows into fake result profiles or erase scores.
            divisions[code] = {**existing_divisions[code], "generated_at": checked_at.isoformat()}
            continue
        elif code == "U18B" and existing_2026.get("bowlers"):
            results = existing_2026
        divisions[code] = merge_registration_and_results(
            registration_data["divisions"][code],
            results,
        )
        divisions[code]["generated_at"] = checked_at.isoformat()

    u18b = divisions["U18B"]
    data.setdefault("version", 1)
    data.setdefault("years", {})["2026"] = {**u18b, "divisions": divisions}
    data["updated_at"] = checked_at.isoformat()
    return data


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


def write_json_atomic(path: Path, data: dict, *, compact: bool = False) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    serialized = (
        json.dumps(data, separators=(",", ":"))
        if compact
        else json.dumps(data, indent=2)
    )
    temporary.write_text(serialized + "\n", encoding="utf-8")
    json.loads(temporary.read_text(encoding="utf-8"))
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=DATA, help="dashboard JSON path")
    parser.add_argument(
        "--explorer-data",
        type=Path,
        default=EXPLORER_DATA,
        help="all-bowler explorer JSON path",
    )
    args = parser.parse_args()

    data = json.loads(args.data.read_text(encoding="utf-8"))
    explorer = (
        json.loads(args.explorer_data.read_text(encoding="utf-8"))
        if args.explorer_data.exists()
        else {"version": 1, "years": {}}
    )
    checked_at = datetime.now(CENTRAL)
    reports_by_division, _ = fetch_all_division_reports()
    u18b_reports = reports_by_division.get("U18B", [])
    update_dashboard(data, u18b_reports, checked_at)
    update_bowler_explorer_data(explorer, reports_by_division, checked_at)
    write_json_atomic(args.data, data)
    write_json_atomic(args.explorer_data, explorer, compact=True)

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
