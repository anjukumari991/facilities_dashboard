from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "dashboard"))

from local_storage import ExpenseLibrary, REQUIRED_SUBDIRECTORIES, SettingsStore  # noqa: E402


class LocalStorageStructureTests(unittest.TestCase):
    def test_configuring_base_directory_creates_complete_structure(self) -> None:
        with tempfile.TemporaryDirectory(prefix="facilities-base-structure-test-") as temporary:
            root = Path(temporary)
            base = root / "Facilities Data"
            base.mkdir()
            library = ExpenseLibrary(SettingsStore(root / "settings.json"))

            library.configure(base)

            self.assertEqual(library.base_dir, base.resolve())
            for directory_name in REQUIRED_SUBDIRECTORIES:
                self.assertTrue((base / directory_name).is_dir(), directory_name)
            summary = library.summary()
            self.assertEqual(summary["surveys_dir"], str((base / "surveys").resolve()))

    def test_selecting_expenses_folder_creates_sibling_structure(self) -> None:
        with tempfile.TemporaryDirectory(prefix="facilities-expenses-selection-test-") as temporary:
            base = Path(temporary)
            expenses = base / "expenses"
            expenses.mkdir()
            library = ExpenseLibrary(SettingsStore(base / "settings.json"))

            library.configure(expenses)

            self.assertEqual(library.base_dir, base.resolve())
            for directory_name in REQUIRED_SUBDIRECTORIES:
                self.assertTrue((base / directory_name).is_dir(), directory_name)


if __name__ == "__main__":
    unittest.main()
