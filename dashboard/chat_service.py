from __future__ import annotations

from collections import defaultdict
import json
import math
import re
from typing import Any, Callable
from urllib.parse import urlsplit

from secure_storage import SecureCredentialStore


PRIMARY_MODEL = "gpt-6-luna"
FALLBACK_MODEL = "gpt-5-mini"
DEFAULT_AI_API_ENDPOINT = "http://127.0.0.1:12345/v1"
ALLOWED_TABS = {"expense", "survey", "workplace", "collaborations"}
EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+?\d[\s().-]*){9,14}(?!\d)")
PERSON_NAME_PAIR_PATTERN = re.compile(r"\b[A-Z][A-Za-z'-]{1,40}\s*(?:&|and)\s*[A-Z][A-Za-z'-]{1,40}\b")
PERSON_NAME_CONTEXT_PATTERN = re.compile(
    r"\b(?i:thanks?|thank you|kudos)\s+(?:(?i:to)\s+)?[A-Z][A-Za-z'-]{1,40}\b",
)
HONORIFIC_NAME_PATTERN = re.compile(r"\b(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Z][A-Za-z'-]{1,40}\b")
MONTH_PATTERN = re.compile(r"^\d{4}-\d{2}-01$")
SUMMARY_SECTIONS = ("appreciations", "employee_asks", "focus_areas", "suggested_actions")


def normalize_api_endpoint(value: Any) -> str:
    endpoint = str(value or "").strip().rstrip("/")
    if not endpoint:
        raise ValueError("Enter an AI API endpoint.")
    if len(endpoint) > 2048:
        raise ValueError("The AI API endpoint is too long.")
    parsed = urlsplit(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("The AI API endpoint must be a valid HTTP or HTTPS URL.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("The AI API endpoint cannot contain credentials, a query, or a fragment.")
    loopback_hosts = {"127.0.0.1", "localhost", "::1"}
    if parsed.scheme == "http" and parsed.hostname.casefold() not in loopback_hosts:
        raise ValueError("Use HTTPS unless the AI API endpoint is on this computer.")
    return endpoint


def redact_text(value: Any, limit: int = 2400) -> str:
    text = str(value or "").strip()[:limit]
    text = EMAIL_PATTERN.sub("[email removed]", text)
    text = PHONE_PATTERN.sub("[phone removed]", text)
    text = PERSON_NAME_PAIR_PATTERN.sub("[names removed]", text)
    text = PERSON_NAME_CONTEXT_PATTERN.sub("[name removed]", text)
    return HONORIFIC_NAME_PATTERN.sub("[name removed]", text)


def _summary_payload(raw: str, comment_count: int) -> dict[str, list[dict[str, Any]]]:
    text = str(raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("AI support returned a summary in an unsupported format. Try Summarize again.")
    try:
        parsed = json.loads(text[start : end + 1])
    except (TypeError, ValueError) as exc:
        raise ValueError("AI support returned a summary in an unsupported format. Try Summarize again.") from exc
    if not isinstance(parsed, dict):
        raise ValueError("AI support returned a summary in an unsupported format. Try Summarize again.")

    output: dict[str, list[dict[str, Any]]] = {}
    for section in SUMMARY_SECTIONS:
        items = parsed.get(section, [])
        if not isinstance(items, list):
            items = []
        normalized = []
        for item in items[:8]:
            if isinstance(item, dict):
                point = redact_text(item.get("point"), 500)
                try:
                    mentions = int(item.get("mentions"))
                except (TypeError, ValueError):
                    mentions = 0
            else:
                point = redact_text(item, 500)
                mentions = 0
            if not point:
                continue
            normalized.append(
                {
                    "point": point,
                    "mentions": mentions if 0 < mentions <= comment_count else None,
                }
            )
        output[section] = normalized
    if not any(output.values()):
        raise ValueError("AI support returned an empty summary. Try Summarize again.")
    return output


def _number(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if math.isfinite(number) else 0.0


def _month_or_empty(value: Any) -> str:
    normalized = str(value or "").strip()
    if normalized and not MONTH_PATTERN.fullmatch(normalized):
        raise ValueError("Months must use YYYY-MM-01 format.")
    return normalized


def _response_item_dict(item: Any) -> dict[str, Any]:
    if isinstance(item, dict):
        return item
    if hasattr(item, "model_dump"):
        return item.model_dump(exclude_none=True)
    raise TypeError("The model returned an unsupported response item.")


def _field(item: Any, name: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


class AggregateGateway:
    """Execute allowlisted, read-only aggregate queries over local dashboard state."""

    EXPENSE_METRICS = {
        "total_spend",
        "average_monthly_spend",
        "expense_line_count",
        "actual_headcount",
        "cost_per_person",
    }
    EXPENSE_DIMENSIONS = {"month", "report_category", "category", "vendor"}
    SURVEY_METRICS = {
        "response_count",
        "overall_average",
        "overall_favorable_rate",
        "lunch_snacks_hygiene_average",
        "lunch_snacks_hygiene_favorable_rate",
        "food_satisfaction_rate",
        "touchpoint_satisfaction_rate",
        "overall_rating_distribution",
        "lunch_snacks_hygiene_rating_distribution",
    }
    SURVEY_METRIC_FIELDS = {
        "lunch_snacks_hygiene_average": "enhancement_average",
        "lunch_snacks_hygiene_favorable_rate": "enhancement_favorable_rate",
        "lunch_snacks_hygiene_rating_distribution": "enhancement_rating_distribution",
    }
    SURVEY_DIMENSIONS = {"survey_month", "touchpoint", "rating"}
    WORKPLACE_METRICS = {
        "total_cost",
        "average_monthly_cost",
        "invoice_count",
        "additional_cost",
        "expected_next_fy_cost",
    }
    WORKPLACE_DIMENSIONS = {"month", "fiscal_year", "cost_class"}
    COLLABORATION_METRICS = {
        "collaboration_count",
        "teams_assisted",
        "completed_count",
        "completion_rate",
        "outcome_documentation_rate",
        "average_per_active_month",
    }
    COLLABORATION_DIMENSIONS = {"month", "plan_year", "department", "status"}

    def __init__(self, state: Any):
        self.state = state

    def tools_for_tab(self, tab: str) -> list[dict[str, Any]]:
        if tab == "expense":
            return [
                {
                    "type": "function",
                    "name": "aggregate_expenses",
                    "description": "Calculate an aggregate expense metric from local data. Returns no individual expense rows.",
                    "strict": True,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "metric": {"type": "string", "enum": sorted(self.EXPENSE_METRICS)},
                            "group_by": {"type": "array", "items": {"type": "string", "enum": sorted(self.EXPENSE_DIMENSIONS)}},
                            "start_month": {"type": "string", "description": "YYYY-MM-01, or an empty string for earliest."},
                            "end_month": {"type": "string", "description": "YYYY-MM-01, or an empty string for latest."},
                            "report_category": {"type": "string", "description": "Exact category, or an empty string for all."},
                            "limit": {"type": "integer", "minimum": 1, "maximum": 25},
                        },
                        "required": ["metric", "group_by", "start_month", "end_month", "report_category", "limit"],
                        "additionalProperties": False,
                    },
                }
            ]
        if tab == "survey":
            return [
                {
                    "type": "function",
                    "name": "aggregate_surveys",
                    "description": "Calculate an anonymised quarterly facilities-survey aggregate. Returns no comments or individual responses.",
                    "strict": True,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "metric": {"type": "string", "enum": sorted(self.SURVEY_METRICS)},
                            "group_by": {"type": "array", "items": {"type": "string", "enum": sorted(self.SURVEY_DIMENSIONS)}},
                            "survey_month": {"type": "string", "description": "YYYY-MM-01, or an empty string for all surveys."},
                            "limit": {"type": "integer", "minimum": 1, "maximum": 25},
                        },
                        "required": ["metric", "group_by", "survey_month", "limit"],
                        "additionalProperties": False,
                    },
                }
            ]
        if tab == "workplace":
            return [
                {
                    "type": "function",
                    "name": "aggregate_workplace",
                    "description": "Calculate an aggregate workplace-cost metric. Returns no invoice numbers, descriptions, filenames, contract contents, or individual rows.",
                    "strict": True,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "metric": {"type": "string", "enum": sorted(self.WORKPLACE_METRICS)},
                            "group_by": {"type": "array", "items": {"type": "string", "enum": sorted(self.WORKPLACE_DIMENSIONS)}},
                            "fiscal_year": {"type": "string", "description": "FY25-style label, or an empty string for all years."},
                            "limit": {"type": "integer", "minimum": 1, "maximum": 25},
                        },
                        "required": ["metric", "group_by", "fiscal_year", "limit"],
                        "additionalProperties": False,
                    },
                }
            ]
        if tab == "collaborations":
            return [
                {
                    "type": "function",
                    "name": "aggregate_collaborations",
                    "description": "Calculate aggregate collaboration activity. Returns no activity, timeline, outcome, filename, or individual-row text.",
                    "strict": True,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "metric": {"type": "string", "enum": sorted(self.COLLABORATION_METRICS)},
                            "group_by": {"type": "array", "items": {"type": "string", "enum": sorted(self.COLLABORATION_DIMENSIONS)}},
                            "plan_year": {"type": "string", "description": "PY26-style label, or an empty string for all years."},
                            "month": {"type": "string", "description": "YYYY-MM-01, or an empty string for all months."},
                            "department": {"type": "string", "description": "Exact department, or an empty string for all departments."},
                            "status": {"type": "string", "description": "Exact dynamic status, or an empty string for all statuses."},
                            "limit": {"type": "integer", "minimum": 1, "maximum": 25},
                        },
                        "required": ["metric", "group_by", "plan_year", "month", "department", "status", "limit"],
                        "additionalProperties": False,
                    },
                }
            ]
        return []

    def execute(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name == "aggregate_expenses":
            return self.aggregate_expenses(arguments)
        if name == "aggregate_surveys":
            return self.aggregate_surveys(arguments)
        if name == "aggregate_workplace":
            return self.aggregate_workplace(arguments)
        if name == "aggregate_collaborations":
            return self.aggregate_collaborations(arguments)
        return {"error": "That aggregate tool is not available."}

    def aggregate_expenses(self, arguments: dict[str, Any]) -> dict[str, Any]:
        metric = str(arguments.get("metric", ""))
        if metric not in self.EXPENSE_METRICS:
            return {"error": "Unsupported expense metric."}
        dimensions = list(dict.fromkeys(arguments.get("group_by") or []))
        if len(dimensions) > 2 or any(dimension not in self.EXPENSE_DIMENSIONS for dimension in dimensions):
            return {"error": "Use at most two supported expense dimensions."}
        try:
            start = _month_or_empty(arguments.get("start_month"))
            end = _month_or_empty(arguments.get("end_month"))
        except ValueError as exc:
            return {"error": str(exc)}
        category_filter = str(arguments.get("report_category") or "").strip()
        limit = min(25, max(1, int(arguments.get("limit") or 10)))

        with self.state.lock:
            records = [dict(row) for row in self.state.payload.get("records", [])]
            settings = self.state.library.settings.load()
        available_categories = {str(row.get("report_category", "")) for row in records}
        if category_filter and category_filter not in available_categories:
            return {"error": "The requested report category is not available."}
        filtered = [
            row
            for row in records
            if (not start or str(row.get("month", "")) >= start)
            and (not end or str(row.get("month", "")) <= end)
            and (not category_filter or row.get("report_category") == category_filter)
        ]
        currency = settings.get("display_currency") if settings.get("display_currency") in {"INR", "USD"} else "INR"
        rate = _number(settings.get("usd_to_inr_rate")) or 96.0

        groups: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
        for row in filtered:
            key = tuple(str(row.get(dimension, "Unspecified")) for dimension in dimensions)
            groups[key].append(row)
        if not groups and not dimensions:
            groups[()] = []

        output_rows = []
        for key, rows in groups.items():
            amount = sum(_number(row.get("amount_inr")) for row in rows)
            headcount = sum(_number(row.get("actual_count")) for row in rows)
            if metric == "total_spend":
                value, unit = amount, currency
            elif metric == "average_monthly_spend":
                months = {row.get("month") for row in rows}
                value, unit = amount / len(months) if months else 0.0, f"{currency} per month"
            elif metric == "expense_line_count":
                value, unit = float(len(rows)), "expense lines"
            elif metric == "actual_headcount":
                value, unit = headcount, "people"
            else:
                value, unit = (amount / headcount if headcount else 0.0), f"{currency} per person"
            if currency == "USD" and metric in {"total_spend", "average_monthly_spend", "cost_per_person"}:
                value /= rate
            output_rows.append(
                {
                    "dimensions": {dimension: key[index] for index, dimension in enumerate(dimensions)},
                    "value": round(value, 2),
                    "unit": unit,
                    "record_count": len(rows),
                }
            )
        if dimensions and dimensions[0] == "month":
            output_rows.sort(key=lambda row: tuple(row["dimensions"].values()))
        else:
            output_rows.sort(key=lambda row: row["value"], reverse=True)
        return {
            "privacy": "aggregate_only",
            "metric": metric,
            "filters": {"start_month": start or None, "end_month": end or None, "report_category": category_filter or None},
            "rows": output_rows[:limit],
            "truncated": len(output_rows) > limit,
        }

    def aggregate_surveys(self, arguments: dict[str, Any]) -> dict[str, Any]:
        metric = str(arguments.get("metric", ""))
        if metric not in self.SURVEY_METRICS:
            return {"error": "Unsupported survey metric."}
        dimensions = list(dict.fromkeys(arguments.get("group_by") or []))
        if len(dimensions) > 2 or any(dimension not in self.SURVEY_DIMENSIONS for dimension in dimensions):
            return {"error": "Use at most two supported survey dimensions."}
        try:
            selected_month = _month_or_empty(arguments.get("survey_month"))
        except ValueError as exc:
            return {"error": str(exc)}
        limit = min(25, max(1, int(arguments.get("limit") or 10)))
        with self.state.lock:
            periods = json.loads(json.dumps(self.state.survey_payload.get("periods", [])))
        if selected_month:
            periods = [period for period in periods if period.get("month") == selected_month]
        if not periods:
            return {"error": "No survey aggregates are available for that selection."}

        rows: list[dict[str, Any]] = []
        rating_key = "overall" if metric == "overall_rating_distribution" else "enhancements"
        source_metric = self.SURVEY_METRIC_FIELDS.get(metric, metric)
        for period in periods:
            if metric == "touchpoint_satisfaction_rate":
                for touchpoint in period.get("touchpoints", {}).values():
                    if int(touchpoint.get("responses") or 0) < 5:
                        continue
                    dimensions_payload = {}
                    if "survey_month" in dimensions:
                        dimensions_payload["survey_month"] = period["month"]
                    if "touchpoint" in dimensions or not dimensions:
                        dimensions_payload["touchpoint"] = touchpoint["label"]
                    rows.append(
                        {
                            "dimensions": dimensions_payload,
                            "value": touchpoint.get("rate"),
                            "unit": "percent satisfied",
                            "response_count": touchpoint.get("responses"),
                        }
                    )
                continue
            if metric in {"overall_rating_distribution", "lunch_snacks_hygiene_rating_distribution"}:
                distribution = period.get("rating_distributions", {}).get(rating_key, {})
                total = sum(int(value or 0) for value in distribution.values())
                if total < 5:
                    continue
                for rating, count in distribution.items():
                    dimensions_payload = {}
                    if "survey_month" in dimensions:
                        dimensions_payload["survey_month"] = period["month"]
                    dimensions_payload["rating"] = rating
                    rows.append(
                        {
                            "dimensions": dimensions_payload,
                            "value": int(count),
                            "unit": "responses",
                            "response_count": total,
                        }
                    )
                continue
            response_count = int(period.get("response_count") or 0)
            if response_count < 5:
                continue
            dimensions_payload = {"survey_month": period["month"]} if "survey_month" in dimensions or len(periods) > 1 else {}
            value = period.get(source_metric)
            unit = "responses" if metric == "response_count" else ("score out of 5" if metric.endswith("average") else "percent")
            rows.append({"dimensions": dimensions_payload, "value": value, "unit": unit, "response_count": response_count})
        rows.sort(key=lambda row: tuple(row["dimensions"].values()) if row["dimensions"] else ("",))
        return {
            "privacy": "aggregate_only_minimum_group_5",
            "metric": metric,
            "survey_month": selected_month or None,
            "rows": rows[:limit],
            "truncated": len(rows) > limit,
        }

    def aggregate_workplace(self, arguments: dict[str, Any]) -> dict[str, Any]:
        metric = str(arguments.get("metric") or "")
        if metric not in self.WORKPLACE_METRICS:
            return {"error": "Unsupported workplace metric."}
        dimensions = list(dict.fromkeys(arguments.get("group_by") or []))
        if len(dimensions) > 2 or any(dimension not in self.WORKPLACE_DIMENSIONS for dimension in dimensions):
            return {"error": "Use at most two supported workplace dimensions."}
        fiscal_year = str(arguments.get("fiscal_year") or "").strip().upper()
        if fiscal_year and not re.fullmatch(r"FY\d{2}", fiscal_year):
            return {"error": "Financial years must use FY25 format."}
        limit = min(25, max(1, int(arguments.get("limit") or 10)))
        with self.state.lock:
            records = [dict(row) for row in self.state.workplace_payload.get("records", [])]
            forecast = dict(self.state.workplace_payload.get("forecast", {}))
            settings = self.state.library.settings.load()
        if fiscal_year:
            records = [row for row in records if row.get("fiscal_year") == fiscal_year]
        if metric == "expected_next_fy_cost":
            value = _number(forecast.get("expected_annual"))
            currency = settings.get("display_currency") if settings.get("display_currency") in {"INR", "USD"} else "INR"
            rate = _number(settings.get("usd_to_inr_rate")) or 96.0
            if currency == "USD":
                value /= rate
            return {
                "privacy": "aggregate_only_no_descriptions_or_contract_content",
                "metric": metric,
                "fiscal_year": forecast.get("fiscal_year"),
                "increase_rate_percent": forecast.get("increase_rate"),
                "months_observed": forecast.get("months_observed"),
                "rows": [{"dimensions": {}, "value": round(value, 2), "unit": currency}],
                "truncated": False,
            }

        currency = settings.get("display_currency") if settings.get("display_currency") in {"INR", "USD"} else "INR"
        rate = _number(settings.get("usd_to_inr_rate")) or 96.0
        groups: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
        for row in records:
            dimension_values = {
                "month": str(row.get("month") or "Unspecified"),
                "fiscal_year": str(row.get("fiscal_year") or "Unspecified"),
                "cost_class": "Rental" if row.get("cost_type") == "Monthly rental" else "Additional",
            }
            groups[tuple(dimension_values[dimension] for dimension in dimensions)].append(row)
        if not dimensions:
            groups[()] = records
        output_rows = []
        for key, rows in groups.items():
            amount = sum(_number(row.get("amount_inr")) for row in rows)
            if metric == "average_monthly_cost":
                months = {row.get("month") for row in rows}
                value, unit = (amount / len(months) if months else 0.0), f"{currency} per month"
            elif metric == "invoice_count":
                value, unit = float(len(rows)), "invoices"
            elif metric == "additional_cost":
                value = sum(_number(row.get("amount_inr")) for row in rows if row.get("cost_type") != "Monthly rental")
                unit = currency
            else:
                value, unit = amount, currency
            if currency == "USD" and metric != "invoice_count":
                value /= rate
            output_rows.append(
                {
                    "dimensions": {dimension: key[index] for index, dimension in enumerate(dimensions)},
                    "value": round(value, 2),
                    "unit": unit,
                    "invoice_count": len(rows),
                }
            )
        output_rows.sort(key=lambda row: tuple(row["dimensions"].values()) if dimensions and dimensions[0] in {"month", "fiscal_year"} else (-row["value"],))
        return {
            "privacy": "aggregate_only_no_descriptions_or_contract_content",
            "metric": metric,
            "fiscal_year": fiscal_year or None,
            "rows": output_rows[:limit],
            "truncated": len(output_rows) > limit,
        }

    def aggregate_collaborations(self, arguments: dict[str, Any]) -> dict[str, Any]:
        metric = str(arguments.get("metric") or "")
        if metric not in self.COLLABORATION_METRICS:
            return {"error": "Unsupported collaboration metric."}
        dimensions = list(dict.fromkeys(arguments.get("group_by") or []))
        if len(dimensions) > 2 or any(dimension not in self.COLLABORATION_DIMENSIONS for dimension in dimensions):
            return {"error": "Use at most two supported collaboration dimensions."}
        plan_year = str(arguments.get("plan_year") or "").strip().upper()
        if plan_year and not re.fullmatch(r"PY\d{2}", plan_year):
            return {"error": "Plan Years must use PY26 format."}
        try:
            month = _month_or_empty(arguments.get("month"))
        except ValueError as exc:
            return {"error": str(exc)}
        department = str(arguments.get("department") or "").strip()
        status = str(arguments.get("status") or "").strip()
        limit = min(25, max(1, int(arguments.get("limit") or 10)))
        with self.state.lock:
            # Free-text activity, timeline, outcome, workbook and source fields are
            # deliberately not copied into the aggregate boundary.
            records = [
                {
                    "month": str(row.get("month") or ""),
                    "plan_year": str(row.get("plan_year") or ""),
                    "department": str(row.get("department") or "Unspecified"),
                    "status": str(row.get("status") or "Unspecified"),
                    "outcome_documented": bool(str(row.get("outcome") or "").strip()),
                }
                for row in self.state.collaboration_payload.get("records", [])
            ]
        available_departments = {row["department"] for row in records}
        available_statuses = {row["status"] for row in records}
        if department and department not in available_departments:
            return {"error": "The requested department is not available."}
        if status and status not in available_statuses:
            return {"error": "The requested status is not available."}
        records = [
            row for row in records
            if (not plan_year or row["plan_year"] == plan_year)
            and (not month or row["month"] == month)
            and (not department or row["department"] == department)
            and (not status or row["status"] == status)
        ]
        groups: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
        for row in records:
            groups[tuple(row[dimension] for dimension in dimensions)].append(row)
        if not dimensions:
            groups[()] = records
        output_rows = []
        for key, rows in groups.items():
            completed = sum(row["status"].casefold() == "completed" for row in rows)
            if metric == "teams_assisted":
                value, unit = float(len({row["department"] for row in rows})), "teams"
            elif metric == "completed_count":
                value, unit = float(completed), "collaborations"
            elif metric == "completion_rate":
                value, unit = (completed / len(rows) * 100 if rows else 0.0), "percent"
            elif metric == "outcome_documentation_rate":
                documented = sum(row["outcome_documented"] for row in rows)
                value, unit = (documented / len(rows) * 100 if rows else 0.0), "percent"
            elif metric == "average_per_active_month":
                months = {row["month"] for row in rows}
                value, unit = (len(rows) / len(months) if months else 0.0), "collaborations per active month"
            else:
                value, unit = float(len(rows)), "collaborations"
            output_rows.append(
                {
                    "dimensions": {dimension: key[index] for index, dimension in enumerate(dimensions)},
                    "value": round(value, 2),
                    "unit": unit,
                    "record_count": len(rows),
                }
            )
        if dimensions and dimensions[0] in {"month", "plan_year"}:
            output_rows.sort(key=lambda row: tuple(row["dimensions"].values()))
        else:
            output_rows.sort(key=lambda row: row["value"], reverse=True)
        return {
            "privacy": "aggregate_only_no_activity_timeline_outcome_or_source_text",
            "metric": metric,
            "filters": {
                "plan_year": plan_year or None,
                "month": month or None,
                "department": department or None,
                "status": status or None,
            },
            "rows": output_rows[:limit],
            "truncated": len(output_rows) > limit,
        }


class DashboardChatService:
    def __init__(
        self,
        state: Any,
        credential_store: SecureCredentialStore,
        client_factory: Callable[..., Any] | None = None,
    ):
        self.state = state
        self.credential_store = credential_store
        self.gateway = AggregateGateway(state)
        self.client_factory = client_factory

    def configured_endpoint(self) -> str:
        settings = self.state.library.settings.load()
        try:
            return normalize_api_endpoint(settings.get("ai_api_endpoint") or DEFAULT_AI_API_ENDPOINT)
        except ValueError:
            return DEFAULT_AI_API_ENDPOINT

    def _client(self, token: str, endpoint: str) -> Any:
        if self.client_factory:
            try:
                return self.client_factory(token, endpoint)
            except TypeError:
                return self.client_factory(token)
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise RuntimeError("AI support is unavailable because the OpenAI component is not installed.") from exc
        # Local CLI-backed models can take several minutes for larger
        # summaries. Do not impose a client-side deadline, and avoid retries
        # that could duplicate a still-running generation request.
        return OpenAI(api_key=token, base_url=endpoint, timeout=None, max_retries=0)

    @staticmethod
    def _model_ids(client: Any) -> list[str]:
        response = client.models.list()
        identifiers = []
        for item in _field(response, "data", []) or []:
            identifier = str(_field(item, "id", "") or "").strip()
            if identifier and identifier not in identifiers:
                identifiers.append(identifier)
        return identifiers

    @staticmethod
    def _candidate_models(available: list[str]) -> list[str]:
        unsuitable = ("embed", "whisper", "tts", "speech", "transcri", "moderation", "rerank", "image")
        preferred = [model for model in (PRIMARY_MODEL, FALLBACK_MODEL) if model in available]
        compatible = [model for model in available if model not in preferred and not any(term in model.casefold() for term in unsuitable)]
        return [*preferred, *compatible]

    @staticmethod
    def _uses_responses_api(endpoint: str) -> bool:
        parsed = urlsplit(endpoint)
        return parsed.scheme == "https" and parsed.hostname == "api.openai.com"

    def _probe_model(self, client: Any, endpoint: str, model: str) -> None:
        if self._uses_responses_api(endpoint):
            client.responses.create(model=model, input="Reply with OK.", max_output_tokens=8, store=False)
            return
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "Reply with OK."}],
            max_tokens=8,
            stream=False,
        )
        if not (_field(response, "choices", []) or []):
            raise RuntimeError("The AI endpoint returned no completion choices during the connection test.")

    def test_endpoint(self, endpoint: str | None = None) -> dict[str, Any]:
        try:
            normalized_endpoint = normalize_api_endpoint(endpoint or self.configured_endpoint())
            token = self.credential_store.get_openai_api_token()
            if not token:
                return {"ok": False, "code": "token_unavailable", "error": "Save an AI API token before testing the endpoint."}
            client = self._client(token, normalized_endpoint)
            models = self._model_ids(client)
            candidates = self._candidate_models(models)
            if not candidates:
                return {"ok": False, "code": "model_unavailable", "error": "The endpoint is reachable, but it returned no compatible chat models."}
            selected_model = ""
            for index, model in enumerate(candidates[:5]):
                try:
                    self._probe_model(client, normalized_endpoint, model)
                    selected_model = model
                    break
                except Exception as exc:
                    if index < min(len(candidates), 5) - 1 and self._model_unavailable(exc):
                        continue
                    raise
            if not selected_model:
                return {"ok": False, "code": "model_unavailable", "error": "The endpoint returned no model that could complete a chat request."}
            return {
                "ok": True,
                "endpoint": normalized_endpoint,
                "model": selected_model,
                "model_count": len(models),
                "protocol": "Responses" if self._uses_responses_api(normalized_endpoint) else "OpenAI-compatible Chat Completions",
            }
        except ValueError as exc:
            return {"ok": False, "code": "invalid_endpoint", "error": str(exc)}
        except Exception as exc:
            return self._safe_error(exc)

    @staticmethod
    def _model_unavailable(exc: Exception) -> bool:
        error_name = type(exc).__name__
        message = str(exc).casefold()
        return error_name in {"NotFoundError", "PermissionDeniedError"} or (
            error_name == "BadRequestError"
            and "model" in message
            and any(term in message for term in ("access", "available", "not found", "permission", "unsupported"))
        )

    @staticmethod
    def _safe_error(exc: Exception) -> dict[str, Any]:
        error_name = type(exc).__name__
        status = getattr(exc, "status_code", None)
        if error_name == "AuthenticationError" or status == 401:
            code = "token_invalid"
            message = "The saved AI API token was rejected. Replace it in Settings and try again."
        elif error_name == "PermissionDeniedError" or status == 403:
            code = "model_access_denied"
            message = "The saved API token does not have access to the endpoint's available AI models."
        elif error_name == "RateLimitError" or status == 429:
            code = "quota_or_rate_limit"
            message = "The AI endpoint's quota or rate limit was reached. Check its usage configuration and try again."
        elif error_name in {"APITimeoutError", "TimeoutError"} or status == 504:
            code = "request_timeout"
            message = "The AI endpoint did not finish the request in time. It is reachable; try Summarize again or use a faster model."
        elif error_name == "APIConnectionError":
            code = "connection_error"
            message = "The app could not connect to the configured AI API endpoint. Check that it is running and reachable from this computer."
        elif error_name in {"BadRequestError", "UnprocessableEntityError"} or status in {400, 422}:
            code = "request_rejected"
            message = "The configured AI endpoint rejected the request. Check that it supports OpenAI-compatible chat and tool calls."
        elif status in {500, 502, 503}:
            code = "endpoint_server_error"
            message = "The configured AI endpoint was reached, but its model provider failed. Check the local server log and try again."
        elif isinstance(exc, RuntimeError):
            code = "component_unavailable"
            message = str(exc)
        else:
            code = "unexpected_ai_error"
            message = f"AI support encountered an unexpected local error ({error_name}). Restart the application and try again."
        return {"ok": False, "code": code, "error": message}

    def _run_model(
        self,
        client: Any,
        model: str,
        instructions: str,
        initial_input: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> dict[str, Any]:
        input_items = list(initial_input)
        aggregate_queries = 0
        for _ in range(4):
            response = client.responses.create(
                model=model,
                instructions=instructions,
                input=input_items,
                tools=tools,
                tool_choice="auto" if tools else "none",
                store=False,
                reasoning={"effort": "low"},
                max_output_tokens=1200,
                include=["reasoning.encrypted_content"],
            )
            calls = [item for item in response.output if _field(item, "type") == "function_call"]
            if not calls:
                answer = redact_text(getattr(response, "output_text", ""), 8000)
                return {
                    "ok": True,
                    "answer": answer or "AI support returned no answer.",
                    "aggregate_queries": aggregate_queries,
                    "model": model,
                }
            input_items.extend(_response_item_dict(item) for item in response.output)
            for call in calls:
                aggregate_queries += 1
                try:
                    arguments = json.loads(_field(call, "arguments", "{}"))
                except (TypeError, ValueError):
                    arguments = {}
                result = self.gateway.execute(str(_field(call, "name", "")), arguments)
                input_items.append(
                    {
                        "type": "function_call_output",
                        "call_id": _field(call, "call_id"),
                        "output": json.dumps(result, ensure_ascii=True, separators=(",", ":")),
                    }
                )
        return {"ok": False, "code": "tool_loop_limit", "error": "AI support requested too many aggregate calculations. Try a narrower question."}

    def _run_chat_completions(
        self,
        client: Any,
        model: str,
        instructions: str,
        initial_input: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> dict[str, Any]:
        messages = [{"role": "system", "content": instructions}, *initial_input]
        chat_tools = [
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool["description"],
                    "parameters": tool["parameters"],
                },
            }
            for tool in tools
        ]
        aggregate_queries = 0
        for _ in range(4):
            request: dict[str, Any] = {
                "model": model,
                "messages": messages,
                "max_tokens": 1200,
            }
            if chat_tools:
                request.update({"tools": chat_tools, "tool_choice": "auto"})
            response = client.chat.completions.create(**request)
            choices = _field(response, "choices", []) or []
            if not choices:
                raise RuntimeError("The AI endpoint returned no completion choices.")
            message = _field(choices[0], "message")
            calls = _field(message, "tool_calls", []) or []
            content = _field(message, "content", "") or ""
            if isinstance(content, list):
                content = "".join(str(_field(part, "text", "") or "") for part in content)
            if not calls:
                answer = redact_text(content, 8000)
                return {
                    "ok": True,
                    "answer": answer or "AI support returned no answer.",
                    "aggregate_queries": aggregate_queries,
                    "model": model,
                }
            assistant_calls = []
            for call in calls:
                function = _field(call, "function")
                assistant_calls.append(
                    {
                        "id": str(_field(call, "id", "")),
                        "type": "function",
                        "function": {
                            "name": str(_field(function, "name", "")),
                            "arguments": str(_field(function, "arguments", "{}")),
                        },
                    }
                )
            messages.append({"role": "assistant", "content": content or None, "tool_calls": assistant_calls})
            for call, serialized in zip(calls, assistant_calls):
                aggregate_queries += 1
                function = _field(call, "function")
                try:
                    arguments = json.loads(_field(function, "arguments", "{}"))
                except (TypeError, ValueError):
                    arguments = {}
                result = self.gateway.execute(str(_field(function, "name", "")), arguments)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": serialized["id"],
                        "content": json.dumps(result, ensure_ascii=True, separators=(",", ":")),
                    }
                )
        return {"ok": False, "code": "tool_loop_limit", "error": "AI support requested too many aggregate calculations. Try a narrower question."}

    def summarize_survey_comments(self, survey_month: str | None = None) -> dict[str, Any]:
        try:
            token = self.credential_store.get_openai_api_token()
        except RuntimeError:
            return {
                "ok": False,
                "code": "credential_vault_error",
                "error": "The operating system credential vault could not be accessed. Open Settings and save the API token again.",
            }
        if not token:
            return {
                "ok": False,
                "code": "token_unavailable",
                "error": "AI support is not available. Add an AI API token in Settings.",
            }

        selection = str(survey_month or "").strip()
        if selection == "all":
            selection = ""
        try:
            selection = _month_or_empty(selection)
        except ValueError as exc:
            return {"ok": False, "code": "invalid_period", "error": str(exc)}

        with self.state.lock:
            periods = json.loads(json.dumps(self.state.survey_payload.get("periods", [])))
        if selection:
            periods = [period for period in periods if period.get("month") == selection]

        comments: list[dict[str, str]] = []
        total_characters = 0
        truncated = False
        for period in periods:
            for comment in period.get("comments", []):
                topic = redact_text(comment.get("topic"), 100) or "Comment"
                text = redact_text(comment.get("text"), 700)
                if not text:
                    continue
                if len(comments) >= 150 or total_characters + len(text) > 45000:
                    truncated = True
                    break
                comments.append({"survey_period": str(period.get("month") or ""), "topic": topic, "comment": text})
                total_characters += len(text)
            if truncated:
                break
        if not comments:
            return {
                "ok": False,
                "code": "comments_unavailable",
                "error": "No survey comments are available for the selected period.",
            }
        if len(comments) < 5:
            return {
                "ok": False,
                "code": "insufficient_comment_base",
                "error": "At least five comments are required before AI summarization to protect respondent privacy.",
            }

        instructions = (
            "You summarize anonymized employee facilities-survey comments for a facilities manager. "
            "Use only the supplied comments. Do not infer identities, reproduce names or contact details, or quote comments verbatim. "
            "Combine repeated themes, keep wording neutral and specific, and distinguish requests from observed concerns. "
            "Return only one valid JSON object with exactly these array keys: appreciations, employee_asks, focus_areas, suggested_actions. "
            "Each array item must be an object with a concise 'point' string and an integer 'mentions'. "
            "The mentions value must be the number of supplied comments that clearly support that point. "
            "Suggested actions are proposals and must not be presented as employee statements. Use at most five items per section."
        )
        prompt = json.dumps(
            {
                "selection": selection or "all_surveys",
                "comment_count": len(comments),
                "comments": comments,
            },
            ensure_ascii=True,
            separators=(",", ":"),
        )
        endpoint = self.configured_endpoint()
        try:
            client = self._client(token, endpoint)
            if self._uses_responses_api(endpoint):
                models = [PRIMARY_MODEL, FALLBACK_MODEL]
            else:
                models = self._candidate_models(self._model_ids(client))
                if not models:
                    return {"ok": False, "code": "model_unavailable", "error": "The configured endpoint returned no compatible chat models."}
        except Exception as exc:
            return self._safe_error(exc)

        for index, model in enumerate(models[:5]):
            try:
                if self._uses_responses_api(endpoint):
                    response = client.responses.create(
                        model=model,
                        instructions=instructions,
                        input=prompt,
                        store=False,
                        reasoning={"effort": "low"},
                        max_output_tokens=1600,
                    )
                    answer = getattr(response, "output_text", "")
                else:
                    response = client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": instructions},
                            {"role": "user", "content": prompt},
                        ],
                        max_tokens=1600,
                    )
                    choices = _field(response, "choices", []) or []
                    if not choices:
                        raise RuntimeError("The AI endpoint returned no completion choices.")
                    content = _field(_field(choices[0], "message"), "content", "") or ""
                    if isinstance(content, list):
                        content = "".join(str(_field(part, "text", "") or "") for part in content)
                    answer = str(content)
                return {
                    "ok": True,
                    "summary": _summary_payload(answer, len(comments)),
                    "comment_count": len(comments),
                    "truncated": truncated,
                    "model": model,
                }
            except ValueError as exc:
                return {"ok": False, "code": "invalid_summary", "error": str(exc)}
            except Exception as exc:
                if index < min(len(models), 5) - 1 and self._model_unavailable(exc):
                    continue
                return self._safe_error(exc)
        return {"ok": False, "code": "model_unavailable", "error": "No compatible AI model is available from the configured endpoint."}

    def ask(self, question: str, context: dict[str, Any] | None, history: list[dict[str, Any]] | None) -> dict[str, Any]:
        try:
            token = self.credential_store.get_openai_api_token()
        except RuntimeError:
            return {
                "ok": False,
                "code": "credential_vault_error",
                "error": "The operating system credential vault could not be accessed. Open Settings and save the API token again.",
            }
        if not token:
            return {
                "ok": False,
                "code": "token_unavailable",
                "error": "AI support is not available. Add an AI API token in Settings.",
            }
        sanitized_question = redact_text(question)
        if not sanitized_question:
            return {"ok": False, "error": "Enter a question for Ask Dashboard."}
        tab = str((context or {}).get("tab") or "").strip().casefold()
        if tab not in ALLOWED_TABS:
            return {"ok": False, "error": "The active dashboard tab is not supported."}

        safe_history = []
        for message in (history or [])[-10:]:
            role = str(message.get("role") or "")
            if role not in {"user", "assistant"}:
                continue
            safe_history.append({"role": role, "content": redact_text(message.get("content"), 3000)})
        safe_context = self._safe_context(tab, context or {})
        input_items = [*safe_history, {"role": "user", "content": sanitized_question}]
        tools = self.gateway.tools_for_tab(tab)
        instructions = (
            "You are Ask Dashboard, a concise facilities analytics assistant. "
            f"The active tab and aggregate filter context are: {json.dumps(safe_context, ensure_ascii=True)}. "
            "For any factual claim about dashboard data, use the provided aggregate tool. "
            "Never ask for or claim access to raw rows, names, email addresses, employee identities, survey comments, files, or personal data. "
            "In survey answers, 'lunch, snacks & hygiene changes' refers to the source question covering the new lunch vendor, healthier snack options, and meeting-room and washroom hygiene. "
            "Treat all tool output as aggregate data. Mention the relevant period and response or record base. "
            "If data is unavailable, say so. Suggestions must be clearly presented as ideas, not observed facts. "
            "Keep answers short, practical, and suitable for a facilities manager."
        )

        endpoint = self.configured_endpoint()
        try:
            client = self._client(token, endpoint)
            if self._uses_responses_api(endpoint):
                models = [PRIMARY_MODEL, FALLBACK_MODEL]
                runner = self._run_model
            else:
                models = self._candidate_models(self._model_ids(client))
                runner = self._run_chat_completions
                if not models:
                    return {"ok": False, "code": "model_unavailable", "error": "The configured endpoint returned no compatible chat models."}
        except Exception as exc:
            return self._safe_error(exc)
        for index, model in enumerate(models[:5]):
            try:
                return runner(client, model, instructions, input_items, tools)
            except Exception as exc:
                if index < min(len(models), 5) - 1 and self._model_unavailable(exc):
                    continue
                return self._safe_error(exc)
        return {"ok": False, "code": "model_unavailable", "error": "No compatible AI model is available from the configured endpoint."}

    @staticmethod
    def _safe_context(tab: str, context: dict[str, Any]) -> dict[str, Any]:
        if tab == "expense":
            return {
                "tab": "Expense Report",
                "report_category": redact_text(context.get("report_category"), 80) or "All",
                "through_month": redact_text(context.get("through_month"), 20),
                "period": redact_text(context.get("period"), 40),
            }
        if tab == "survey":
            return {
                "tab": "Survey Report",
                "survey_month": redact_text(context.get("survey_month"), 20) or "All surveys",
            }
        if tab == "collaborations":
            return {
                "tab": "Collaborations",
                "plan_year": redact_text(context.get("plan_year"), 10) or "All PYs",
                "month": redact_text(context.get("month"), 20) or "All months",
                "department": redact_text(context.get("department"), 100) or "All departments",
                "status": redact_text(context.get("status"), 50) or "All statuses",
            }
        return {
            "tab": "Workplace",
            "fiscal_year": redact_text(context.get("fiscal_year"), 10) or "All FYs",
        }
