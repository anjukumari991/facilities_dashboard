from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from local_storage import SettingsStore, user_data_directory
from secure_storage import SecureCredentialStore


MANAGED_AI_HOST = "127.0.0.1"


@dataclass(frozen=True)
class ModelFile:
    filename: str
    url: str
    sha256: str
    size: int


@dataclass(frozen=True)
class LocalModel:
    identifier: str
    name: str
    description: str
    size_label: str
    memory_label: str
    files: tuple[ModelFile, ...]

    @property
    def total_size(self) -> int:
        return sum(item.size for item in self.files)


MODEL_CATALOG: tuple[LocalModel, ...] = (
    LocalModel(
        identifier="qwen2.5-3b-q4",
        name="Qwen 2.5 3B — Fast",
        description="Best responsiveness on the target 16 GB Windows computer; suitable for routine dashboard questions.",
        size_label="2.1 GB download",
        memory_label="About 3–4 GB RAM",
        files=(
            ModelFile(
                filename="qwen2.5-3b-instruct-q4_k_m.gguf",
                url="https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/cc1e68eea5f05f88f41a6de1fc73110178f23715/qwen2.5-3b-instruct-q4_k_m.gguf?download=true",
                sha256="626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d",
                size=2_104_932_768,
            ),
        ),
    ),
    LocalModel(
        identifier="qwen2.5-7b-q4",
        name="Qwen 2.5 7B — Balanced",
        description="Better summaries and tool selection, with slower CPU responses. Recommended when quality matters most.",
        size_label="4.7 GB download",
        memory_label="About 6–8 GB RAM",
        files=(
            ModelFile(
                filename="qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf",
                url="https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/293ca9a10157b0e5fc5cb32af8b636a88bede891/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf?download=true",
                sha256="dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db",
                size=3_993_201_344,
            ),
            ModelFile(
                filename="qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf",
                url="https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/293ca9a10157b0e5fc5cb32af8b636a88bede891/qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf?download=true",
                sha256="539cf93f78e887edea1c04e2d7d8cdaca9d01dae9c9025bcb8accbe29df3d72a",
                size=689_872_288,
            ),
        ),
    ),
    LocalModel(
        identifier="qwen3-8b-q4",
        name="Qwen 3 8B — Quality",
        description="Highest-quality option in this catalog. Expect longer responses and heavier memory use on CPU-only Windows systems.",
        size_label="5.0 GB download",
        memory_label="About 7–10 GB RAM",
        files=(
            ModelFile(
                filename="Qwen3-8B-Q4_K_M.gguf",
                url="https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/6a569868d07d3bd59e8b97fb001bf8c0b254bb20/Qwen3-8B-Q4_K_M.gguf?download=true",
                sha256="d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785",
                size=5_027_783_488,
            ),
        ),
    ),
)
MODELS_BY_ID = {model.identifier: model for model in MODEL_CATALOG}


class DownloadCancelled(Exception):
    pass


def _free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((MANAGED_AI_HOST, 0))
        return int(probe.getsockname()[1])


class LocalAIManager:
    """Download, verify, start, and stop the app's optional local model server."""

    def __init__(
        self,
        settings: SettingsStore,
        credential_store: SecureCredentialStore,
        models_dir: Path | None = None,
        port: int | None = None,
    ):
        self.settings = settings
        self.credential_store = credential_store
        self.models_dir = models_dir or user_data_directory() / "models"
        saved = settings.load()
        candidate = str(saved.get("local_ai_model") or MODEL_CATALOG[0].identifier)
        self.selected_id = candidate if candidate in MODELS_BY_ID else MODEL_CATALOG[0].identifier
        self.port = int(port) if port else _free_loopback_port()
        self.process: subprocess.Popen[bytes] | None = None
        self.lock = threading.RLock()
        self.cancel_event = threading.Event()
        self.download_thread: threading.Thread | None = None
        self.download_model_id: str | None = None
        self.runtime_install_thread: threading.Thread | None = None
        self.runtime_installing = False
        self.starting = False
        self.downloaded_bytes = 0
        self.download_total = 0
        self.status_message = "Local AI is not running."
        self.error = ""
        if self.provider() == "managed" and not self.runtime_available():
            self.ensure_runtime_async()

    @property
    def endpoint(self) -> str:
        return f"http://{MANAGED_AI_HOST}:{self.port}/v1"

    def _model_dir(self, model: LocalModel) -> Path:
        return self.models_dir / model.identifier

    def _model_path(self, model: LocalModel) -> Path:
        return self._model_dir(model) / model.files[0].filename

    def _server_log_path(self) -> Path:
        return self.models_dir.parent / "logs" / "local-ai.log"

    def _installed(self, model: LocalModel) -> bool:
        directory = self._model_dir(model)
        return all((directory / item.filename).is_file() and (directory / item.filename).stat().st_size == item.size for item in model.files)

    def _verify_model(self, model: LocalModel) -> None:
        for item in model.files:
            path = self._model_dir(model) / item.filename
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
                    digest.update(chunk)
            if digest.hexdigest().casefold() != item.sha256.casefold():
                raise RuntimeError("The selected model failed its security check. Remove it and download it again.")

    @staticmethod
    def _llama_server_path() -> str | None:
        discovered = shutil.which("llama-server")
        if discovered:
            return discovered
        candidates = [
            Path("/opt/homebrew/bin/llama-server"),
            Path("/usr/local/bin/llama-server"),
        ]
        # A future standalone macOS package can place the native runtime beside
        # the app resources without changing the dashboard code.
        if getattr(sys, "frozen", False):
            candidates.insert(0, Path(__file__).resolve().parents[2] / "bin" / "llama-server")
        for candidate in candidates:
            if Path(candidate).is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
        return None

    @staticmethod
    def _homebrew_path() -> str | None:
        discovered = shutil.which("brew")
        if discovered:
            return discovered
        for candidate in ("/opt/homebrew/bin/brew", "/usr/local/bin/brew"):
            if Path(candidate).is_file() and os.access(candidate, os.X_OK):
                return candidate
        return None

    @classmethod
    def python_runtime_available(cls) -> bool:
        try:
            import llama_cpp  # noqa: F401
        except (ImportError, OSError):
            return False
        return True

    @classmethod
    def runtime_available(cls) -> bool:
        return cls.python_runtime_available() or cls._llama_server_path() is not None

    @classmethod
    def runtime_name(cls) -> str:
        if cls.python_runtime_available():
            return "Bundled Python runtime"
        if cls._llama_server_path():
            return "Native llama.cpp server"
        return "Unavailable"

    def provider(self) -> str:
        return "managed" if self.settings.load().get("ai_provider") == "managed" else "custom"

    def set_provider(self, provider: str) -> dict[str, Any]:
        if provider not in {"managed", "custom"}:
            raise ValueError("AI provider must be managed or custom.")
        self.settings.update(ai_provider=provider)
        if provider == "custom":
            self.stop()
        else:
            self.ensure_runtime_async()
        return self.state()

    def ensure_runtime_async(self) -> dict[str, Any]:
        """Provision the native macOS runtime without blocking or prompting."""
        with self.lock:
            if self.runtime_available():
                self.runtime_installing = False
                return self.state()
            if self.runtime_install_thread and self.runtime_install_thread.is_alive():
                return self.state()
            brew = self._homebrew_path() if sys.platform == "darwin" else None
            if not brew:
                self.error = "This installation does not contain a local AI runtime."
                self.status_message = "Local AI runtime is unavailable."
                return self.state()
            self.runtime_installing = True
            self.error = ""
            self.status_message = "Installing the local AI runtime automatically…"
            self.runtime_install_thread = threading.Thread(
                target=self._install_runtime_worker,
                args=(brew,),
                name="local-ai-runtime-install",
                daemon=True,
            )
            self.runtime_install_thread.start()
            return self.state()

    def _install_runtime_worker(self, brew: str) -> None:
        log_path = self._server_log_path()
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            environment = os.environ.copy()
            environment.update(
                {
                    "HOMEBREW_NO_AUTO_UPDATE": "1",
                    "HOMEBREW_NO_ENV_HINTS": "1",
                    "HOMEBREW_NO_INSTALL_CLEANUP": "1",
                    "NONINTERACTIVE": "1",
                }
            )
            with log_path.open("ab") as log_handle:
                result = subprocess.run(
                    [brew, "install", "llama.cpp"],
                    stdin=subprocess.DEVNULL,
                    stdout=log_handle,
                    stderr=subprocess.STDOUT,
                    env=environment,
                    check=False,
                )
            with self.lock:
                if result.returncode == 0 and self.runtime_available():
                    self.status_message = "Local AI runtime installed. Choose a model to download."
                    self.error = ""
                else:
                    self.status_message = "The local AI runtime could not be installed."
                    self.error = f"Automatic runtime installation failed. Diagnostic log: {log_path}"
        except Exception as exc:
            with self.lock:
                self.status_message = "The local AI runtime could not be installed."
                self.error = f"Automatic runtime installation failed: {exc}"
        finally:
            with self.lock:
                self.runtime_installing = False

    def select(self, model_id: str) -> dict[str, Any]:
        if model_id not in MODELS_BY_ID:
            raise ValueError("Select a supported local AI model.")
        with self.lock:
            if self.download_thread and self.download_thread.is_alive():
                raise RuntimeError("Wait for the current model download to finish or cancel it first.")
            if self.process and self.process.poll() is None and model_id != self.selected_id:
                self.stop()
            self.selected_id = model_id
            self.settings.update(local_ai_model=model_id)
            self.error = ""
            self.status_message = "Model selected."
        return self.state()

    def _catalog_state(self) -> list[dict[str, Any]]:
        return [
            {
                "id": model.identifier,
                "name": model.name,
                "description": model.description,
                "size": model.size_label,
                "memory": model.memory_label,
                "installed": self._installed(model),
                "selected": model.identifier == self.selected_id,
            }
            for model in MODEL_CATALOG
        ]

    def state(self) -> dict[str, Any]:
        with self.lock:
            running = bool(self.process and self.process.poll() is None)
            downloading = bool(self.download_model_id and self.download_thread and self.download_thread.is_alive())
            selected = MODELS_BY_ID[self.selected_id]
            percentage = 0
            if self.download_total:
                percentage = max(0, min(100, round(self.downloaded_bytes * 100 / self.download_total)))
            return {
                "provider": self.provider(),
                "endpoint": self.endpoint,
                "models_directory": str(self.models_dir),
                "log_path": str(self._server_log_path()),
                "runtime_available": self.runtime_available(),
                "runtime_name": self.runtime_name(),
                "runtime_installing": self.runtime_installing,
                "selected_model": self.selected_id,
                "selected_installed": self._installed(selected),
                "running": running,
                "starting": self.starting,
                "downloading": downloading,
                "download_model": self.download_model_id,
                "downloaded_bytes": self.downloaded_bytes,
                "download_total": self.download_total,
                "download_percent": percentage,
                "message": self.status_message,
                "error": self.error,
                "models": self._catalog_state(),
            }

    def download_selected(self) -> dict[str, Any]:
        with self.lock:
            model = MODELS_BY_ID[self.selected_id]
            if self._installed(model):
                self.status_message = "The selected model is already downloaded."
                return self.state()
            if self.download_thread and self.download_thread.is_alive():
                return self.state()
            free_bytes = shutil.disk_usage(self.models_dir.parent if self.models_dir.parent.exists() else user_data_directory()).free
            present_bytes = []
            for item in model.files:
                target = self._model_dir(model) / item.filename
                part = self._model_dir(model) / f"{item.filename}.part"
                if target.is_file() and target.stat().st_size == item.size:
                    present_bytes.append(item.size)
                elif part.is_file():
                    present_bytes.append(min(item.size, part.stat().st_size))
                else:
                    present_bytes.append(0)
            missing_bytes = model.total_size - sum(present_bytes)
            if free_bytes < missing_bytes + 2_000_000_000:
                raise RuntimeError("There is not enough free disk space for this model and its working files.")
            self.cancel_event.clear()
            self.download_model_id = model.identifier
            self.download_total = model.total_size
            self.downloaded_bytes = sum(present_bytes)
            self.error = ""
            self.status_message = f"Downloading {model.name}…"
            self.download_thread = threading.Thread(target=self._download_worker, args=(model,), name="local-ai-download", daemon=True)
            self.download_thread.start()
            return self.state()

    def cancel_download(self) -> dict[str, Any]:
        self.cancel_event.set()
        with self.lock:
            self.status_message = "Cancelling download…"
        return self.state()

    def _download_worker(self, model: LocalModel) -> None:
        download_complete = False
        try:
            directory = self._model_dir(model)
            directory.mkdir(parents=True, exist_ok=True)
            completed = 0
            for item in model.files:
                target = directory / item.filename
                if target.is_file() and target.stat().st_size == item.size:
                    completed += item.size
                    continue
                part = directory / f"{item.filename}.part"
                self._download_file(item, part, completed)
                if self.cancel_event.is_set():
                    raise DownloadCancelled()
                digest = hashlib.sha256()
                with part.open("rb") as handle:
                    for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
                        digest.update(chunk)
                if part.stat().st_size != item.size or digest.hexdigest().casefold() != item.sha256.casefold():
                    part.unlink(missing_ok=True)
                    raise RuntimeError(f"Security check failed for {item.filename}; the incomplete file was removed.")
                os.replace(part, target)
                completed += item.size
            with self.lock:
                self.downloaded_bytes = model.total_size
                self.status_message = f"{model.name} is downloaded and verified."
                self.error = ""
                self.download_model_id = None
                download_complete = True
            self.start(already_verified=True)
        except DownloadCancelled:
            with self.lock:
                self.status_message = "Download paused. Choose Download & use to resume it."
                self.error = ""
        except Exception as exc:
            with self.lock:
                self.status_message = "The model was downloaded, but local AI could not start." if download_complete else "The model could not be downloaded."
                self.error = str(exc)
        finally:
            with self.lock:
                self.download_model_id = None

    def _download_file(self, item: ModelFile, part: Path, completed: int) -> None:
        offset = part.stat().st_size if part.exists() else 0
        if offset > item.size:
            part.unlink()
            offset = 0
        if offset == item.size:
            with self.lock:
                self.downloaded_bytes = completed + offset
            return
        curl = shutil.which("curl")
        if curl:
            self._download_file_with_curl(curl, item, part, completed, offset)
            return
        headers = {"User-Agent": "Facilities-Dashboard/1.0"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        request = Request(item.url, headers=headers)
        try:
            response = urlopen(request, timeout=60)
        except HTTPError as exc:
            raise RuntimeError(f"Could not download {item.filename}: the download service returned HTTP {exc.code}.") from exc
        except URLError as exc:
            reason = str(exc.reason) if exc.reason else "network connection failed"
            raise RuntimeError(f"Could not download {item.filename}: {reason}.") from exc
        except TimeoutError as exc:
            raise RuntimeError(f"Could not download {item.filename}: the connection timed out.") from exc
        with response:
            if offset and getattr(response, "status", 200) != 206:
                offset = 0
                part.unlink(missing_ok=True)
            mode = "ab" if offset else "wb"
            with part.open(mode) as handle:
                while True:
                    if self.cancel_event.is_set():
                        raise DownloadCancelled()
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
                    offset += len(chunk)
                    with self.lock:
                        self.downloaded_bytes = completed + offset

    def _download_file_with_curl(
        self,
        curl: str,
        item: ModelFile,
        part: Path,
        completed: int,
        offset: int,
    ) -> None:
        def attempt(resume: bool) -> tuple[int, str]:
            command = [
                curl,
                "--location",
                "--fail",
                "--silent",
                "--show-error",
                "--retry",
                "5",
                "--retry-delay",
                "2",
                "--retry-all-errors",
                "--connect-timeout",
                "30",
                "--output",
                str(part),
            ]
            if resume:
                command.extend(["--continue-at", "-"])
            command.append(item.url)
            process = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
            while process.poll() is None:
                if self.cancel_event.is_set():
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                    raise DownloadCancelled()
                current = part.stat().st_size if part.exists() else 0
                with self.lock:
                    self.downloaded_bytes = completed + min(current, item.size)
                time.sleep(0.25)
            _, error_text = process.communicate()
            return process.returncode, (error_text or "").strip()

        return_code, error_text = attempt(offset > 0)
        # Exit 33 means the server could not resume this partial transfer.
        # Restarting the one file is safe because the final SHA-256 is pinned.
        if return_code == 33 and offset:
            part.unlink(missing_ok=True)
            return_code, error_text = attempt(False)
        if return_code:
            concise = error_text.splitlines()[-1][:300] if error_text else f"curl exited with code {return_code}"
            raise RuntimeError(f"Could not download {item.filename}: {concise}")
        with self.lock:
            self.downloaded_bytes = completed + (part.stat().st_size if part.exists() else 0)

    def _token(self) -> str:
        token = self.credential_store.get_local_ai_token()
        if token:
            return token
        token = secrets.token_urlsafe(32)
        self.credential_store.set_local_ai_token(token)
        return token

    def start(self, *, already_verified: bool = False) -> dict[str, Any]:
        with self.lock:
            if self.process and self.process.poll() is None:
                return self.state()
            if self.starting:
                raise RuntimeError("Local AI is already starting. Please wait.")
            model = MODELS_BY_ID[self.selected_id]
            if not self._installed(model):
                raise RuntimeError("Download the selected model before starting local AI.")
            if not self.runtime_available():
                raise RuntimeError(
                    "No local AI runtime is available. Close the app and relaunch it with the platform launcher."
                )
            self.status_message = f"Verifying {model.name}…"
            self.error = ""
            self.starting = True
        try:
            if not already_verified:
                self._verify_model(model)
            token = self._token()
            llama_server = None if self.python_runtime_available() else self._llama_server_path()
            if llama_server:
                threads = max(2, min(12, (os.cpu_count() or 4) - 1))
                command = [
                    llama_server,
                    "--model",
                    str(self._model_path(model)),
                    "--alias",
                    model.identifier,
                    "--host",
                    MANAGED_AI_HOST,
                    "--port",
                    str(self.port),
                    "--ctx-size",
                    "16384",
                    "--threads",
                    str(threads),
                    "--n-gpu-layers",
                    "99" if sys.platform == "darwin" else "0",
                    "--jinja",
                ]
            else:
                command = [
                    sys.executable,
                    "--managed-ai-server",
                    "--model-path",
                    str(self._model_path(model)),
                    "--model-id",
                    model.identifier,
                    "--port",
                    str(self.port),
                ]
                if not getattr(sys, "frozen", False):
                    command.insert(1, str(Path(__file__).with_name("desktop_app.py")))
            child_environment = os.environ.copy()
            child_environment["FACILITIES_LOCAL_AI_TOKEN"] = token
            child_environment["LLAMA_API_KEY"] = token
            log_path = self._server_log_path()
            log_path.parent.mkdir(parents=True, exist_ok=True)
            if log_path.is_file() and log_path.stat().st_size > 2_000_000:
                log_path.replace(log_path.with_suffix(".previous.log"))
            log_handle = log_path.open("ab")
            kwargs: dict[str, Any] = {
                "stdin": subprocess.DEVNULL,
                "stdout": log_handle,
                "stderr": log_handle,
                "env": child_environment,
            }
            if os.name == "nt":
                kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            with self.lock:
                try:
                    self.process = subprocess.Popen(command, **kwargs)
                finally:
                    log_handle.close()
                self.status_message = f"Starting {model.name}…"
                self.error = ""
        except Exception as exc:
            with self.lock:
                self.starting = False
                self.error = str(exc)
                self.status_message = "Local AI did not start."
            raise
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            with self.lock:
                if self.process and self.process.poll() is not None:
                    self.starting = False
                    self.error = f"The local AI process stopped while loading the model. Diagnostic log: {self._server_log_path()}"
                    self.status_message = "Local AI did not start."
                    raise RuntimeError(self.error)
            try:
                request = Request(f"http://{MANAGED_AI_HOST}:{self.port}/health", headers={"Authorization": f"Bearer {token}"})
                with urlopen(request, timeout=2) as response:
                    if response.status == 200:
                        with self.lock:
                            self.status_message = f"{model.name} is ready."
                            self.starting = False
                        self.settings.update(ai_provider="managed")
                        return self.state()
            except (HTTPError, URLError, TimeoutError):
                time.sleep(0.5)
        self.stop()
        message = "The local model took too long to load. Try the Fast model or close other applications."
        with self.lock:
            self.error = message
            self.status_message = "Local AI did not start."
        raise RuntimeError(message)

    def ensure_running(self) -> None:
        if self.provider() != "managed":
            return
        with self.lock:
            if self.process and self.process.poll() is None:
                return
        self.start()

    def stop(self) -> dict[str, Any]:
        with self.lock:
            process = self.process
            self.process = None
            self.starting = False
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        with self.lock:
            self.status_message = "Local AI is stopped."
        return self.state()

    def remove(self, model_id: str) -> dict[str, Any]:
        if model_id not in MODELS_BY_ID:
            raise ValueError("Select a supported local AI model.")
        with self.lock:
            if self.download_thread and self.download_thread.is_alive() and self.download_model_id == model_id:
                raise RuntimeError("Cancel the model download before removing it.")
            if self.process and self.process.poll() is None and model_id == self.selected_id:
                raise RuntimeError("Stop local AI before removing the active model.")
        directory = self._model_dir(MODELS_BY_ID[model_id])
        if directory.is_dir():
            shutil.rmtree(directory)
        with self.lock:
            self.status_message = "Downloaded model files were removed."
        return self.state()

    def shutdown(self) -> None:
        self.cancel_event.set()
        self.stop()
