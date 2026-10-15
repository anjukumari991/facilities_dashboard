from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone
import json
import ssl
from typing import Any, Callable
from urllib.request import Request, urlopen


NAGER_DATE_API = "https://nagerholidays.com/api/v4/Holidays"
HOLIDAY_SOURCE_NAME = "Nager.Date Community Holiday API"


class ExternalFactsUnavailable(RuntimeError):
    """Raised when a verified, allowlisted fact source cannot be reached."""


class HolidayFactsClient:
    """Fetch public-holiday facts from one allowlisted calendar API.

    This is intentionally not a general web client. The model never selects a
    URL, and returned text is reduced to dated calendar facts before it enters
    the AI context.
    """

    def __init__(self, fetch_json: Callable[[str], Any] | None = None):
        self._fetch_json = fetch_json or self._download_json
        self._cache: dict[tuple[str, int], list[dict[str, Any]]] = {}

    @staticmethod
    def _download_json(url: str) -> Any:
        if not url.startswith(f"{NAGER_DATE_API}/"):
            raise ExternalFactsUnavailable("The requested calendar source is not allowlisted.")
        request = Request(url, headers={"Accept": "application/json", "User-Agent": "FacilitiesDashboard/1"})
        context = ssl.create_default_context()
        try:
            import certifi

            context = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            pass
        try:
            with urlopen(request, timeout=15, context=context) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            raise ExternalFactsUnavailable("The verified public-holiday calendar is currently unavailable.") from exc

    def holidays(self, country_code: str, year: int) -> list[dict[str, Any]]:
        country = str(country_code or "").strip().upper()
        if len(country) != 2 or not country.isalpha() or year < 2000 or year > 2100:
            raise ExternalFactsUnavailable("The requested calendar period is invalid.")
        key = (country, year)
        if key not in self._cache:
            url = f"{NAGER_DATE_API}/{country}/{year}"
            payload = self._fetch_json(url)
            if not isinstance(payload, list):
                raise ExternalFactsUnavailable("The public-holiday calendar returned an invalid response.")
            self._cache[key] = [item for item in payload if isinstance(item, dict)]
        return self._cache[key]

    def month_facts(
        self,
        month: str,
        country_code: str = "IN",
        subdivision_code: str = "IN-KA",
    ) -> dict[str, Any]:
        try:
            first = datetime.strptime(month, "%Y-%m-01").date()
        except (TypeError, ValueError) as exc:
            raise ExternalFactsUnavailable("The forecast month is invalid.") from exc

        source_url = f"{NAGER_DATE_API}/{country_code.upper()}/{first.year}"
        applicable: list[dict[str, Any]] = []
        for item in self.holidays(country_code, first.year):
            try:
                holiday_date = date.fromisoformat(str(item.get("date") or ""))
            except ValueError:
                continue
            if holiday_date.year != first.year or holiday_date.month != first.month:
                continue
            subdivisions = item.get("subdivisionCodes")
            if subdivisions is None:
                subdivisions = item.get("counties")
            subdivisions = [str(value).upper() for value in subdivisions] if isinstance(subdivisions, list) else []
            national = bool(item.get("nationalHoliday", item.get("global", not subdivisions)))
            if not national and subdivision_code.upper() not in subdivisions:
                continue
            applicable.append(
                {
                    "date": holiday_date.isoformat(),
                    "name": str(item.get("name") or item.get("localName") or "Public holiday")[:120],
                    "scope": "national" if national else subdivision_code.upper(),
                    "holiday_types": [str(value)[:40] for value in (item.get("holidayTypes") or item.get("types") or [])[:5]],
                }
            )

        _, day_count = calendar.monthrange(first.year, first.month)
        weekdays = [first.replace(day=day) for day in range(1, day_count + 1) if first.replace(day=day).weekday() < 5]
        weekday_holidays = {date.fromisoformat(item["date"]) for item in applicable if date.fromisoformat(item["date"]).weekday() < 5}
        long_weekends = []
        bridge_day_opportunities = []
        for holiday in applicable:
            holiday_date = date.fromisoformat(holiday["date"])
            if holiday_date.weekday() == 4:  # Friday
                long_weekends.append({"start": holiday_date.isoformat(), "end": (holiday_date + timedelta(days=2)).isoformat(), "holiday": holiday["name"]})
            elif holiday_date.weekday() == 0:  # Monday
                long_weekends.append({"start": (holiday_date - timedelta(days=2)).isoformat(), "end": holiday_date.isoformat(), "holiday": holiday["name"]})
            elif holiday_date.weekday() in {1, 3}:
                bridge_day = holiday_date - timedelta(days=1) if holiday_date.weekday() == 1 else holiday_date + timedelta(days=1)
                bridge_day_opportunities.append({"holiday": holiday["name"], "holiday_date": holiday_date.isoformat(), "possible_leave_date": bridge_day.isoformat()})

        return {
            "month": month,
            "country_code": country_code.upper(),
            "subdivision_code": subdivision_code.upper(),
            "calendar_weekdays": len(weekdays),
            "weekday_public_holidays": len(weekday_holidays),
            "working_days": len(weekdays) - len(weekday_holidays),
            "public_holidays": applicable,
            "long_weekends": long_weekends,
            "bridge_day_opportunities": bridge_day_opportunities,
            "source": HOLIDAY_SOURCE_NAME,
            "source_url": source_url,
            "retrieved_at": datetime.now(timezone.utc).date().isoformat(),
            "coverage_note": (
                "India/Karnataka public-holiday coverage only. Company-specific, optional and city-only holidays may be absent. "
                "Bridge days are possibilities, not assumed leave."
            ),
        }
