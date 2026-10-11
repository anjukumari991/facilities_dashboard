from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from typing import Any


APP_DIRECTORY_NAME = "Facility Expense Dashboard"
SETTINGS_FILENAME = "settings.json"
SUPPORTED_WORKBOOK_SUFFIXES = {".xlsx", ".xlsm"}
REQUIRED_SUBDIRECTORIES = ("expenses", "surveys", "workplace", "contracts", "audit_reports")


def user_settings_directory() -> Path:
    """Return the per-user settings directory for the current platform."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_DIRECTORY_NAME
    if os.name == "nt":
        root = os.getenv("APPDATA")
        if root:
            return Path(root) / APP_DIRECTORY_NAME
        return Path.home() / "AppData" / "Roaming" / APP_DIRECTORY_NAME
    root = os.getenv("XDG_CONFIG_HOME")
    return (Path(root) if root else Path.home() / ".config") / APP_DIRECTORY_NAME


class SettingsStore:
    def __init__(self, path: Path | None = None):
        self.path = path or user_settings_directory() / SETTINGS_FILENAME
        self.lock = threading.RLock()

    def load(self) -> dict[str, Any]:
        with self.lock:
            if not self.path.is_file():
                return {}
            try:
                payload = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, ValueError, TypeError):
                return {}
            return payload if isinstance(payload, dict) else {}

    def save(self, payload: dict[str, Any]) -> None:
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary_name = tempfile.mkstemp(
                prefix=f".{self.path.stem}-",
                suffix=".tmp",
                dir=self.path.parent,
                text=True,
            )
            temporary_path = Path(temporary_name)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    json.dump(payload, handle, ensure_ascii=False, indent=2)
                    handle.write("\n")
                os.replace(temporary_path, self.path)
            finally:
                if temporary_path.exists():
                    temporary_path.unlink()

    def update(self, **values: Any) -> dict[str, Any]:
        payload = self.load()
        payload.update(values)
        self.save(payload)
        return payload


@dataclass(frozen=True)
class WorkbookEntry:
    identifier: str
    path: Path
    relative_path: str
    group: str
    modified_at: str
    modified_ns: int
    size_bytes: int

    def as_dict(self, selected: bool = False) -> dict[str, Any]:
        return {
            "id": self.identifier,
            "name": self.path.name,
            "relative_path": self.relative_path,
            "group": self.group,
            "modified_at": self.modified_at,
            "size_bytes": self.size_bytes,
            "selected": selected,
        }


class ExpenseLibrary:
    """Manage a cached base directory and workbooks under its expenses folder."""

    def __init__(self, settings: SettingsStore | None = None):
        self.settings = settings or SettingsStore()
        self.lock = threading.RLock()
        self.base_dir: Path | None = None
        self.selected_id: str | None = None
        self.entries: list[WorkbookEntry] = []
        self._restore()

    @property
    def expenses_dir(self) -> Path | None:
        return self.base_dir / "expenses" if self.base_dir else None

    @property
    def surveys_dir(self) -> Path | None:
        return self.base_dir / "surveys" if self.base_dir else None

    @property
    def workplace_dir(self) -> Path | None:
        return self.base_dir / "workplace" if self.base_dir else None

    @property
    def contracts_dir(self) -> Path | None:
        return self.base_dir / "contracts" if self.base_dir else None

    @property
    def audit_reports_dir(self) -> Path | None:
        return self.base_dir / "audit_reports" if self.base_dir else None

    @property
    def selected(self) -> WorkbookEntry | None:
        return next((entry for entry in self.entries if entry.identifier == self.selected_id), None)

    def _restore(self) -> None:
        settings = self.settings.load()
        raw_base_dir = settings.get("base_dir")
        if not isinstance(raw_base_dir, str) or not raw_base_dir.strip():
            return
        candidate = Path(raw_base_dir).expanduser()
        if not candidate.is_dir():
            return
        resolved = candidate.resolve()
        # Users naturally select the folder containing the workbooks. If that
        # folder is already named "expenses", store its parent as base_dir so
        # we never create or scan an accidental expenses/expenses directory.
        self.base_dir = resolved.parent if resolved.name.casefold() == "expenses" else resolved
        if self.base_dir != resolved:
            self.settings.update(base_dir=str(self.base_dir))
        self.ensure_support_directories(ignore_errors=True)
        cached_selected = settings.get("selected_workbook")
        self.selected_id = cached_selected if isinstance(cached_selected, str) else None
        self.refresh()

    def configure(self, base_dir: str | Path) -> None:
        candidate = Path(base_dir).expanduser()
        if not candidate.exists():
            raise ValueError(f"The selected directory does not exist: {candidate}")
        if not candidate.is_dir():
            raise ValueError(f"The selected path is not a directory: {candidate}")
        resolved = candidate.resolve()
        if resolved.name.casefold() == "expenses":
            resolved = resolved.parent
        with self.lock:
            self.base_dir = resolved
            self.ensure_support_directories()
            self.selected_id = None
            self.settings.update(base_dir=str(resolved), selected_workbook=None)
            self.refresh()

    def ensure_support_directories(self, *, ignore_errors: bool = False) -> None:
        if self.base_dir is None:
            return
        try:
            for directory_name in REQUIRED_SUBDIRECTORIES:
                (self.base_dir / directory_name).mkdir(parents=True, exist_ok=True)
        except OSError:
            if not ignore_errors:
                raise

    def refresh(self) -> list[WorkbookEntry]:
        with self.lock:
            expenses_dir = self.expenses_dir
            if expenses_dir is None or not expenses_dir.is_dir():
                self.entries = []
                self.selected_id = None
                return []

            entries: list[WorkbookEntry] = []
            for path in expenses_dir.rglob("*"):
                if (
                    not path.is_file()
                    or path.is_symlink()
                    or path.name.startswith("~$")
                    or path.suffix.casefold() not in SUPPORTED_WORKBOOK_SUFFIXES
                ):
                    continue
                relative = path.relative_to(expenses_dir)
                if any(part.startswith(".") for part in relative.parts):
                    continue
                stat = path.stat()
                relative_path = relative.as_posix()
                group = relative.parent.as_posix() if relative.parent != Path(".") else "Expenses"
                entries.append(
                    WorkbookEntry(
                        identifier=relative_path,
                        path=path.resolve(),
                        relative_path=relative_path,
                        group=group,
                        modified_at=datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat(timespec="seconds"),
                        modified_ns=stat.st_mtime_ns,
                        size_bytes=stat.st_size,
                    )
                )

            self.entries = sorted(entries, key=lambda entry: entry.relative_path.casefold())
            available_ids = {entry.identifier for entry in self.entries}
            if self.selected_id not in available_ids:
                newest = max(self.entries, key=lambda entry: entry.modified_ns, default=None)
                self.selected_id = newest.identifier if newest else None
                self.settings.update(selected_workbook=self.selected_id)
            return list(self.entries)

    def select(self, identifier: str) -> WorkbookEntry:
        with self.lock:
            entry = next((item for item in self.entries if item.identifier == identifier), None)
            if entry is None:
                self.refresh()
                entry = next((item for item in self.entries if item.identifier == identifier), None)
            if entry is None:
                raise ValueError("The selected workbook is not available in the expenses directory.")
            self.selected_id = entry.identifier
            self.settings.update(selected_workbook=entry.identifier)
            return entry

    def summary(self) -> dict[str, Any]:
        with self.lock:
            selected = self.selected
            return {
                "configured": self.base_dir is not None,
                "base_dir": str(self.base_dir) if self.base_dir else None,
                "expenses_dir": str(self.expenses_dir) if self.expenses_dir else None,
                "surveys_dir": str(self.surveys_dir) if self.surveys_dir else None,
                "workplace_dir": str(self.workplace_dir) if self.workplace_dir else None,
                "contracts_dir": str(self.contracts_dir) if self.contracts_dir else None,
                "audit_reports_dir": str(self.audit_reports_dir) if self.audit_reports_dir else None,
                "selected_id": selected.identifier if selected else None,
                "files": [entry.as_dict(selected=entry == selected) for entry in self.entries],
            }
