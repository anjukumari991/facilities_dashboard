# Facility Expense Dashboard Feedback Tracker

This tracker records the feedback captured from the review image. Each item will be classified with the requester as cosmetic or functional before implementation. Unclear wording remains marked for clarification.

| No. | Feedback item | Clarification note | Classification | Status |
|---:|---|---|---|---|
| 1 | Dollar needs to be added | Provide an INR/USD selector. Convert INR values to USD using an editable rate, defaulting to 1 USD = ₹96. Persist the preference locally without modifying Excel data. | Functional | Implemented |
| 2 | Change the header from “Operations · Executive View” to “India Admin and Facilities” | Updated the dashboard eyebrow using uppercase styling consistent with the existing design. | Cosmetic | Implemented |
| 3 | Add Plan Year to Lookback — PY25 and PY26 | Retain rolling periods and dynamically add plan years found in Excel. PY25 means 1 July 2025 through 30 June 2026. | Functional | Implemented |
| 4 | Average data for the month for PY25 and PY26 | Add one chronological month-and-year line chart that grows with Excel data and includes a monthly-average reference line. | Functional | Implemented |
| 5 | Pie chart for category | Apply the pie chart to Miscellaneous Detail, showing selected-period spend by miscellaneous expense type with amount and percentage. | Functional | Implemented |
| 6 | Separate workspace cost for AWFIS | Requires the Excel source data to identify and separate AWFIS workspace costs consistently before dashboard treatment is defined. | Data change | Pending source-data update |
| 7 | Check the category with Nishi | Category definitions must be confirmed with Nishi and updated in the Excel source data. | Data change | Pending external confirmation |
| 8 | Opportunity area | Metrics and definition need clarification. | Pending | Awaiting review |
| 9 | Risk area — renewal charges increase the cost; war situation affects dry-fruit cost | Confirm whether these are manually entered risks or calculated alerts. | Pending | Awaiting review |
| 10 | F&B audit for all lunch vendors | Scope and audit measures need clarification. | Pending | Awaiting review |
| 11 | Fall Back plan | Required content and placement need clarification. | Pending | Awaiting review |
| 12 | Day-by-day lunch expenses by headcount | Confirm the source fields and required visualization. | Pending | Awaiting review |
| 13 | Add forecast for the next month | Forecast method and assumptions need clarification. | Pending | Awaiting review |
| 14 | Add KPIs: monthly budget defined; 50% lunch from a particular vendor; month-on-month increase; employee survey; vendor SLA; savings | Each KPI requires its source, calculation, target, and display rule. | Pending | Awaiting review |
| 15 | Separate dashboard for workspace expenditure and table-space expenses | Confirm data availability and whether this is a new view or separate application. | Pending | Awaiting review |
| 16 | Add percentage in the summary | Confirm which total or comparison each percentage represents. | Pending | Awaiting review |

## Review decisions

- Item 1 was classified as functional and implemented with INR/USD display conversion, an editable ₹96 default exchange rate, and cached preferences.
- Item 2 was classified as cosmetic and implemented by changing the dashboard eyebrow to “India Admin and Facilities.”
- Item 3 was classified as functional and implemented as dynamic plan-year period options derived from Excel dates. Plan years run from 1 July through 30 June of the following year.
- The workbook dropdown was removed from the visible filters. Workbook discovery and selection continue automatically, and the loaded filename remains visible in the status message.
- Item 4 was classified as functional and implemented as a dynamic month-and-year line chart with a monthly-average reference line.
- The month-and-year graph was compacted after review. Final cross-dashboard alignment is deferred until the remaining feedback components are added.
- Item 5 was clarified and implemented as a Miscellaneous Detail pie chart for selected-period spend by expense type. The separately added category chart was removed.
- Expand controls were added to every chart panel so each visualization can be opened in a larger modal view.
- Item 6 was classified as a data change. No dashboard code change was made; implementation is pending the AWFIS source-data update.
- Item 7 was classified as a data change. No dashboard code change was made; the category update is pending confirmation with Nishi.
- The report title was removed from the header, the filter area was moved below the header, and the main view now uses Expense Report and Survey Report tabs. Existing dashboard content is under Expense Report; Survey Report is intentionally empty.
- Base-location actions were moved into a reusable Settings dialog. Refresh remains in the main header.
- Settings now supports a masked OpenAI API token stored in the operating system credential vault (Windows Credential Manager or macOS Keychain); the token is not stored in the dashboard settings file.
