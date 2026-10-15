# Facility Expense Dashboard Desktop App

The dashboard is a local pywebview application for macOS and Windows. It reads expense and quarterly facilities-survey Excel workbooks from the local filesystem; it does not use Google Sheets.

## Start the app

### macOS

Double-click `Start Expense Dashboard.command`, or run:

```bash
./Start\ Expense\ Dashboard.command
```

The launcher installs Homebrew's prebuilt `llama.cpp` server when a local AI runtime is not already available, avoiding a source compilation on the normal path. It uses a Python/Metal build only as a fallback. A local-AI installation failure does not prevent the dashboard itself from opening.

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

Settings can use a model managed by the app or a custom OpenAI-compatible endpoint. Managed model weights are not packaged in the executable: the user chooses Fast, Balanced, or Quality, and the app downloads and SHA-256 verifies the corresponding GGUF files. Downloads can be paused and resumed. Models are stored in `%LOCALAPPDATA%\Facility Expense Dashboard\models` on Windows and `~/Library/Application Support/Facility Expense Dashboard/models` on macOS. Windows uses CPU inference by default for broad compatibility; Apple silicon uses Metal. A random token for the private loopback model server is kept in Windows Credential Manager or macOS Keychain.

In custom mode, the endpoint is stored in `settings.json` and defaults to `http://127.0.0.1:12345/v1`. The masked API token is stored separately in the operating-system credential vault; it is never returned to the dashboard interface or written to `settings.json`. **Test endpoint** validates the token, discovers compatible models, and performs a small completion. Ask Dashboard sends only allowlisted aggregate calculations and never raw rows or survey comments. Name, email, ID and other identity columns are not extracted into application records. The Survey Report separately reads only explicitly recognised comment/feedback columns, masks contact details, explicit identifiers and recognisable personal-name patterns locally, and sends those comments to the active AI endpoint only after the user confirms **Summarize**. Collaboration Activity, Timeline, Outcome, source information, audit-report filenames, and individual rows are excluded from AI requests. Survey groups with fewer than five responses are suppressed in Ask Dashboard, and chat history is held only for the current app session.

Ask Dashboard is locked to the active tab. Cross-tab and general external-search requests are rejected locally, and the AI receives no arbitrary web-search tool. The Expense Report has one narrowly allowlisted external-facts path: its forecast tool reads dated India/Karnataka public-holiday facts from the Nager.Date API, derives working days and long weekends locally, and displays the source with the answer. Forecast values are calculated by the application from monthly average attendance, monthly average per-person cost and average fixed cost; the model cannot replace those values. If verified facts are unavailable, no calendar adjustment is made. Analytical responses are accepted only after an allowlisted aggregate tool has been used. Requested ad-hoc charts are rendered locally from a constrained aggregate-only chart specification; no model-generated HTML, JavaScript, or executable chart code is accepted.

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

For a OneDrive-backed base directory, use **Always keep on this device** and wait for the green check mark. Workbook readers retry transient access failures, parse an in-memory byte snapshot, and close every Excel handle. A failed background refresh keeps the last good Expense or Collaboration payload visible and shows an actionable sync/lock message.

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
