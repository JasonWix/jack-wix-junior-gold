#!/usr/bin/env python3
"""Build the searchable 2026 Junior Gold participant index from Bowl.com PDFs."""
from __future__ import annotations

import hashlib
import io
import json
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pdfplumber
import requests


CENTRAL = ZoneInfo("America/Chicago")
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "registration.json"
REPORT_BASE = "https://scores.bowl.com/2026-JG/"
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


def source_url(code: str) -> str:
    return f"{REPORT_BASE}{code}Advancer.pdf?v=new"


def normalized(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def registration_id(code: str, first: str, last: str, city: str, state: str) -> str:
    identity = "|".join((code, first.casefold(), last.casefold(), city.casefold(), state.casefold()))
    return f"reg-{code.lower()}-{hashlib.sha1(identity.encode('utf-8')).hexdigest()[:12]}"


def parse_source_as_of(text: str) -> str | None:
    match = re.search(
        r"2026 Advancers Report as of\s+([A-Z][a-z]+,\s+[A-Z][a-z]+\s+\d{1,2},\s+2026)",
        text,
    )
    if not match:
        return None
    return datetime.strptime(match.group(1), "%A, %B %d, %Y").replace(tzinfo=CENTRAL).isoformat()


def profiles_from_tables(code: str, tables: list[list[list[str | None]]]) -> list[dict]:
    division = DIVISIONS[code]
    unique: dict[tuple[str, str, str, str], dict] = {}
    for table in tables:
        for row in table or []:
            if len(row) != 8:
                continue
            last, first, city, state, event, row_division, squad_text, waiver = map(normalized, row)
            squad_match = re.fullmatch(r"Squad\s+(\d+)", squad_text, re.I)
            if row_division != division or not squad_match or not first or not last:
                continue
            identity = (first.casefold(), last.casefold(), city.casefold(), state.casefold())
            unique[identity] = {
                "id": registration_id(code, first, last, city, state),
                "name": f"{first} {last}",
                "hometown": f"{city}, {state}" if city and state else city or state,
                "city": city,
                "state": state.upper(),
                "squad": int(squad_match.group(1)),
                "division_code": code,
                "division": division,
                "qualification_event": event,
                "waiver_status": waiver,
            }
    return sorted(unique.values(), key=lambda profile: (profile["name"].casefold(), profile["hometown"].casefold()))


def download_division(code: str, session: requests.Session) -> dict:
    response = session.get(source_url(code), timeout=90, headers={"User-Agent": "JuniorGoldDashboard/3.0"})
    response.raise_for_status()
    if not response.content.startswith(b"%PDF"):
        raise ValueError(f"{code} registration source was not a PDF")
    tables: list[list[list[str | None]]] = []
    with pdfplumber.open(io.BytesIO(response.content)) as pdf:
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)
        for page in pdf.pages:
            tables.extend(page.extract_tables() or [])
    profiles = profiles_from_tables(code, tables)
    if not profiles:
        raise ValueError(f"{code} registration source contained no participant rows")
    return {
        "division_code": code,
        "division": DIVISIONS[code],
        "source_url": source_url(code),
        "source_as_of": parse_source_as_of(text),
        "participant_count": len(profiles),
        "bowlers": profiles,
    }


def main() -> None:
    session = requests.Session()
    divisions = {code: download_division(code, session) for code in DIVISIONS}
    payload = {
        "year": 2026,
        "generated_at": datetime.now(CENTRAL).isoformat(),
        "participant_count": sum(item["participant_count"] for item in divisions.values()),
        "divisions": divisions,
    }
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {payload['participant_count']:,} participants to {OUTPUT}")
    for code, item in divisions.items():
        print(f"{code}: {item['participant_count']:,}")


if __name__ == "__main__":
    main()
