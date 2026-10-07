# Facility Expense Dashboard Desktop App

The dashboard is a local pywebview application for macOS and Windows. It reads Excel workbooks from the local filesystem; it does not use Google Sheets or upload expense data to a server.

## Start the app

### macOS

Double-click `Start Expense Dashboard.command`, or run:

```bash
./Start\ Expense\ Dashboard.command
```

### Windows

For normal use, download `facilities_dashboard.exe` from the latest GitHub Release and double-click it. It is a portable x64 application that bundles Python, the application dependencies, and the Qt renderer.

To run from source instead, double-click `Start Expense Dashboard.bat`.

The source launcher creates a Python virtual environment when required, installs the dependencies, and opens the dashboard in a native desktop window. Python 3.10 or newer is required only when running from source. The released executable does not require Python or WebView2 to be installed.

## First launch and file layout

On the first launch, choose a base directory. You may also select an existing folder named `expenses`; the app automatically treats its parent as the base directory. The app creates and uses:

```text
<base_dir>/
└── expenses/
    ├── Expense_Data_Backend_Corrected.xlsx
    ├── FY-2026/
    │   └── October.xlsx
    └── another-team/
        └── Facility_Expenses.xlsm
```

Place `.xlsx` or `.xlsm` workbooks anywhere under `expenses`. Subfolders are scanned recursively and used to organize the workbook selector. Temporary Excel files beginning with `~$`, hidden files, and symbolic links are ignored.

The app remembers both the base directory and the last selected workbook. Settings are stored per user at:

- macOS: `~/Library/Application Support/Facility Expense Dashboard/settings.json`
- Windows: `%APPDATA%\Facility Expense Dashboard\settings.json`

Use **Change base location** to select another base directory, **Open Base Folder** to open `<base_dir>` in Finder or Explorer, and **Refresh** after adding or saving a workbook. Workbook changes are also checked every 60 seconds while the app is visible.

## Required workbook structure

The preferred workbook contains these sheets and headers:

- `Lunch`, with headers on row 4: Expense Month, Vendor, Food Orders, Counts Ordered, Actual Count, Invoice Value INR, Per Person Cost INR
- `Pantry & Misc`, with headers on row 4: Expense Month, Report Category, Vendor, Expense Type, Amount INR

The existing legacy workbook formats supported by `expense_parser.py` continue to work.

## Browser-only development mode

After a base directory has been configured, the local HTTP layer can be run without pywebview for development:

```bash
python dashboard/app.py --base-dir "/path/to/base" --open
```

The server binds to `127.0.0.1` by default. Folder selection and opening the expenses directory require the pywebview desktop app.
