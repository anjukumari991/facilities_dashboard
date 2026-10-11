from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any


MONTH_FOLDER_FORMATS = ("%b%Y", "%B%Y", "%b %Y", "%B %Y", "%b-%Y", "%B-%Y")
ICON_TYPES = {
    ".pdf": "pdf",
    ".doc": "word",
    ".docx": "word",
    ".xls": "excel",
    ".xlsx": "excel",
    ".xlsm": "excel",
    ".ppt": "presentation",
    ".pptx": "presentation",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".gif": "image",
    ".txt": "text",
    ".csv": "text",
}


def _month_folder(value: str) -> str | None:
    normalized = " ".join(value.split()).title()
    for fmt in MONTH_FOLDER_FORMATS:
        try:
            return datetime.strptime(normalized, fmt).date().replace(day=1).isoformat()
        except ValueError:
            pass
    return None


def list_audit_reports(base_dir: Path | None) -> dict[str, Any]:
    root = base_dir / "audit_reports" if base_dir else None
    if root is None or not root.is_dir():
        return {"reports": [], "meta": {"report_count": 0, "months": [], "ignored_files": 0}}
    root = root.resolve()
    reports = []
    ignored_files = 0
    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink() or path.name.startswith((".", "~$")):
            continue
        try:
            resolved = path.resolve()
            relative = resolved.relative_to(root)
        except (OSError, ValueError):
            ignored_files += 1
            continue
        unresolved_relative = path.relative_to(root)
        cursor = root
        linked_component = False
        for part in unresolved_relative.parts:
            cursor /= part
            if cursor.is_symlink():
                linked_component = True
                break
        if linked_component:
            ignored_files += 1
            continue
        if len(relative.parts) < 2 or any(part.startswith(".") for part in relative.parts):
            ignored_files += 1
            continue
        month = _month_folder(relative.parts[0])
        if month is None:
            ignored_files += 1
            continue
        stat = resolved.stat()
        extension = resolved.suffix.casefold()
        reports.append(
            {
                "id": relative.as_posix(),
                "name": resolved.name,
                "relative_path": relative.as_posix(),
                "month": month,
                "month_folder": relative.parts[0],
                "extension": extension.lstrip(".").upper() or "FILE",
                "icon": ICON_TYPES.get(extension, "file"),
                "size_bytes": stat.st_size,
            }
        )
    reports.sort(key=lambda item: (item["month"], item["name"].casefold()), reverse=True)
    return {
        "reports": reports,
        "meta": {
            "report_count": len(reports),
            "months": sorted({report["month"] for report in reports}),
            "ignored_files": ignored_files,
        },
    }
