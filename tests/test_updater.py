from __future__ import annotations

from pathlib import Path
import sys
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "dashboard"))

from updater import (  # noqa: E402
    EXECUTABLE_ASSET,
    GitHubReleaseUpdater,
    UpdateError,
    _expected_checksum,
    _release_asset_url,
    is_newer_version,
)


class VersionComparisonTests(unittest.TestCase):
    def test_newer_patch_minor_and_major_versions(self) -> None:
        self.assertTrue(is_newer_version("v1.0.1", "1.0.0"))
        self.assertTrue(is_newer_version("v1.2.0", "1.1.9"))
        self.assertTrue(is_newer_version("v2.0.0", "1.99.99"))

    def test_equal_and_older_versions_are_not_updates(self) -> None:
        self.assertFalse(is_newer_version("v1.2.3", "1.2.3"))
        self.assertFalse(is_newer_version("v1.2.2", "1.2.3"))

    def test_stable_release_replaces_prerelease(self) -> None:
        self.assertTrue(is_newer_version("v1.2.3", "1.2.3-beta.2"))
        self.assertTrue(is_newer_version("v1.2.3-beta.10", "1.2.3-beta.2"))
        self.assertFalse(is_newer_version("v1.2.3-beta.2", "1.2.3"))


class ReleaseValidationTests(unittest.TestCase):
    def test_checksum_must_name_the_expected_executable(self) -> None:
        digest = "a" * 64
        self.assertEqual(_expected_checksum(f"{digest}  {EXECUTABLE_ASSET}\n".encode("ascii")), digest)
        with self.assertRaises(UpdateError):
            _expected_checksum(f"{digest}  other.exe\n".encode("ascii"))

    def test_asset_url_is_restricted_to_the_configured_repository(self) -> None:
        release = {
            "assets": [
                {
                    "name": EXECUTABLE_ASSET,
                    "browser_download_url": (
                        "https://github.com/anjukumari991/facilities_dashboard/"
                        "releases/download/v1.0.0/facilities_dashboard.exe"
                    ),
                }
            ]
        }
        self.assertIn("v1.0.0", _release_asset_url(release, EXECUTABLE_ASSET))
        release["assets"][0]["browser_download_url"] = "https://example.com/facilities_dashboard.exe"
        with self.assertRaises(UpdateError):
            _release_asset_url(release, EXECUTABLE_ASSET)

    def test_source_launch_reports_local_state_without_network(self) -> None:
        state = GitHubReleaseUpdater(executable_path=Path("dashboard.py")).local_state()
        self.assertIn("current_version", state)
        self.assertFalse(state["supported"])


if __name__ == "__main__":
    unittest.main()
