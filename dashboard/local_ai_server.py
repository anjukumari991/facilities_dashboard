from __future__ import annotations

import json
import inspect
import os
from pathlib import Path
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


def run_local_ai_server(model_path: str, model_id: str, port: int, api_key: str) -> None:
    try:
        from llama_cpp import Llama
    except ImportError as exc:
        raise RuntimeError("The local AI runtime is not installed.") from exc

    gpu_layers = -1 if os.sys.platform == "darwin" else 0
    threads = max(2, min(12, (os.cpu_count() or 4) - 1))
    llm = Llama(
        model_path=str(Path(model_path).resolve()),
        n_ctx=16_384,
        n_threads=threads,
        n_threads_batch=threads,
        n_gpu_layers=gpu_layers,
        chat_format="chatml-function-calling",
        verbose=False,
    )
    inference_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        server_version = "FacilitiesLocalAI/1.0"

        def log_message(self, _format: str, *_args: Any) -> None:
            return

        def _authorized(self) -> bool:
            return self.headers.get("Authorization", "") == f"Bearer {api_key}"

        def _json(self, status: int, payload: Any) -> None:
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            if not self._authorized():
                self._json(401, {"error": {"message": "Unauthorized", "type": "authentication_error"}})
                return
            if self.path == "/health":
                self._json(200, {"ok": True, "model": model_id})
            elif self.path.rstrip("/") == "/v1/models":
                self._json(200, {"object": "list", "data": [{"id": model_id, "object": "model", "owned_by": "local"}]})
            else:
                self._json(404, {"error": {"message": "Not found", "type": "not_found_error"}})

        def do_POST(self) -> None:  # noqa: N802
            if not self._authorized():
                self._json(401, {"error": {"message": "Unauthorized", "type": "authentication_error"}})
                return
            if self.path.rstrip("/") != "/v1/chat/completions":
                self._json(404, {"error": {"message": "Not found", "type": "not_found_error"}})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 2_000_000:
                    raise ValueError("Request body is empty or too large.")
                request = json.loads(self.rfile.read(length))
                if request.get("stream"):
                    raise ValueError("Streaming is not supported by the managed local server.")
                kwargs: dict[str, Any] = {
                    "messages": request.get("messages") or [],
                    "max_tokens": min(2_048, max(1, int(request.get("max_tokens") or 1_200))),
                    "temperature": float(request.get("temperature", 0.2)),
                    "stream": False,
                }
                if request.get("tools"):
                    kwargs["tools"] = request["tools"]
                    kwargs["tool_choice"] = request.get("tool_choice", "auto")
                if request.get("response_format"):
                    kwargs["response_format"] = request["response_format"]
                if model_id.startswith("qwen3-") and "chat_template_kwargs" in inspect.signature(llm.create_chat_completion).parameters:
                    kwargs["chat_template_kwargs"] = {"enable_thinking": False}
                with inference_lock:
                    response = llm.create_chat_completion(**kwargs)
                self._json(200, response)
            except (TypeError, ValueError, json.JSONDecodeError) as exc:
                self._json(400, {"error": {"message": str(exc), "type": "invalid_request_error"}})
            except Exception:
                self._json(500, {"error": {"message": "Local model inference failed.", "type": "server_error"}})

    server = ThreadingHTTPServer(("127.0.0.1", int(port)), Handler)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
