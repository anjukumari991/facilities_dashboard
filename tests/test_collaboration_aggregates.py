from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys
import threading
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "dashboard"))

from chat_service import AggregateGateway  # noqa: E402


class CollaborationAggregateTests(unittest.TestCase):
    def test_aggregate_boundary_excludes_free_text(self) -> None:
        state = SimpleNamespace(
            lock=threading.RLock(),
            collaboration_payload={
                "records": [
                    {
                        "month": "2026-09-01",
                        "plan_year": "PY26",
                        "department": "People Experience Team",
                        "status": "Completed",
                        "activity": "Private name and person@example.com",
                        "timeline": "Private timeline",
                        "outcome": "Private outcome",
                    },
                    {
                        "month": "2026-10-01",
                        "plan_year": "PY26",
                        "department": "Finance",
                        "status": "Awaiting Approval",
                        "activity": "Another private activity",
                        "timeline": "Private timeline",
                        "outcome": "",
                    },
                ]
            },
        )
        result = AggregateGateway(state).aggregate_collaborations(
            {
                "metric": "collaboration_count",
                "group_by": ["status"],
                "plan_year": "PY26",
                "month": "",
                "department": "",
                "status": "",
                "limit": 10,
            }
        )
        serialized = str(result)
        self.assertEqual(len(result["rows"]), 2)
        self.assertNotIn("person@example.com", serialized)
        self.assertNotIn("Private", serialized)
        self.assertIn("Awaiting Approval", serialized)


if __name__ == "__main__":
    unittest.main()
