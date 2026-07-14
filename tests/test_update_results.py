import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "update_results.py"
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


if __name__ == "__main__":
    unittest.main()
