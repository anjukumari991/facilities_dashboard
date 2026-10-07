from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys
import threading
from typing import Any

import webview

from app import DashboardState, create_server
from local_storage import ExpenseLibrary


class DesktopApi:
    def __init__(self, state: DashboardState):
        self.state = state
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
    window.expose(api.get_app_state, api.choose_base_directory, api.open_base_directory)

    try:
        # The packaged Windows app uses Qt so the executable contains its own
        # renderer and does not depend on a separately installed WebView2
        # runtime. Other platforms continue to use their native renderer.
        if os.name == "nt":
            webview.start(gui="qt", debug=args.debug)
        else:
            webview.start(debug=args.debug)
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)


if __name__ == "__main__":
    main()
