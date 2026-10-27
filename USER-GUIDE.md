# SAS MAS Scorer - User Guide

This guide walks you through every feature of the SAS MAS Scorer application. Whether you are scoring a single row against a published model, running thousands of rows in parallel, building custom UIs for business users, or analyzing test coverage across your SAS Intelligent Decisioning assets, this guide will help you get the most out of the tool.

---

## Table of Contents

1. [What Is the SAS MAS Scorer?](#1-what-is-the-sas-mas-scorer)
2. [Getting Connected](#2-getting-connected)
3. [Navigating the Application](#3-navigating-the-application)
4. [Browsing Modules](#4-browsing-modules)
5. [Module Details](#5-module-details)
6. [Scoring — Single Execution](#6-scoring--single-execution)
7. [Scoring — Parallel (File Upload)](#7-scoring--parallel-file-upload)
8. [Scoring — Parallel (CAS Table)](#8-scoring--parallel-cas-table)
9. [Scenarios and Tests](#9-scenarios-and-tests)
10. [View API Call](#10-view-api-call)
11. [View Source Code](#11-view-source-code)
12. [UI Apps](#12-ui-apps)
13. [View Flows](#13-view-flows)
14. [Segmentation Tree Explorer](#14-segmentation-tree-explorer)
15. [Test Coverage Analysis](#15-test-coverage-analysis)
16. [Publishing Overview](#16-publishing-overview)
17. [Job Monitoring](#17-job-monitoring)
18. [Schema → Code](#18-schema--code)
19. [Business Rules Import](#19-business-rules-import)
20. [Keyboard and Interaction Tips](#20-keyboard-and-interaction-tips)

---

## 1. What Is the SAS MAS Scorer?

The SAS Micro Analytic Score (MAS) service hosts published models and decisions as **modules**. Each module exposes one or more **steps** — executable endpoints that accept input variables and return output variables.

The SAS MAS Scorer gives you a visual interface to:

- Browse all published modules and inspect their inputs, outputs, and source code.
- Score individual rows by filling in a form, or score thousands of rows in parallel from an uploaded file (CSV, TSV, JSON/JSONL, Excel, or Parquet) or a CAS table.
- Save scoring setups back to SAS Intelligent Decisioning as **Scenarios** (static input/expected output pairs) or **Tests** (CAS table-backed batch tests), and load, run and check them again from the app.
- Compare results with expected values: a loaded scenario, a batch file's or CAS table's expected-output columns, or two runs from the run history.
- Build lightweight custom UIs on top of any module so that business users can score without seeing the underlying technical details.
- Visualize SAS Intelligent Decisioning flows as interactive diagrams.
- Analyze test coverage across all your Decisioning and Model Manager assets.

---

## 2. Getting Connected

The application supports three deployment modes. How you authenticate depends on which one you are using.

### Desktop App (Electron)

The desktop app supports **multiple named connections** (e.g. "Production", "Dev", "Staging") with per-connection authentication.

**First launch:**

1. The app opens with an **Add Connection** form.
2. Fill in the fields:

   | Field | Description |
   |-------|-------------|
   | **Connection Name** | A label for this connection (e.g. "Production") |
   | **SAS Viya Server URL** | The base URL of your Viya environment (e.g. `https://viya.example.com`) |
   | **Client ID** | An OAuth client registered on Viya. The default `vscode` works on Viya 2022.11+ |
   | **Client Secret** | Leave empty for the default public client |
   | **Skip SSL verification** | Enable for dev/test environments with self-signed certificates |
   | **Environment Color** | Optional — tints the application header with this connection's color so you can tell environments apart at a glance. Pick a preset (Light Blue, Midnight Blue, Pink) or any custom color; **Default** keeps the standard SAS blue |

3. Click **Save**, then click **Login**. A browser window opens for the OAuth authentication flow.
4. After successful login, the app loads your modules.

**Managing connections:**

- Click the **gear icon** in the top-right header to open the connection settings panel.
- From there you can add, edit, delete, or switch between connections.
- The active connection name and a green status dot are shown in the header.
- Editing the **Environment Color** of the active connection recolors the header immediately — handy for making sure production and test environments never look alike.

**Later launches:** if the stored session has expired, the app renews it at startup with the saved refresh token — the header shows **Connecting…** meanwhile, and no login window opens. If the server cannot be reached at startup (a network outage, VPN not up yet), the saved session is kept, so you do not have to log in again once the connection is back.

### Web Server (Browser)

When deployed on a web server on the same origin as SAS Viya, authentication uses browser cookies. Click **Login** in the header. A popup window opens to the SAS Viya login page. Once authenticated, the popup closes and the app loads.

### SAS Visual Analytics (Embedded)

When embedded in a SAS Visual Analytics report via a Job Definition, the application inherits the user's existing SAS Viya session. No separate login is needed.

**Downloads inside SAS Visual Analytics:** the report can show the app in a frame that does not allow downloads. Every export in the app (batch results CSV, coverage CSV and Markdown, flow Markdown, path CSV, job log and code, Rules Import files, the Schema → Code `.py`, UI App export) then shows a notice instead of doing nothing: **Download blocked** when the frame is known to block downloads, or **Did the download start?** when the app cannot tell. Click **Copy contents** and paste the text into a file. If the clipboard is blocked as well, the notice shows the text so you can select it and copy it with **Ctrl+C** (**⌘C** on a Mac).

### When Your Session Expires

When the SAS Viya session ends while you work — a request answered with HTTP 401, or the SAS Logon page answering in place of the service, which is how cookie sessions expire in the web and Visual Analytics versions — the app first checks the session again; if it is still valid, the request is simply retried. Otherwise it shows one **Your session has expired** prompt, however many requests were affected:

- **Sign in** — signs you in again (the desktop app's login window, or a SAS Logon popup in the browser) and then retries what was waiting, so you carry on where you were without losing what you had entered. If no popup opens in the browser, it has probably been blocked: allow pop-ups for the site and try again.
- **Not now** — closes the prompt and the waiting requests fail. In the desktop and web versions the header then shows **Login**, so you can sign in when you are ready.
- **Job Execution / Visual Analytics** — sign in through the popup, or click **Reload page** if the popup does not open. Anything you have not saved on the page is lost when it reloads.

### Copying Error Details

An error message caused by a failed SAS Viya request has a **Copy details** button. It copies a short report, ready for an administrator or a support ticket: the message, the HTTP status, the SAS error code, the request (method and path), the time, the app version and build, the page you were on and the browser. The button reads **Details copied** once it has worked.

---

## 3. Navigating the Application

The left sidebar is the primary navigation. It contains the main pages and a contextual section that appears when you have a module selected.

### Main Pages

| Page | Description |
|------|-------------|
| **All Modules** | Browse, search, and filter all published modules |
| **UI Apps** | Create and manage custom scoring UIs |
| **View Flows** | Visualize SAS Intelligent Decisioning flows |
| **Segmentation Trees** | Navigate and search large segmentation trees path by path, copy any path, predict a record's path, and turn paths into SID scenarios or tests |
| **Test Coverage** | Analyze test scenario coverage and test health across all assets |
| **Publishing Overview** | See every publishing destination and everything deployed to it |
| **Rules Import** | Validate and import SAS Intelligent Decisioning rule sets from CSV files |
| **Job Monitoring** | Track running and historical Job Execution jobs, view live logs and code, and rerun finished jobs |
| **Schema → Code** | Generate a Python `execute()` function from a JSON/XML sample and save it to SAS Intelligent Decisioning |

### Current Module Section

When you select a module, two additional navigation items appear:

- **Details** — Opens the module's details page: metadata, steps, submodules, and source links.
- **Execute Score** — Returns to the scoring panel for the step you last scored in this module. If you have not scored a step of it yet, it opens the module with focus on its **Steps** list so you can pick one.

### Lists Keep Their View

The search, filters, sort order and page of the **All Modules**, **View Flows** and **Segmentation Trees** lists and of the Job Monitoring history, and the search, type and coverage filters of the **Test Coverage** table, are kept in the page link (as is the Job Monitoring statistics period, `?period=`). The browser's **Back** button, a reload and a copied link therefore bring back the same view, and going back to View Flows or Segmentation Trees does not reload the whole list. Choosing the page in the sidebar starts a fresh, unfiltered list. The open tab of a job's detail page is kept the same way (`?tab=…`).

### Pages Reopen From Memory

Decision flows, sub-decisions, rule sets, REST API and treatment definitions, segmentation trees and module details are kept for the session once loaded, so going back to one opens it at once while the app checks for changes in the background. If a newer version was saved in SAS Intelligent Decisioning in the meantime, it replaces the one on screen. Logging out, switching connection or importing rules clears the affected copies.

### Recent Items

The sidebar also shows your most recently accessed **UI Apps** and **Modules** (up to 5 each) for quick navigation.

### Collapsing the Sidebar

The sidebar starts as a narrow rail of icons, giving the page the extra width; hover an icon to see its name. The double-arrow button at the bottom (next to the version number when the sidebar is open) expands it to show the labels and folds it back; hovering or focusing the button shows **Expand** or **Collapse**. Once you have chosen, the choice is remembered on that computer, so the sidebar opens the way you left it. The recent-items lists are hidden while the sidebar is collapsed.

### Narrow Windows and Embeds

Below 768 pixels — a SAS Visual Analytics object, a Job Execution embed, or a small browser window — the sidebar becomes a drawer: the menu button at the left of the header opens it over the page, and **Escape**, a click outside it, or choosing a page closes it. Toolbars wrap. At any window width, a table wider than the window (Test Coverage's asset table, for example) scrolls inside its card instead of giving the whole page a horizontal scroll bar. The desktop app never goes narrower than 800 pixels, so it always shows the full sidebar (collapsible as above).

---

## 4. Browsing Modules

The **All Modules** page displays every module published to the SAS Micro Analytic Score service.

### Searching and Filtering

- **Search** — Type in the search box to filter modules by name. The search is case-insensitive and updates as you type.
- **Type filter** — Use the dropdown to filter by **All**, **Model**, or **Decision**.
- The header shows a count like "Filtered to 12 / 48 modules" when a filter is active.

### The Module Table

Each row shows:

| Column | Description |
|--------|-------------|
| **Module Name** | The name and ID of the module |
| **Type** | A color-coded badge — blue for Model, green for Decision, orange for Data |
| **Steps** | The number of executable steps |
| **Created By** | The user who published the module |
| **Last Modified** | When the module was last updated |

Click any column header to sort ascending or descending.

### Pagination

Use the **Previous** / **Next** buttons at the bottom of the table to move between pages.

### Opening a Module

Click the **View** button on any row to open the Module Details page, or click the module name directly.

---

## 5. Module Details

The Module Details page gives you a complete picture of a module before you start scoring.

### Module Information

A summary card shows:

- **Status** — The module scope (public or private).
- **Type** — Model, Decision, or Data.
- **Version** — For Decisions, this is the major.minor revision from the decision flow. For Models, this is the model version ID.
- **Description** — The description from the decision or model definition (if available).
- **Created / Modified** — Timestamps and usernames.
- **Source** — A deep link that opens the decision flow in SAS Intelligent Decisioning or the model in SAS Model Manager.

### Steps

A table listing every step in the module. For most published decisions, there is a single step called `execute`. For models, there may be a `score` step and others.

Each row shows the step ID, the number of inputs and outputs, and an **Execute** button that takes you to the scoring panel.

### Submodules

If the module contains submodules (common for complex decision flows), they are listed with their name and language.

### Actions

- **Build UI** — Create a custom UI on top of this module (available for Model and Decision types).
- **View Flow** — Open the interactive flow diagram (available for Decision types).
- **Delete Module** — Remove the module from MAS. This action requires confirmation.

---

## 6. Scoring — Single Execution

The scoring panel is where you execute a module step. At the top of the page you will see a mode toggle with three options:

- **Single Execution** — Score one row at a time by filling in a form.
- **Parallel (File Upload)** — Score many rows from an uploaded file (CSV, TSV, JSON/JSONL, Excel, or Parquet).
- **Parallel (CAS Table)** — Score many rows from a CAS table.

This section covers Single Execution. The other modes are covered in the next two sections.

### Step Information

Two cards at the top show:

- **Step Information** — The number of inputs and outputs.
- **Output Signature** — A list of all output variables with their data types.

### Entering Input Values

The input form shows one field for each input parameter. Each field is labelled with the parameter name and displays a type badge (e.g. `decimal`, `string`, `integer`).

**The form is kept for the browser tab.** What you enter is kept for each step (per connection, module and step) while the browser tab is open, so leaving the score page and coming back, or reloading, no longer clears it. A note above the form says *Restored the inputs you entered for this step earlier in this browser tab*; **Dismiss** hides it. The values stay in this browser tab only, are never sent anywhere, and are cleared when you log out, switch connection or close the tab.

### DataGrid Inputs (Decision Modules)

If a decision input is a **datagrid** (a table-valued variable), the app detects this from the decision's signature and replaces the raw text field with a grid editor. The field shows a `dataGrid` type badge, a summary of the current grid (e.g. "2 rows × 2 columns"), and a **Create grid…** / **Edit grid…** button that opens the editor:

- **Columns from the decision** — When the decision declares the datagrid's columns (a *datagrid extension*), the editor locks the column names and types to match, and each cell gets a type-appropriate input: number fields for numeric columns, date/datetime pickers, and true/false dropdowns for booleans.
- **Row limit** — If the decision declares a maximum row count, the editor shows it as a badge and refuses to add rows beyond the limit, telling you why.
- **Free-form grids** — When the decision does not declare columns, you define them yourself: add columns, name them, and pick each column's type (string, decimal, integer, date, datetime, boolean).
- The editor starts with one empty row ready to fill in. **Apply grid** writes the value back to the form; **Clear** on the field removes it.

The grid is sent to MAS in its native JSON structure — you never have to hand-write the `metadata`/`data` JSON yourself.

**Helpful actions in the input card header:**

| Button | What It Does |
|--------|--------------|
| **Load Scenario** | Replace every input with the values of a scenario saved in SAS Intelligent Decisioning, keeping its expected outputs to check after the run, or score all of the decision's scenarios at once (Decision modules only; see [Scenarios and Tests](#9-scenarios-and-tests)) |
| **Auto-fill Defaults** | Populate all fields with zero-values (0 for numbers, empty string for text, empty arrays for array types) |
| **Clear All** | Reset all input fields to empty |

### Executing

Click **Execute Score** to send the input values to MAS. While the request is in progress, the button shows a loading spinner.

### Viewing Results

After a successful execution, a results section appears below the input form showing:

- **Execution state** — Typically "completed".
- **Execution time** — How long the request took (in milliseconds).
- **Output values** — Displayed in a table by default. You can toggle to a raw JSON view using the **Table** / **JSON** buttons.
- **Datagrid outputs** — If an output is a datagrid (a table-within-a-table), it renders as a scrollable nested table with sticky column headers.

**Actions on results:**

- **Save as Scenario** — Save the input/output pair as a test scenario in SAS Intelligent Decisioning (Decision modules only). The scenario stores the inputs that were sent with the run, not whatever the form holds now.
- **Clear Results** — Dismiss the results section.

**When the inputs change after a run:** the results stay on screen, dimmed, under **Results (previous run)**, with an **Inputs changed since this run** banner and a **Run again** button. **Save as Scenario** is disabled until you run again, so a scenario never pairs inputs with outputs they did not produce. If a re-run fails, the error is shown and the previous successful result stays below it, dimmed and labelled the same way.

**Checking a loaded scenario:** after you load a scenario (see [Scenarios and Tests](#9-scenarios-and-tests)) and click **Execute Score**, the output table gains an **Expected** column and a **Check** column. Each output shows **Matches**, **Differs** or **Not checked** (the scenario has no expected value for it), and a line above the table sums it up — *Scenario Approve_1: 4 match, 1 differ, 2 not checked (no expected value)* — with a **Matches expected**, **Differs from expected** or **Nothing to check** badge. An output the scenario expects but the run did not return is listed as *not returned* and counts as differing. The expected values belong to the scenario's own inputs: if you change an input and run again, they are not shown for that run, and a note says to load the scenario again to check it. **How values are compared** below the summary opens the comparison rule (see the next section).

### How Values Are Compared

Every expected-versus-actual check in the app — a loaded scenario, **Run all scenarios**, the expected-output columns of a batch run — uses the same rule, and each of those places has a **How values are compared** link that opens it:

- **Actual values** are what the published MAS module returned for that run; nothing is calculated in the browser.
- **Numbers** — also numbers written as text, such as `"12.50"` — match when they differ by at most 1 × 10⁻⁹ times the expected value (or by at most 1 × 10⁻⁹ when the expected value is between −1 and 1). No rounding or format is applied.
- **Text** matches exactly after leading and trailing blanks are removed; upper and lower case count. A date-time written with "T" or a blank, or with a zero fraction, is the same value.
- **Missing values** match each other: null, an empty value and the SAS missing values `.`, `.A`–`.Z` and `._`.
- **A blank expected value is not checked** (null or blank shows "Not checked"). To require a missing result, expect `.`.
- **DataGrids and lists** match when every cell matches by the same rules.
- **"Differs"** only says that the values are not the same; it does not say why.

### Run History

Below the results, **Run history (N)** keeps the last 20 runs of the step (each **Execute Score** adds one): the time, the state, the latency and the first outputs, or the error of a failed run. Click the heading to open it.

- **Restore inputs** puts that run's inputs back in the form (*Restored the inputs of the run at 14:05:12*).
- **Pick two runs** with their checkboxes to compare them: a table lists every input and output of both runs, marks each one **Changed** or **Same**, and says how many changed (*2 inputs and 1 output changed*). **Only changed values** hides the rest. A third pick replaces the oldest one. Values are compared by the rule above.
- **Clear history** empties the list.

The history stays in this browser tab only: it is never sent anywhere, and it is cleared when you log out, switch connection or close the tab.

---

## 7. Scoring — Parallel (File Upload)

Switch to the **Parallel (File Upload)** tab to score many rows at once from a file on your machine.

### Supported File Formats

| Format | Extensions | Notes |
|--------|------------|-------|
| CSV | `.csv` | Comma-delimited, quoted fields supported |
| TSV | `.tsv`, `.tab` | Tab-delimited |
| JSON / JSONL | `.json`, `.jsonl`, `.ndjson` | Either a single JSON array of objects or one JSON object per line. Headers are inferred from the union of keys in the first 100 records |
| Excel | `.xlsx` | Workbooks with multiple sheets are supported — a sheet picker appears after upload |
| Parquet | `.parquet` | Native column types are preserved (numbers stay numbers) — no string coercion |

The file format is detected automatically from the extension, and a badge next to the file name confirms which parser was used. Excel and Parquet parsers are loaded on demand the first time you pick one of those formats.

**Dates (Excel and Parquet):** a date is sent to a numeric input as a SAS date value (days since 1 Jan 1960), or as a SAS datetime value (seconds since 1 Jan 1960) when it has a time of day, and to a string input as ISO 8601 text. A note under the mapped input says which conversion is used.

### Uploading a File

Click the file picker and choose a file in one of the supported formats, or drag and drop the file onto the upload area. From the keyboard, the file picker is the way in. The file is parsed entirely in the browser — nothing is uploaded to a server.

### Custom Delimiter (CSV / TSV only)

For delimited text formats, a **Delimiter** control appears above the column mapping section with preset chips for Comma, Tab, Semicolon, and Pipe, plus a free-text field for any custom character (e.g. `^`, `#`). This is useful when a file uses a non-standard separator despite its `.csv` extension — a common pitfall with European locale exports that use `;`. Changing the delimiter re-parses the file immediately.

### Sheet Picker (Excel only)

If the uploaded workbook contains more than one sheet, a **Sheet** dropdown appears above the column mapping section. Pick the sheet you want to score; the preview and mapping refresh automatically.

### Column Mapping

After the file is parsed, a mapping interface shows each module input parameter on the left and a source dropdown on the right. The app automatically maps columns by name (case-insensitive, ignoring underscores, spaces, and hyphens); inputs it cannot match are left unset. Each input takes one of:

| Source | What Is Sent |
|--------|--------------|
| A **column** | That column's value on each row |
| **Send as missing (null)** | A missing value on every row — for optional inputs the file does not have |
| **Constant value…** | The value you type, on every row. It is checked against the input's type; for an array input, separate the values with `;` |

The file therefore does not need a column for every input. A badge summarizes the mapping (e.g. "5 mapped, 2 missing, 1 constant", plus "N not set" while inputs are still open), and **Send N unset inputs as missing** sets every input you have not chosen to missing in one click — quick when a module has dozens of optional inputs. **Run All** waits until every input has a source and every constant is valid; the message next to it says what is left.

**Missing and unreadable values:** empty cells, SAS missing values (`.`, `.A`–`.Z`, `._`) and values that cannot be read as the input's type (`N/A`, `1,5`, `12abc` for a number) are all sent as missing (null), never as 0. Unreadable values are flagged before you run: a **Check:** note under the mapped input says how many there are, with examples and the first row — e.g. *2 values in column clage can't be read as decimal (e.g. "N/A", "12abc"; first in row 3). They are sent as missing (null), not 0.* Fix the file, or map another column, if those rows should not be scored that way.

**Datagrid inputs:** a flat file cannot nest a table inside a cell, so a column mapped to a datagrid parameter should contain the serialized datagrid JSON (e.g. `[{"metadata":[{"col":"string"}]},{"data":[["a"]]}]`) in each cell. The app parses it into the native structure MAS expects before scoring — this applies to CAS table batches as well.

### Expected Outputs (Regression Checks)

Below the input mapping, the optional **Expected outputs (optional)** section turns a batch run into a regression check. For each output, choose the column that holds the value each row should produce; outputs left on **Not compared** are not checked. A badge says how many outputs are compared (*3 of 5 outputs compared*, or *Nothing compared*), and **Compare nothing** clears every choice.

Columns named `expected_<output>`, `Output_<output>` or like the output itself are suggested when the file is loaded (a column already used for an input is not suggested by the output's own name). Suggestions are marked **Suggested by name**; **Remove** next to any choice stops comparing that output.

Each scored row is then marked **Matches**, **Differs** or **Not checked**: a row differs when at least one compared output is not the same as its expected value, and is not checked when all its expected cells are blank (a blank cell is never checked). Failed rows are not compared. The values are compared by the rule in [How Values Are Compared](#how-values-are-compared): blanks trimmed from text, numbers within 1 × 10⁻⁹ relative tolerance, every kind of missing value alike, a blank expected value not checked.

### Data Preview

A preview table shows the first few rows of your data so you can verify it looks correct.

### Configuring the Run

- **Parallel Requests** — Controls how many scoring requests run concurrently (1 to 100). Higher values score faster but put more load on the server. Start with 2-4 and increase if needed.

### Running the Batch

Click **Run All** to start. A progress card shows how the run is going: a progress bar with rows done of the total, **Succeeded** and **Failed** counts, **Automatic retries** (once there are any), **Throughput** in rows per second, **Time left**, and the **Last error**. You can click **Stop** at any time — partial results are kept and displayed immediately.

**Temporary errors are retried automatically.** A row that fails with HTTP 429, 502, 503 or 504, or whose connection dropped, is sent again up to twice, with a short wait in between, before it is recorded as failed. Other errors (for example an error in the module's own code) fail at once.

**A run of failures pauses the batch.** If 20 rows in a row fail — typically an expired session, a removed module or a service outage — no more rows are sent and the card shows **Run paused: the last 20 rows failed**, with the most common message. **Continue** resumes and stops pausing for that message (a different failure pauses again); **Stop** ends the run and keeps the rows scored so far.

### Batch Results

After the run completes (or is stopped), the results are displayed in a detailed table.

**Statistics overview:**

| Metric | Description |
|--------|-------------|
| Total Runtime | Wall-clock time for the entire batch |
| Avg Request Time | Mean time per individual scoring request |
| Success Rate | Percentage of rows that scored successfully |
| Fastest / Slowest Response | Best and worst individual request times |
| Median Response | The middle response time |
| Total Requests | How many rows were processed |
| Succeeded / Failed | Count of successes and errors |
| Mismatches / Match Expected / Not Checked | With expected-output columns mapped: rows that differ from, match, or had nothing to compare with their expected values (**Not Checked** only when there are such rows) |

**Results table:**

Each row shows the row number, status badge, output values, and runtime. Click **Show** on any row to expand it and see the full input and output JSON; with expected outputs mapped, the expanded row also lists each compared output with its expected value, actual value and check.

- **Expected values** — with expected-output columns mapped, the card header shows *N differ from expected*, the table gains an **Expected** column (**Matches**, **Differs (N)** or **Not checked**), each differing value is highlighted with *expected …* written under it, and a note above the table explains the check, with **How values are compared**.
- **Status filter** — the chips **All**, **Succeeded** and **Failed** (each with its count), and **Mismatched** when expected outputs are mapped, narrow the table to those rows; the line next to them says what is shown (e.g. *Showing 12 failed of 5,000 rows*), and **Show all rows** clears the filter.
- **Sorting** — click the **Row**, **Status**, **Expected**, any output or the **Runtime** header to sort; click again to reverse (on **Expected**, differing rows come first). Missing values always sort last.
- **Paging** — 100 rows per page by default (switch to 500 or 1,000 with **Rows per page**); **Showing 1-100 of N** and the **Previous** / **Next** controls sit below the table.

Sorting, filtering and selection apply to the whole result set, not just the visible page. **Download CSV** and **Upload to CAS** always include every row, whatever the filter.

**Errors by message:** when rows failed, a list above the table groups them by message, most frequent first (e.g. *10 × The step … was not found*); the first five kinds are shown, **Show all N kinds** lists the rest. **Show these rows** filters the table to the rows with that error, and **Go to row N** opens the first row with it.

**Retry failed rows:** **Retry failed rows (N)** in the card header scores only the failed rows again, with the inputs they were sent with, and puts the new results in their places; successful rows are kept. A note then says how many now succeeded and how many still failed.

If an output value is a datagrid, the cell shows a **DataGrid(rows × columns)** link instead of the raw structure — click it to open the grid in a modal viewer with sticky headers, paging at 200 rows, and a **Copy JSON** button.

**Actions:**

| Button | What It Does |
|--------|--------------|
| **Retry failed rows (N)** | Score only the failed rows again (shown when rows failed) |
| **Save as Scenarios** | Save selected rows as test scenarios (select rows using checkboxes first) |
| **Upload to CAS** | Upload the results as a new CAS table |
| **Download CSV** | Export results as a CSV file including inputs, outputs, runtime, status, and errors. With expected outputs mapped, it adds an `Expected_<output>` and a `Match_<output>` column per compared output and a `Check` column (`match`, `differs` or `not checked`), so the file can be uploaded again as a regression suite — its `Expected_` columns are suggested as expected outputs |
| **Clear Results** | Remove the results from the screen |

### Selecting Rows

Click the checkbox next to any successful row to select it (or Tab to it and press **Space**). Use **Shift+Click** to select a range of the rows as shown (filtered and sorted). Use the header checkbox to select or deselect all successful rows across every page — or, with a filter on, all successful rows it shows — and the **Save as Scenarios** button shows the full count. Only successful rows can be selected.

---

## 8. Scoring — Parallel (CAS Table)

Switch to the **Parallel (CAS Table)** tab to score rows directly from a CAS table without downloading data first.

### Browsing CAS Tables

1. **CAS Server** — Select the CAS server from the dropdown (e.g. `cas-shared-default`).
2. **Caslib** — Select the caslib (library) that contains your table (e.g. `Public`).
3. **Table** — The app lists all tables in the selected caslib that have at least one row. Use the filter box to narrow the list. Click a table to select it.

### Load Test

For Decision modules, **Load Test…** in the card header lists the decision's CAS-table tests saved in SAS Intelligent Decisioning (tests created with **Save as Test** here or on the decision's Tests tab). Each entry shows the input table, how many columns it maps, and — for the first 25 tests — when it last ran (*Last run started …* or *No run found*). Search by name, table or author.

Choosing a test selects its CAS server, caslib and table and replaces the column mapping with the test's: *Loaded test "Regression_Q3": 12 inputs mapped to columns, 2 sent as missing (the test does not map them).* A note lists mapped columns the table no longer has (those inputs need a source) and mapped variables that are not inputs of this step (skipped). If the test's server, caslib or table is not available to you (or the table has no rows, so it is not listed), the selection stops there and a note says what is missing — load the table into CAS, then load the test again.

### Column Mapping

Once you select a table, the app loads its column metadata and shows the mapping interface — the same as the file upload mode: each input takes a column (listed with its CAS type), **Send as missing (null)** or a **constant**, the badge summarizes the choices, **Send N unset inputs as missing** fills the rest, and **Run All** waits until every input has a source. Columns are auto-matched by name.

The notes under each input are based on the table's metadata and the preview rows:

- A character column mapped to a numeric input is flagged — values that are not numbers are sent as missing (null).
- A numeric column mapped to a string input is noted — its values are sent as text, and SAS missing values as null.
- Values in the preview rows that cannot be read are listed, prefixed *Preview rows:*.

CAS returns every missing numeric as `.`; these, and the special missing values `.A`–`.Z` and `._`, are sent as missing (null), not 0.

The optional **Expected outputs** section works as in the file upload mode (see [Expected Outputs (Regression Checks)](#expected-outputs-regression-checks)): map a column per output and every scored row is checked against it.

**Before scoring:** the full table is only read when you click **Run All**, and the same check then runs on every fetched row. If any values cannot be read, nothing is scored yet: a warning lists, per input, how many values are affected, with examples and the first row, and offers **Score N rows anyway** (those values are sent as missing) or **Cancel**.

### Data Preview

A 5-row preview of the table is shown so you can verify the data and column types.

### Configuring the Run

- **Score full table** — Check this to score every row in the table. The rows are fetched from CAS page by page before scoring starts, so the count you see in the results is the count that was actually scored. Tables over 50,000 rows show a warning but still run. When unchecked, a **Row Limit** field lets you cap how many rows to score (default: 1,000); exactly that many rows are fetched and scored.
- **Parallel Requests** — Same concurrency control as the file upload mode.

**While rows are fetched:** a progress bar under **Run All** shows the rows fetched of the total (*Fetching rows... 12,000 of 150,000*); nothing is scored until every row has been fetched. **Stop fetching** cancels the fetch — *Fetching stopped. Nothing was scored.* — and focus returns to **Run All**.

Switching table or caslib while data is still loading discards the earlier load — the mapping and preview always belong to the table currently selected.

### Save as Test

For Decision modules, a **Save as Test** button appears next to **Run All**. This lets you save the CAS table and column mapping configuration as a Test (score definition) back to SAS Intelligent Decisioning — without needing to run the batch first. Inputs set to **Send as missing** are saved without a mapping, which is how a test leaves them missing. A setup with a **constant** cannot be saved as a test (SAS Intelligent Decisioning has no constant mapping for table tests): the button stays disabled and a note explains why — constants apply to runs in this app only. The dialog can also run the test straight away. See [Scenarios and Tests](#9-scenarios-and-tests) for details.

### Running and Results

Click **Run All** to start the batch. Once the rows are fetched, the run and its results work exactly as in the file upload mode: the same progress card, automatic retries and pause after repeated failures, and the same statistics, status filter, expected-value checks, **Errors by message**, **Retry failed rows**, selection, and export capabilities.

---

## 9. Scenarios and Tests

Scenarios and Tests are score definitions stored in SAS Intelligent Decisioning. They allow you to re-run scoring validations from within the SAS platform.

### Scenarios

A **Scenario** captures a single row of static input values and expected output values. Think of it as a saved test case.

**Saving a single scenario (from Single Execution):**

1. Execute a single row successfully.
2. Click **Save as Scenario** in the results section.
3. Fill in the dialog:
   - **Name** — A name for this scenario (max 100 characters).
   - **Description** — Optional description.
   - **SAS Content Folder** — Browse the SAS Content tree and click **Select current folder** to choose where to save. The "Select current folder" link appears at the bottom of the folder browser — you must click it to confirm your selection.
   - **CAS Output Library** — Choose the CAS server and caslib for the output table.
4. Click **Save Scenario**.

**Saving batch scenarios (from Parallel modes):**

1. After a batch run, select the rows you want to save using the checkboxes.
2. Click **Save as Scenarios (N)** where N is the number of selected rows.
3. Fill in a **Base Name** — each scenario will be named `{BaseName}_1`, `{BaseName}_2`, etc.
4. Choose the folder and output library as above.
5. Click **Save**. A progress bar shows the creation progress.

**Loading a scenario (in Single Execution):**

1. Click **Load Scenario** in the input card header.
2. A dialog lists all saved scenarios for the current decision. Search by name, description or author.
3. Click a scenario. Loading a scenario **replaces every input in the form** and keeps the scenario's expected outputs. A note says so — *Loaded scenario "Approve_1": every input was replaced. After the run, its 3 expected output values are shown next to the results.*
4. Click **Execute Score**. Each output shows its expected value and **Matches**, **Differs** or **Not checked** (see [Viewing Results](#viewing-results) and [How Values Are Compared](#how-values-are-compared)).

If some of the scenario's inputs are not inputs of this step (it may belong to another step, or the decision has changed since it was saved), the form is filled without them and its expected values are not shown, and the note names those inputs.

**Running all scenarios:**

**Run all scenarios (N)** in the Load Scenario dialog scores every scenario of the decision against the published module you are on — or, with a search entered, **Run N shown** scores only the scenarios the search shows. Each scenario's inputs are scored by the module and its outputs compared with the saved expected values, three scenarios at a time; **Stop** ends the run early.

The results list each scenario as **Matches**, **Differs**, **Not checked** (no expected values) or **Could not run**, with a summary such as *24 scenarios run: 21 match the expected values, 2 differ, 1 could not run*, and **How values are compared**.

- The chips **All**, **Differs**, **Could not run**, **Matches** and **Not checked** filter the list.
- **Go to first difference** shows the first scenario that differs (or could not run) with its details open.
- **Details** lists each differing output with its expected and actual value (*not returned* when the run did not return it), or the reason a scenario could not run.
- **Load and run** loads that scenario into the form and runs it, so you see the full result with its checks.
- **Back to the list** returns to the scenario list.

A scenario with inputs the step does not have is reported as **Could not run**, naming those inputs, instead of being scored without them.

### Tests

A **Test** captures a CAS table reference and column-to-variable mappings. Instead of static values, the test points to a table that can be re-scored at any time.

**Saving a test (from Parallel CAS Table):**

1. In the CAS Table tab, select a table and give every input a column or **Send as missing** (constants cannot be saved in a test).
2. Click **Save as Test** (you do not need to run the batch first).
3. Fill in the dialog:
   - **Input Table** — Shown read-only, confirming the server, caslib, and table name.
   - **Name** — A name for this test.
   - **Description** — Optional description.
   - **SAS Content Folder** — Browse and select a folder (click "Select current folder" to confirm).
   - **CAS Output Library** — Choose where the output table will be written.
   - **Column Mappings** — A read-only summary showing each variable mapped to its CAS column, or *(missing)* for inputs sent as missing.
   - **Run the test now and show its output table and row count** — ticked by default: the test runs as soon as it is saved.
4. Click **Save and Run** (or **Save Test** when the box is cleared).

**Running the test:** with the box ticked — or with **Run test now** after saving — the dialog runs the test in SAS Viya (this can take a few minutes; **Stop waiting** stops waiting while the run continues in SAS Viya). It then shows the run's **State**, its **Output Table** and the **Output Size** in rows and columns; **Run again** runs it once more. The app reports the output table and its size only; it does not read or compare the scored rows, so review them in SAS Intelligent Decisioning or in the CAS table. If the run fails, SAS Intelligent Decisioning records no message of its own, so the dialog shows the **ERROR** lines of the run's SAS log instead (or, when there are none, its warnings or last lines).

**Loading a test:** **Load Test…** on the CAS Table tab lists the decision's CAS-table tests, with when each last ran, and selects the test's table and column mapping (see [Load Test](#load-test)).

Both Scenarios and Tests appear in SAS Intelligent Decisioning under the decision's test section, where they can also be executed and validated.

---

## 10. View API Call

Click **View API Call** in the scoring panel header to see ready-to-use code examples for calling the current module step from external code.

### Language Toggle

Switch between three languages:

- **Python** — Uses the `requests` library.
- **JavaScript** — Uses the `fetch` API.
- **SAS** — Uses `proc json` and `proc http` with `oauth_bearer=sas_services`.

### Mode Toggle

- **Single Row** — Code to score one row.
- **Parallel** — Code to score many rows from a CSV file with configurable concurrency. Python uses `ThreadPoolExecutor`, JavaScript uses a worker pool pattern, and SAS uses `proc ds2` with threaded HTTP requests.

Click **Copy Code** to copy the currently displayed example to your clipboard.

The code examples include the full API endpoint URL, request headers, a sample request body based on the actual step inputs, and response parsing logic.

---

## 11. View Source Code

Click **View Source** in the scoring panel header to see the DS2 source code of the current module. This is the code that MAS executes when the step is called. It is loaded on demand from the MAS API.

---

## 12. UI Apps

UI Apps let you build simple, purpose-built interfaces on top of any module. Business users can then score against the module using a clean form without needing to understand the underlying technical details.

### Creating a UI App

There are two ways to start:

1. From the **UI Apps** page, click **Create New**, then select a module.
2. From a Module Details page, click **Build UI**.

Both take you to the UI Builder.

### The UI Builder

The builder page is headed **Create UI App** (or **Edit: <app name>**) with the module's name below it. The breadcrumb **UI Apps** above the heading returns to the UI Apps list. The builder has three main areas.

**Toolbar (top):**

| Control | Description |
|---------|-------------|
| **Name** / **Description** | The app's name and an optional description |
| **Columns:** 1 / 2 / 3 | Set the number of form columns |
| **Output:** | Where outputs are shown: **Below** (in a separate section), **Side by Side** (inputs on the left, outputs on the right) or **Inline** (outputs among the inputs) |
| **Button:** | The text on the run button (default `Execute`) |
| Save status | **Unsaved changes**, **All changes saved**, or **Not saved yet** for a new app |
| **Undo** | Undo the last edit (**Ctrl+Z**); hover it to see which edit (e.g. *Undo: Remove field Age*) |
| **Share** | Open the Share dialog to copy a self-contained link or portable code for this UI (see [Sharing & Standalone Mode](#sharing--standalone-mode)) |
| **Replace / Re-sync Module** | Swap the underlying module, or re-read the current one, while preserving as much of the field configuration as possible (available when editing an existing app; see [Replace / Re-sync Module](#replace--re-sync-module)) |
| **Preview & Test Run** / **Back to Editing** | Switch between editing and a live run of the form |
| **Save & Run** | Save the app and open it in the runner |
| **Save** | Save the app and keep editing |

A UI App is deleted from the **UI Apps** list (see [Managing UI Apps](#managing-ui-apps)), not from the builder.

**Canvas (center):**

The canvas shows your form layout organized into **sections**. Each section has a title and contains one or more fields.

- Click **Add Section** (below the sections) to create a new section.
- **+ Add field** at the foot of a section lists the step's parameters that have no field yet and adds the one you pick. It is disabled when every parameter in the step signature already has a field.
- **+ Text Block** at the foot of a section inserts a static markdown text block (supports inline images).
- Use the **up/down arrows** on a section or a field to reorder it.
- Click the **X** on a section or a field to remove it; **Undo** restores it.
- A field is labelled **(required)** when it is marked Required, **Hidden** when it is not visible, and **Not in signature** when its parameter is no longer in the module's step signature.

**Field Configuration:**

Click any field to configure it. Each field has these properties:

| Property | Description |
|----------|-------------|
| **Direction** | Input (the user provides the value) or Output (shows results). Text blocks are static content |
| **Mapped Parameter** | The step parameter the field is bound to; its type and declared size are shown below it |
| **Section** | Move the field to another section |
| **Label** | Display name shown to the user |
| **Description / Help Text** | Help text shown below the field |
| **Widget Type** | The type of UI control (see below) |
| **Width** | 1/3, 1/2 or Full of the section width |
| **Visible** | Whether the field is shown in the form. A hidden input with a default value is sent on every execution |
| **Placeholder** | Hint text shown when the field is empty |
| **Default Value** | Pre-populated value, stored by the parameter's type: a number for a numeric parameter, comma-separated values sent as an array for an array parameter, and text exactly as typed for a string parameter |
| **Required** | The app will not run until this field has a value |
| **Value when on** / **Value when off** | For a Toggle: what it sends (default `1` / `0` for an integer input, `Y` / `N` for a string input) |
| **Max length** | For Text Input and Text Area on a string input. Empty uses the size the step signature declares |
| **Min** / **Max** / **Step Size** | For Number Input and Slider. Min and Max are checked before the app runs; Step Size is how much the arrow keys (or the slider) change the value |

### Widget Types

| Widget | Use For | Configuration |
|--------|---------|---------------|
| **Text Input** | Free-text string inputs | Max length (default: the size in the step signature) |
| **Number Input** | Numeric inputs | Min, Max, Step Size |
| **Slider** | Numeric inputs with a visual range | Min, Max, Step Size |
| **Dropdown** | Picking from a fixed list | Options (label/value pairs) |
| **Radio Buttons** | Picking from a small set of options | Options (label/value pairs) |
| **Toggle Switch** | On/off flags on integer or string inputs | Value when on / off (default `1` / `0`, or `Y` / `N` for a string) |
| **Text Area** | Multi-line text inputs | Max length (default: the size in the step signature) |
| **Read Only** | Displaying a value the user cannot change | — |
| **Gauge** | Visualizing a numeric output as a dial | Min, Max, Color stops |
| **Badge** | Displaying a status label with color | Value mappings (value to display text) |
| **Hidden** | Sending a fixed value without showing it | Default value (sent on every execution) |
| **Markdown** | Displaying formatted text, instructions, or images | Markdown content with `![alt](url)` image support |

### Output Formatting

Output fields have additional options:

- **Decimal places** — Round numeric outputs to a specific number of decimals.
- **Value mappings** — Translate raw output values to user-friendly labels (e.g. map `1` to "Approved" and `0` to "Denied").
- **Gauge color stops** — Define ranges with colors (e.g. 0-30 green, 30-70 orange, 70-100 red).

### Saving and Leaving the Builder

- **Save** saves the app and keeps you in the builder (*Saved. You can keep editing.*); **Save & Run** saves it and opens it in the runner. The status next to the buttons reads **Unsaved changes** whenever the app differs from what was last saved.
- **Undo** (or **Ctrl+Z**, **⌘Z** on a Mac) reverses edits one at a time, newest first — adding, removing, moving and remapping fields and sections among them. While you type in a field, Ctrl+Z undoes the typing in that field instead.
- **Preview & Test Run** shows the form as it is now, unsaved changes included, and runs the **published module** in MAS when you execute it. A **Preview run** note says so; running a preview does not save the app. **Back to Editing** returns to the canvas.
- **Leaving with unsaved changes** — the breadcrumb, the sidebar (pages and recent items) and the browser's **Back** / **Forward** buttons ask **Leave without saving?** first: **Stay**, **Discard Changes**, or **Save and Leave**. In the browser and Job Execution versions, reloading or closing the tab shows the browser's own leave prompt. **The desktop app does not prompt when its window is closed**: unsaved changes are then lost, so save before closing it.

### When the Module Changes

The builder compares the app's fields with the module's current step signature. When they differ, a banner above the toolbar lists:

- **New inputs with no field** — sent as missing (null) until you add them.
- **New outputs with no field.**
- **Fields for parameters the signature no longer lists** — these are not sent.

**Add to section…** adds a field for every new parameter to the section you pick (or a **New section**), and **Remove orphaned fields** removes the fields whose parameters are gone; **Undo** reverses either. The banner can be dismissed. To re-read the module (for example after it was republished), use **Replace / Re-sync Module** and pick the current module again.

### Running a UI App

From the **UI Apps** list, click **Run** on any app. The runner displays the form as configured in the builder.

1. Fill in the input fields.
2. Click the run button (its text is set with **Button:** in the builder; default `Execute`).
3. Output fields update with the results.
4. Click **Clear All** to reset the form and start over.

**Checks before running:** the runner checks every visible, editable input before anything is sent to MAS. It checks the type and size the step signature declares (a number for a numeric input, a whole number for an integer input, numbers in a numeric array, a string no longer than its declared size) and the field settings from the builder (**Required**, **Min**, **Max**, **Max length**). Each problem is shown under its field — e.g. *Enter a whole number. The step signature declares this input as integer.* or *Use at most 8 characters (now 11).* — and a **Not run: check the highlighted fields** message counts them. These checks cover only the step signature's types and sizes and the app's field settings: they do not know the module's own rules, which run in MAS, so a value that passes them can still be rejected or produce an unexpected result.

**How values are sent:** each value is sent as its parameter's type. Text stays text (`"007"` stays `"007"`), numbers are sent as numbers and array inputs as arrays. A slider you have not touched sends the value it shows.

**When the module has changed:** if the app's fields differ from the module's current step signature, the runner says so in a banner (the app still runs): inputs in the signature with no field in the app are sent as missing (null), fields for parameters the signature no longer lists are not sent (inputs) or stay empty (outputs), and outputs the app does not show are named. Edit the app to add or remove those fields.

**Header actions in the runner:**

- **Standalone** — Switch to standalone mode (see below).
- **Edit** — Open the builder to modify the app.
- **Save to My UI Apps** — Appears instead of **Edit** when the app was opened from a shared link, whichever output layout the app uses. Saves the embedded definition into your own library (with a new ID) so you can keep and edit it. Opening the builder for an app that is not in your library shows **This UI App is not in your library**, explaining that you open the shared link, choose **Save to My UI Apps**, then edit your copy.
- **Back** — Return to the UI Apps list.

### Sharing & Standalone Mode

A UI App normally lives only in the browser where it was created (it is stored in that browser's local storage). To hand an app to someone else — or to move it between the desktop, Job Execution, and Webserver versions of MAS Scorer — use **Share**, which embeds the *entire app definition* into the link. The recipient does not need anything pre-installed; the link is self-contained.

> **Note:** The app still scores against a live module. Whatever server the link is opened against must have the same MAS module published, or the runner will report that the module could not be loaded.

**Standalone vs. Within MAS Scorer**

The Share dialog lets you choose how the app opens:

- **Standalone** — Removes the sidebar, header, and all navigation chrome, leaving only the UI App form centered on the page. Best for business users or for embedding in other tools. An **Exit Standalone** bar appears at the top to return to the full application.
- **Within MAS Scorer** — Opens the app inside the normal application chrome.

You can also switch to standalone at any time from the runner by clicking **Standalone** in the header.

**Two ways to copy from the Share dialog**

- **Full link (this server)** — A complete URL rooted at the server you are currently on. Use this when the recipient will open the *same* deployment.
- **Portable code (any target)** — Just the hash portion of the URL (for example `#/ui-apps/{appId}?def=...&standalone=true`). Because all three delivery targets use the same hash-based routing, you can paste this onto the end of *any* MAS Scorer URL — the desktop app, the Job Execution HTML, or the Webserver build — and it opens the same app. This is the recommended way to move an app between targets (e.g. build it in the desktop app, then paste the code onto your Job Execution URL).

The shared URL follows the pattern: `#/ui-apps/{appId}?def={encodedDefinition}&standalone=true`, where `def` carries the full, URL-encoded app definition and the optional `standalone=true` flag selects standalone vs. within-MAS-Scorer display.

### Managing UI Apps

The **UI Apps** list page shows all your apps as cards.

| Action | Description |
|--------|-------------|
| **Run** | Open the app in the runner |
| **Edit** | Open the app in the builder |
| **Duplicate** | Create a copy of the app (appended with "(Copy)") |
| **Export** | Download the app definition as a JSON file |
| **Import** | Upload a previously exported JSON file to create a new app |
| **Delete** | Remove the app (requires confirmation) |

### Replace / Re-sync Module

When editing an existing UI App, you can swap the underlying module without starting from scratch, or re-read the current module after it has changed:

1. Click **Replace / Re-sync Module** in the builder toolbar.
2. Browse and search modules. Use the type filter to narrow results. The app's own module is marked **(current: re-sync)** — pick it to re-read its current step signature.
3. Select the module and its step, then click **Next: Map Parameters**.
4. A parameter mapping screen (**Map Parameters**, or **Re-sync Parameters** for the current module) shows each current field next to a parameter of the module's step. The app auto-matches parameters by name. You can manually remap any field, or choose **(unmapped — will be removed)**.
5. **Parameters with no field** lists the step's parameters that no field maps to. Ticked ones are added as fields, in the section you pick under **Add to section** (or a **New section**); an input left out is sent as missing (null).
6. Click **Apply** to apply the changes (the button counts the mapped and added fields).

Fields that map successfully keep their widget configuration, labels, and settings. Unmapped fields are removed. **Undo** in the builder reverses the whole replacement or re-sync.

---

## 13. View Flows

The **View Flows** page lets you explore SAS Intelligent Decisioning decision flows as interactive diagrams.

### Flow List

The list page shows all decision flows in your environment. Use the search box to filter by name or description. Click a decision to open its flow diagram.

The **MAS module** column says whether each decision is published to MAS, from the decisions' completed publish records checked against the modules MAS has (one lookup for the whole list, so the column may show **Checking…** for a few seconds):

- **Published** with the module name — click the name to open the module in this app and score it. A **+N** marks other modules the decision was also published as. When MAS could not be asked, the link's tooltip says the module comes from the publish history and was not checked.
- **Not published** — no completed publish to MAS.
- **Module removed** — the decision was published, but MAS no longer has the module.
- **Unknown** — the publish history could not be read.

### Scoring a Published Decision

A decision's flow page shows, under its name, **Published to MAS as <module> — Score** when it has been published to MAS and MAS has the module. Click it to open that module in this app (its Module Details page), where **Execute** on a step opens the scoring panel. The button says more when it needs to:

- *Published …; the flow has been modified since, so the module runs the revision published then* — the flow was changed after it was published.
- *From the publish history; MAS could not be asked whether the module still exists.*
- **Also published as** lists other modules, and *Earlier modules no longer in MAS* names removed ones.
- **Not published to MAS**, or **Published to MAS as <module>, but MAS no longer has that module**, when there is nothing to score.

### Flow Diagram

The diagram renders the full decision flow with all node types:

| Node Type | Description |
|-----------|-------------|
| **Start / End** | Entry and exit points of the flow |
| **Sub-Decision** | A nested decision flow (expanded recursively up to 3 levels deep) |
| **Rule Set** | Business rules with conditions and actions. The node shows the rule count and the rule set type (*assignment* or *filtering*); a red **⚠** badge means SAS Intelligent Decisioning reports one or more of its rules as invalid — a missing lookup table, for example |
| **Model** | A published model |
| **Code File** | Custom code (DS2, Python, SQL) |
| **Condition** | A branching point based on a condition |
| **Assignment** | Variable assignment nodes |
| **A/B Test** | Random split for testing |
| **Parallel Process** | Nodes that run concurrently |
| **Record Contact** | Contact history recording |
| **Treatment Group** | Treatment assignment |
| **Segmentation Tree** | Decision tree segmentation |
| **REST API** | A call to an external service, defined as a REST API definition (the node shows the HTTP method and endpoint host) |

**Diagram controls:**

- **Pan** — Click and drag the canvas.
- **Zoom** — Scroll wheel, or use the +/- controls in the bottom-left.
- **Fit View** — Click the fit-to-screen button to zoom the entire flow into view.
- **Mini Map** — A small overview in the bottom-right corner for navigation.
- **Legend** — Toggle the legend to see what each node color and shape represents.
- **Keyboard** — Tab to a node and press **Enter** or **Space** to open its details, as a click does. The selected node has a clear ring, and it is centred when its details open.

### Find Node

The **Find node** box above the diagram (*Name, type or expression*) filters the nodes by name, node type, expression, or the sub-decision they sit in, and lists the matches (*12 matching nodes*; the first 50 are listed, so type more to narrow a long list). Pick one with the mouse, or with **↑** / **↓** and **Enter**: the diagram zooms to that node and opens its details. **Escape** closes the list.

### Where Is This Variable Used

Select a variable name to see which nodes use it. Variable names are selectable in the decision header's **Variables (N)** section, in a rule set's reads and writes in the side panel, and in a node's mappings and an assignment in the side panel. The diagram then:

- marks the nodes whose own rules or terms **write** it (solid outline), **read** it (dashed outline) or both (double outline), and the nodes it is only **mapped into or out of** (dotted outline), each with a tag (**Reads**, **Writes**, **Reads + writes**, **Mapped in**, **Mapped out**, **Mapped in + out**), and dims the rest;
- shows a summary bar above the canvas (*Where `Score` is used: 2 writes · 3 reads · 1 mapped · 4 not checked*) with **Clear trace**;
- lists the nodes in the side panel under **Where `Score` is used** — **Read or written by its rules or terms**, **Mapped into or out of**, and **Not checked** — and each entry takes you to its node.

Select the same name again, click **Clear trace**, or press **Escape** to stop.

**What the trace knows — and what it does not.** This is lineage from the decision's metadata, not an execution trace. Rule sets, branch conditions, assignments and record contact are read from the terms SAS Intelligent Decisioning records for them. Code files, models, REST calls, treatments, segmentation trees and sub-decisions are shown by their input and output mappings only: they may use a variable internally in ways the app cannot see. Nodes of those kinds with no mappings at all are listed as **Not checked**, because the app cannot tell whether they use the variable. Free-text expressions are not read. The trace does not show which rule fires or what value results, and a write inside a rule happens only when that rule's conditions are met.

### When Referenced Objects Cannot Be Loaded

If a sub-decision, rule set or REST API definition the flow refers to cannot be loaded, the page says so — *2 referenced objects could not be loaded* — and lists each one with the reason. Their nodes are marked **Unavailable**: a sub-decision is not expanded, and a rule set or REST API node has no badges, so the diagram may be missing parts of the decision. **Retry** loads them again; **Copy details** copies the error for a support ticket.

### Node Details Side Panel

Click any node in the diagram to open a side panel with detailed information:

- **Rule Sets** — Shows the rules as the chain they are: numbered in execution order, each starting with `IF`, `ELSE IF`, `ELSE` or `OR`, its conditions joined by `AND`, and its actions under `THEN`. Every condition and action is tagged with its kind — Comparison, Expression, Lookup, Assignment, Lookup value or Advanced list — and names the lookup table or advanced list it reads, so `JOB in HMEQ_job` tells you exactly which table the rule depends on. Above the rules the panel lists the decision variables the rule set **reads** and **writes**, the **lookup tables & lists** it depends on, and — if the service reports any rule as invalid — the message it gives, so a broken reference is visible before the decision is published. Rules that record rule-fired tracking are marked *tracked*.
- **Models** — Shows the algorithm, input/output variables, and model properties.
- **Code Files** — Shows a preview of the code with a button to open a full syntax-highlighted viewer.
- **Treatment Groups** — Shows member definitions, attributes, and eligibility criteria.
- **Segmentation Trees** — Shows the tree's size (splits, paths, outcomes), its signature and an **Open in Segmentation Tree Explorer** button; the explorer is where the tree itself is navigated (see [Segmentation Tree Explorer](#14-segmentation-tree-explorer)).
- **REST API definitions** — Shows the HTTP method and the endpoint with its `{placeholders}` highlighted, the authorization type, query parameters, request and response headers, the request body and the definition's signature. Each parameter and header row also names the decision variable its placeholder is bound to, so you can see what actually gets sent.

Where applicable, the side panel includes deep links to open the asset directly in SAS Intelligent Decisioning or SAS Model Manager.

### Code Viewer

When viewing a code file node, click the code link to open a full-screen code viewer with syntax highlighting for Python, DS2, SQL, and other languages. Press **Escape** to close.

### Workflow History

If the decision has an associated workflow, the flow header shows the current workflow state and last modifier. Click the workflow indicator to open a timeline view showing all state transitions — who made each change, when, and any comments.

### Export

Click **Export Markdown** to generate a Markdown document with a Mermaid diagram of the flow and enriched node details. Rule set sections show the same execution-order chain as the side panel, with the reads/writes lists and any validation messages. Two inventory tables precede the diagram: **Rule Sets** (every rule set the decision executes, with rule count, type, version and validation status) and **Lookup Tables & Lists** (every lookup table and advanced list those rule sets read, and which rules use them). If the decision calls any REST API definitions, the document also contains an **External Endpoints** table listing every outbound call — the node, HTTP method, endpoint, authorization type and definition version. Together these three tables are the decision's external dependencies, which is useful for review and governance. The export reuses everything the page has already loaded, so it does not re-request rule sets or REST definitions.

A **Variable Usage** table lists every variable with its direction and the nodes that write it, read it, or have it mapped in or out, followed by the nodes that are **Not checked** (no mappings declared, so they may use any variable). It is the same lineage as [Where Is This Variable Used](#where-is-this-variable-used), with the same caveat at its top: it comes from the decision's metadata, not from an execution; it does not show which rule fires or what value results; and code files, models, sub-decisions, REST calls and other mapped nodes are shown by their mappings only.

**When details are missing:** if parts of the flow could not be loaded from SAS Viya, the file opens with an **Incomplete Sections** list naming each affected section and why, and each of those sections starts with an *Incomplete section* note; the page says *Exported with N missing details; see "Incomplete Sections" at the top of the file.* Export again to retry. If the export fails altogether, **The Markdown export failed** shows the error instead of nothing happening.

---

## 14. Segmentation Tree Explorer

The **Segmentation Trees** page is built for trees too large to read in SAS Intelligent Decisioning's canvas — thousands of paths, hundreds of outcomes. Instead of drawing the whole tree it shows one split at a time, the path that leads to it, and an index of every outcome, so you can go from "which records end up in Scenario_75?" to the exact conditions in a click.

### Tree List

Lists every segmentation tree in the environment; search by name or description and click a tree to open it.

### Reading the Page

- **Header** — name, description, version and counts (splits, paths, outcomes), a link that opens the tree in SAS Intelligent Decisioning, **Test whole tree…**, **Tests on this tree…**, **Find path for a record…** and **Export paths (CSV)**.
- **Find bar** — above the centre view: find in the tree and step through matches, paths, dead ends or failed paths, with the **Variables** summary below it (see [Find in Tree](#find-in-tree)).
- **Breadcrumb** — the path from the top of the tree to where you are. Click any step to jump back to that level. The **▾** beside a step lists the other branches at that level (with how many paths sit below each, or the outcome it assigns) and switches to one of them, so you can move sideways without climbing back up.
- **Centre: Split, Outline, Diagram or Icicle** — four ways to look at the tree (see below). All three follow the same selection, so the breadcrumb and path panel always describe what you clicked last.
- **Left: Outcomes** — every outcome with its output values and how many paths reach it. Search by name or value, group by an output variable (e.g. `ScenarioGroup`), or filter to outcomes with failed or unreachable paths. Clicking an outcome reached by one path jumps straight to it; an outcome reached by several paths expands to list them, showing the conditions **every** path shares once and only what differs under each path.
- **Right: the path panel** — the conditions that lead to the selected point, the outcome and the values it assigns, and — after a test run — whether that path passed.

The page address carries your position (`?at=…`), so the browser's Back button walks back through your jumps and a copied link opens the same node.

### Split, Outline, Diagram and Icicle

- **Split** shows one split at a time: the variable being tested and its branches *in the order SID tests them*. The first branch whose condition matches wins, which is why order matters. Each branch shows where it leads (another split, or an outcome) and how many paths and distinct outcomes lie below it. Click a branch to go into it.
- **Outline** shows the whole tree as an indented list, like a file explorer. Each row is a branch — `variable: condition → next split or outcome` — with its path count and any unreachable, failed or passed counts. Click the arrow to open or close a branch and the row to select it. From the keyboard: **↑/↓** move, **→** opens a branch or steps into it, **←** closes it or steps out to its parent, **Enter** selects.
- **Diagram** draws the tree left to right as boxes and lines: blue boxes are splits, teal boxes outcomes, and a dashed box is a collapsed part of the tree marked **+ N paths**. The path to the selected node is drawn in blue, and a line's thickness shows how many paths run through it, so the busy routes stand out. Click a node to select it; click a collapsed node to open it, and click the selected node again to close it. Pan by dragging, zoom with the wheel or the +/− buttons, and use the minimap for the overview.

- **Icicle** shows the whole tree's shape at once: one row per level, and each block's width is its share of the paths, as in Visual Analytics' decision tree. Hover a block for its condition, path and outcome counts; click it to select it and zoom in so that it fills the width (**Zoom out one level** goes back). From the keyboard, focus the chart and use **↑** (parent), **↓** (first branch) and **←/→** (siblings). **Shade by** colours the blocks:
  - **Splits and outcomes** — the structure.
  - **Share of an output value** — pick an output and a value (e.g. `ScenarioGroup = 14`); each block is shaded light to dark by the share of its paths that assign that value, so you can see where in the tree a group comes from. The output with the fewest distinct values is picked first.
  - **Dead ends** (and **test results** after a test run) — the dead-end or failed paths in a strong colour, the blocks leading to them in a light tint.

Large trees are not opened all at once. On load the Outline opens the top levels until about 150 branches are showing and the Diagram until about 40; everything deeper stays collapsed until you open it. Selecting a node anywhere opens the tree up to it. **Open one more level**, **Collapse all** and **Reset** (back to the starting view) apply to the tab you are on, the Outline also has **Expand all**, and while either tab is open the outcome list moves below the tree to give it the width.

### Find in Tree

The find box above the tree (*Find variable, condition or outcome...*) searches split variables, branch conditions and outcomes. Matches are marked in the Outline and the Icicle, and the selected match is shown in every view.

**Previous** / **Next** step through a list, chosen with **Step through**:

- **Find matches** — the find results (*Match 3 of 12*).
- **All paths (N)** — every path in the tree's order.
- **Dead ends (N)** — the unreachable paths, when the tree has any.
- **Failed paths (N)** — after a test run whose results are on show.

Stepping works in both directions. In the find box, **Enter** / **Shift+Enter** go to the next / previous match; anywhere on the page, **Alt+↓** / **Alt+↑** go to the next / previous item in the chosen list. **Shortcuts** next to the buttons lists these keys.

**Variables (N)** below the find bar opens a summary of every variable the tree splits on: its type, how many splits test it, at which levels, and its cut points or values (branches whose condition could not be read are counted as *not read*). **Find** on a row searches the tree for that variable.

### Merged and Raw Conditions

Strategy trees often test the same variable several times on one path. **Merged** (the default) folds those into one condition per variable — `17 ≤ SCScore01Risk < 600`, `CQWorstCycleDelqProd < 21 or missing` — taking into account that a branch only receives what its earlier siblings did not catch. **Raw steps** lists every split exactly as SID labels it. The choice is remembered.

Missing values follow SAS rules: a missing number is lower than any number, so a branch such as `< 1` also catches missing values, and the *Other* branch catches everything the branches above it did not.

### Copying a Path

**Copy ▾** in the path panel copies the selected path as:

| Format | Use |
|--------|-----|
| **Path as text** | One line, breadcrumb style, ending in the outcome and its values — for chat and tickets |
| **SAS condition** | A `WHERE` / DS2 expression selecting exactly the records that take the path — paste it into a query or a rule |
| **Markdown table** | The numbered conditions plus the outcome |
| **Sample input (JSON)** | A record that takes the path |
| **Link to this node** | A link that opens the explorer on this node |

### Unreachable Paths

A branch is a **dead end** when no record can ever reach it. Usually the same variable is tested twice on one path with ranges that contradict each other — for example `CQWorstCycleDelqProd < 22 or missing` at step 5 and `CQWorstCycleDelqProd >= 22` at step 16 — which typically happens when a strategy table is turned into a tree. Less often, a branch sits below siblings that already catch every value it accepts.

Dead ends do not break scoring: every record still gets an outcome from another branch. But the outcome at a dead end never fires from there, which is almost always not what the strategy intended.

The page finds them when the tree loads. A banner says how many there are, with a real example from the tree; **Show** lists every dead end with the steps that conflict. Opening one shows, in the path panel, **why** no record can reach it — the conflicting steps, each a link that shows that split — and **how to fix it** in SAS Intelligent Decisioning: delete the dead branch if it should not exist (nothing changes for scoring), or correct the range at the earlier step if it should. Dead ends are marked *Unreachable* in every view, in the outcome index and in the CSV export, and are left out of generated tests.

### Exporting All Paths

**Export paths (CSV)** writes one row per path: its number, one column per variable with the merged condition, the outcome, its output values and whether the path is reachable — effectively the strategy table rebuilt from the tree, which makes it easy to compare against the spreadsheet a tree was built from.

### Find Path for a Record

**Find path for a record…** predicts which path a record takes. Enter the record as **JSON** — paste it in the format **Copy → Sample input (JSON)** produces (numbers as JSON numbers, text in quotes, `null` for missing) — or as a **Form** with one field per variable the tree tests (blank is missing). **Start from Path N's sample input** fills it from the selected path. Tick **Take variables that are not in the record as missing** to carry on where the record has no value; otherwise the prediction stops there. Click **Predict path**.

The result is labelled **Predicted path — from the tree's conditions, not executed by SAS**. It names the path and its outcome with the values it assigns, and lists each step: the variable, its value, and every branch tried in order — *does not match*, or *matched, taken* (the first branch that holds wins, and **Other** takes whatever reaches it). **Show the predicted path on the tree** selects the path.

**This is a prediction, not a SAS run.** The page reads the tree's branch conditions; it does not run or imitate the code SAS Intelligent Decisioning generates. Wherever it cannot be sure, it stops — **Stopped at step N: cannot decide** — marks that step **Not decided**, and says why. It stops at:

- an expression, or a branch condition it could not fully read;
- a variable that is not an input in the tree's signature (a function or a derived value), or that the record does not carry;
- a type mismatch — text for a number, a number for text, a decimal for an integer; nothing is converted;
- a SAS special missing value given as text (`.`, `.A`–`.Z`, `._`) — give `null` for missing;
- a number within rounding distance of a cut point, but not equal to it;
- text that differs from a branch value only in upper or lower case or in leading or trailing blanks, a value with leading or trailing blanks, and a branch value that is blank or looks like a list or an expression.

If no branch matches and the split has no Other branch, it says the record leaves the tree there without an outcome. **Show where it stopped** selects that point on the tree. The prediction cannot prove which path SAS takes; a real run — a test (see [Testing Paths](#testing-paths)) or a scored record — only shows the outcome SAS produces.

### Testing Paths

**Test this path…** (path panel), **Test N paths…** (any point in the tree), **Test all N paths…** (an outcome) and **Test whole tree…** (header) open the same dialog for that set of paths.

**1. Review rows.** One record is generated per path: inputs that take the path (the lower bound of each range where possible) and, as expected values, the outputs the path's outcome assigns. Unreachable paths are left out and named. Every cell can be edited; **Add row** adds a record of your own, the trash icon or **Delete selected** removes rows, and **Reset to generated** starts over. A blank input is a missing value; a blank expected value is not checked.

**2. Save to SID.** Choose what to create:

- **One table test with all rows** — the rows are uploaded to a CAS table in the caslib you pick (and saved there, so the test still works after a CAS restart) and a test is created on the tree in the folder you pick. The table also carries a `_pathId` column and one `expected_<output>` column per output, which SID copies into the test's output table. If a table of that name already exists, tick **Replace it** or choose another name. With **Run the test now** ticked, the app runs the test, reads the output table and compares every row with its expected values.
- **One scenario per selected row** — each selected row becomes a SID scenario with its inputs and expected outputs (a single row keeps the name you type; several are suffixed `_Path_<n>`). Run them from the tree's **Scenarios** tab in SAS Intelligent Decisioning.

The folder and caslib you pick are remembered for next time.

**3. Result.** For a test run, the dialog reports how many rows passed and failed, and the results are applied on the tree as soon as the comparison finishes — however you close the dialog (**Close and view on the tree**, **Close and show failed paths**, **Escape**). On the page, branches show passed and failed counts for everything below them, the outcome index can filter to outcomes with failures, a banner offers **Next failed path**, and the path panel of a failed path lists each output with its expected and actual value.

The last test results are kept for the browser session for that revision of the tree, so they are still there after you leave the page and come back; a new revision of the tree starts without them. Dismissing the results banner hides them, and **Show last test results** in the header brings them back.

**When a run fails.** SAS Intelligent Decisioning records no error message for these runs, so the dialog reads the run's SAS log and shows its **ERROR** lines (or, when there are none, its warnings or last lines). Below them are the **Full log**, **Download the log**, **Open the log in SAS Viya** and a link that opens the tree's tests in SAS Intelligent Decisioning.

### Tests on This Tree

**Tests on this tree…** lists the tests and scenarios saved on the tree in SAS Intelligent Decisioning. Each one shows the tree revision it is pinned to — **Revision 2.0 (current)**, or **Older revision 1.0** in a warning colour — because a test scores the revision its definition names, not necessarily the one on screen.

For each **table test**:

- **Show last results** reads the output table of the test's last completed run and shows the results on the tree. If none of the recent runs completed, or the output table is gone (for example when its CAS session ended), it says so and suggests running the test again.
- **Run again** runs the test and shows the new results on the tree. For a test pinned to an older revision, **Run on the current revision…** offers **Move and run** (changes the saved test in SAS Intelligent Decisioning so it tests the current revision, then runs it; its rows and expected values stay as saved) or **Run on its own revision**.

Result rows are matched to paths by their `_pathId`. Rows whose path is not in this revision of the tree (removed, or split further) are counted and flagged, not shown on it. Closing the dialog during a run stops waiting; the run continues in SAS Viya.

**Scenarios** are listed with their revision, but keep their expected values in the scenario rather than in an output table, so they are run and checked on the tree's **Scenarios** tab in SAS Intelligent Decisioning.

---

## 15. Test Coverage Analysis

The **Test Coverage** page helps you understand which of your SAS Intelligent Decisioning and Model Manager assets have test scenarios defined.

### Running an Analysis

1. Navigate to **Test Coverage** in the sidebar.
2. Click **Start Analysis** (or **Re-run Analysis** if you have previous results).
3. The app collects all assets from your environment:
   - Decisions
   - Business Rules
   - Code Files
   - Treatment Definitions
   - Segmentation Trees
4. It then cross-references these against Score Definitions to determine which assets have test scenarios.
5. A progress indicator shows the current phase and item count.

**While it runs:** you can leave the page — the analysis carries on and is shown again when you come back to **Test Coverage**. **Cancel** stops it (*Analysis cancelled.*). During a re-run, the previous results stay on screen below the progress indicator until the new run finishes; if the re-run fails or is cancelled, they stay, marked as the results of the previous analysis.

**What counts as a test:** a score definition counts when SAS Intelligent Decisioning marks it as a test (the `test` property) or a scenario (`inputData.type = Scenario`); its name does not count. Score definitions in the trash do not count, and publishing validations are never counted. The **Data collection** section (below) states how many tests and scenarios were counted, out of how many score definitions.

### Reading the Results

**Gaps in the collection:** if a collection could not be read (HTTP 403, 404 or another error) or stopped at the page limit, a warning above the results lists it — the figures then cover only what was collected. A type that could not be read stays in the bar chart as *not collected*, with *n/a* and no bar, and is left out of the totals. If the score definitions themselves could not be read, coverage is unknown: the gauge, the **With Tests** / **Without Tests** cards and every type show *n/a* instead of a misleading 0%, while the asset counts are still listed.

**Data collection:** the expandable **Data collection** section under the bar chart (*complete*, or *N incomplete*) lists every collection with its status — **Complete**, **Truncated** or **Not collected** — and how many items were read: *330 of 330*, or *loaded N (no total reported)* where the service does not report a total, as for score definitions. Its last line is the count of tests and scenarios used for coverage.

**Summary Dashboard:**

- **Coverage Gauge** — A circular gauge showing overall coverage percentage.
- **Stat Cards** — Total assets, assets with tests, and assets without tests.
- **Test Health** — How the covered assets' tests stand (see below).
- **Coverage by Asset Type** — A bar chart showing coverage percentage for each asset type (Decisions, Business Rules, Code Files, etc.), color-coded by coverage level.

**Test Health:**

For each test, the analysis looks up its **last run** — the state SAS recorded for the newest score execution of that test, with its date — and whether the asset **changed since the test**. Covered assets then roll up as:

| Health | Meaning |
|--------|---------|
| **Healthy** | No test's latest run failed, and at least one completed |
| **Failing** | A test's latest run failed |
| **No finished run** | No completed or failed run recorded |
| **No run in scan** | No run was found within the scan limit; a run may exist further back (**Runs not read** when the executions could not be read) |
| **Changed since tests** | Every test of the asset predates its current state |

Read these words exactly as meant:

- **"Completed" means the run finished, not that its expected values matched.** The app reads the state SAS recorded; it does not compare the run's output with expected values, so a Healthy asset can still have tests whose results differ.
- **"Changed since test"** means the test targets another revision than the asset's current one, or the asset was modified after the test was created. It does not mean the test would now fail.
- **The scan of runs has a limit.** Runs are read newest first, up to the 3,000 newest score executions. When the limit is reached, the card says so (*Latest runs found for 40 of 52 tests, from the 3,000 newest score executions (the scan limit).*), and a warning above the results explains that tests showing **No run in scan** may have a run further back. If the score executions could not be read, a warning says so; coverage itself is not affected.

**Show the N covered but failing or changed** in the card (or the **Coverage** filter below) narrows the table to the assets at risk; **Show all assets** goes back.

**Detail Table:**

The table lists every asset with columns for Name, Type, Coverage status, number of Tests, Test health (with a **Changed since tests** marker), Created By, Modified date, and links.

- **Search** — Filter by name or author; the table updates shortly after you stop typing.
- **Type filter** — Show only a specific asset type.
- **Coverage filter** — Show All, Covered only, Uncovered only, or **Covered, but failing or changed since tests**.
- Click a column header (or Tab to it and press **Enter**) to sort.
- The table is paginated; expanded rows stay expanded when you page away and back, and **Export CSV** always includes every filtered row.

**Expanding a Row:**

Click the chevron on any covered asset to expand it and see its individual test scenarios — the name, type, **Last run** (the recorded state, such as *Completed* or *Failed*, with its date, or *No run recorded* / *No run in the 3,000 newest runs*), **Changed since test** (e.g. *Targets revision 1a2b3c4d; the asset is now at 5e6f7a8b*, or *Asset modified …, after this test was created …*; *None shown in the metadata* otherwise), and description.

**Deep Links:**

Each asset row has a link icon that opens the asset in SAS Intelligent Decisioning. Decision assets also have a flow icon that opens the in-app flow viewer, and — when the decision is published to a module MAS has — a **Score** icon that opens that module in this app (see [Scoring a Published Decision](#scoring-a-published-decision)). Segmentation trees have an icon that opens them in the [Segmentation Tree Explorer](#14-segmentation-tree-explorer).

### Exporting

- **Export CSV** — Downloads a `test-coverage.csv` file with all assets and their coverage status, including **Test Health**, **Changed Since Tests**, **Latest Run State** and **Latest Run** columns.
- **Export Markdown** — Downloads a formatted `test-coverage-report.md` with the full analysis, including a **Test Health** section (with the same notes on what "completed" and "changed since tests" mean), a **Data Collection** section (what was read and what was counted as a test) and a warning at the top when the collection was incomplete.

---

## 16. Publishing Overview

The **Publishing Overview** page answers "what is deployed where?" for the whole environment: every publishing destination (MAS, CAS, container and other destinations) and every model and decision that has been published to it.

### While It Loads

The page reads the destinations and the complete list of deployed items. A progress card shows the two loads as they arrive — **Destinations (9)**, **Deployed models & decisions (424)** — so you can see it advancing; on a typical environment this takes a couple of seconds. The three summary figures show a dash until the data is in.

### Summary and Destinations

- **Stat cards** — the number of publishing destinations, deployed models and deployed decisions.
- **Destinations** — one row per destination with its type and how many models and decisions it holds. Click the chevron (or Tab to it and press **Enter**) to expand a destination and see what is deployed there.

### Deployed Models & Decisions

The table lists every completed publish, deduplicated to the latest version of each item per destination, with the name, kind (model or decision), destination, code type, who published it and when.

- **Search** filters by name; **Kind**, **Destination** and **Code Type** narrow the list. Any filter returns you to page 1, and **Showing X of Y** always counts the whole filtered list.
- The table is paginated (25 rows per page) with **Previous** / **Page X of Y** / **Next**.
- A deployed **model** links to its Module Details page in this app; a deployed **decision** links to the in-app flow viewer, so you can go from "it is deployed" to "what does it do" in one click.
- **Refresh** in the page header re-reads everything; the data is otherwise cached for the session and cleared when you switch connections. While it reloads, the figures and the table — with its search, filters and page — stay on screen, and the text beside the button reads **Refreshing…**, then **Data as of 14:05** (the time the data was loaded).

---

## 17. Job Monitoring

The **Job Monitoring** page gives you a live view of every job executed by the SAS Viya Job Execution service. Use it to watch active runs as they happen, drill into a job's log or final output, and search the full history.

### The Overview Page

**KPI Cards** sit at the top. Except **Active**, they cover the period chosen with the **Statistics for** chips above them: **24 hours**, **7 days** (the default), **30 days** or **All**. The period is kept in the page link (`?period=30d`, for example), and switching back to a period already counted this session is instant.

- **Total Jobs** — every job created in the period. Shows a `+` suffix (and *most recent*) when the count stopped at its cap of the 10,000 most recent jobs.
- **Active** — currently running and pending jobs. Always live (updates every 5 seconds with the running panel).
- **Completed** — successful jobs.
- **Failed / Other** — failures plus cancelled, timed-out, and other terminal states.
- **Avg Runtime** — average elapsed time of the completed jobs counted in the period.

When you open the page, choose a period or click Refresh, a **Counting jobs…** banner next to the chips shows how far the count has got (e.g. *Counting jobs in the last 30 days… 1,200 so far, back to 14 Oct, 09:30*). Several pages of jobs are read at a time, and the counts tick up as they arrive.

**Running Panel** shows one card per active job with:

- The job name and a state badge (pulsing for `running` / `pending`).
- Description, creator, type, start time, and a live elapsed timer that ticks every second.
- A **Monitor** button that opens the job's detail page.

This panel auto-refreshes every 5 seconds.

**History Table** lists every finished job, with:

- A debounced search box that filters on the server by job name.
- State filter chips: **All**, **Completed**, **Failed**, **Canceled**, **Timed Out**.
- 50 jobs per page, with **Previous** / **Next** buttons. The table walks as deep as the Job Execution API allows; the envelope `count` field is intentionally ignored because it can underreport on a busy tenant.
- Hover affordance on each row (the job name turns blue and underlined, a right-edge chevron slides in). Click anywhere on a row to open its details.

When you're on page 1 with no filter or search, the history table also auto-refreshes every 30 seconds. As soon as you apply a filter or page deeper, that auto-refresh pauses so the rug isn't pulled out from under you.

### Manual Refresh

Click **Refresh** in the page header to force-update all three sections. Stats refresh is **incremental** — it walks pages from the top and stops at the first full page where every job's ID and state match what was scanned previously. In the steady state, a refresh is just one HTTP call.

Automatic refreshing stops while the browser tab is in the background. Coming back to the tab refreshes the page at once (the statistics only when they are more than a minute old).

### Error Backoff

If a request to SAS Viya fails, that section retries by itself — after 5 seconds, 10 seconds, 30 seconds, then every minute — and returns to its normal refresh as soon as a request succeeds. Meanwhile the page shows a single banner:

> *Some data could not be refreshed from SAS Viya. Retrying automatically in 8 s. Last error: …*

Click **Retry now** in the banner (or the page-level **Refresh**) to try at once.

### Job Detail Page

Selecting a job opens its detail page at `/jobs/<id>`. The header shows:

- Job name and a state badge.
- Creator, type, start time, ID, and a live elapsed counter (running jobs).
- End timestamp and final elapsed (terminal jobs).
- For a failed job, the first error of its log: **First error (line N):** followed by the error text.
- A **← Back to Job Monitoring** link.
- A **Refresh** button that re-fetches the job record and log/listing for this one job.
- A red **Cancel Job** or **Delete Job** button (see *Cancelling or Deleting a Job* below).
- For a finished job, **Rerun** and **Rerun with changes…** (see *Rerunning a Job* below), and the **Application** that submitted it.

The open tab is part of the link (`?tab=code`, for example), so a reload, **Back** or a shared link shows the same tab.

#### Cancelling or Deleting a Job

The detail page exposes a single destructive action whose label depends on the job's current state. Both actions open a confirmation dialog before anything is sent to SAS Viya — clicking the red button alone never causes the action to fire.

**Cancel Job** — appears for any non-terminal job (`running`, `pending`, `paused`).

1. Click the red **Cancel Job** button.
2. A dialog appears: *"Cancel this job? You're about to cancel `<JobName>`. This will terminate the SAS session backing the job (if one is active) and mark the job record as canceled. This cannot be undone."*
3. Click **Cancel job** to proceed, or **Keep running** / press Esc to dismiss.
4. The app PUTs `state = canceled` on the Job Execution record *first*, then deletes the Compute session that's hosting the SAS process. (Doing the session delete first would cause Job Execution to mark the job as `failed` before our `canceled` PUT lands, and the state would be locked in.)
5. If the compute session is already gone, that step is skipped silently. Any other failure surfaces an inline red error in the dialog so you can retry.
6. On success the dialog closes, the page header flips to `canceled`, and the Log tab swaps from live tail to the saved log file.

**Delete Job** — appears for any terminal job (`completed`, `failed`, `canceled`, `timedOut`).

1. Click the red **Delete Job** button.
2. A dialog appears: *"Delete this job? You're about to permanently delete `<JobName>` from SAS Viya. The job record, its log, its listing, and any attached result files will be removed. This cannot be undone."*
3. Click **Delete job** to proceed, or **Keep job** / press Esc to dismiss.
4. The app issues `DELETE /jobExecution/jobs/<id>`. The record and all its attached files are removed from the tenant.
5. On success the app navigates you back to the Job Monitoring overview. The deleted job is also dropped from the in-memory cache so the KPI counts reflect the change immediately, without forcing a full re-walk of the job list.

Both dialogs are dismiss-blocking while the underlying request is in flight — you can't accidentally close them mid-request — and surface a red error banner if SAS Viya returns a failure.

#### Rerunning a Job

A finished job (`completed`, `failed`, `canceled`, `timedOut`) submitted from SAS Job Execution or SAS Studio — or whose request does not name the submitting application, which the dialog then notes — can be submitted again from its detail page:

- **Rerun** — a confirmation (*Rerun this job?*) says what will happen: the job is submitted again as a new job, under your user, with the same arguments as the original run; this job stays as it is. Click **Rerun job**.
- **Rerun with changes…** — the same, but first lists the original arguments (and the parameters the job definition declares) as fields you can edit. Changed fields are tagged **changed**, a parameter that was not passed originally shows its default, and the dialog counts the changed values. Click **Rerun with these values**.

When the original request named a job definition by URI, the rerun uses that definition as it is now, which may differ from the version the job ran — the dialog says so; otherwise it runs the same code the job ran. The new job opens at once with its live log.

Jobs submitted by other services — score executions and SAS Intelligent Decisioning tests, publishing validations, Model Studio pipelines and the like — are not offered a rerun: those services keep their own record of each run, so the page says *Rerun is not offered: it was submitted by …* and asks you to run it again from that application. A job whose stored request has neither a job definition URI nor the definition code cannot be rerun either, and the page says why.

The page has four tabs:

#### Log

Shows the SAS log output:

- **While the job is running** — live tail via the Compute API every 3 seconds. Only the tab you are looking at (Log or Listing) is fetched, and only while the browser tab is visible; a long backlog (opening a job that has already written thousands of lines, or coming back to the tab) is read straight through until it catches up. Auto-scroll keeps you pinned to the bottom; scroll up to read older lines and auto-scroll pauses, scroll back near the bottom and it resumes.
- **Once the job finishes** — the saved `.log.txt` file from the Files service is shown instead. The lines already on screen stay until the file has arrived.
- **A failed job** opens at its first error rather than at the end of the log.

Each line is colour-coded by type, with a tinted background and a coloured left border:

| Type | Colour |
|------|--------|
| **Error** | Red |
| **Fatal** | Red, bolder |
| **Warning** | Amber |
| **Note** | Blue |
| **Source code** | Cyan |
| **Title** | Green, larger and bold |
| **Message / Byline / Footnote** | Pink / Lavender / Purple |

Toolbar buttons:

- **Pause auto-scroll** / **Resume auto-scroll** — toggle whether new lines auto-scroll you to the bottom.
- **Copy** — copies the whole log text to the clipboard (no type prefixes — just the SAS content), whatever filter is set.
- **Download** — saves the log as `<JobName>-<8charId>.log`.
- **Refresh now** — force-fetch the latest log content. The lines already shown stay on screen while it loads.

**Finding errors:** the toolbar counts the lines, errors and warnings (e.g. *4,210 lines · 3 errors · 12 warnings*). Below it:

- **Show** — **All lines**, **Errors and warnings**, or **Errors only**. While filtering, each line keeps its line number.
- **Search the log…** — searches the whole log (within the current **Show** filter) and moves to the first match as you type. **Enter** goes to the next match, **Shift+Enter** to the previous one.
- **Previous** / **Next** — step through the search matches, or, without a search, through the errors (the warnings when the log has none). The position is shown beside them, e.g. *Error 2 of 10* or *Match 3 of 41*, and stepping wraps around at either end.

#### Listing

The Compute listing output (procedure output and the like). Same controls as the Log tab, except the error and warning tools (only the search and **Previous** / **Next** through its matches). The listing has its own type hierarchy: **title** lines render largest, **highlighted** lines (column headers, summary rows) at a medium size, normal lines at the base size. **Download** saves as `<JobName>-<8charId>.lst`.

#### Code

The full SAS source from the job definition, syntax-highlighted via Prism with a line-number gutter on the left.

- **Copy code** — copies the source to the clipboard.
- **Download** — saves as `<JobName>.sas`.

The line numbers are display-only — both Copy and Download produce the clean, runnable source.

#### Parameters

A table of every parameter declared on the job definition, paired with the value actually submitted at runtime:

| Column | Description |
|--------|-------------|
| **Name** | Parameter name, with the label as a sub-line if it differs |
| **Type** | Parameter type (`character`, `numeric`, etc.) |
| **Required** | Yes / No |
| **Default** | Default value from the job definition |
| **Argument** | The value passed in when the job was submitted, with an **overridden** badge if it differs from the default, or **extra** if it was supplied but never declared on the definition |

---

## 18. Schema → Code

The **Schema → Code** page generates a Python `execute()` function for SAS Intelligent Decisioning (SID) from a sample data payload, then lets you save it to SAS Viya. It is useful when an incoming request arrives as a single JSON or XML string and you need SID code that parses it into individual, typed variables.

The page is a three-step workflow shown as tabs at the top.

### Step 1 — Input Schema

1. Set the **Input variable name** — the name of the SID Character variable that will hold the raw string at runtime (default `input_string`).
2. Provide a sample payload one of three ways:
   - **Paste** JSON or XML directly into the text area.
   - **Upload file** — choose a `.json`, `.xml`, or `.txt` file.
   - **Load JSON sample** / **Load XML sample** — insert a built-in example to experiment with.
3. Click **Parse & extract variables**. The format (JSON or XML) is detected automatically.

### Step 2 — Variable Mapping

The detected variables are listed in a table:

| Column | Description |
|--------|-------------|
| **Source Path** | Where the value came from in the sample (dot notation for JSON, slash path for XML) |
| **Variable Name** | The generated SID variable name — editable, validated to ≤32 characters and a legal SAS identifier |
| **Len** | Current length of the variable name (turns red if over 32) |
| **SAS ID Type** | Inferred data type (Character, Integer, Decimal, Boolean, Date, Datetime) — change it with the dropdown |
| **Sample Value** | The value pulled from your sample |

A JSON number written with a decimal point (`100.00`) is inferred as **Decimal**, not Integer, so a later value such as `99.5` is not truncated.

Repeating elements (JSON arrays / repeated XML elements) become a **DataGrid** variable, with their child fields captured as grid columns. Use the **×** button to remove any variable you do not need. When the mapping looks right, click **Generate Python code**.

**Names that would break the code are blocked.** Each name is checked as you type, and problems are shown in place:

- **Errors** — a Python keyword (`class`, `return`, …), a duplicate (names are case-insensitive), a name the generated code itself uses (`parse_success`, `parse_status`), a name starting with `_sb_` (reserved for the generated code), or the same name as the input variable.
- **Warnings** — a DS2 reserved word; it is allowed, but SAS Intelligent Decisioning may reject it.

The **Input variable name** from step 1 is checked the same way. While any error remains, **Generate Python code** and **Save to SAS Viya** are disabled and a line next to them says why (e.g. *Fix 2 invalid variable names in step 2 first.*).

### Step 3 — Python Output

The generated `execute()` function is shown with syntax highlighting. The function initializes all output variables, guards against empty input, parses the string, and extracts each value with type casting and error handling (returning `parse_success` and `parse_status` alongside your variables). The code is regenerated from the current mapping after every edit, so the code, its signature and the `execute()` parameter always match what is saved.

For JSON, a field that is absent from the payload defaults on its own and does not void the other variables: `parse_success` stays `1` and `parse_status` lists the missing paths (`OK; absent: customer.phone, …`).

From here you can:

- **Copy to clipboard**
- **Download .py**
- **Save to SAS Viya** — opens the save dialog.

**Default unset variables to missing values** — by default, a variable that is absent from the payload (or fails to parse) is initialized to a neutral default: `0` for numbers and an empty string for text. Tick this checkbox to initialize them to a SAS **missing value** (Python `None`) instead, so a value that wasn't supplied comes back as missing rather than zero/blank. The variable types in the saved signature are unchanged either way.

**DataGrid outputs need an extra step.** A Python code node cannot output a DataGrid directly into SID — it can only return the grid as a *serialized JSON string* in a Character variable. When your mapping includes one or more DataGrids, this screen shows a note for each, with a ready-to-copy conversion statement. To turn the string back into a real DataGrid in your decision, add a **Rule Set** or **Variable Assignment** node *after* this code file and assign:

```
dataGrid_create(<grid_variable>, <character_output>)
```

where `<character_output>` is this code file's serialized string and `<grid_variable>` is a DataGrid variable in your decision. Make sure the Character variable's **length** is large enough to hold the full JSON — the generated signature uses the maximum (32672). If it is left at the default of 100, SID silently truncates the string and the conversion fails.

### Saving to SAS Intelligent Decisioning

The **Save to SAS Viya** dialog has two modes:

- **Create new** — enter a name (≤32 chars, letters/digits/underscore) and optional description, browse to a target **folder**, and click **Create code file**. The code is uploaded to the Files service and registered as a new Python code file in SID.
- **Update existing** — choose a **revision type** (minor or major), then browse the content tree and **select an existing code file**. Clicking **Save new revision** pushes the generated code to that code file as a new revision.

> **Why a revision for updates?** A code file's content lives in an attached file, and the SID "update" operation only changes a code file's name and description — it cannot replace the code. Creating a new revision is what actually publishes the new code, while preserving the previous version's history.

---

## 19. Business Rules Import

The **Rules Import** page imports SAS Intelligent Decisioning **rule sets** from CSV files — the same 15-column format used by the `%DCM_IMPORT_RULESET` macro and the rule export in SAS Intelligent Decisioning. Instead of importing blind and digging through a SAS log afterwards, you validate the file up front, fix problems directly in the grid, and see exactly what the server accepted or rejected.

The page is a four-step wizard. Click any enabled step in the step bar to move back and forth.

### Step 1 — Upload

- Click **Choose a CSV file** or drag & drop the file onto the drop zone — or Tab to the drop zone and press **Space** to open the file dialog. Files must be UTF-8 CSV with the standard header row (`ruleset_id,ruleset_nm,folder_path,…`).
- **Download template** in the page header produces an empty CSV with the correct header row.
- After loading, the page shows row, rule set, and rule counts and moves on to Review & Fix automatically. Files with a missing or wrong header are rejected here with an explanation of what was expected.
- A previously downloaded rejection file (which carries an extra reason column) can be re-uploaded as-is — the extra column is recognized and ignored.

### Step 2 — Review & Fix

Every row is shown in an editable grid, and every cell is re-validated as you type:

- **Errors (red)** block the import — missing required values, term names longer than 32 characters or using DS2 reserved words, invalid `conditional` / `expression_type` / data type values, non-contiguous rule sequence numbers, a first rule that is not `if`, ELSE rules with conditions, unbalanced quotes or parentheses in expressions, or one term used with two different data types within the same rule set.
- **Warnings (amber)** allow the import but deserve a look — a blank folder path, an expression longer than 4,000 characters, lowercase `expression_type`, unquoted string action values, the same rule set name under two folders, and similar.
- **Info (blue)** notes are advisory — for example uppercase variable names inside expressions (the documentation recommends lowercase).

Two shapes that look wrong but are perfectly valid are accepted as they are: rows whose **expression stands on its own**, with no data type or term — a free-form condition such as `sum(amount_a, amount_b) > 5000`, or an advanced action such as `DATAGRID_TOPN(...)` — and expressions that **span several lines**, which get a resizable multi-line cell editor.

Tools in this step:

- Hover a highlighted cell (or the marker in the row gutter — a red **×** for errors, amber for warnings, with the messages read out to screen readers) to read its messages. Every cell announces its column name and row number.
- **Only rows with issues** filters the grid down to problem rows.
- **Next error →** jumps to the next error cell, scrolls it into view, and places the cursor in it ready to type the fix.
- **Clear ID columns** blanks `ruleset_id` and `rule_id` on every row. A CSV exported from another environment carries that environment's ids; in the target they match nothing, so the service tries to *create* a rule set whose name and folder already exist and rejects the import. Without ids the import matches by name + folder and updates in place. The button shows how many rows still carry an id, and is disabled once both columns are empty.
- **Auto-fix formatting** normalizes what can be fixed mechanically: lowercases conditionals, uppercases expression types and flags, canonical data type casing, stray whitespace.
- **Download corrected CSV** saves the current state of the grid — including all your edits — as a clean CSV.
- Large files are paginated at 200 rows per page.

### Step 3 — Server Checks

**Continue to server checks** runs the checks automatically (you must be logged in). For every rule set in the file the app determines:

- **CREATE or UPDATE** — whether a rule set with the same name already exists in the target folder. Existing rule sets are **updated** with a new revision by the import; the current revision number is shown.
- **Folder existence** — missing SAS Content folders are flagged as informational only; the service creates them automatically during import.
- **ruleset_id conflicts** — files exported from *another environment* carry that environment's ids. If the target folder already contains a rule set with the same name but a different id, the service rejects the whole import. The app flags this as a blocking error and offers **Clear conflicting IDs**, which blanks the `ruleset_id` / `rule_id` columns for the affected rule sets so the import matches by name + folder and updates them cleanly. If you already know the file came from elsewhere, **Clear ID columns** in Review & Fix does the same for the whole file before you get here.

Edits that change rule set names or folder paths mark the checks as stale — rerun them before importing.

### Step 4 — Import

- The scope line shows what will be sent: all rule sets, or only the previously rejected ones on a retry.
- **Import…** opens a confirmation dialog listing every rule set with a CREATE / UPDATE badge. If any rule sets will be updated, you must tick an acknowledgment checkbox first — an update replaces the rule set content with a new unlocked revision.
- After the import, the results appear below: **imported** rule sets (green), **rejected** rule sets (red, with the server's reasons), and any global issues. Rejected rows are also tinted in the Review & Fix grid with the reasons attached to them.
- Each imported rule set shows its new **revision**, an **Open in SAS Intelligent Decisioning** link and **Show rules**, which displays the rule chain as it now stands on the server. The rule set is looked up by name and folder; if it cannot be found, the line says so.
- The server checks are refreshed automatically after an import, so the CREATE / UPDATE labels and the update acknowledgment are correct if you import the same file again.
- **Import again — rejected only** re-sends just the rejected rule sets after you fix them — rule sets that already imported are never sent twice (every import creates a new revision).
- **Download rejected rows (CSV)** and **Download server response** are available for offline analysis.

> **How matching works:** the import matches rule sets by **name + folder path**. If both match, the rule set is updated; otherwise it is created. Imported rule sets arrive as unlocked revisions.

---

## 20. Keyboard and Interaction Tips

The application meets **WCAG 2.1 AA**: every control can be reached and operated from the keyboard, has a visible focus ring, and has a name a screen reader can announce.

- **Tab** / **Shift+Tab** move between controls everywhere — including table rows that open something (the row's name is the button), sort headers, file drop zones, the sidebar and the icon buttons. The focused control shows a blue ring.
- **Enter** or **Space** activates the focused control; **Space** toggles a row checkbox.
- In any dialog, **Escape** closes it, **Tab** stays inside it, and focus returns to the control that opened it when it closes. A click on the dark area outside the dialog also closes it.
- **Escape** also closes the navigation drawer on narrow layouts. In View Flows it first clears a variable trace, then closes the node details panel.
- In View Flows, **Enter** or **Space** on a focused node opens its details, as a click does; in **Find node**, **↑**/**↓** and **Enter** pick a match.
- In the Segmentation Tree Explorer, **Enter** / **Shift+Enter** in the find box go to the next / previous match, and **Alt+↓** / **Alt+↑** anywhere on the page step through the chosen list (matches, paths, dead ends or failed paths).
- In the UI Builder, **Ctrl+Z** (**⌘Z** on a Mac) undoes the last edit when you are not typing in a field.
- Menus (**Copy ▾**, the breadcrumb's **▾** branch lists) open with **Enter**, **Space** or **↓**; **↑**/**↓**, **Home** and **End** move between items, **Enter** picks one and **Escape** closes the menu.
- Severity and status are never conveyed by colour alone — error rows carry a **×** marker and a red bar, badges carry text, and log lines carry a glyph.
- With the operating system's **reduce motion** setting on, nothing in the app animates or spins.
- **Shift+Click** on batch result checkboxes to select a range of rows.
- In a job's log or listing search, **Enter** goes to the next match and **Shift+Enter** to the previous one.
- The scoring panel **remembers your last-used folder and CAS library** when saving scenarios and tests, so you do not need to re-select them each time.
- Switching between Single Execution, Parallel (File Upload), and Parallel (CAS Table) modes **keeps your work**: each mode keeps its uploaded file, delimiter, sheet, column mapping, selected CAS table and results, and the single-run result stays too. Clicking the tab you are already on does nothing.
- In the folder browser dialogs, you must click the **"Select current folder"** link at the bottom to confirm your folder choice. Simply navigating into a folder does not select it.

---

## Additional Resources

- [MAS API Documentation](https://developer.sas.com/rest-apis/microanalyticScore)
- [Score Definitions API Documentation](https://developer.sas.com/rest-apis/scoreDefinitions)
- [CHANGELOG.md](CHANGELOG.md) — Detailed list of changes in each release
- [MAS Module Scorer Playlist (YouTube)](https://youtube.com/playlist?list=PLncvHGGelzhUHszGZ39TPMCxNYjNTAp7B&si=9Y2iL7Kzk_iRQn1r) — Video walkthrough and update videos of the application
