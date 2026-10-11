# Facility Expense Dashboard Desktop App

The dashboard is a local pywebview application for macOS and Windows. It reads expense and quarterly facilities-survey Excel workbooks from the local filesystem; it does not use Google Sheets.

## Start the app

### macOS

Double-click `Start Expense Dashboard.command`, or run:

```bash
./Start\ Expense\ Dashboard.command
```

### Windows

For normal use, download `facilities_dashboard.exe` from the latest GitHub Release and double-click it. It is a portable x64 application that bundles Python, the application dependencies, and the Qt renderer.

For later versions, open **Settings** and click **Check for updates**. A newer stable release is downloaded from `anjukumari991/facilities_dashboard`, checked against `facilities_dashboard.exe.sha256`, installed after the running EXE closes, and reopened automatically. The current version is embedded from the release tag during the Windows build. Always publish upgrades with a new semantic tag such as `v1.1.0`.

To run from source instead, double-click `Start Expense Dashboard.bat`.

The source launcher creates a Python virtual environment when required, installs the dependencies, and opens the dashboard in a native desktop window. Python 3.10 or newer is required only when running from source. The released executable does not require Python or WebView2 to be installed.

## First launch and file layout

On the first launch, choose a base directory. You may also select an existing folder named `expenses`; the app automatically treats its parent as the base directory. The app creates and uses:

```text
<base_dir>/
├── expenses/
│   ├── Expense_Data_Backend_Corrected.xlsx
│   └── FY-2026/
│       └── October.xlsx
├── surveys/
│   ├── 2026-Q1.xlsx
│   └── archive/
│       └── 2025-Q4.xlsm
├── workplace/
│   └── Workplace-Costs.xlsx
├── contracts/
│   └── Workspace-Rental-Contract.pdf
└── audit_reports/
    ├── Sep2026/
    │   └── Facilities-Audit.pdf
    └── Oct2026/
        └── Lunch-Vendor-Audit.xlsx
```

Place `.xlsx` or `.xlsm` workbooks anywhere under `expenses`. Subfolders are scanned recursively and used to organize the workbook selector. Temporary Excel files beginning with `~$`, hidden files, and symbolic links are ignored.

The app remembers both the base directory and the last selected workbook. Settings are stored per user at:

- macOS: `~/Library/Application Support/Facility Expense Dashboard/settings.json`
- Windows: `%APPDATA%\Facility Expense Dashboard\settings.json`

Use **Settings** to change the base location or open `<base_dir>` in Finder or Explorer. **Refresh** remains in the main header for use after adding or saving a workbook and reloads both data folders. Workbook changes are also checked every 60 seconds while the app is visible.

The optional OpenAI-compatible API endpoint in Settings is stored in `settings.json` with the other application preferences and defaults to `http://127.0.0.1:12345/v1`. The masked AI API token is stored separately in Windows Credential Manager on Windows or Keychain on macOS; it is never returned to the dashboard interface or written to `settings.json`. **Test endpoint** validates the saved token, discovers compatible models, and performs a small completion. Ask Dashboard sends only allowlisted aggregate calculations and never raw rows or survey comments. Name, email, ID and other identity columns are not extracted into application records. The Survey Report separately reads only explicitly recognised comment/feedback columns, masks contact details, explicit identifiers and recognisable personal-name patterns locally, and sends those comments to the configured AI endpoint only after the user confirms **Summarize**. Collaboration Activity, Timeline, Outcome, source information, audit-report filenames, and individual rows are excluded from AI requests. Survey groups with fewer than five responses are suppressed in Ask Dashboard, and chat history is held only for the current app session.

## Survey workbooks

Every recognised `.xlsx` or `.xlsm` file under `surveys` is loaded. The survey month is the month of the earliest valid `Start time` in each file. Duplicate responses across copied files are ignored. The Survey Report provides a single Survey Month filter, six summary metrics, a quarterly favorable-percentage trend, a selected-versus-previous touchpoint comparison, 1–5 rating distributions, and a responsive split panel showing masked original comments beside an on-demand AI summary. Reception Area and Meeting Rooms remain distinct touchpoints.

## Required workbook structure

The preferred workbook contains these sheets and headers:

- `Lunch`, with headers on row 4: Expense Month, Vendor, Food Orders, Counts Ordered, Actual Count, Invoice Value INR, Per Person Cost INR
- `Pantry & Misc`, with headers on row 4: Expense Month, Category Name, Vendor, Expense Type, Amount INR
- `Facilities Team Collaboration`, with headers: Month, Department, Activity / Collaboration, Status, Timeline, Outcome

The existing legacy workbook formats supported by `expense_parser.py` continue to work.

Collaboration Plan Years run from 1 July through 30 June: PY26 means 1 July 2026–30 June 2027. Status values are data-driven; Completed, Ongoing, Planned, and future values automatically appear in filters and KPI cards. The team-distribution pie counts selected activities by team and exposes the complete activity list in each team's tooltip. Exact duplicate Month/Department/Activity rows are ignored, while the last row wins when the same collaboration has updated status, timeline, or outcome text.

## Audit reports

The Expense Report uses an 80/20 audit area: expense detail on the left and a scrollable report-file panel on the right. Put reports below a recognised month folder such as `audit_reports/Oct2026/`; subfolders inside that month are supported. Only the Expense **Through month** filter applies. Double-click a file to open it outside the dashboard. Report contents are never parsed, indexed, served to the browser, or sent to Ask Dashboard.

## Workplace workbooks and contracts

Every `.xlsx` or `.xlsm` file under `workplace` is combined. Each recognised sheet must contain `Invoice Number`, `Amount`, `Description`, `Date`, and `Period`. Invoice numbers are deduplicated across copied workbooks, and conflicting duplicates or Date/Period mismatches are surfaced as data-quality warnings.

Workplace financial years run from 1 May through 30 April: FY25 means 1 May 2025–30 April 2026. Missing months are excluded from averages rather than treated as zero. The next-FY forecast annualizes the historical monthly average and applies a 5% contractual increase.

The final Contracts panel lists files under `contracts`. Double-click a file to open it in the operating system's default application. Contract contents are not parsed, indexed, served to the browser, or provided to Ask Dashboard.

## Browser-only development mode

After a base directory has been configured, the local HTTP layer can be run without pywebview for development:

```bash
python dashboard/app.py --base-dir "/path/to/base" --open
```

The server binds to `127.0.0.1` by default. Folder selection, opening the base directory, and credential-vault settings require the pywebview desktop app.
