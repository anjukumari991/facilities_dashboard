@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Creating the local Python environment...
  where py >nul 2>nul
  if errorlevel 1 (
    python -m venv --clear .venv
  ) else (
    py -3 -m venv --clear .venv
  )
)

.venv\Scripts\python.exe -c "import keyring, openai, openpyxl, webview" >nul 2>nul
if errorlevel 1 (
  echo Installing desktop application dependencies ^(first launch only^)...
  set PIP_DISABLE_PIP_VERSION_CHECK=1
  .venv\Scripts\python.exe -m pip install --prefer-binary -r dashboard\requirements.txt
  if errorlevel 1 (
    echo.
    echo The dependencies could not be installed. Check your internet or proxy connection and try again.
    pause
    exit /b 1
  )
)

echo Starting Facility Expense Dashboard...
.venv\Scripts\python.exe dashboard\desktop_app.py
if errorlevel 1 (
  echo.
  echo The dashboard could not start. Review the error above.
  pause
  exit /b 1
)
endlocal
