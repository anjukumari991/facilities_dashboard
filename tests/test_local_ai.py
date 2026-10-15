from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "dashboard"))

from local_ai import LocalAIManager, LocalModel, ModelFile, MODEL_CATALOG  # noqa: E402
from local_storage import SettingsStore  # noqa: E402


class _Credentials:
    def __init__(self):
        self.token = None

    def get_local_ai_token(self):
        return self.token

    def set_local_ai_token(self, token):
        self.token = token


class LocalAIManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="facilities-local-ai-test-")
        root = Path(self.temporary.name)
        self.settings = SettingsStore(root / "settings.json")
        self.manager = LocalAIManager(self.settings, _Credentials(), root / "models", port=12481)

    def tearDown(self) -> None:
        self.manager.shutdown()
        self.temporary.cleanup()

    def test_catalog_uses_https_and_pinned_hashes(self) -> None:
        self.assertGreaterEqual(len(MODEL_CATALOG), 3)
        for model in MODEL_CATALOG:
            for item in model.files:
                self.assertTrue(item.url.startswith("https://"))
                self.assertEqual(len(item.sha256), 64)
                self.assertGreater(item.size, 0)

    def test_selection_is_persisted(self) -> None:
        selected = MODEL_CATALOG[1]
        state = self.manager.select(selected.identifier)
        self.assertEqual(state["selected_model"], selected.identifier)
        self.assertEqual(self.settings.load()["local_ai_model"], selected.identifier)

    def test_complete_files_are_recognised_as_installed(self) -> None:
        model = LocalModel(
            identifier="tiny-test-model",
            name="Tiny test model",
            description="Test only",
            size_label="4 B",
            memory_label="4 B",
            files=(ModelFile("tiny.gguf", "https://example.invalid/tiny.gguf", "0" * 64, 4),),
        )
        directory = self.manager.models_dir / model.identifier
        directory.mkdir(parents=True)
        for item in model.files:
            (directory / item.filename).write_bytes(b"test")
        self.assertTrue(self.manager._installed(model))

    def test_native_server_is_accepted_when_python_binding_is_absent(self) -> None:
        with patch.object(LocalAIManager, "python_runtime_available", return_value=False), patch.object(
            LocalAIManager, "_llama_server_path", return_value="/opt/homebrew/bin/llama-server"
        ):
            self.assertTrue(LocalAIManager.runtime_available())
            self.assertEqual(LocalAIManager.runtime_name(), "Native llama.cpp server")

    def test_first_download_creates_missing_model_directory_before_disk_check(self) -> None:
        missing_models = Path(self.temporary.name) / "fresh-install" / "models"
        manager = LocalAIManager(self.settings, _Credentials(), missing_models, port=12482)
        self.addCleanup(manager.shutdown)

        with patch.object(LocalAIManager, "runtime_available", return_value=True), patch.object(
            manager, "_download_worker"
        ) as worker:
            manager.download_selected()
            manager.download_thread.join(timeout=1)

        self.assertTrue(missing_models.is_dir())
        worker.assert_called_once()

    def test_windows_curl_uses_best_effort_certificate_revocation(self) -> None:
        model_file = ModelFile("tiny.gguf", "https://example.invalid/tiny.gguf", "0" * 64, 4)
        part = Path(self.temporary.name) / "tiny.gguf.part"
        captured_command: list[str] = []

        class CompletedProcess:
            returncode = 0

            @staticmethod
            def poll():
                return 0

            @staticmethod
            def communicate():
                return "", ""

        def launch(command, **_kwargs):
            captured_command.extend(command)
            part.write_bytes(b"test")
            return CompletedProcess()

        with patch("local_ai.sys.platform", "win32"), patch("local_ai.subprocess.Popen", side_effect=launch):
            self.manager._download_file_with_curl("curl.exe", model_file, part, 0, 0)

        self.assertIn("--ssl-revoke-best-effort", captured_command)
        self.assertIn("Cache-Control: no-cache", captured_command)
        self.assertIn("Pragma: no-cache", captured_command)
        self.assertTrue(captured_command[-1].startswith(f"{model_file.url}?facilities_download="))


if __name__ == "__main__":
    unittest.main()
