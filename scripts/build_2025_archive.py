#!/usr/bin/env python3
"""Build the immutable 2025 U18 Boys dataset for the Bowler Explorer."""
from __future__ import annotations

import argparse
import io
import json
import time
from datetime import datetime
from pathlib import Path

import pdfplumber
from pypdf import PdfReader

import update_results as updater


RESULTS_PAGE = "https://bowl.com/youth/youth-tournaments/junior-gold-championships/2025-results"
REPORTS = {
    round_number: f"https://scores.bowl.com/2025-JG/Qualifying_Round%20{round_number}_U18Boys.pdf"
    for round_number in (1, 2, 4)
}


def download_pdf(url: str, session) -> bytes:
    response = session.get(f"{url}?v={int(time.time())}", timeout=90)
    response.raise_for_status()
    if not response.content.startswith(b"%PDF"):
        raise ValueError(f"{url} did not return a PDF")
    return response.content


def extract_standard_pdf(content: bytes) -> str:
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


def decode_2025_round_two(content: bytes) -> str:
    """Decode the reversed single-byte font embedded in the archived Day 2 PDF."""
    raw = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(content)).pages)
    decoded: list[str] = []
    for character in raw:
        codepoint = ord(character)
        original = 288 - codepoint
        decoded.append(chr(original) if 162 <= codepoint <= 255 and 32 <= original <= 126 else character)
    return "".join(decoded)


def build_reports() -> list[updater.Report]:
    session = updater.build_session()
    reports: list[updater.Report] = []
    for round_number, url in REPORTS.items():
        content = download_pdf(url, session)
        text = decode_2025_round_two(content) if round_number == 2 else extract_standard_pdf(content)
        updated_at = updater.parse_source_updated_at(text)
        rows = updater.parse_standings(text, round_number, allow_partial=round_number == 4)
        if updated_at is None or not rows:
            raise RuntimeError(f"2025 Round {round_number} did not contain a valid standings table")
        reports.append(updater.Report(round_number, url, text, updated_at, rows))
        print(f"2025 Round {round_number}: parsed {len(rows)} bowlers")
    return reports


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=updater.EXPLORER_DATA)
    args = parser.parse_args()

    reports = build_reports()
    final_report = next(report for report in reports if report.round_number == 4)
    final_ids = {row["usbc_id"] for row in final_report.rows}
    if len(final_ids) != 1341:
        raise RuntimeError(f"Expected 1,341 final U18 Boys entries; parsed {len(final_ids)}")

    checked_at = datetime.now(updater.CENTRAL)
    data = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else {"version": 1, "years": {}}
    archive = updater.build_all_bowler_profiles(
        reports,
        year=2025,
        source_page=RESULTS_PAGE,
        checked_at=checked_at,
        field_size=1341,
        status="final",
        derive_missing_blocks=True,
    )
    archive["archive_note"] = (
        "The official 2025 Day 3 PDF is image-based. When individual Day 3 games were not machine-readable, "
        "the block total is derived from the official Day 2 grand total and Day 4 previous-total column and is labeled accordingly."
    )
    data.setdefault("version", 1)
    data.setdefault("years", {})["2025"] = archive
    data["updated_at"] = checked_at.isoformat()
    updater.write_json_atomic(args.output, data, compact=True)

    jack = next(profile for profile in archive["bowlers"] if profile["name"].casefold() == "jack wix")
    assert jack["total"] == 2631
    assert jack["rank"] == 1009
    print(f"Wrote {len(archive['bowlers'])} searchable 2025 profiles to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
