#!/bin/zsh
set -e

cd "$(dirname "$0")"

show_error() {
  local exit_code=$?
  echo
  echo "The dashboard could not start."
  echo "Review the error above. If dependency installation failed, check your internet or proxy connection and try again."
  echo
  read -r "?Press Enter to close this window..."
  exit "$exit_code"
}
trap show_error ZERR

if [[ ! -x ".venv/bin/python" ]]; then
  echo "Creating the local Python environment..."
  python3 -m venv --clear .venv
fi

if ! .venv/bin/python -c "import keyring, openai, openpyxl, webview" >/dev/null 2>&1; then
  echo "Installing dashboard dependencies (first launch only)..."
  PIP_DISABLE_PIP_VERSION_CHECK=1 .venv/bin/python -m pip install --prefer-binary -r dashboard/requirements.txt
fi

if ! .venv/bin/python -c "import llama_cpp" >/dev/null 2>&1 && \
  [[ ! -x "/opt/homebrew/bin/llama-server" && ! -x "/usr/local/bin/llama-server" ]]; then
  echo "Preparing the local AI runtime (first launch only)..."
  BREW_BIN="$(command -v brew 2>/dev/null || true)"
  [[ -n "$BREW_BIN" ]] || [[ ! -x "/opt/homebrew/bin/brew" ]] || BREW_BIN="/opt/homebrew/bin/brew"
  [[ -n "$BREW_BIN" ]] || [[ ! -x "/usr/local/bin/brew" ]] || BREW_BIN="/usr/local/bin/brew"
  if [[ -n "$BREW_BIN" ]] && \
    HOMEBREW_NO_AUTO_UPDATE=1 \
    HOMEBREW_NO_ENV_HINTS=1 \
    HOMEBREW_NO_INSTALL_CLEANUP=1 \
    NONINTERACTIVE=1 \
    "$BREW_BIN" install llama.cpp </dev/null; then
    echo "Native local AI runtime installed."
  else
    echo "Homebrew runtime installation was unavailable; trying the Python build fallback..."
    LOCAL_AI_ARCH="$(.venv/bin/python -c 'import platform; print(platform.machine())')"
    if PIP_DISABLE_PIP_VERSION_CHECK=1 .venv/bin/python -m pip install --prefer-binary "cmake>=3.29" "ninja>=1.11" && \
      PATH="$PWD/.venv/bin:$PATH" \
      CMAKE_ARGS="-DGGML_METAL=ON -DGGML_NATIVE=OFF -DCMAKE_OSX_ARCHITECTURES=$LOCAL_AI_ARCH" \
      CMAKE_BUILD_PARALLEL_LEVEL=4 \
      MACOSX_DEPLOYMENT_TARGET=13.0 \
      PIP_DISABLE_PIP_VERSION_CHECK=1 \
      .venv/bin/python -m pip install --prefer-binary -r dashboard/requirements-local-ai.txt; then
      echo "Python local AI runtime installed."
    else
      echo
      echo "Warning: the optional local AI runtime could not be installed."
      echo "The dashboard will still start; custom OpenAI-compatible endpoints remain available."
      echo "To retry manually, run: brew install llama.cpp"
      echo
    fi
  fi
fi

echo "Starting Facility Expense Dashboard..."
.venv/bin/python dashboard/desktop_app.py
