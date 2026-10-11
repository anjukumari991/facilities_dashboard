from __future__ import annotations

import os
import sys

import keyring
from keyring.errors import KeyringError, PasswordDeleteError


SERVICE_NAME = "Facilities Dashboard"
OPENAI_TOKEN_ACCOUNT = "OpenAI API token"


class SecureCredentialStore:
    """Store application secrets in the current operating system's vault."""

    @property
    def vault_name(self) -> str:
        if os.name == "nt":
            return "Windows Credential Manager"
        if sys.platform == "darwin":
            return "macOS Keychain"
        return "system credential store"

    def get_openai_api_token(self) -> str | None:
        try:
            return keyring.get_password(SERVICE_NAME, OPENAI_TOKEN_ACCOUNT)
        except KeyringError as exc:
            raise RuntimeError(f"Could not access {self.vault_name}.") from exc

    def has_openai_api_token(self) -> bool:
        return bool(self.get_openai_api_token())

    def set_openai_api_token(self, token: str) -> None:
        normalized = token.strip()
        if not normalized:
            raise ValueError("Enter an AI API token before saving.")
        if len(normalized) > 4096:
            raise ValueError("The AI API token is too long.")
        try:
            keyring.set_password(SERVICE_NAME, OPENAI_TOKEN_ACCOUNT, normalized)
            if keyring.get_password(SERVICE_NAME, OPENAI_TOKEN_ACCOUNT) != normalized:
                raise RuntimeError(f"{self.vault_name} did not retain the token.")
        except KeyringError as exc:
            raise RuntimeError(f"Could not save the token in {self.vault_name}.") from exc

    def delete_openai_api_token(self) -> bool:
        if not self.has_openai_api_token():
            return False
        try:
            keyring.delete_password(SERVICE_NAME, OPENAI_TOKEN_ACCOUNT)
            return True
        except (PasswordDeleteError, KeyringError) as exc:
            raise RuntimeError(f"Could not remove the token from {self.vault_name}.") from exc
