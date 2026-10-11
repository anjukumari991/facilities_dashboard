from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest

from openpyxl import Workbook


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "dashboard"))

from expense_parser import load_expenses  # noqa: E402


class ExpenseParserTests(unittest.TestCase):
    def test_reorganized_pantry_reads_category_name_header(self) -> None:
        temporary_directory = Path(tempfile.mkdtemp(prefix="facilities-expense-test-"))
        path = temporary_directory / "expenses.xlsx"
        workbook = Workbook()
        lunch = workbook.active
        lunch.title = "Lunch"
        lunch.append([])
        lunch.append([])
        lunch.append([])
        lunch.append(
            [
                "Expense Month",
                "Vendor",
                "Invoice Value INR",
                "Food Orders",
                "Counts Ordered",
                "Actual Count",
                "Per Person Cost INR",
            ]
        )
        lunch.append(["Sep 2026", "Lunch Vendor", 10000, 55, 55, 50, 200])

        pantry = workbook.create_sheet("Pantry & Misc")
        pantry.append([])
        pantry.append([])
        pantry.append([])
        pantry.append(["Expense Month", "Category Name", "Vendor", "Expense Type", "Amount INR"])
        pantry.append(["Sep 2026", "Pantry", "Pantry Vendor", "Snacks", 2500])
        workbook.save(path)
        workbook.close()

        try:
            payload = load_expenses(path)
            pantry_record = next(row for row in payload["records"] if row["vendor"] == "Pantry Vendor")
            self.assertEqual(payload["meta"]["source_format"], "reorganized")
            self.assertEqual(pantry_record["report_category"], "Pantry")
            self.assertEqual(pantry_record["category"], "Snacks")
        finally:
            path.unlink(missing_ok=True)
            temporary_directory.rmdir()


if __name__ == "__main__":
    unittest.main()
