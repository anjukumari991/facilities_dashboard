from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import threading
import unittest

from openpyxl import Workbook


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "dashboard"))

from chat_service import DashboardChatService, _summary_payload  # noqa: E402
from survey_parser import load_surveys  # noqa: E402


SURVEY_HEADERS = [
    "ID",
    "Start time",
    "Completion time",
    "Email",
    "Name",
    "How satisfied are you with food and fresh beverage?",
    "How do you rate the recent workplace enhancements?",
    "Work Areas",
    "Meeting Rooms",
    "Pantry",
    "Washroom",
    "Air quality, lighting, temperature and noise",
    "Reception Area",
    "Kitchen / Breakout Area",
    "Overall experience with Sequoia India facilities",
    "Any other Suggestions or Feedback?",
]


class SurveyCommentParserTests(unittest.TestCase):
    def test_reads_only_recognised_comments_and_masks_direct_identifiers(self) -> None:
        temporary_directory = Path(tempfile.mkdtemp(prefix="facilities-survey-comment-test-"))
        surveys_directory = temporary_directory / "surveys"
        surveys_directory.mkdir()
        path = surveys_directory / "survey.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(SURVEY_HEADERS)
        sheet.append(
            [
                "SECRET-ID-1",
                "2026-10-01 09:00:00",
                "2026-10-01 09:05:00",
                "person@example.com",
                "Private Person",
                "Satisfied",
                4,
                "Satisfied",
                "Satisfied",
                "Satisfied",
                "Satisfied",
                "Satisfied",
                "Satisfied",
                "Satisfied",
                5,
                "Email me at person@example.com; Anju & Suman are helpful; employee ID A-123.",
            ]
        )
        workbook.save(path)
        workbook.close()
        try:
            payload = load_surveys(temporary_directory)
            serialized = json.dumps(payload)
            comment = payload["periods"][0]["comments"][0]["text"]
            self.assertEqual(payload["periods"][0]["comment_count"], 1)
            self.assertEqual(payload["periods"][0]["commenting_response_count"], 1)
            self.assertIn("[email removed]", comment)
            self.assertIn("[names removed]", comment)
            self.assertIn("[employee identifier removed]", comment)
            self.assertNotIn("Private Person", serialized)
            self.assertNotIn("SECRET-ID-1", serialized)
            self.assertNotIn("person@example.com", serialized)
        finally:
            path.unlink(missing_ok=True)
            surveys_directory.rmdir()
            temporary_directory.rmdir()

    def test_does_not_treat_rating_question_feedback_word_as_comment(self) -> None:
        headers = list(SURVEY_HEADERS)
        headers[5] = "Food and fresh beverage feedback and support"
        headers.pop()
        temporary_directory = Path(tempfile.mkdtemp(prefix="facilities-survey-no-comment-test-"))
        surveys_directory = temporary_directory / "surveys"
        surveys_directory.mkdir()
        path = surveys_directory / "survey.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(headers)
        sheet.append(["id", "2026-10-01", "2026-10-01", "x@example.com", "Name", "Satisfied", 4, "Satisfied", "Satisfied", "Satisfied", "Satisfied", "Satisfied", "Satisfied", "Satisfied", 4])
        workbook.save(path)
        workbook.close()
        try:
            payload = load_surveys(temporary_directory)
            self.assertEqual(payload["periods"][0]["comments"], [])
        finally:
            path.unlink(missing_ok=True)
            surveys_directory.rmdir()
            temporary_directory.rmdir()


class SurveyCommentSummaryTests(unittest.TestCase):
    def test_timeout_is_not_reported_as_connection_failure(self) -> None:
        timeout_error = type("APITimeoutError", (Exception,), {})
        result = DashboardChatService._safe_error(timeout_error("timed out"))
        self.assertEqual(result["code"], "request_timeout")
        self.assertIn("reachable", result["error"])

    def test_summary_payload_accepts_json_fences_and_validates_mentions(self) -> None:
        parsed = _summary_payload(
            '```json\n{"appreciations":[{"point":"Healthy food","mentions":3}],"employee_asks":[],"focus_areas":[],"suggested_actions":[]}\n```',
            2,
        )
        self.assertEqual(parsed["appreciations"][0]["point"], "Healthy food")
        self.assertIsNone(parsed["appreciations"][0]["mentions"])

    def test_summary_sends_no_identity_fields_and_redacts_comment_content(self) -> None:
        captured: dict = {}

        class Models:
            def list(self):
                return SimpleNamespace(data=[SimpleNamespace(id="local-model")])

        class Completions:
            def create(self, **request):
                captured.update(request)
                content = json.dumps(
                    {
                        "appreciations": [{"point": "Facilities support", "mentions": 1}],
                        "employee_asks": [],
                        "focus_areas": [],
                        "suggested_actions": [],
                    }
                )
                return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])

        client = SimpleNamespace(models=Models(), chat=SimpleNamespace(completions=Completions()))
        settings = SimpleNamespace(load=lambda: {"ai_api_endpoint": "http://127.0.0.1:12345/v1"})
        state = SimpleNamespace(
            lock=threading.RLock(),
            library=SimpleNamespace(settings=settings),
            survey_payload={
                "periods": [
                    {
                        "month": "2026-10-01",
                        "comments": [
                            {"topic": "Feedback", "text": "Anju & Suman helped; contact person@example.com"},
                            {"topic": "Feedback", "text": "More meeting rooms"},
                            {"topic": "Feedback", "text": "Healthy lunch options"},
                            {"topic": "Feedback", "text": "Facilities are good"},
                            {"topic": "Feedback", "text": "Improve pantry seating"},
                        ],
                    }
                ]
            },
        )
        credentials = SimpleNamespace(get_openai_api_token=lambda: "test-token")
        service = DashboardChatService(state, credentials, client_factory=lambda *_args: client)
        result = service.summarize_survey_comments("2026-10-01")
        prompt = captured["messages"][1]["content"]
        self.assertTrue(result["ok"])
        self.assertNotIn("Anju", prompt)
        self.assertNotIn("Suman", prompt)
        self.assertNotIn("person@example.com", prompt)
        self.assertNotIn("email", json.loads(prompt)["comments"][0])


if __name__ == "__main__":
    unittest.main()
