from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from _build_version import APP_VERSION
from local_storage import user_settings_directory


GITHUB_REPOSITORY = "anjukumari991/facilities_dashboard"
LATEST_RELEASE_API = f"https://api.github.com/repos/{GITHUB_REPOSITORY}/releases/latest"
RELEASE_DOWNLOAD_PREFIX = f"https://github.com/{GITHUB_REPOSITORY}/releases/download/"
EXECUTABLE_ASSET = "facilities_dashboard.exe"
CHECKSUM_ASSET = f"{EXECUTABLE_ASSET}.sha256"
MAX_RELEASE_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_CHECKSUM_BYTES = 4096
MAX_EXECUTABLE_BYTES = 750 * 1024 * 1024
VERSION_PATTERN = re.compile(
    r"^v?(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)"
    r"(?:-(?P<prerelease>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$"
)


class UpdateError(RuntimeError):
    pass


def _parsed_version(value: str) -> tuple[int, int, int, str | None]:
    match = VERSION_PATTERN.fullmatch(str(value or "").strip())
    if not match:
        raise UpdateError(f"Unsupported application version: {value!r}.")
    return (
        int(match.group("major")),
        int(match.group("minor")),
        int(match.group("patch")),
        match.group("prerelease"),
    )


def is_newer_version(candidate: str, current: str) -> bool:
    candidate_major, candidate_minor, candidate_patch, candidate_pre = _parsed_version(candidate)
    current_major, current_minor, current_patch, current_pre = _parsed_version(current)
    candidate_core = (candidate_major, candidate_minor, candidate_patch)
    current_core = (current_major, current_minor, current_patch)
    if candidate_core != current_core:
        return candidate_core > current_core
    if candidate_pre is None and current_pre is not None:
        return True
    if candidate_pre is not None and current_pre is None:
        return False
    if not candidate_pre or not current_pre:
        return False
    candidate_parts = candidate_pre.split(".")
    current_parts = current_pre.split(".")
    for candidate_part, current_part in zip(candidate_parts, current_parts):
        if candidate_part == current_part:
            continue
        candidate_numeric = candidate_part.isdigit()
        current_numeric = current_part.isdigit()
        if candidate_numeric and current_numeric:
            return int(candidate_part) > int(current_part)
        if candidate_numeric != current_numeric:
            return not candidate_numeric
        return candidate_part > current_part
    return len(candidate_parts) > len(current_parts)


def _safe_version_label(value: str) -> str:
    parsed = _parsed_version(value)
    suffix = f"-{parsed[3]}" if parsed[3] else ""
    return f"{parsed[0]}.{parsed[1]}.{parsed[2]}{suffix}"


def _read_limited(response: Any, limit: int) -> bytes:
    content_length = response.headers.get("Content-Length")
    if content_length:
        try:
            if int(content_length) > limit:
                raise UpdateError("The update server response is larger than expected.")
        except ValueError:
            pass
    body = response.read(limit + 1)
    if len(body) > limit:
        raise UpdateError("The update server response is larger than expected.")
    return body


def _open_url(url: str, *, accept: str = "application/octet-stream") -> Any:
    request = Request(
        url,
        headers={
            "Accept": accept,
            "User-Agent": f"Facilities-Dashboard/{APP_VERSION}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        return urlopen(request, timeout=30)
    except HTTPError as exc:
        if exc.code == 404:
            raise UpdateError("No published GitHub Release is available yet.") from exc
        raise UpdateError(f"GitHub returned HTTP {exc.code} while checking for updates.") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise UpdateError("Could not connect to GitHub. Check your internet connection and try again.") from exc


def _release_asset_url(release: dict[str, Any], name: str) -> str:
    assets = release.get("assets")
    if not isinstance(assets, list):
        raise UpdateError("The GitHub Release does not contain downloadable assets.")
    matches = [asset for asset in assets if isinstance(asset, dict) and asset.get("name") == name]
    if len(matches) != 1:
        raise UpdateError(f"The GitHub Release must contain exactly one {name} asset.")
    url = str(matches[0].get("browser_download_url") or "")
    if not url.startswith(RELEASE_DOWNLOAD_PREFIX):
        raise UpdateError(f"GitHub returned an unexpected download URL for {name}.")
    return url


def _expected_checksum(payload: bytes) -> str:
    try:
        text = payload.decode("ascii")
    except UnicodeDecodeError as exc:
        raise UpdateError("The release checksum file is invalid.") from exc
    pattern = re.compile(rf"(?im)^([0-9a-f]{{64}})\s+\*?{re.escape(EXECUTABLE_ASSET)}\s*$")
    match = pattern.search(text)
    if not match:
        raise UpdateError("The release checksum does not identify facilities_dashboard.exe.")
    return match.group(1).lower()


class GitHubReleaseUpdater:
    def __init__(
        self,
        *,
        current_version: str = APP_VERSION,
        executable_path: Path | None = None,
        staging_root: Path | None = None,
    ):
        self.current_version = current_version
        self.executable_path = Path(executable_path or sys.executable).resolve()
        self.staging_root = staging_root or user_settings_directory() / "updates"

    @property
    def supported(self) -> bool:
        return os.name == "nt" and bool(getattr(sys, "frozen", False)) and self.executable_path.suffix.casefold() == ".exe"

    def local_state(self) -> dict[str, Any]:
        if self.supported:
            message = "Updates are installed from verified GitHub Release files."
        elif os.name != "nt":
            message = "One-click updates are available in the packaged Windows application."
        else:
            message = "One-click updates are unavailable while running from source."
        return {
            "current_version": self.current_version,
            "repository": GITHUB_REPOSITORY,
            "supported": self.supported,
            "message": message,
        }

    def _latest_release(self) -> dict[str, Any]:
        with _open_url(LATEST_RELEASE_API, accept="application/vnd.github+json") as response:
            raw = _read_limited(response, MAX_RELEASE_RESPONSE_BYTES)
        try:
            release = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise UpdateError("GitHub returned an invalid release response.") from exc
        if not isinstance(release, dict) or release.get("draft") or release.get("prerelease"):
            raise UpdateError("GitHub did not return a stable published release.")
        html_url = str(release.get("html_url") or "")
        if not html_url.startswith(f"https://github.com/{GITHUB_REPOSITORY}/releases/"):
            raise UpdateError("GitHub returned an unexpected release location.")
        _parsed_version(str(release.get("tag_name") or ""))
        return release

    def check(self) -> dict[str, Any]:
        state = self.local_state()
        if not self.supported:
            return {"ok": True, "status": "unsupported", **state}
        release = self._latest_release()
        tag = str(release["tag_name"])
        latest_version = _safe_version_label(tag)
        available = is_newer_version(tag, self.current_version)
        result = {
            "ok": True,
            "status": "update_available" if available else "up_to_date",
            **state,
            "latest_version": latest_version,
            "release_name": str(release.get("name") or tag),
            "release_notes": str(release.get("body") or "")[:4000],
            "release_url": str(release.get("html_url") or ""),
        }
        if available:
            _release_asset_url(release, EXECUTABLE_ASSET)
            _release_asset_url(release, CHECKSUM_ASSET)
        return result

    def _download_executable(self, release: dict[str, Any], destination: Path) -> str:
        checksum_url = _release_asset_url(release, CHECKSUM_ASSET)
        with _open_url(checksum_url) as response:
            expected = _expected_checksum(_read_limited(response, MAX_CHECKSUM_BYTES))

        executable_url = _release_asset_url(release, EXECUTABLE_ASSET)
        partial = destination.with_suffix(destination.suffix + ".part")
        digest = hashlib.sha256()
        downloaded = 0
        try:
            with _open_url(executable_url) as response, partial.open("wb") as output:
                content_length = response.headers.get("Content-Length")
                if content_length:
                    try:
                        if int(content_length) > MAX_EXECUTABLE_BYTES:
                            raise UpdateError("The release executable is larger than expected.")
                    except ValueError:
                        pass
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    downloaded += len(chunk)
                    if downloaded > MAX_EXECUTABLE_BYTES:
                        raise UpdateError("The release executable is larger than expected.")
                    output.write(chunk)
                    digest.update(chunk)
            if downloaded == 0:
                raise UpdateError("The downloaded release executable is empty.")
            actual = digest.hexdigest()
            if actual != expected:
                raise UpdateError("The downloaded executable failed SHA-256 verification and was not installed.")
            os.replace(partial, destination)
            return actual
        finally:
            partial.unlink(missing_ok=True)

    def install_latest(self) -> dict[str, Any]:
        if not self.supported:
            raise UpdateError(self.local_state()["message"])
        release = self._latest_release()
        tag = str(release["tag_name"])
        if not is_newer_version(tag, self.current_version):
            return {"ok": True, "status": "up_to_date", "current_version": self.current_version}

        version = _safe_version_label(tag)
        staging_directory = self.staging_root / version
        staging_directory.mkdir(parents=True, exist_ok=True)
        downloaded_executable = staging_directory / EXECUTABLE_ASSET
        checksum = self._download_executable(release, downloaded_executable)
        script_path = staging_directory / "apply-update.ps1"
        log_path = self.staging_root / "last-update.log"
        script_path.write_text(_POWERSHELL_UPDATE_SCRIPT, encoding="utf-8")

        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.Popen(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script_path),
                "-TargetPid",
                str(os.getpid()),
                "-CurrentExe",
                str(self.executable_path),
                "-DownloadedExe",
                str(downloaded_executable),
                "-LogPath",
                str(log_path),
            ],
            close_fds=True,
            creationflags=creation_flags,
        )
        return {
            "ok": True,
            "status": "restarting",
            "current_version": self.current_version,
            "latest_version": version,
            "sha256": checksum,
        }


_POWERSHELL_UPDATE_SCRIPT = r'''param(
    [Parameter(Mandatory=$true)][int]$TargetPid,
    [Parameter(Mandatory=$true)][string]$CurrentExe,
    [Parameter(Mandatory=$true)][string]$DownloadedExe,
    [Parameter(Mandatory=$true)][string]$LogPath
)

$ErrorActionPreference = "Stop"
$candidate = "$CurrentExe.update"
$backup = "$CurrentExe.previous"

try {
    Wait-Process -Id $TargetPid -Timeout 120 -ErrorAction SilentlyContinue
    $installed = $false
    for ($attempt = 1; $attempt -le 40; $attempt++) {
        try {
            Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue
            [System.IO.File]::Copy($DownloadedExe, $candidate, $true)
            Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
            [System.IO.File]::Replace($candidate, $CurrentExe, $backup, $true)
            $installed = $true
            break
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $installed) {
        throw "The application executable remained locked or could not be replaced."
    }
    Start-Process -FilePath $CurrentExe
    Start-Sleep -Seconds 2
    Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $DownloadedExe -Force -ErrorAction SilentlyContinue
    "Update installed successfully at $(Get-Date -Format o)." | Out-File -LiteralPath $LogPath -Encoding utf8
} catch {
    "Update failed at $(Get-Date -Format o): $($_.Exception.Message)" | Out-File -LiteralPath $LogPath -Encoding utf8
    Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $CurrentExe) {
        Start-Process -FilePath $CurrentExe
    }
    exit 1
}
'''


def schedule_window_close(window: Any, delay_seconds: float = 1.0) -> None:
    def close() -> None:
        try:
            window.destroy()
        except Exception:
            pass

    timer = threading.Timer(delay_seconds, close)
    timer.daemon = True
    timer.start()
