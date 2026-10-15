from __future__ import annotations

from datetime import date, datetime
from io import BytesIO
from pathlib import Path
import re
from typing import Any

from workbook_io import load_workbook_snapshot


SHEET_NAME = "Facilities Team Collaboration"
REQUIRED_COLUMNS = (
    "Month",
    "Department",
    "Activity / Collaboration",
    "Status",
    "Timeline",
    "Outcome",
)
MONTH_FORMATS = (
    "%b %Y",
    "%B %Y",
    "%b %y",
    "%B %y",
    "%b-%Y",
    "%B-%Y",
    "%Y-%m",
    "%m/%Y",
)


def _text(value: Any) -> str:
    return re.sub(r"\s+", " ", "" if value is None else str(value)).strip()


def _label(value: Any, fallback: str = "Unspecified") -> str:
    text = _text(value)
    if not text:
        return fallback
    return text.title() if text.isupper() or text.islower() else text


def _header_key(value: Any) -> str:
    # Treat the earlier no-space spelling as compatible while presenting and
    # documenting the canonical Excel header with spaces around the slash.
    return re.sub(r"\s*/\s*", " / ", _text(value)).casefold()


def _month(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date().replace(day=1)
    if isinstance(value, date):
        return value.replace(day=1)
    raw = _text(value)
    if not raw:
        return None
    for fmt in MONTH_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date().replace(day=1)
        except ValueError:
            pass
    return None


def plan_year_for_month(month: date) -> str:
    start_year = month.year if month.month >= 7 else month.year - 1
    return f"PY{start_year % 100:02d}"


def _empty_payload() -> dict[str, Any]:
    return {
        "records": [],
        "meta": {
            "sheet_found": False,
            "record_count": 0,
            "months": [],
            "plan_years": [],
            "departments": [],
            "statuses": [],
            "duplicate_count": 0,
            "conflicting_duplicates": 0,
            "invalid_rows": 0,
        },
    }


def _find_sheet(workbook: Any) -> Any | None:
    expected = SHEET_NAME.casefold()
    return next((sheet for sheet in workbook.worksheets if _text(sheet.title).casefold() == expected), None)


def _headers(sheet: Any) -> tuple[int, dict[str, int]]:
    required = {_header_key(column): column for column in REQUIRED_COLUMNS}
    for row_number in range(1, min(sheet.max_row, 25) + 1):
        found = {
            _header_key(sheet.cell(row_number, column_number).value): column_number
            for column_number in range(1, sheet.max_column + 1)
            if _header_key(sheet.cell(row_number, column_number).value)
        }
        if set(required).issubset(found):
            return row_number, {display: found[key] for key, display in required.items()}
    raise ValueError(
        f"{SHEET_NAME!r} must contain these headers in one row: {', '.join(REQUIRED_COLUMNS)}."
    )


def _load_workbook_payload(workbook: Any) -> dict[str, Any]:
    sheet = _find_sheet(workbook)
    if sheet is None:
        return _empty_payload()

    header_row, columns = _headers(sheet)
    latest: dict[tuple[str, str, str], dict[str, Any]] = {}
    duplicate_count = 0
    conflicting_duplicates = 0
    invalid_rows = 0

    for row_number in range(header_row + 1, sheet.max_row + 1):
        values = {
            column: sheet.cell(row_number, column_number).value
            for column, column_number in columns.items()
        }
        if not any(_text(value) for value in values.values()):
            continue
        month = _month(values["Month"])
        department = _label(values["Department"])
        activity = _text(values["Activity / Collaboration"])
        if month is None or department == "Unspecified" or not activity:
            invalid_rows += 1
            continue
        record = {
            "month": month.isoformat(),
            "plan_year": plan_year_for_month(month),
            "department": department,
            "activity": activity,
            "status": _label(values["Status"]),
            "timeline": _text(values["Timeline"]),
            "outcome": _text(values["Outcome"]),
        }
        key = (record["month"], department.casefold(), activity.casefold())
        previous = latest.get(key)
        if previous is not None:
            if any(previous[field] != record[field] for field in ("status", "timeline", "outcome")):
                conflicting_duplicates += 1
            else:
                duplicate_count += 1
        latest[key] = record

    records = sorted(
        latest.values(),
        key=lambda row: (row["month"], row["department"].casefold(), row["activity"].casefold()),
    )
    months = sorted({record["month"] for record in records})
    plan_year_labels = sorted({record["plan_year"] for record in records})
    plan_years = []
    for label in plan_year_labels:
        candidate_months = [date.fromisoformat(record["month"]) for record in records if record["plan_year"] == label]
        start_year = min(month.year if month.month >= 7 else month.year - 1 for month in candidate_months)
        loaded_months = {record["month"] for record in records if record["plan_year"] == label}
        plan_years.append(
            {
                "label": label,
                "start": date(start_year, 7, 1).isoformat(),
                "end": date(start_year + 1, 6, 30).isoformat(),
                "loaded_months": len(loaded_months),
            }
        )

    return {
        "records": records,
        "meta": {
            "sheet_found": True,
            "sheet_name": sheet.title,
            "record_count": len(records),
            "months": months,
            "plan_years": plan_years,
            "departments": sorted({record["department"] for record in records}, key=str.casefold),
            "statuses": sorted({record["status"] for record in records}, key=str.casefold),
            "duplicate_count": duplicate_count,
            "conflicting_duplicates": conflicting_duplicates,
            "invalid_rows": invalid_rows,
        },
    }


def load_collaborations(source: str | Path | bytes | BytesIO) -> dict[str, Any]:
    workbook = load_workbook_snapshot(source, data_only=True, read_only=True)
    try:
        return _load_workbook_payload(workbook)
    finally:
        workbook.close()
