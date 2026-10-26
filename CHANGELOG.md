# Changelog

All notable changes to the SAS MAS Scorer will be documented in this file.

## [2.11.0] - 2026-10-26

Fast and at scale: pages you return to open from memory, long lists and job statistics load in parallel, batch runs show how they are going and recover from failures, and an expired session no longer leaves the app silently failing.

### Added

- **Find failed rows fast** — batch results can be filtered to All, Succeeded or Failed and sorted by row, status, any output or runtime. **Errors by message** groups failures ("10 × The step … was not found") with **Show these rows** and a jump to the first row with each error
- **Retry failed rows** — after a run, **Retry failed rows (N)** scores only the failed rows again and puts the new results in place. During a run, rows that fail with a temporary error (HTTP 429, 502, 503, 504 or a dropped connection) are retried automatically up to twice
- **See how a batch is going while it runs** — the progress card shows succeeded and failed rows, rows per second and the time left, plus the last error. If 20 rows in a row fail (an expired session, a removed module, a service outage) the run pauses and asks **Continue** or **Stop** instead of sending every remaining row into the same error
- **Stop a CAS table fetch** — Parallel (CAS Table) shows rows fetched of the total while it reads the table, and **Stop fetching** cancels it without scoring anything; large tables use less memory while they are read
- **Job log tools** — error and warning counts, Previous / Next through errors, a filter for errors and warnings only, and search across the whole log; a failed job opens at its first error, which is also shown in the job header
- **Job statistics for a period** — Job Monitoring counts the jobs of the last 24 hours, 7 days (default), 30 days or all, several pages at a time, and switching back to a period already counted is instant. The banner shows how far back the count has got
- **Session expiry prompt** — when the SAS Viya session ends (a 401, or the SAS Logon page answering in place of the service, which is how cookie sessions expire in the web and VA versions) the app shows one "Your session has expired" prompt. Sign in and what was waiting is retried; **Not now** shows Login in the header
- **Copy details on errors** — error messages from SAS Viya get a **Copy details** button that copies the HTTP status, SAS error code, request, time, app version and build, ready for an administrator or a support ticket
- **Cancel a coverage run** — Test Coverage has a **Cancel** button

### Changed

- **Pages you return to open from memory** — decision flows, sub-decisions, rule sets, REST API and treatment definitions, segmentation trees (about 1 MB each) and module details are kept for the session and refreshed quietly in the background. Re-opening a tree no longer downloads it again (5.1 s → 0.7 s for a 2,687-path tree); a version saved in SAS Intelligent Decisioning in the meantime replaces the old one on screen. Logging out, switching connection or importing rules clears the affected copies
- **Long lists load several pages at once** — Decision Flows, Segmentation Trees, Publishing, Test Coverage and CAS tables request a few pages in parallel once the total is known; rule sets are read 1,000 rules per request
- **Faster full flow diagram** — rule sets and REST definitions load while sub-decisions are still arriving, the diagram fits itself again after expanding (unless you have moved it), badges appear without re-laying out the graph, and diagrams with over 100 nodes draw only what is in view
- **Smaller, faster start** — the flow-diagram library loads only when a flow or tree is opened, and scoring, the UI builder, Rules Import, Test Coverage, Publishing and Connection Settings load when first opened (web entry 400 kB → 120 kB). The Job Execution / Visual Analytics version is compressed: 1.75 MB → 0.64 MB, so it is sent and started in about half the time (first request to SAS Viya after 1.2 s instead of 2.3 s), and it still runs where eval is blocked
- **Open Sans ships with the app** — no Google Fonts request and the right font on networks without internet access. The Job Execution / VA version gets it too (registered from script, because Job Execution's Content-Security-Policy blocks inlined fonts); until now it fell back to Arial there. The desktop app no longer flashes white on start
- **Job Monitoring recovers by itself** — after a failed request each section retries (5 s, 10 s, 30 s, then every minute) and resumes on success; coming back to the browser tab refreshes at once
- **Live logs catch up faster** — while a job runs only the visible tab (log or listing) is fetched, a long backlog is read straight through, and **Refresh now** keeps the lines already shown
- **Coverage runs survive navigation** — a running analysis keeps going when you leave Test Coverage and is shown again when you return; a re-run keeps the previous results on screen
- **Publishing Overview stays put on Refresh** — figures and the table, with its search, filters and page, stay on screen while the data reloads ("Refreshing…", then "Data as of 14:05")

## [2.10.0] - 2026-10-24

Nothing lost, nothing wrong: this release fixes the places where the app silently dropped work or scored, saved or counted the wrong thing, and makes lists and pages remember where you were.

### Added

- **Choose how each batch input gets its value** — in Parallel (File Upload) and Parallel (CAS Table), each input can take a column, **Send as missing (null)** or a **constant**, so a file or CAS table no longer needs every input as a column. A summary ("5 mapped, 2 missing, 1 constant") and a **Send unset inputs as missing** button make dozens of optional inputs quick to handle; Run waits until every input has a choice. A CAS setup with a constant cannot be saved as a SID test (SID has no constant mapping for table tests); one with missing inputs can
- **Unreadable values flagged before scoring** — the file mapping shows, per input, how many values cannot be read as the input's type, with examples and the first row ("2 values in column clage can't be read as decimal (e.g. "N/A", "12abc"; first in row 3). They are sent as missing (null), not 0."). A CAS run pauses with the same list before scoring, and character columns mapped to numeric inputs are flagged
- **Drag and drop for File Upload** — drop a CSV, TSV, JSON/JSONL, Excel or Parquet file onto the upload area, as the User Guide describes; the file picker remains the keyboard route
- **Rules Import links to what you imported** — each imported rule set shows its new revision, an **Open in SAS Intelligent Decisioning** link and its rule chain on demand (**Show rules**)
- **Test Coverage reports its gaps** — a collection that could not be read (403/404/error) or was cut off is listed in a warning, in a **Data collection** table and in the Markdown export, and a failed type shows as "not collected". If the tests themselves cannot be read, coverage shows n/a instead of 0%
- **Segmentation tree test runs explain failures** — a failed run shows the error lines from its SAS log (SID records no error message for these runs), with the full log, a download and links to the log and the tree
- **Copy instead of download where an embed blocks downloads** — inside SAS Visual Analytics the app can run in a frame that blocks downloads. Every export (batch results CSV, coverage CSV/Markdown, flow Markdown, path CSV, job log and code, Rules Import files, the Schema → Code .py, UI App export) now goes through one helper that offers **Copy contents** when the download is blocked or may have been, instead of doing nothing

### Changed

- **Lists remember where you were** — search, filters, sort and page on Modules, Decision Flows, Segmentation Trees, Test Coverage and Job history are kept in the link, so Back, a reload and a shared link show the same view; the sidebar entry starts a fresh list. The open job detail tab is kept the same way. Going back to Decision Flows or Segmentation Trees no longer reloads the whole list, and each view now has its own browser tab title
- **Switching execution mode keeps your work** — the uploaded file, delimiter, sheet, column mapping, selected CAS table, the single-run result and each mode's batch results are kept when you switch tabs; clicking the active tab no longer clears anything
- **Missing and unreadable values are sent as missing, not 0** — SAS missing values (`.`, `.A`–`.Z`, `._`), empty cells and values such as `N/A` or `1,5` are now sent as null instead of 0. Excel/Parquet dates are sent as SAS date/datetime numbers to numeric inputs and as ISO text to string inputs
- **Test Coverage: "covered" means a live test** — trashed score definitions no longer count, tests and scenarios are recognised only by their SID properties (`test`, `inputData.type`), no longer by "test" or "scenario" in the name, and publishing validations are never counted. The page says how many tests and scenarios were counted
- **Schema → Code: generated code always matches the mapping** — the Python is regenerated from every edit, so the code, the signature and the `execute()` parameter cannot drift apart. Python keywords, duplicate names and names the generated code uses are flagged in place and block Generate and Save; DS2 reserved words show a warning
- **Segmentation tree test results stay** — a finished table test is shown on the tree immediately, however the dialog is closed, and is kept for the browser session for that tree revision; dismissing the banner hides the results and **Show last test results** brings them back
- **Rules Import refreshes the server checks after an import**, so CREATE/UPDATE labels and the update acknowledgement are right on a re-import
- **Desktop app: faster API calls** — connection details and tokens are kept in memory (still encrypted on disk) instead of decrypting the settings file on every request, which capped batch and CAS-table scoring speed
- **Desktop app: silent session renewal** — when the stored session has expired, the app renews it at startup with the saved refresh token and shows "Connecting…" instead of "Not connected" and the login window. A network outage at startup no longer discards the saved session
- **Sidebar starts collapsed** — the navigation opens as the icon rail by default; once you expand or collapse it, that choice is remembered. The collapse control is now a compact double-arrow button beside the version number, labelled **Collapse** / **Expand** on hover or focus, instead of a full-width "Collapse" row above it. Expanding or collapsing no longer makes the menu jump: labels stay on one line while the width animates
- **Not-found pages** — a missing UI App, an app that is not in your library and a module that cannot be loaded now show a proper message with a way back, instead of unstyled text

### Fixed

- **Batch scoring turned SAS missing values into 0** — CAS returns every missing numeric as `.`, and the app scored those as 0; unreadable file values (`N/A`, `1,5`) were scored as 0 as well
- **Save as Scenario saved inputs that did not produce the result** — a scenario now stores the inputs sent with the run. If inputs change after a run, the results are marked "Inputs changed since this run" and Save as Scenario waits for a re-run; a failed re-run keeps the previous result dimmed and labelled
- **Wrong model version for similarly named models** — the published-model lookup now matches the module name exactly (the service's `contains()` matches substrings and ignores case), so a model no longer shows the version, Model Manager link or CSV version of a model published later under a longer name; names with an apostrophe no longer lose their version
- **Job Monitoring mixed servers** — switching connection or logging out and back in now clears the previous server's job counts, instead of adding the new server's jobs to the old totals
- **The sidebar's Details and Execute Score items did nothing** — Details opens the current module; Execute Score returns to the step last scored in it, or moves to the module's Steps list when none has been scored yet
- **Shared UI App links showed a broken Edit button** in the default (below) and inline layouts; they now show **Save to My UI Apps** in every layout, and opening the editor for an app that is not in your library explains how to save a copy
- **Schema → Code: one missing JSON field voided every other variable** — absent fields now default one at a time, `parse_success` stays 1 and `parse_status` lists the absent paths (`OK; absent: …`). A JSON number written with a decimal point (`100.00`) is inferred as Decimal, so a later 99.5 is no longer truncated
- **Opening a step could land on the module page instead** — coming from UI Apps (or the UI Builder) to a module's step, the score page briefly saw no steps and redirected to the module; it now waits for that module's steps
- **Very large batch runs could fail at the end** — run statistics no longer overflow the call stack, and the progress card always closes
- **Save dialogs could crash the scoring page where browser storage is blocked** — Save as Scenario, Save Batch Scenarios and Save as Test now work without stored preferences

## [2.9.0] - 2026-10-19

### Added

- **Segmentation Tree Explorer** — a new **Segmentation Trees** page for navigating trees too large for SAS Intelligent Decisioning's canvas. It was built against a 2,687-path, 801-outcome strategy tree, which it indexes in under a quarter of a second
  - **Four views of the tree** — **Split** shows one split at a time, its branches in the order SID tests them (first match wins), each with where it leads and how many paths and distinct outcomes lie below it; **Outline** shows the whole tree as an expandable, keyboard-navigable list; **Diagram** draws it left to right with the selected path highlighted and line width showing how many paths run through each branch; **Icicle** shows the whole tree's shape (one row per level, block width = share of paths), zooms on click, and can shade by the share of paths assigning an output value (e.g. `ScenarioGroup`) or by dead ends and test results. Large trees open collapsed — the top levels until about 150 (Outline) or 40 (Diagram) branches show, deeper parts behind **+ N paths** handles — and selecting anything opens the tree up to it
  - **Breadcrumb navigation** — the path from the top of the tree to the current node; click a step to jump back to it, or use its **▾** menu to switch to a sibling branch at that level. The position is part of the address (`?at=…`), so links open the same node and Back walks back through the jumps
  - **Outcome index** — every outcome with its output values and path count; search, group by an output variable, and filter to outcomes with failed or unreachable paths. An outcome reached by several paths lists them, with the conditions all paths share shown once and only the differences under each path
  - **Path panel** — the conditions that lead to the selected node, **merged** into one condition per variable (`17 ≤ SCScore01Risk < 600`) or as **raw** SID steps, plus the outcome and the values it assigns
  - **Copy** a path as one line of text, a SAS `WHERE`/DS2 condition, a Markdown table, a sample input record (JSON) or a link to the node
  - **Dead-end branches explained** — branches no record can reach (typically a variable tested twice on one path with contradictory ranges, e.g. `< 22` at step 5 and `>= 22` at step 16) are found on load. A banner explains them with an example from the tree and lists each one with the conflicting steps; the path panel says why the path is unreachable, links to the conflicting splits, and says how to fix it in SAS Intelligent Decisioning
  - **Export paths (CSV)** — one row per path with one column per variable, the outcome, its outputs and reachability: the strategy table rebuilt from the tree
- **Test segmentation tree paths in SID** — for one path, an outcome, any subtree or the whole tree, a dialog generates one record per path (inputs that take the path, the outcome's outputs as expected values). Rows can be edited, added and deleted, then saved as **one SID scenario per selected row** or as **one table-based test**: the rows are uploaded to a CAS table in a caslib you pick and a test is created on the tree. The table test can run straight away; the app reads its output table, compares every row with its expected values, and overlays the result on the tree — passed/failed counts on every branch, a **Next failed path** banner, and expected vs actual values in the path panel. Verified against the 2,687-path tree: all 2,683 reachable paths' generated records produced their expected outcome in SID
- **Menu button** — a shared, keyboard-operable menu (arrow keys, Home/End, Escape) used by the explorer's Copy and branch menus

### Changed

- **View Flows** — the segmentation tree side panel no longer renders the whole tree as nested cards (thousands of them for a large tree); it shows the tree's size and an **Open in Segmentation Tree Explorer** button

### Fixed

- **First call to a service could fail with "Authentication success, retry original request."** — Viya answers the first cookie-authenticated request a browser session makes to some services this way; the API client now retries such a request once instead of surfacing it as an error (seen in the Job Execution build when creating a test)

## [2.8.0] - 2026-09-15

This release folds in the results of a full performance and accessibility review of the app — 232 verified findings across every page — and makes **WCAG 2.1 AA** a shipping requirement. Every screen was reworked for keyboard use, screen readers and contrast; the data layer was audited for silently truncated lists; and the shared design system now owns the components each page had been re-implementing on its own.

### Added

- **Rule sets in View Flows show the rule chain** — a rule set is an ordered *if / else if / else* chain, and the diagram, side panel and Markdown export now show it that way instead of a flat list. Rules appear in execution order with `IF` / `ELSE IF` / `ELSE` / `OR` leads, conditions joined by `AND`, actions under `THEN`, and each condition or action carries its kind (Comparison, Expression, Lookup, Assignment, Lookup value, Advanced list) and the lookup table or advanced list it reads. The rule set node shows its rule count and type (`assignment` / `filtering`); a rule set the service reports as invalid — a missing lookup table, for example — gets a warning badge on the node and the service's message in the panel and export. Each rule set also lists the decision variables it reads and writes. The export gains **Rule Sets** and **Lookup Tables & Lists** tables alongside the External Endpoints table from 2.7.0
- **Publishing Overview shows progress while it loads** — a live count of destinations and deployed items as they arrive, instead of a bare spinner and three zeros
- **Collapsible sidebar** — a control at the bottom of the sidebar folds it to an icon rail and back; default expanded, remembered per browser. Labels stay available as tooltips and to screen readers
- **Narrow layouts** — below 768px (Visual Analytics objects, Job Execution embeds, small windows) the sidebar becomes a drawer behind a header toggle, tables scroll inside their cards, and toolbars wrap
- **Keyboard and screen-reader support across the app** — file pickers (Parallel › File Upload, Rules Import) reachable by keyboard; clickable table rows, sort headers and UI Builder field rows are real buttons; every dialog closes on Escape, traps Tab and returns focus to what opened it; every form control, grid cell and icon button has an accessible name; focus is visible on every control; rule and log severities are no longer conveyed by colour alone; animation stops under the OS "reduce motion" setting
- **Recoverable page loads** — if a page's code fails to download (web build), a message with **Try again** replaces the blank screen

### Fixed

- **Lists were silently cut short.** SAS Viya collections default to ten items, and several calls never asked for more or stopped paging when a service capped the page below what was requested. Rule sets with more than ten rules showed "Rules (10)" in View Flows; reference-data modules showed ten entries as the total; modules with more than twenty steps hid the rest; the coverage, job history, decision, scenario and CAS lists had the same latent bug. One shared paginator now walks every collection to the end, using the page size the service echoes back
- **View Flows dropped the operand from every condition and action** — `DEBTINC < 43`, `DELINQ = 0` rendered as `<43, 0`; `loan_bin = 1` as `1`; a lookup condition showed only the term with no sign of the table it reads
- **"Score full table" could score a subset while reporting the full count** — CAS rows were requested in one un-paged call; they are now fetched page by page with progress on the button
- **Publishing Overview took ~16 seconds to load** — five sequential requests at ~3.5 s each; the service accepts a larger page, and all deployed items now arrive in one request of about 2 s
- **Batch scoring rebuilt and re-sorted the whole results array after every row**, and kept sending requests after you navigated away; the results are assembled once, and leaving the page aborts the batch
- **Rules Import revalidated the entire file on every keystroke** — unchanged rows are now cached, so editing a 2,000-row file has no lag and the import gate updates instantly
- **Job logs grew the page without limit** — the viewer windows what it renders; Copy and Download still return the full log
- **Coverage and Publishing rendered every row at once and re-sorted on every keystroke** — both paginate, and search is debounced
- **Styles were silently dropped** — 83 references to 24 CSS variables that were never defined; the folder you picked in the Save dialogs had no highlight, one control had no padding, and several screens rendered an off-brand palette through fallbacks. All rewritten onto real tokens
- **Stale responses could win** — switching CAS tables, folders, modules or jobs quickly could apply the earlier response to the later selection; guarded everywhere
- **Input/output direction badges were colour-inverted** between View Flows and the UI Builder
- **Modules were fetched twice on login**, and opening a module by deep link loaded its steps only after the module arrived; both fixed
- **Contrast** — badge text, secondary text, boolean outputs, the decision badge in UI Runner, the schema type chips and the header status line on light environment colours all failed AA; the palette's status and gray tokens were darkened to verified values, so every badge and alert passes in one place

### Changed

- **Design system** — Modal, IconButton, EmptyState, SearchInput, StepNav, Pagination, ProgressBar, stat cards, a compact table variant, direction badges and deep links are shared components now; the per-page copies (17 badge styles, 13 hand-styled tables, 9 modal implementations, 16 empty states) are gone
- **Batch Results** page sizes are 100 / 500 (the "All" option is gone), and the datagrid viewer pages at 200 rows instead of "Show all"
- **Web build loads faster** — route-level code splitting takes the entry bundle from 944 kB to 370 kB; View Flows, Job Monitoring and Schema → Code load on first use. The Job Execution build is unchanged (one inlined file)
- **Type sizes** in Job Monitoring, Publishing and the UI Builder moved from `rem` values (which landed off the 14px base) onto the token scale
- The Electron connection dialog uses the shared Modal, its delete confirmation is the red **danger** button, and environment colour swatches are native radio buttons

## [2.7.0] - 2026-08-31

### Added

- **REST API definitions in View Flows** — decision steps that call a REST API definition used to render as anonymous custom nodes, hiding the most interesting thing about them. They are now a node type of their own:
  - The diagram shows a **REST API** node with the HTTP method and the endpoint host
  - The node details panel shows the endpoint with its `{placeholders}` highlighted and mapped to the decision variables that feed them, the authorization type, query parameters, request and response headers, the request body, the definition signature, revision and lock state, and a deep link into SAS Intelligent Decisioning
  - The Markdown export gains a section per REST API node plus an **External Endpoints** table listing every outbound call the decision makes — node, method, endpoint, authorization type and definition version
- **Clear ID columns** in Rules Import — one click blanks `ruleset_id` and `rule_id` across the file, which is what a CSV exported from another environment needs before it will import. The button shows how many rows still carry an id and is disabled once both columns are empty

### Fixed

- **Rules Import rejected valid exports** — the validation was checked against a 299-rule-set export taken from a live environment, and raised roughly 1,000 blocking errors on rows the service itself had produced:
  - Rows whose expression stands on its own — free-form conditions (`sum(a,b) > 5000`), advanced actions (`DATAGRID_TOPN(...)`) and `ACTIONADVANCEDLIST` — no longer require a data type or term. 39% of the rows in that export have this shape
  - `or` is accepted as a `conditional`, and `ACTIONADVANCEDLIST` as an `expression_type`
  - A blank `folder_path` is a warning instead of an error, and the server checks match such rule sets by name instead of reporting a missing folder
  - Expressions longer than 4,000 characters warn instead of erroring — that limit comes from the `%DCM_IMPORT_RULESET` informat, not from the import service, which accepts far longer values
  - The one-data-type-per-term rule is scoped to a rule set rather than the whole file, since each rule set has its own signature

### Changed

- Rules Import expression cells use a resizable multi-line editor — 14% of the rows in a real export contain expressions that span several lines

## [2.6.0] - 2026-08-20

### Added

- **Business Rules Import** — new primary navigation page that imports SAS Intelligent Decisioning rule sets from CSV files (the `%DCM_IMPORT_RULESET` / rule-export format) through the businessRules REST API, as a four-step wizard (Upload → Review & Fix → Server Checks → Import), available in all three build targets
  - Client-side pre-flight validation with per-cell highlighting: required values and length limits, term naming (≤32 characters, legal SAS name, no DS2 reserved words), value domains (conditional, rule-fired flag, data types, expression types), rule structure (contiguous rule/expression numbering, first rule must be IF, ELSE rules cannot have conditions), expression sanity (balanced quotes/parentheses, string-literal quoting), and cross-file consistency (one data type per term)
  - Editable grid with error/warning/info tooltips, an issues-only filter, **Next error** navigation that scrolls to and focuses the offending cell, **Auto-fix formatting** for normalizable issues, pagination for large files, and **Download corrected CSV**
  - Server checks classify each rule set as **CREATE** or **UPDATE** (existing revision shown), flag missing SAS Content folders (created automatically by the service), and detect **ruleset_id conflicts** in files exported from another environment — with a one-click **Clear conflicting IDs** fix so the import updates the existing rule set by name + folder instead of being rejected
  - Import confirmation dialog with per-rule-set CREATE/UPDATE badges and an explicit acknowledgment when existing rule sets will be updated
  - Full multipart response handling: accepted and rejected rule sets with the server's reasons mapped back onto the grid rows (including the HTTP 400 rejection response), **rejected-only retry** that never re-sends accepted rule sets, and downloads of the rejected rows and the raw server response
- **Environment colors for connections** (desktop app) — each saved connection can be given a color (presets or a custom picker) that tints the application header, so users can tell at a glance which environment they are connected to; editing the active connection recolors the app immediately. The default remains the SAS brand blue
- **Self-signed certificate guidance** — a failed login now opens an explanatory dialog instead of failing silently; certificate errors get step-by-step instructions (enable **Skip SSL certificate verification** on the connection profile) and a shortcut into Connection Settings. Covers every Login entry point in the app

### Fixed

- **Mojibake in the Job Execution build** — non-ASCII characters in the single-file build (e.g. the arrow in "Schema → Code") rendered as garbled text ("Schema â Code") because the base64-decoded script bytes were not interpreted as UTF-8; the loader now decodes them with `TextDecoder`

### Changed

- New default header color **#0766D1** (SAS brand blue) with an updated logo mark; header buttons keep readable contrast on any environment color
- The version number in the sidebar is injected from `package.json` at build time instead of being hardcoded
- Score page decluttered — the **Step Information** and **Output Signature** cards were removed (the same information is on the module details page and in the scoring results)
- Connections dialog polish: spacing for the **Add Connection** button, and **Escape** closes the dialog

## [2.5.0] - 2026-08-05

### Added

- **DataGrid input editor** — decision datagrid inputs get a real editor instead of a raw JSON text field. The app reads the decision's signature (via the module's `sourceURI`): when the datagrid declares its columns (`dataGridExtension`), the editor locks column names and types and gives each cell a type-appropriate input (number fields, date/datetime pickers, true/false dropdowns); when it declares a row cap (`dataGridMaxRowCount`), the editor shows it and refuses to add rows beyond it with an explanation. Datagrids without declared columns fall back to a free-form editor where the user defines columns and types (string / decimal / integer / date / datetime / boolean). The editor opens with a first empty row ready to fill in
- **DataGrid results viewer** — in batch results, a datagrid output cell now shows a **DataGrid(rows × columns)** link that opens the grid in a modal (sticky headers, Copy JSON) instead of flooding the table
- **Application icon** — the app now ships an icon: browser favicon, Electron window/taskbar icon, and installer icons for all three platforms (auto-generated by electron-builder from `public/icon.png`)

### Fixed

- **CAS table Row Limit was ignored** — scoring a CAS table always fetched the default 1,000 rows regardless of the Row Limit the user entered (a stale memoized callback captured the initial value). The limit now takes effect, and fetched rows are additionally capped client-side
- **Datagrid values displayed as `[object Object]`** — batch result cells and the CSV export rendered datagrids and other structured values with JavaScript's default string coercion. Structured values now render properly (and export as JSON)
- **Datagrid inputs were rejected by MAS (400 Bad Request)** — MAS requires a datagrid input value as native JSON, not a JSON-encoded string. All paths now send the native structure: the grid editor, loaded scenarios (stored mappings are parsed back), and file/CAS batch rows (a cell containing serialized datagrid JSON is parsed automatically before scoring)

### Changed

- License notice scoped: the application icon (`public/icon.png`) is owned by SAS and not released under the open source license; everything else remains Apache 2.0

## [2.4.0] - 2026-06-02

### Added

- **Schema → Code** page — a new primary navigation entry that turns a sample JSON or XML payload into a Python `execute()` function for SAS Intelligent Decisioning, then saves it to SAS Viya
  - Paste or upload a JSON/XML sample; the parser auto-detects the format, flattens the structure, infers SAS ID data types (Character / Integer / Decimal / Boolean / Date / Datetime), and turns repeating elements into **DataGrid** columns
  - **Variable Mapping** step shows every detected variable with its source path, generated SAS name (validated to ≤32 chars and a legal SAS identifier), inferred type (editable), an editable storage **Length** for string-like types, and a sample value; rows can be renamed, retyped, or removed before generating code
  - **Python Output** step renders the generated `execute()` with Prism syntax highlighting and a line-number gutter, plus **Copy to clipboard** and **Download .py**
  - **Save to SAS Viya** dialog with two modes:
    - **Create new** — uploads the code to the Files service (`POST /files/files`), then creates the code file (`POST /decisions/codeFiles?parentFolderUri={folder}`, `type: decisionPythonFile`) referencing it via `fileUri`, with the description and the typed signature, in a folder chosen via the content browser
    - **Update existing** — browse the content tree to pick an existing code file, then upload the new code (`POST /files/files`) and create a new **revision** (`POST /decisions/codeFiles/{id}/revisions?revisionType={minor|major}&fromRevisionUri={current revision}`) referencing the new file plus the signature. The revision is what carries new code content, since `updateCodeFile` only edits metadata; `fromRevisionUri` links the new revision to the current one for lineage
    - On success, the dialog shows an **Open in SAS Intelligent Decisioning** deep link straight to the saved code file
    - Optional **"Also create a test scenario"** checkbox — creates a Scenario score definition (`POST /scoreDefinitions/definitions`) targeting the new code file's revision, with the pasted example used as the static `input_string` value and a description of *"Auto-generated from the example schema"*, so there's a ready-to-run first test. Pick the CAS output server/caslib (reusing the existing CAS pickers) and the scenario folder (defaults to the code file's folder)
    - The full variable **signature** is sent with the create/revision request — every input/output term with its SID `dataType` (`string`/`integer`/`decimal`/`date`/`datetime`; booleans map to `integer` since the generated Python emits 1/0) and the editable string lengths. DataGrid outputs are declared as `string` (Character) at the maximum length (32672), because a Python code node returns a DataGrid as a serialized JSON string rather than a native grid (see the DataGrid guidance below)
  - **Default unset variables to missing values** — a checkbox on the **Python Output** step that initializes unset or unparsed output variables to a SAS **missing value** (Python `None`) instead of `0` / empty string. Off by default, preserving the original behavior. Variables are type-annotated in the generated code so the inferred SID signature stays correct either way
  - **DataGrid output guidance** — a Python code node cannot output a DataGrid directly into SAS Intelligent Decisioning, so DataGrid outputs are emitted as a serialized JSON string in a max-length Character variable. The **Python Output** step now shows a per-variable note explaining this, with a copy-ready `dataGrid_create(<grid>, <string>)` statement to convert the string back into a real DataGrid downstream (via a **Rule Set** or **Variable Assignment** node), plus a warning to size the Character length so the JSON isn't truncated
- **Self-contained UI App share links** — UI Apps can now be shared with anyone, not just on the browser where they were created. The new **Share** button in the builder toolbar opens a Share dialog that embeds the *entire* app definition into the URL (base64url-encoded in a `def` query parameter), so the recipient needs nothing in their own local storage
  - Choose **Standalone** (form only, no app chrome) or **Within MAS Scorer** (full application chrome) for how the shared link opens — selectable in the dialog and carried by the existing `standalone=true` URL flag
  - **Full link (this server)** — a complete URL rooted at the current deployment's origin, for sharing within the same deployment
  - **Portable code (any target)** — just the hash suffix (`#/ui-apps/{id}?def=...&standalone=true`). Because all three delivery targets (Electron desktop, SAS Job Execution / JobDefinition, and the Webserver build) use hash-based routing, the same suffix can be pasted onto the end of *any* target's URL and resolves identically — e.g. build an app in the desktop app, then paste the code onto a Job Execution URL
  - **Save to My UI Apps** — when an app is opened from a shared link, the runner replaces **Edit** with a save action that imports the embedded definition into the recipient's own library (with a fresh ID) so they can keep and edit it
  - The standalone toggle in the runner now preserves the embedded `def` token, so switching in and out of standalone mode keeps a shared link self-contained

### Changed

- **Top header navigation** — removed the redundant **Modules** link from the top header bar; all page navigation now happens through the sidebar
- **Header help icon** — the **?** icon in the header now opens the project **User Guide** (`USER-GUIDE.md` on GitHub) instead of the MAS REST API documentation
- **Developer tooling** — added an ESLint configuration (`.eslintrc.cjs`, with TypeScript and React Hooks rules) so `npm run lint` runs cleanly, and fixed the issues it surfaced: unsafe `return`s inside `finally` blocks in the Job Monitoring / Job Detail hooks (rewritten as guarded state updates, so loading flags settle correctly) and a redundant `try/catch` in the steps API

### Fixed

- **Decimal input truncation** — decimal fields in the scoring form and the **Number** UI App widget no longer drop the decimal portion while typing. They previously re-parsed the value to a number on every keystroke and fed it back as the input text, so typing `3.0` collapsed to `3` (the `.` / `0` vanished) and a comma was rejected outright. A new shared `DecimalInput` keeps the exact text the user types (`3.`, `3.0`, `3,02`), accepts both `.` and `,` as the decimal separator, and emits the parsed number to the form
- **UI App field help tooltips** — the **?** help icon next to a field now reliably shows the field's description on hover (and on keyboard focus). It previously relied on the browser's native `title` attribute, which was slow and often suppressed on the small icon; it now uses a styled tooltip that appears instantly, wraps long text, and is keyboard-accessible

## [2.3.0] - 2026-05-11

### Added

- **Job Monitoring** page — new primary navigation entry for tracking SAS Viya Job Execution jobs in real time
  - KPI cards (Total Jobs, Active, Completed, Failed/Other, Avg Runtime) populated by walking `/jobExecution/jobs` page-by-page and bucketing each item locally — the unreliable envelope `count` is never trusted
  - Running panel with one card per active job, pulsing state badge, and a live elapsed timer that ticks every second; auto-refreshes every 5 s
  - History table covering every finished job with debounced server-side search, state filter chips (All / Completed / Failed / Canceled / Timed Out), 50-per-page pagination, and click-to-detail rows with hover underline and a right-edge chevron
  - Per-job detail page at `/jobs/:id` with **Log**, **Listing**, **Code**, and **Parameters** tabs
    - **Log** live-tails via the Compute API while the job runs (3 s polling, drains up to 5 pages per tick), then switches to the saved `.log.txt` file when terminal. Per-line colour coding by type (error / warning / note / source / title / fatal / message / byline / footnote / highlighted) with tinted backgrounds and coloured left borders. The file-format `<type>: <line>` prefix is parsed off before display
    - **Listing** handles the matching `/listing` endpoint and `.lst` file with a `title > highlighted > normal` font-size hierarchy
    - **Code** renders `jobDefinition.code` via Prism with a line-number gutter (display-only)
    - **Parameters** lists declared parameters next to submitted arguments with **overridden** / **extra** tags
  - **Copy** to clipboard + **Download** controls on each tab — `<JobName>-<8charId>.log` from the Log tab, `.lst` from Listing, `<JobName>.sas` from Code (line numbers excluded from the download)
  - **Cancel Job** (red button, double-confirm modal) for any non-terminal job. Issues `PUT /jobExecution/jobs/<id>/state` with body `canceled` *first*, then `DELETE /compute/sessions/<sessionId>` (best-effort, swallows 404s / missing sessions). Order matters: deleting the session first races with Job Execution flipping the state to `failed`, after which the field becomes immutable. Cache is updated locally so the monitoring page counts stay in sync without a re-walk
  - **Delete Job** (red button, double-confirm modal) for any terminal job. Issues `DELETE /jobExecution/jobs/<id>` (removing the record, log, listing, and result files), drops the entry from the in-memory cache, and navigates back to the Job Monitoring overview
  - Incremental refresh — an in-memory `jobsById` map persists across navigations within the session, so clicking Refresh walks pages from the top and stops on the first full page of unchanged jobs (typically a single HTTP call)
  - Per-section error backoff: when a fetch fails, that section's polling pauses until manual retry; the page shows a single "Auto-refresh paused due to errors from SAS Viya — Retry" banner
  - Shared 5xx response-interceptor handling — 502 / 503 / 504 now surface as "SAS Viya service is temporarily unavailable" instead of falling through to a generic error
- **Per-destination deployment count badges** on the Publishing Overview page — each destination card now shows badges next to its name indicating how many models and decisions are deployed there (e.g., "3 models", "1 decision"). Destinations with no deployed content show a "0" badge. Counts are derived from the same deduplicated completed-publish list as the summary cards

## [2.2.0] - 2026-05-05

### Added

- **Publishing Overview** page — new primary navigation entry providing a cross-environment view of published models and decisions
  - Summary cards showing total publishing destinations, models deployed, and decisions deployed (counts derived from the deduplicated completed-publish list)
  - Destinations panel listing every publishing destination with name, type badge, description, and a collapsible block of type-specific details (CAS server/library/table, SingleStore host/port/schema, Git repo URL/branch/folder, private Docker base repo/kube URL, ESP target container, MAS, etc.)
  - Searchable and filterable table of completed publishes with filters for Kind (Model/Decision), Destination, and Code Type plus debounced free-text search
  - Dedup logic — for any `destinationName + publishName` pair, only the most recent `creationTimeStamp` is retained
  - Icon-based row actions: "View Flow Diagram" (in-app flow viewer for decisions), "Open in SAS Model Manager / Intelligent Decisioning" (deeplink), and "Execute Score" (in-app scoring for MAS-deployed items)
- **Multi-format batch file upload** — parallel scoring now accepts TSV, JSON/JSONL, Excel (`.xlsx`), and Parquet files in addition to CSV
  - TSV / tab-delimited files (`.tsv`, `.tab`)
  - JSON arrays and JSON Lines (`.json`, `.jsonl`, `.ndjson`) — headers inferred from the union of keys across the first 100 records
  - Excel workbooks (`.xlsx`) with multi-sheet support — a sheet picker appears when the workbook has more than one sheet
  - Parquet files (`.parquet`) with native type preservation (no string-to-number coercion guesswork)
- **Format badge** shown next to the uploaded file name indicating which parser was used
- **File format adapter architecture** (`src/utils/fileFormats/`) — adapters implement a common interface so new formats can be added without changing the scoring, mapping, or result pipeline
- **Lazy-loaded parsers** — Excel (`read-excel-file`) and Parquet (`hyparquet`) libraries are loaded on demand, keeping the main bundle size unchanged
- **Custom delimiter override** for CSV / TSV uploads — pick a preset (Comma, Tab, Semicolon, Pipe) or type any character in the free-text field to re-parse the file. Useful for European-locale CSVs that use `;` or for pipe-delimited exports

### Changed

- **"Parallel (CSV Upload)" renamed to "Parallel (File Upload)"** in the scoring panel mode toggle to reflect the broader format support
- `CsvUpload` component renamed to `FileUpload`
- Column auto-mapping, data preview, parallel dispatch, and result export behave identically across all supported formats
- **Session-level caching for Publishing Overview and Test Coverage** — navigating away from either page and returning no longer triggers a refetch or re-run. Data persists in memory for the session; the explicit Refresh / Re-run Analysis buttons still force a fresh fetch, and caches are cleared automatically on logout

## [2.1.0] - 2026-04-14

### Added

- **Parallel scoring from CAS tables** — browse CAS servers, caslibs, and tables, map columns to step inputs, and score with configurable row limits (default 1,000) and concurrency controls
  - Server → Caslib → Table browser with filtering (tables with 0 rows hidden)
  - Column-to-parameter mapping with auto-match
  - 5-row data preview from the selected table
  - Editable row limit with option to score the full table
- **Save as Test** for CAS table scoring — save the CAS table and column mapping setup as a Test (score definition) back to SAS Intelligent Decisioning
  - Maps input parameters to CAS table columns using `datasource` mapping type
  - Configurable name, description, SAS Content folder, and CAS output library
  - Column mapping summary displayed in the save dialog for review
- **Stop batch scoring** — abort button for both CSV and CAS Table parallel scoring modes; partial results are displayed immediately
- **Save batch results as scenarios** — select rows from parallel scoring results and save them as SAS Decision test scenarios (score definitions)
  - Checkbox column with select-all and shift+click range selection
  - Shared folder, description, and CAS output library across all scenarios
  - Sequential naming (`{baseName}_1`, `{baseName}_2`, …) with progress bar
- **Standalone UI Apps mode** — run a UI app without the sidebar, header, or navigation chrome via a `?standalone=true` query parameter
  - "Standalone" button in the UI App runner header to enter standalone mode
  - "Exit Standalone" bar to return to the full application
  - "Copy Standalone Link" button in the UI Builder toolbar to copy a shareable direct link
- **Clear cached results** when switching between Single Execution, Parallel (CSV), and Parallel (CAS Table) modes
- **Replace Module** in the UI Apps builder — swap the underlying module of an existing UI app with a two-step dialog
  - Browse and search modules with Model/Decision type indicator and type filter
  - Parameter mapping screen with auto-match by name, data types displayed for orientation, and per-field dropdown to remap or remove fields
- **User Guide** — added `USER-GUIDE.md` covering all application features, from getting connected through scoring, UI Apps, View Flows, and Test Coverage Analysis

### Fixed

- **UI Apps Delete and Export buttons** now work inside sandboxed iframes (SAS Visual Analytics Job Definition mode) — replaced `window.confirm()` with an inline confirmation banner and added clipboard fallback for export when programmatic downloads are blocked

## [2.0.0] - 2026-04-13

### Added

- **View Flows** page — new primary navigation entry for exploring SAS Intelligent Decisioning decision flows as interactive diagrams
  - Paginated, searchable decision list with sortable Name column, client-side case-insensitive filtering on name and description, and full API pagination to fetch all decisions
  - Interactive flow diagram (React Flow + Dagre auto-layout) with all node types: sub-decisions, rule sets, models, code files, conditions, assignments, A/B tests, parallel processes, record contacts, treatment groups, and segmentation trees
  - Sub-decision recursive expansion up to depth 3 with color-coded group boxes
  - Node inspection side panel with rich API-fetched metadata for rule sets (rules, conditions, actions), models (algorithm, variables, properties), code files (inline preview, syntax-highlighted viewer via Prism.js), treatment groups (member definitions, attributes, eligibility), segmentation trees (split conditions, outcomes, decision tree), and variable assignments/mappings
  - Markdown + Mermaid diagram export with enriched node details
  - Deep links to SAS Intelligent Decisioning for all asset types
  - Clickable API links in side panel with deep links to SAS Intelligent Decisioning / SAS Model Manager where applicable
  - Workflow status display in flow header showing current state, last modified by/date, or "No Workflow" when unassigned
  - Workflow history popup with timeline view of all state transitions (from/to, who, when, comments)
  - Workflow information included in Markdown export (state, history table)
  - Code viewer popup with Prism.js syntax highlighting for Python, DS2, SQL, and Query code files (ESC to dismiss)
  - Legend, minimap, and zoom controls on the flow diagram
- **View Flow** button on Module Details page for Decision-type modules — navigates directly to the flow diagram
- **Flow diagram icon** on Test Coverage page for decision items — links to the in-app flow viewer
- **Test Coverage Analysis** page — new primary navigation entry that collects all Decisions, Business Rules, Code Files, Treatment Definitions, and Segmentation Trees from SAS Viya, links them to Score Definition test scenarios, and visualises coverage
  - Real-time progress indicator showing collection status across all 5 asset types + score definitions
  - Summary dashboard with circular coverage gauge, stat cards (total/covered/uncovered), and horizontal bar charts per asset type color-coded by coverage level
  - Filterable, sortable detail table of all assets with search, type filter, and coverage filter
  - Deep links to SAS Intelligent Decisioning for each asset type (Decisions, Business Rules, Code Files, Treatment Definitions, Segmentation Trees)
  - Export to Markdown report and CSV
- **Load Scenario** for Decision modules in single scoring mode — loads saved test scenarios from Score Definitions back into the input form, with reverse variable name mapping (decision names → MAS parameter names) and automatic value unwrapping for dates, datetimes, and datagrid types

### Changed

-   Improved the setup instructions in the main README.md

## [1.3.0] - 2026-03-20

### Added

- "Created By" column in the module list table
- Type filter dropdown (All / Model / Decision) in the module list toolbar with server-aware filtering across all pages
- "Filtered to X / Y modules" counter in the page header when search or type filter is active
- Version display in Module Information for Decision modules (fetched from decision flow revision as majorRevision.minorRevision)
- Version display in Module Information for Model modules (fetched from `/modelPublish/models` as modelVersionId)
- Decision description field in Module Information with text wrapping and ellipsis
- Source Link and Version columns in batch scoring CSV uploaded to CAS
- Model Manager deeplinks now include the model version path (`/versions/{modelVersionId}`)
- "Save as Scenario" button for Decision modules after a successful single score — saves input values and expected outputs as a score definition back to SAS Viya, with SAS Content folder browser, CAS output library selection, and automatic MAS-to-decision variable name mapping (fetches decision flow signature for case-correct names, strips trailing `_` suffix)

### Changed

- Removed Scope and Revision columns from the module list table
- Removed Revision field from Module Information for Decision and Model type modules (replaced by Version)

### Fixed

- Increased scoring request timeout from 30s to 120s to prevent 499 (client closed) errors when decisions take longer to execute
- Switching between Single Execution and Parallel (CSV Upload) modes now clears previous results

## [1.2.0] - 2026-03-19

### Added

- Markdown text blocks in UI Builder with inline image support (`![alt](url)`)
- Move fields between sections via "Placement > Section" dropdown
- Hidden inputs with default values sent silently on every execution
- Output formatting: configurable decimal places for rounding numeric outputs
- Output value mappings: translate raw values to display labels (e.g. 1 → Yes)
- Gauge customization: configurable range (min/max) and color stop thresholds
- Slider step size configuration
- Dropdown widget support for numeric input parameters
- SAS code example in View API Call (single row scoring using `proc json`, `proc http` with `oauth_bearer=sas_services`)
- Parallel scoring code examples in View API Call for Python (ThreadPoolExecutor), JavaScript (worker pool), and SAS (`proc ds2` with threaded HTTP)
- Single Row / Parallel toggle in View API Call to switch between code example modes

### Changed

- "Batch (CSV Upload)" execution mode renamed to "Parallel (CSV Upload)"
- Section titles in the builder are now visually editable (hover/focus indicators)
- Side-by-side layout no longer shows redundant "Input"/"Results" headings

### Fixed

- Text blocks not rendering in side-by-side layout mode
- Reset clearing hidden input defaults
- package-lock.json out of sync with package.json (caused CI build failures)

## [1.1.0] - 2026-03-10

### Added

- Ability to create small UIs on top of models with a score step and decisions with an execute step

## [1.0.3] - 2026-03-02

### Fixed

- Fixed infinite request loop when loading modules with spaces or special characters in their names (e.g., "Credit Card Fraud Agent2_1"). The app would repeatedly fetch the same module hundreds of times without displaying results due to a URL encoding mismatch between the router and the API response.
- Fixed search filter breaking when module names contain single quotes. Quotes are now properly escaped using SAS filter syntax (`''`).
- Fixed deeplinks to SAS Intelligent Decisioning and SAS Model Manager pointing to `localhost` instead of the actual SAS Viya server URL when running in the Electron app.

### Changed

- External links (API documentation, SAS Intelligent Decisioning deeplinks, SAS Model Manager deeplinks) now open in the user's default web browser instead of a new Electron window.
- Large datagrid outputs in scoring results are now contained within a scrollable area (max-height 400px) with sticky column headers, preventing wide or tall datagrids from overflowing the page layout.

## [1.0.2] - 2026-02-28

### Fixed

- Fixed path error in Electron build configuration.

## [1.0.1] - 2026-02-28

### Changed

- Updated package.json configuration.

## [1.0.0] - 2026-02-28

### Added

- Initial release of SAS MAS Scorer.
- Module list with search, sort, and pagination.
- Module detail view with steps, submodules, and source code display.
- Interactive scoring panel for executing module steps with input parameters.
- Batch scoring via CSV upload.
- Support for datagrid output rendering.
- SAS Viya authentication (browser cookie-based and Electron OAuth/PKCE).
- Electron desktop app with connection management and multi-server support.
- Deeplinks to SAS Intelligent Decisioning and SAS Model Manager for published modules.
- Job Definition build mode for embedding in SAS Visual Analytics.
