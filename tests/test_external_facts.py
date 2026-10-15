from __future__ import annotations

from pathlib import Path
import sys
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "dashboard"))

from external_facts import HolidayFactsClient, NAGER_DATE_API  # noqa: E402


class HolidayFactsTests(unittest.TestCase):
    def test_month_facts_keep_dated_applicable_holidays_and_derive_long_weekend(self) -> None:
        calls = []

        def fetch(url: str):
            calls.append(url)
            return [
                {
                    "date": "2026-05-01",
                    "name": "Test National Holiday",
                    "nationalHoliday": True,
                    "subdivisionCodes": [],
                    "holidayTypes": ["Public"],
                },
                {
                    "date": "2026-05-04",
                    "name": "Other State Holiday",
                    "nationalHoliday": False,
                    "subdivisionCodes": ["IN-MH"],
                },
            ]

        client = HolidayFactsClient(fetch_json=fetch)
        facts = client.month_facts("2026-05-01")

        self.assertEqual(calls, [f"{NAGER_DATE_API}/IN/2026"])
        self.assertEqual(facts["weekday_public_holidays"], 1)
        self.assertEqual(facts["working_days"], 20)
        self.assertEqual([item["name"] for item in facts["public_holidays"]], ["Test National Holiday"])
        self.assertEqual(facts["long_weekends"][0]["start"], "2026-05-01")
        self.assertEqual(facts["long_weekends"][0]["end"], "2026-05-03")

    def test_year_response_is_cached(self) -> None:
        calls = []
        client = HolidayFactsClient(fetch_json=lambda url: calls.append(url) or [])
        client.month_facts("2026-05-01")
        client.month_facts("2026-06-01")
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
