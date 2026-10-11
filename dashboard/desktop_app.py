from __future__ import annotations

import argparse
import math
import os
from pathlib import Path
import subprocess
import sys
import threading
from typing import Any

import webview

from app import STATIC, DashboardState, create_server
from chat_service import DEFAULT_AI_API_ENDPOINT, DashboardChatService, normalize_api_endpoint
from local_storage import ExpenseLibrary
from secure_storage import SecureCredentialStore
from updater import GitHubReleaseUpdater, UpdateError, schedule_window_close


class DesktopApi:
    def __init__(self, state: DashboardState, credential_store: SecureCredentialStore | None = None):
        self.state = state
        self.credential_store = credential_store or SecureCredentialStore()
        settings = self.state.library.settings.load()
        if not str(settings.get("ai_api_endpoint") or "").strip():
            self.state.library.settings.update(ai_api_endpoint=DEFAULT_AI_API_ENDPOINT)
        self.chat_service = DashboardChatService(state, self.credential_store)
        self.updater = GitHubReleaseUpdater()
        self.window: webview.Window | None = None

    def get_app_state(self) -> dict[str, Any]:
        with self.state.lock:
            return self.state.refresh_library()

    def choose_base_directory(self) -> dict[str, Any]:
        if self.window is None:
            return {"configured": False, "error": "The application window is not ready."}
        initial = str(self.state.library.base_dir or Path.home())
        selected = self.window.create_file_dialog(webview.FileDialog.FOLDER, directory=initial)
        if not selected:
            return {**self.get_app_state(), "cancelled": True}
        try:
            return self.state.configure_base_directory(selected[0])
        except Exception as exc:
            return {**self.get_app_state(), "error": str(exc)}

    def open_base_directory(self) -> dict[str, Any]:
        base_dir = self.state.library.base_dir
        if base_dir is None:
            return {"ok": False, "error": "Choose a base directory first."}
        try:
            if os.name == "nt":
                os.startfile(str(base_dir))  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(base_dir)])
            else:
                subprocess.Popen(["xdg-open", str(base_dir)])
            return {"ok": True, "path": str(base_dir)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def open_contract(self, identifier: str) -> dict[str, Any]:
        contracts_dir = self.state.library.contracts_dir
        if contracts_dir is None:
            return {"ok": False, "error": "Choose a base directory first."}
        try:
            root = contracts_dir.resolve()
            requested = root / str(identifier or "")
            if requested.is_symlink():
                raise ValueError("Linked contract files cannot be opened from the dashboard.")
            target = requested.resolve()
            if root not in target.parents or not target.is_file():
                raise ValueError("The selected contract is not available in the contracts folder.")
            if os.name == "nt":
                os.startfile(str(target))  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(target)])
            else:
                subprocess.Popen(["xdg-open", str(target)])
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def open_audit_report(self, identifier: str) -> dict[str, Any]:
        reports_dir = self.state.library.audit_reports_dir
        if reports_dir is None:
            return {"ok": False, "error": "Choose a base directory first."}
        try:
            root = reports_dir.resolve()
            relative = Path(str(identifier or ""))
            requested = root / relative
            cursor = root
            for part in relative.parts:
                cursor /= part
                if cursor.is_symlink():
                    raise ValueError("Linked audit reports cannot be opened from the dashboard.")
            target = requested.resolve()
            if root not in target.parents or not target.is_file():
                raise ValueError("The selected audit report is not available in the audit_reports folder.")
            if os.name == "nt":
                os.startfile(str(target))  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(target)])
            else:
                subprocess.Popen(["xdg-open", str(target)])
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def get_currency_preferences(self) -> dict[str, Any]:
        settings = self.state.library.settings.load()
        currency = settings.get("display_currency")
        exchange_rate = settings.get("usd_to_inr_rate")
        if currency not in {"INR", "USD"}:
            currency = "INR"
        try:
            exchange_rate = float(exchange_rate)
        except (TypeError, ValueError):
            exchange_rate = 96.0
        if not math.isfinite(exchange_rate) or exchange_rate <= 0:
            exchange_rate = 96.0
        return {"currency": currency, "exchange_rate": exchange_rate}

    def set_currency_preferences(self, currency: str, exchange_rate: float) -> dict[str, Any]:
        if currency not in {"INR", "USD"}:
            raise ValueError("Currency must be INR or USD.")
        try:
            normalized_rate = float(exchange_rate)
        except (TypeError, ValueError) as exc:
            raise ValueError("Exchange rate must be a number.") from exc
        if not math.isfinite(normalized_rate) or normalized_rate <= 0:
            raise ValueError("Exchange rate must be greater than zero.")
        self.state.library.settings.update(
            display_currency=currency,
            usd_to_inr_rate=normalized_rate,
        )
        return {"currency": currency, "exchange_rate": normalized_rate}

    def get_settings_state(self) -> dict[str, Any]:
        credential_error = None
        try:
            token_configured = self.credential_store.has_openai_api_token()
        except RuntimeError as exc:
            token_configured = False
            credential_error = str(exc)
        return {
            "base_dir": str(self.state.library.base_dir) if self.state.library.base_dir else None,
            "api_endpoint": self.chat_service.configured_endpoint(),
            "token_configured": token_configured,
            "credential_vault": self.credential_store.vault_name,
            "credential_error": credential_error,
            "updates": self.updater.local_state(),
        }

    def check_for_updates(self) -> dict[str, Any]:
        try:
            return self.updater.check()
        except UpdateError as exc:
            return {"ok": False, "error": str(exc), **self.updater.local_state()}
        except Exception:
            return {
                "ok": False,
                "error": "The update check failed unexpectedly. Try again later.",
                **self.updater.local_state(),
            }

    def install_latest_update(self) -> dict[str, Any]:
        try:
            result = self.updater.install_latest()
        except UpdateError as exc:
            return {"ok": False, "error": str(exc), **self.updater.local_state()}
        except Exception:
            return {
                "ok": False,
                "error": "The update could not be downloaded or installed.",
                **self.updater.local_state(),
            }
        if result.get("status") == "restarting" and self.window is not None:
            schedule_window_close(self.window)
        return result

    def save_ai_api_endpoint(self, endpoint: str) -> dict[str, Any]:
        normalized = normalize_api_endpoint(endpoint)
        self.state.library.settings.update(ai_api_endpoint=normalized)
        return {"ok": True, "api_endpoint": normalized}

    def test_ai_api_endpoint(self, endpoint: str | None = None) -> dict[str, Any]:
        return self.chat_service.test_endpoint(endpoint or self.chat_service.configured_endpoint())

    def save_openai_api_token(self, token: str) -> dict[str, Any]:
        self.credential_store.set_openai_api_token(token)
        return {"ok": True, "token_configured": True}

    def delete_openai_api_token(self) -> dict[str, Any]:
        removed = self.credential_store.delete_openai_api_token()
        return {"ok": True, "removed": removed, "token_configured": False}

    def ask_dashboard(
        self,
        question: str,
        context: dict[str, Any] | None = None,
        history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        return self.chat_service.ask(question, context, history)

    def summarize_survey_comments(self, survey_month: str | None = None) -> dict[str, Any]:
        return self.chat_service.summarize_survey_comments(survey_month)


def main() -> None:
    parser = argparse.ArgumentParser(description="Facility Expense Dashboard desktop application")
    parser.add_argument("--debug", action="store_true", help="Enable pywebview debug tools")
    args = parser.parse_args()

    library = ExpenseLibrary()
    state = DashboardState(library)
    server = create_server(state, "127.0.0.1", 0)
    server_thread = threading.Thread(target=server.serve_forever, name="expense-dashboard-server", daemon=True)
    server_thread.start()

    api = DesktopApi(state)
    window = webview.create_window(
        "Facility Expense Dashboard",
        f"http://127.0.0.1:{server.server_port}",
        width=1440,
        height=920,
        min_size=(900, 650),
        text_select=True,
    )
    api.window = window
    window.expose(
        api.get_app_state,
        api.choose_base_directory,
        api.open_base_directory,
        api.open_contract,
        api.open_audit_report,
        api.get_currency_preferences,
        api.set_currency_preferences,
        api.get_settings_state,
        api.check_for_updates,
        api.install_latest_update,
        api.save_ai_api_endpoint,
        api.test_ai_api_endpoint,
        api.save_openai_api_token,
        api.delete_openai_api_token,
        api.ask_dashboard,
        api.summarize_survey_comments,
    )

    try:
        # The packaged Windows app uses Qt so the executable contains its own
        # renderer and does not depend on a separately installed WebView2
        # runtime. Other platforms continue to use their native renderer.
        if os.name == "nt":
            webview.start(gui="qt", debug=args.debug, icon=str(STATIC / "app-icon.png"))
        else:
            webview.start(debug=args.debug, icon=str(STATIC / "app-icon.png"))
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)


if __name__ == "__main__":
    main()
