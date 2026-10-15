# Facilities Dashboard

Facilities Dashboard is a local desktop application for reviewing facility expenses and quarterly facilities surveys from Excel workbooks. It runs with pywebview on macOS and Windows and keeps source data on the local filesystem.

## Data location

On first launch, select a base directory. The application automatically creates the required `expenses`, `surveys`, `workplace`, `contracts`, and `audit_reports` subfolders so their names and locations are consistent. Expense workbooks are read from:

```text
<base_dir>/expenses/
```

Quarterly survey workbooks are read from every `.xlsx` or `.xlsm` file under:

```text
<base_dir>/surveys/
```

Workplace invoices and locally opened contract references use:

```text
<base_dir>/workplace/
<base_dir>/contracts/
```

Workplace workbooks require `Invoice Number`, `Amount`, `Description`, `Date`, and `Period`. The Workplace report combines every recognised workbook, deduplicates invoice numbers, uses May–April financial years, and calculates its next-FY outlook with the configured 5% contractual increase. Contract files are only listed and opened with the operating system; their contents are never parsed or sent to AI.

Monthly audit reports are listed from folders such as `<base_dir>/audit_reports/Oct2026/`. Only the Expense Report's selected month applies to this panel; report category and period filters do not affect it. Files open in their operating-system application on double-click and are never parsed.

The application supports `.xlsx` and `.xlsm` workbooks, recursively organizes multiple files in the workbook selector, and remembers the base directory and last selected workbook.

Use **Settings** to change or open the base location. Refresh reloads expenses, surveys, workplace invoices, and contract filenames. **Survey Report** combines all recognised survey files, identifies the survey month from each file's earliest Start time, and compares quarterly satisfaction trends. Reception Area and Meeting Rooms are reported separately.

The **Collaborations** tab reads the `Facilities Team Collaboration` sheet from the active expense workbook. Required columns are `Month`, `Department`, `Activity / Collaboration`, `Status`, `Timeline`, and `Outcome`. It uses July–June Plan Years and derives departments and statuses from the data, so newly added status values appear automatically. Its team-distribution pie shows activity counts and lists each team's selected activities on hover or keyboard focus.

## AI assistant

**Settings → AI assistant** can use either a model managed by this app or a custom OpenAI-compatible endpoint.

- In managed mode, choose Fast (Qwen 2.5 3B), Balanced (Qwen 2.5 7B), or Quality (Qwen 3 8B). The selected GGUF model is downloaded only when requested, resumes after interruption, and must pass its pinned SHA-256 check before use. Model files live outside the application under `%LOCALAPPDATA%\Facility Expense Dashboard\models` on Windows or `~/Library/Application Support/Facility Expense Dashboard/models` on macOS. Windows runs CPU-first for the target 16 GB integrated-graphics computer; Apple silicon uses Metal acceleration.
- In custom mode, the editable endpoint is stored in ordinary per-user settings and defaults to `http://127.0.0.1:12345/v1`. The masked token is stored only in Windows Credential Manager or macOS Keychain. It is never written to the settings file, returned to the browser interface, or committed.

The local inference runtime is bundled in packaged applications, but the multi-gigabyte model weights are not. The app starts and stops a private loopback OpenAI-compatible server automatically, so the existing client and privacy guardrails are shared by both modes.

Ask Dashboard uses tab-specific context and read-only aggregate tools. Survey names, email addresses, IDs and other identity columns are excluded at the parser boundary. The Survey Report reads only explicitly recognised comment/feedback columns and masks contact details, explicit identifiers and recognisable personal-name patterns locally. Those masked comments are sent to the active AI endpoint only after the user confirms **Summarize**; ordinary Ask Dashboard chat never receives them. Raw expense rows and filenames are also never provided to the AI service. Collaboration chat receives only aggregate counts and rates; Activity, Timeline, Outcome, workbook information, audit-report filenames, and individual rows remain local. Survey aggregates with fewer than five responses are suppressed in chat. Conversation history stays in the current app session. Without a downloaded local model or saved custom token, AI features report that support is unavailable and make no request.

Chat scope is enforced by the application, not only by model instructions. Each conversation is locked to its active tab and receives only that tab's allowlisted aggregate tools. Explicit cross-tab, general web/news/weather, prompt-bypass, and raw-record requests are rejected locally. Expense forecasts may use the app's fixed public-holiday calendar source; the model cannot choose a URL or browse arbitrary sites. The forecast uses workbook-derived monthly average attendance, monthly average per-person cost and average fixed cost. Holiday and working-day adjustments are applied only from dated sourced facts, while a long-weekend attendance factor is applied only when enough comparable workbook history exists. If the source is unavailable, the forecast explicitly omits the adjustment instead of guessing. A normal analytical answer is shown only after at least one aggregate calculation. When a user requests a chart or graph, the application creates a constrained line, bar, or pie specification from returned aggregate rows and renders it locally; the model cannot provide executable chart code or raw data.

## Start the application

### Windows (recommended)

Download `facilities_dashboard.exe` from the repository's latest GitHub Release and double-click it. The executable bundles Python, the application dependencies, and its Qt renderer; Python and WebView2 do not need to be installed separately.

After the first download, use **Settings → Application updates → Check for updates**. When a newer GitHub Release is available, the app downloads the replacement EXE, verifies the published SHA-256 checksum, closes, replaces itself, and reopens. This one-click updater is available only in the packaged Windows EXE; source and macOS launches show their version but do not self-update.

Each published build must use a new semantic release tag such as `v1.1.0`. Reusing an existing tag does not create a detectable upgrade because the application compares release versions.

### macOS

Double-click `Start Expense Dashboard.command`.

On first launch, the source launcher installs Homebrew's prebuilt `llama.cpp` runtime when local AI is not already available. This avoids compiling `llama-cpp-python` on the user's computer. If Homebrew is unavailable, the launcher tries the Python/Metal build as a fallback; a failure of either optional path does not prevent the dashboard or custom OpenAI-compatible endpoints from working.

For a standalone `.app`, install the requirements in the Python 3.11 environment and run `scripts/build_macos_app.sh`. The script checks that the local AI runtime is included and prints the Metal-enabled installation command if it is missing.

### Windows (from source)

Double-click `Start Expense Dashboard.bat`.

The first launch creates a local virtual environment and installs the required dependencies. Python 3.10 or newer is required. See [dashboard/README.md](dashboard/README.md) for workbook structure and detailed usage.

## Privacy

Expense and survey workbooks, generated outputs, presentations, local environments, and internal feedback are excluded from Git. The application does not read Google Sheets. Source workbooks stay local. Ask Dashboard sends only anonymised aggregate results; Survey Summarize sends only locally masked comment text after explicit confirmation.

When the base directory is inside OneDrive, mark it **Always keep on this device** and wait for the green check mark before the first load. The app reads Excel files through a retrying in-memory snapshot and closes workbook handles after parsing, so brief Excel/OneDrive locks retain the last successfully loaded dashboard instead of leaving it in a loading state.
