# Facilities Dashboard

Facilities Dashboard is a local desktop application for reviewing facility expenses from Excel workbooks. It runs with pywebview on macOS and Windows and keeps expense data on the local filesystem.

## Data location

On first launch, select a base directory. Expense workbooks are read from:

```text
<base_dir>/expenses/
```

The application supports `.xlsx` and `.xlsm` workbooks, recursively organizes multiple files in the workbook selector, and remembers the base directory and last selected workbook.

## Start the application

### Windows (recommended)

Download `facilities_dashboard.exe` from the repository's latest GitHub Release and double-click it. The executable bundles Python, the application dependencies, and its Qt renderer; Python and WebView2 do not need to be installed separately.

### macOS

Double-click `Start Expense Dashboard.command`.

### Windows (from source)

Double-click `Start Expense Dashboard.bat`.

The first launch creates a local virtual environment and installs the required dependencies. Python 3.10 or newer is required. See [dashboard/README.md](dashboard/README.md) for workbook structure and detailed usage.

## Privacy

Expense workbooks, generated outputs, presentations, local environments, and the source feedback image are excluded from Git. The application does not read Google Sheets or upload workbook data to a server.
