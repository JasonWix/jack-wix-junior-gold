import importlib.util
import json
import sys
import unittest
from copy import deepcopy
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "update_results.py"
DATA = Path(__file__).resolve().parents[1] / "data" / "dashboard.json"
EXPLORER_DATA = Path(__file__).resolve().parents[1] / "data" / "bowlers.json"
SPEC = importlib.util.spec_from_file_location("update_results", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


ROUND_ONE = """U18 Boys 2026 Junior Gold Championships
- Unofficial Results - as of: Jul 13, 2026 06:56 PM
4 Braden Mauro 22-78788 Birmingham, AL Squad 21 Day 1 198 278 225 206 907 907 226.75 +1074
364 Jack Wix 22-96140 Cullman, AL Squad 01 Day 1 132 190 163 221 706 706 176.50 -944
364 Another Bowler 22-99999 Mobile, AL Squad 22 Day 1 170 180 180 176 706 706 176.50 -944
"""

ROUND_TWO = """U18 Boys 2026 Junior Gold Championships
- Unofficial Results - as of: Jul 14, 2026 10:20 PM
200 Jack Wix 22-96140 Cullman, AL Squad 01 Day 2 706 190 200 210 220 820 1526 190.75 -744
"""


class ParserTests(unittest.TestCase):
    def test_discovers_literal_space_link(self):
        parsed = MODULE.canonical_report_url(
            "https://scores.bowl.com/2026-JG/Qualifying_Round 1_U18Boys.pdf??"
        )
        self.assertEqual(parsed[0], 1)
        self.assertEqual(
            parsed[1],
            "https://scores.bowl.com/2026-JG/Qualifying_Round%201_U18Boys.pdf",
        )

    def test_round_one_ignores_squad_and_day_numbers(self):
        rows = MODULE.parse_standings(ROUND_ONE, 1)
        jack = MODULE.row_for_athlete(rows)
        self.assertEqual(jack["games"], [132, 190, 163, 221])
        self.assertEqual(jack["block_total"], 706)
        self.assertEqual(jack["grand_total"], 706)
        self.assertEqual(jack["rank"], 364)
        self.assertTrue(jack["tied"])

    def test_round_two_handles_previous_total(self):
        rows = MODULE.parse_standings(ROUND_TWO, 2)
        jack = MODULE.row_for_athlete(rows)
        self.assertEqual(jack["games"], [190, 200, 210, 220])
        self.assertEqual(jack["block_total"], 820)
        self.assertEqual(jack["grand_total"], 1526)
        self.assertEqual(jack["games_complete"], 8)
        self.assertEqual(jack["previous_total"], 706)

    def test_archive_parser_accepts_incomplete_final_entry(self):
        text = (
            "1341 Jose Jimenez 22-4726 New York, FC Squad 32 Day 4 "
            "1080 0 0 0 0 0 1080 90.00 -212012\n"
        )
        self.assertEqual(MODULE.parse_standings(text, 4), [])
        rows = MODULE.parse_standings(text, 4, allow_partial=True)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["games_complete"], 12)
        self.assertEqual(rows[0]["grand_total"], 1080)

    def test_accepts_missing_state_and_glued_usbc_id(self):
        text = (
            "84 Pedro Diaz Gonzalez 11-454483 Guaynabo, Squad 01 Day 1 200 206 195 201 802 802 200.50 +24\n"
            "344 Michael N Montgomery15-67969 Kansas City, KS Squad 01 Day 1 129 187 220 175 711 711 177.75 -894\n"
        )
        rows = MODULE.parse_standings(text, 1)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["hometown"], "Guaynabo,")
        self.assertEqual(rows[0]["state"], "")
        self.assertEqual(rows[1]["name"], "Michael N Montgomery")
        self.assertEqual(rows[1]["state"], "KS")

    def test_rejects_arithmetic_mismatch(self):
        bad = ROUND_ONE.replace("907 907", "906 907", 1)
        names = [row["name"] for row in MODULE.parse_standings(bad, 1)]
        self.assertNotIn("Braden Mauro", names)

    def test_alabama_profiles_exclude_non_alabama(self):
        text = ROUND_ONE + "1 Jane Doe 22-11111 Atlanta, GA Squad 01 Day 1 200 200 200 200 800 800 200.00 +0\n"
        rows = MODULE.parse_standings(text, 1)
        report = MODULE.Report(1, "https://example.test/r1.pdf", text, MODULE.parse_source_updated_at(text), rows)
        profiles = MODULE.build_alabama_profiles([report])
        self.assertEqual({profile["name"] for profile in profiles}, {"Braden Mauro", "Jack Wix", "Another Bowler"})

    def test_partial_new_round_does_not_drop_prior_alabama_bowlers(self):
        first_rows = MODULE.parse_standings(ROUND_ONE, 1)
        second_rows = MODULE.parse_standings(ROUND_TWO, 2)
        first = MODULE.Report(1, "https://example.test/r1.pdf", ROUND_ONE, MODULE.parse_source_updated_at(ROUND_ONE), first_rows)
        second = MODULE.Report(2, "https://example.test/r2.pdf", ROUND_TWO, MODULE.parse_source_updated_at(ROUND_TWO), second_rows)
        profiles = MODULE.build_alabama_profiles([first, second])
        by_name = {profile["name"]: profile for profile in profiles}
        self.assertEqual(set(by_name), {"Braden Mauro", "Jack Wix", "Another Bowler"})
        self.assertEqual(by_name["Jack Wix"]["games_complete"], 8)
        self.assertEqual(len(by_name["Jack Wix"]["blocks"]), 2)

        dashboard = {"current": {}, "blocks": [{"round": n, "games": [], "total": None} for n in range(1, 5)]}
        MODULE.update_dashboard(dashboard, [first, second], second.updated_at)
        self.assertEqual(dashboard["current"]["field_size"], 3)

    def test_history_does_not_duplicate_unchanged_results(self):
        rows = MODULE.parse_standings(ROUND_ONE, 1)
        report = MODULE.Report(1, "https://example.test/r1.pdf", ROUND_ONE, MODULE.parse_source_updated_at(ROUND_ONE), rows)
        dashboard = {"current": {}, "blocks": [{"round": n, "games": [], "total": None} for n in range(1, 5)]}

        MODULE.update_dashboard(dashboard, [report], report.updated_at)
        MODULE.update_dashboard(dashboard, [report], report.updated_at.replace(minute=57))

        self.assertEqual(len(dashboard["history"]), 1)
        self.assertEqual(dashboard["history"][0]["games_complete"], 4)

    def test_history_appends_when_a_new_block_posts(self):
        first_rows = MODULE.parse_standings(ROUND_ONE, 1)
        second_rows = MODULE.parse_standings(ROUND_TWO, 2)
        first = MODULE.Report(1, "https://example.test/r1.pdf", ROUND_ONE, MODULE.parse_source_updated_at(ROUND_ONE), first_rows)
        second = MODULE.Report(2, "https://example.test/r2.pdf", ROUND_TWO, MODULE.parse_source_updated_at(ROUND_TWO), second_rows)
        dashboard = {"current": {}, "blocks": [{"round": n, "games": [], "total": None} for n in range(1, 5)]}

        MODULE.update_dashboard(dashboard, [first], first.updated_at)
        MODULE.update_dashboard(dashboard, [first, second], second.updated_at)

        self.assertEqual([item["games_complete"] for item in dashboard["history"]], [4, 8])
        self.assertEqual(dashboard["history"][-1]["position"], 200)
        self.assertEqual(dashboard["history"][-1]["source_url"], "https://example.test/r2.pdf?v=new")
        self.assertAlmostEqual(
            dashboard["history"][-1]["cut_pace_average"],
            dashboard["history"][-1]["projected_cut_total"] / 16,
            places=2,
        )

    def test_archived_2025_comparison_is_internally_consistent(self):
        data = json.loads(DATA.read_text(encoding="utf-8"))
        previous = data["year_comparison"]["previous_year"]
        running_total = 0

        self.assertEqual(previous["year"], 2025)
        self.assertEqual(previous["division"], "U18 Boys")
        self.assertEqual(previous["field_size"], 1341)
        self.assertEqual(len(previous["blocks"]), 4)

        for round_number, block in enumerate(previous["blocks"], start=1):
            self.assertEqual(block["round"], round_number)
            self.assertEqual(len(block["games"]), 4)
            self.assertEqual(sum(block["games"]), block["total"])
            running_total += block["total"]
            self.assertEqual(block["cumulative_total"], running_total)
            self.assertAlmostEqual(
                block["cumulative_average"],
                round(running_total / (round_number * 4), 2),
                places=2,
            )
            self.assertTrue(block["source_url"].startswith("https://scores.bowl.com/2025-JG/"))

        final = previous["final_qualifying"]
        self.assertEqual(final["total"], running_total)
        self.assertEqual(final["total"], 2631)
        self.assertEqual(final["position"], 1009)
        self.assertEqual(final["field_size"], 1341)
        self.assertAlmostEqual(final["average"], round(running_total / 16, 2), places=2)

    def test_live_updater_preserves_archived_2025_comparison(self):
        data = json.loads(DATA.read_text(encoding="utf-8"))
        expected = deepcopy(data["year_comparison"])
        rows = MODULE.parse_standings(ROUND_ONE, 1)
        report = MODULE.Report(
            1,
            "https://example.test/r1.pdf",
            ROUND_ONE,
            MODULE.parse_source_updated_at(ROUND_ONE),
            rows,
        )

        MODULE.update_dashboard(data, [report], report.updated_at)

        self.assertEqual(data["year_comparison"], expected)

    def test_bowler_explorer_archive_has_every_2025_entry(self):
        explorer = json.loads(EXPLORER_DATA.read_text(encoding="utf-8"))
        archive = explorer["years"]["2025"]
        live = explorer["years"]["2026"]

        self.assertEqual(archive["field_size"], 1341)
        self.assertEqual(len(archive["bowlers"]), 1341)
        self.assertEqual(len({bowler["id"] for bowler in archive["bowlers"]}), 1341)
        self.assertEqual(len(live["bowlers"]), live["field_size"])

        jack_2025 = next(bowler for bowler in archive["bowlers"] if bowler["name"] == "Jack Wix")
        jack_2026 = next(bowler for bowler in live["bowlers"] if bowler["name"] == "Jack Wix")
        self.assertEqual((jack_2025["total"], jack_2025["rank"]), (2631, 1009))
        self.assertGreater(jack_2026["games_complete"], 0)
        self.assertGreater(jack_2026["total"], 0)
        self.assertEqual(
            jack_2026["total"],
            sum(block["total"] for block in jack_2026["blocks"]),
        )
        self.assertAlmostEqual(
            jack_2026["average"],
            jack_2026["total"] / jack_2026["games_complete"],
            delta=0.01,
        )
        self.assertGreater(jack_2026["rank"], 0)
        self.assertLessEqual(jack_2026["rank"], jack_2026["field_size"])
        self.assertFalse(
            any(
                block["total"] == 0
                for bowler in archive["bowlers"]
                for block in bowler.get("blocks", [])
            )
        )

    def test_live_explorer_update_preserves_2025_archive(self):
        explorer = json.loads(EXPLORER_DATA.read_text(encoding="utf-8"))
        expected_archive = deepcopy(explorer["years"]["2025"])
        rows = MODULE.parse_standings(ROUND_ONE, 1)
        report = MODULE.Report(
            1,
            "https://example.test/r1.pdf",
            ROUND_ONE,
            MODULE.parse_source_updated_at(ROUND_ONE),
            rows,
        )

        MODULE.update_bowler_explorer_data(explorer, [report], report.updated_at)

        self.assertEqual(explorer["years"]["2025"], expected_archive)
        self.assertEqual(len(explorer["years"]["2026"]["bowlers"]), 3)
        self.assertEqual(
            next(bowler for bowler in explorer["years"]["2026"]["bowlers"] if bowler["name"] == "Jack Wix")["games_complete"],
            4,
        )


if __name__ == "__main__":
    unittest.main()
