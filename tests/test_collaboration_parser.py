from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest

from openpyxl import Workbook


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "dashboard"))

from collaboration_parser import SHEET_NAME, load_collaborations, plan_year_for_month  # noqa: E402


HEADERS = ["Month", "Department", "Activity / Collaboration", "Status", "Timeline", "Outcome"]


class CollaborationParserTests(unittest.TestCase):
    def workbook_path(self, rows: list[list[object]], *, headers: list[str] = HEADERS) -> Path:
        temporary_directory = Path(tempfile.mkdtemp(prefix="facilities-collaboration-test-"))
        path = temporary_directory / "facilities.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = SHEET_NAME
        sheet.append(["Facilities collaboration register"])
        sheet.append(headers)
        for row in rows:
            sheet.append(row)
        workbook.save(path)
        workbook.close()
        self.addCleanup(lambda: temporary_directory.rmdir())
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        return path

    def test_parses_plan_years_and_dynamic_statuses(self) -> None:
        path = self.workbook_path(
            [
                ["Jun 2026", "Finance", "Budget planning", "Planned", "Complete by Jun", ""],
                ["Sep 2026", "People Experience Team", "Anniversary gift program", "Completed", "Completed by Sep 26", "Positive experience"],
                ["Jan 2027", "IT", "Access review", "Ongoing", "Jan–Mar 2027", "Actions in progress"],
                ["Oct 2026", "Operations", "Workspace review", "Awaiting Approval", "Oct 2026", "Options shared"],
            ]
        )
        payload = load_collaborations(path)
        self.assertEqual(payload["meta"]["record_count"], 4)
        self.assertEqual([item["label"] for item in payload["meta"]["plan_years"]], ["PY25", "PY26"])
        self.assertIn("Awaiting Approval", payload["meta"]["statuses"])
        self.assertEqual(payload["records"][0]["plan_year"], "PY25")
        self.assertEqual(payload["records"][-1]["plan_year"], "PY26")

    def test_deduplicates_exact_rows_and_uses_last_conflicting_update(self) -> None:
        base = ["Sep 2026", "Finance", "Budget review", "Planned", "Sep 2026", "Draft prepared"]
        changed = ["Sep 2026", "Finance", "Budget review", "Completed", "Sep 2026", "Approved"]
        payload = load_collaborations(self.workbook_path([base, base, changed]))
        self.assertEqual(payload["meta"]["record_count"], 1)
        self.assertEqual(payload["meta"]["duplicate_count"], 1)
        self.assertEqual(payload["meta"]["conflicting_duplicates"], 1)
        self.assertEqual(payload["records"][0]["status"], "Completed")

    def test_invalid_rows_are_counted_without_exposing_them(self) -> None:
        payload = load_collaborations(
            self.workbook_path([["not a month", "Finance", "Budget review", "Planned", "", ""]])
        )
        self.assertEqual(payload["records"], [])
        self.assertEqual(payload["meta"]["invalid_rows"], 1)

    def test_missing_sheet_returns_empty_payload(self) -> None:
        temporary_directory = Path(tempfile.mkdtemp(prefix="facilities-collaboration-test-"))
        path = temporary_directory / "facilities.xlsx"
        workbook = Workbook()
        workbook.active.title = "Expenses"
        workbook.save(path)
        workbook.close()
        try:
            payload = load_collaborations(path)
            self.assertFalse(payload["meta"]["sheet_found"])
            self.assertEqual(payload["records"], [])
        finally:
            path.unlink(missing_ok=True)
            temporary_directory.rmdir()

    def test_plan_year_starts_in_july(self) -> None:
        from datetime import date

        self.assertEqual(plan_year_for_month(date(2026, 6, 1)), "PY25")
        self.assertEqual(plan_year_for_month(date(2026, 7, 1)), "PY26")

    def test_accepts_legacy_activity_header_without_spaces(self) -> None:
        legacy_headers = ["Month", "Department", "Activity/Collaboration", "Status", "Timeline", "Outcome"]
        payload = load_collaborations(
            self.workbook_path(
                [["Sep 2026", "Finance", "Budget planning", "Planned", "Sep 2026", ""]],
                headers=legacy_headers,
            )
        )
        self.assertEqual(payload["records"][0]["activity"], "Budget planning")


if __name__ == "__main__":
    unittest.main()
