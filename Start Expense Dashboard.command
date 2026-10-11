#!/bin/zsh
set -e

cd "$(dirname "$0")"

show_error() {
  local status=$?
  echo
  echo "The dashboard could not start."
  echo "Review the error above. If dependency installation failed, check your internet or proxy connection and try again."
  echo
  read -r "?Press Enter to close this window..."
  exit "$status"
}
trap show_error ZERR

if [[ ! -x ".venv/bin/python" ]]; then
  echo "Creating the local Python environment..."
  python3 -m venv --clear .venv
fi

if ! .venv/bin/python -c "import keyring, openai, openpyxl, webview" >/dev/null 2>&1; then
  echo "Installing desktop application dependencies (first launch only)..."
  PIP_DISABLE_PIP_VERSION_CHECK=1 .venv/bin/python -m pip install --prefer-binary -r dashboard/requirements.txt
fi

echo "Starting Facility Expense Dashboard..."
.venv/bin/python dashboard/desktop_app.py
