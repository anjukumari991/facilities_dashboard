from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "dashboard"))

from audit_reports import list_audit_reports  # noqa: E402


class AuditReportTests(unittest.TestCase):
    def test_lists_reports_from_month_folders(self) -> None:
        with tempfile.TemporaryDirectory(prefix="facilities-audit-test-") as temporary_name:
            base = Path(temporary_name)
            october = base / "audit_reports" / "Oct2026"
            september = base / "audit_reports" / "September 2026"
            october.mkdir(parents=True)
            september.mkdir(parents=True)
            (october / "Lunch Audit.pdf").write_bytes(b"pdf")
            (october / "Vendor Review.xlsx").write_bytes(b"xlsx")
            (september / "Summary.docx").write_bytes(b"docx")
            payload = list_audit_reports(base)
            self.assertEqual(payload["meta"]["report_count"], 3)
            self.assertEqual(payload["meta"]["months"], ["2026-09-01", "2026-10-01"])
            self.assertEqual(
                {report["icon"] for report in payload["reports"]},
                {"pdf", "excel", "word"},
            )

    def test_ignores_files_without_a_valid_month_folder(self) -> None:
        with tempfile.TemporaryDirectory(prefix="facilities-audit-test-") as temporary_name:
            base = Path(temporary_name)
            root = base / "audit_reports"
            invalid = root / "Current"
            invalid.mkdir(parents=True)
            (root / "root-report.pdf").write_bytes(b"pdf")
            (invalid / "report.pdf").write_bytes(b"pdf")
            payload = list_audit_reports(base)
            self.assertEqual(payload["reports"], [])
            self.assertEqual(payload["meta"]["ignored_files"], 2)


if __name__ == "__main__":
    unittest.main()
