from __future__ import annotations

import argparse
from datetime import datetime
import json
import mimetypes
from pathlib import Path
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import webbrowser

from audit_reports import list_audit_reports
from collaboration_parser import load_collaborations
from expense_parser import load_expenses
from local_storage import ExpenseLibrary
from survey_parser import load_surveys, survey_signature
from workplace_parser import load_workplace, workplace_signature


ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"


class DashboardState:
    def __init__(self, library: ExpenseLibrary):
        self.library = library
        self.lock = threading.RLock()
        self.payload: dict = {}
        self.source_signature: tuple[str, int, int] | None = None
        self.error: str | None = None
        self.survey_payload: dict = {"periods": [], "meta": {"months": [], "file_count": 0, "response_count": 0}}
        self.survey_source_signature: tuple[tuple[str, int, int], ...] = ()
        self.survey_error: str | None = None
        self.workplace_payload: dict = {
            "records": [],
            "contracts": [],
            "forecast": {},
            "meta": {"months": [], "fiscal_years": [], "file_count": 0, "record_count": 0},
        }
        self.workplace_source_signature: tuple[tuple[str, int, int], ...] = ()
        self.workplace_error: str | None = None
        self.collaboration_payload: dict = {
            "records": [],
            "meta": {"months": [], "plan_years": [], "departments": [], "statuses": [], "record_count": 0},
        }
        self.collaboration_source_signature: tuple[str, int, int] | None = None
        self.collaboration_error: str | None = None
        if self.library.selected:
            self.reload(force=True)
        self.reload_surveys(force=True)
        self.reload_workplace(force=True)
        self.reload_collaborations(force=True)

    def configure_base_directory(self, base_dir: str | Path) -> dict:
        with self.lock:
            self.library.configure(base_dir)
            self.payload = {}
            self.source_signature = None
            self.error = None
            self.survey_payload = {"periods": [], "meta": {"months": [], "file_count": 0, "response_count": 0}}
            self.survey_source_signature = ()
            self.survey_error = None
            self.workplace_payload = {
                "records": [],
                "contracts": [],
                "forecast": {},
                "meta": {"months": [], "fiscal_years": [], "file_count": 0, "record_count": 0},
            }
            self.workplace_source_signature = ()
            self.workplace_error = None
            self.collaboration_payload = {
                "records": [],
                "meta": {"months": [], "plan_years": [], "departments": [], "statuses": [], "record_count": 0},
            }
            self.collaboration_source_signature = None
            self.collaboration_error = None
            if self.library.selected:
                self.reload(force=True)
            self.reload_surveys(force=True)
            self.reload_workplace(force=True)
            self.reload_collaborations(force=True)
            return self.library.summary()

    def refresh_library(self) -> dict:
        with self.lock:
            previous = self.library.selected_id
            self.library.refresh()
            if self.library.selected_id != previous:
                self.payload = {}
                self.source_signature = None
                self.error = None
                if self.library.selected:
                    self.reload(force=True)
                self.reload_collaborations(force=True)
            return self.library.summary()

    def reload_surveys(self, force: bool = False) -> None:
        with self.lock:
            try:
                signature = survey_signature(self.library.base_dir)
                if not force and signature == self.survey_source_signature:
                    return
                self.survey_payload = load_surveys(self.library.base_dir)
                self.survey_source_signature = signature
                self.survey_error = None
            except Exception as exc:
                self.survey_error = f"{type(exc).__name__}: {exc}"

    def reload_workplace(self, force: bool = False) -> None:
        with self.lock:
            try:
                signature = workplace_signature(self.library.base_dir)
                # Contract files are only listed, never opened or parsed. Loading on
                # every request keeps that lightweight listing current as files move.
                self.workplace_payload = load_workplace(self.library.base_dir)
                self.workplace_source_signature = signature
                self.workplace_error = None
            except Exception as exc:
                self.workplace_error = f"{type(exc).__name__}: {exc}"

    def reload_collaborations(self, force: bool = False) -> None:
        with self.lock:
            selected = self.library.selected
            if selected is None:
                self.collaboration_payload = {
                    "records": [],
                    "meta": {"months": [], "plan_years": [], "departments": [], "statuses": [], "record_count": 0},
                }
                self.collaboration_source_signature = None
                self.collaboration_error = None
                return
            try:
                stat = selected.path.stat()
                signature = (str(selected.path), stat.st_mtime_ns, stat.st_size)
                if not force and signature == self.collaboration_source_signature:
                    return
                self.collaboration_payload = load_collaborations(selected.path)
                self.collaboration_payload["meta"].update(
                    {
                        "source_name": selected.path.name,
                        "source_relative_path": selected.relative_path,
                        "loaded_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                    }
                )
                self.collaboration_source_signature = signature
                self.collaboration_error = None
            except Exception as exc:
                self.collaboration_error = f"{type(exc).__name__}: {exc}"

    def select_workbook(self, identifier: str) -> dict:
        with self.lock:
            self.library.select(identifier)
            self.payload = {}
            self.source_signature = None
            self.error = None
            self.reload(force=True)
            self.reload_collaborations(force=True)
            if self.error:
                raise ValueError(self.error)
            return self.library.summary()

    def reload(self, force: bool = False) -> None:
        with self.lock:
            self.library.refresh()
            selected = self.library.selected
            if selected is None:
                self.payload = {}
                self.source_signature = None
                if self.library.base_dir is None:
                    self.error = "Choose a base directory to start the dashboard."
                else:
                    self.error = f"No Excel workbooks were found in {self.library.expenses_dir}."
                return

            try:
                stat = selected.path.stat()
                signature = (str(selected.path), stat.st_mtime_ns, stat.st_size)
                if not force and self.source_signature == signature:
                    return
                parsed = load_expenses(selected.path)
                parsed["meta"].update(
                    {
                        "source_name": selected.path.name,
                        "source_path": str(selected.path),
                        "source_relative_path": selected.relative_path,
                        "base_dir": str(self.library.base_dir),
                        "expenses_dir": str(self.library.expenses_dir),
                        "available_workbooks": len(self.library.entries),
                        "loaded_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                        "allow_upload": False,
                        "storage_mode": "local_filesystem",
                    }
                )
                self.payload = parsed
                self.source_signature = signature
                self.error = None
            except Exception as exc:  # keep the last good payload if an edited file is temporarily invalid
                self.error = f"{type(exc).__name__}: {exc}"


def make_handler(state: DashboardState):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ExpenseDashboard/2.0"

        def _security_headers(self) -> None:
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
                "base-uri 'none'; frame-ancestors 'none'",
            )

        def _json(self, payload: dict, status: int = 200) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self._security_headers()
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self) -> dict:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 1024 * 1024:
                raise ValueError("A valid JSON request body is required.")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("The JSON request body must be an object.")
            return payload

        def _serve_file(self, relative: str) -> None:
            requested = (STATIC / relative).resolve()
            if STATIC.resolve() not in requested.parents and requested != STATIC.resolve():
                self.send_error(403)
                return
            if not requested.is_file():
                self.send_error(404)
                return
            body = requested.read_bytes()
            mime = mimetypes.guess_type(requested.name)[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", f"{mime}; charset=utf-8" if mime.startswith("text/") else mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self._security_headers()
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            path = urlsplit(self.path).path
            if path == "/healthz":
                self._json({"ok": state.error is None}, 200 if state.error is None else 503)
                return
            if path in ("/", "/index.html"):
                self._serve_file("index.html")
                return
            if path == "/api/library":
                with state.lock:
                    summary = state.refresh_library()
                    self._json({**summary, "error": state.error})
                return
            if path == "/api/data":
                state.reload()
                with state.lock:
                    self._json({**state.payload, "error": state.error})
                return
            if path == "/api/surveys":
                state.reload_surveys()
                with state.lock:
                    self._json({**state.survey_payload, "error": state.survey_error})
                return
            if path == "/api/workplace":
                state.reload_workplace()
                with state.lock:
                    self._json({**state.workplace_payload, "error": state.workplace_error})
                return
            if path == "/api/collaborations":
                state.reload_collaborations()
                with state.lock:
                    self._json({**state.collaboration_payload, "error": state.collaboration_error})
                return
            if path == "/api/audit-reports":
                try:
                    with state.lock:
                        self._json({**list_audit_reports(state.library.base_dir), "error": None})
                except Exception as exc:
                    self._json({"reports": [], "meta": {}, "error": f"{type(exc).__name__}: {exc}"}, 500)
                return
            if path == "/api/refresh":
                state.reload(force=True)
                state.reload_surveys(force=True)
                state.reload_workplace(force=True)
                state.reload_collaborations(force=True)
                with state.lock:
                    self._json(
                        {
                            "ok": True,
                            "meta": state.payload.get("meta", {}),
                            "expense_error": state.error,
                            "survey_meta": state.survey_payload.get("meta", {}),
                            "survey_error": state.survey_error,
                            "workplace_meta": state.workplace_payload.get("meta", {}),
                            "workplace_error": state.workplace_error,
                            "collaboration_meta": state.collaboration_payload.get("meta", {}),
                            "collaboration_error": state.collaboration_error,
                        }
                    )
                return
            self._serve_file(path.lstrip("/"))

        def do_POST(self) -> None:  # noqa: N802
            path = urlsplit(self.path).path
            if path != "/api/select-workbook":
                self.send_error(404)
                return
            try:
                payload = self._read_json()
                identifier = payload.get("id")
                if not isinstance(identifier, str) or not identifier:
                    raise ValueError("A workbook id is required.")
                summary = state.select_workbook(identifier)
                self._json({"ok": True, **summary})
            except Exception as exc:
                self._json({"ok": False, "error": str(exc)}, 400)

        def log_message(self, fmt: str, *args) -> None:
            print(f"[{self.log_date_time_string()}] {fmt % args}")

    return Handler


def create_server(state: DashboardState, host: str = "127.0.0.1", port: int = 0) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), make_handler(state))


def main() -> None:
    parser = argparse.ArgumentParser(description="Local facility expense dashboard backed by Excel files.")
    parser.add_argument("--base-dir", help="Directory containing the expenses subdirectory")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="Open the dashboard in the default browser")
    args = parser.parse_args()

    library = ExpenseLibrary()
    if args.base_dir:
        library.configure(args.base_dir)
    if library.base_dir is None:
        parser.error("No base directory is configured. Launch desktop_app.py for the first-run folder picker.")

    state = DashboardState(library)
    server = create_server(state, args.host, args.port)
    url = f"http://{args.host}:{server.server_port}"
    print(f"Expense dashboard: {url}")
    print(f"Expenses directory: {library.expenses_dir}")
    if args.open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dashboard.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
