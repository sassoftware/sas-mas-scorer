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
7. [Scoring — Parallel (CSV Upload)](#7-scoring--parallel-csv-upload)
8. [Scoring — Parallel (CAS Table)](#8-scoring--parallel-cas-table)
9. [Scenarios and Tests](#9-scenarios-and-tests)
10. [View API Call](#10-view-api-call)
11. [View Source Code](#11-view-source-code)
12. [UI Apps](#12-ui-apps)
13. [View Flows](#13-view-flows)
14. [Test Coverage Analysis](#14-test-coverage-analysis)
15. [Keyboard and Interaction Tips](#15-keyboard-and-interaction-tips)

---

## 1. What Is the SAS MAS Scorer?

The SAS Micro Analytic Score (MAS) service hosts published models and decisions as **modules**. Each module exposes one or more **steps** — executable endpoints that accept input variables and return output variables.

The SAS MAS Scorer gives you a visual interface to:

- Browse all published modules and inspect their inputs, outputs, and source code.
- Score individual rows by filling in a form, or score thousands of rows in parallel from a CSV file or CAS table.
- Save scoring setups back to SAS Intelligent Decisioning as **Scenarios** (static input/expected output pairs) or **Tests** (CAS table-backed batch tests).
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

3. Click **Save**, then click **Login**. A browser window opens for the OAuth authentication flow.
4. After successful login, the app loads your modules.

**Managing connections:**

- Click the **gear icon** in the top-right header to open the connection settings panel.
- From there you can add, edit, delete, or switch between connections.
- The active connection name and a green status dot are shown in the header.

### Web Server (Browser)

When deployed on a web server on the same origin as SAS Viya, authentication uses browser cookies. Click **Login** in the header. A popup window opens to the SAS Viya login page. Once authenticated, the popup closes and the app loads.

### SAS Visual Analytics (Embedded)

When embedded in a SAS Visual Analytics report via a Job Definition, the application inherits the user's existing SAS Viya session. No separate login is needed.

---

## 3. Navigating the Application

The left sidebar is the primary navigation. It contains four main pages and a contextual section that appears when you have a module selected.

### Main Pages

| Page | Description |
|------|-------------|
| **All Modules** | Browse, search, and filter all published modules |
| **UI Apps** | Create and manage custom scoring UIs |
| **View Flows** | Visualize SAS Intelligent Decisioning flows |
| **Test Coverage** | Analyze test scenario coverage across all assets |

### Current Module Section

When you select a module, two additional navigation items appear:

- **Details** — View module metadata, steps, submodules, and source links.
- **Execute Score** — Open the scoring panel for the currently selected step.

### Recent Items

The sidebar also shows your most recently accessed **UI Apps** and **Modules** (up to 5 each) for quick navigation.

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
- **Parallel (CSV Upload)** — Score many rows from a CSV file.
- **Parallel (CAS Table)** — Score many rows from a CAS table.

This section covers Single Execution. The other modes are covered in the next two sections.

### Step Information

Two cards at the top show:

- **Step Information** — The number of inputs and outputs.
- **Output Signature** — A list of all output variables with their data types.

### Entering Input Values

The input form shows one field for each input parameter. Each field is labelled with the parameter name and displays a type badge (e.g. `decimal`, `string`, `integer`).

**Helpful actions in the input card header:**

| Button | What It Does |
|--------|--------------|
| **Load Scenario** | Load saved input values from a previously saved scenario in SAS Intelligent Decisioning (Decision modules only) |
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

- **Save as Scenario** — Save the input/output pair as a test scenario in SAS Intelligent Decisioning (Decision modules only).
- **Clear Results** — Dismiss the results section.

---

## 7. Scoring — Parallel (CSV Upload)

Switch to the **Parallel (CSV Upload)** tab to score many rows at once from a CSV file.

### Uploading a CSV

Drag and drop a `.csv` file onto the upload area, or click to browse. The file is parsed client-side — nothing is uploaded to a server.

### Column Mapping

After the CSV is parsed, a mapping interface shows each module input parameter on the left and a dropdown of CSV column names on the right. The app automatically maps columns by name (case-insensitive, ignoring underscores, spaces, and hyphens). You can adjust any mapping manually.

A badge shows how many parameters are mapped (e.g. "8/8 mapped"). All parameters must be mapped before you can run.

### Data Preview

A preview table shows the first few rows of your CSV data so you can verify the data looks correct.

### Configuring the Run

- **Parallel Requests** — Controls how many scoring requests run concurrently (1 to 100). Higher values score faster but put more load on the server. Start with 2-4 and increase if needed.

### Running the Batch

Click **Run All** to start. A progress bar shows how many rows have been processed. You can click **Stop** at any time — partial results are kept and displayed immediately.

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

**Results table:**

Each row shows the row number, status badge, output values, and runtime. Click **Show** on any row to expand it and see the full input and output JSON.

**Actions:**

| Button | What It Does |
|--------|--------------|
| **Save as Scenarios** | Save selected rows as test scenarios (select rows using checkboxes first) |
| **Upload to CAS** | Upload the results as a new CAS table |
| **Download CSV** | Export results as a CSV file including inputs, outputs, runtime, status, and errors |
| **Clear Results** | Remove the results from the screen |

### Selecting Rows

Click the checkbox next to any successful row to select it. Use **Shift+Click** to select a range. Use the header checkbox to select or deselect all successful rows. Only successful rows can be selected.

---

## 8. Scoring — Parallel (CAS Table)

Switch to the **Parallel (CAS Table)** tab to score rows directly from a CAS table without downloading data first.

### Browsing CAS Tables

1. **CAS Server** — Select the CAS server from the dropdown (e.g. `cas-shared-default`).
2. **Caslib** — Select the caslib (library) that contains your table (e.g. `Public`).
3. **Table** — The app lists all tables in the selected caslib that have at least one row. Use the filter box to narrow the list. Click a table to select it.

### Column Mapping

Once you select a table, the app loads its column metadata and shows the mapping interface — the same as CSV upload. Columns are auto-matched by name. Adjust any mapping manually using the dropdowns.

### Data Preview

A 5-row preview of the table is shown so you can verify the data and column types.

### Configuring the Run

- **Score full table** — Check this to score every row in the table. When unchecked, a **Row Limit** field lets you cap how many rows to score (default: 1,000).
- **Parallel Requests** — Same concurrency control as CSV mode.

### Save as Test

For Decision modules, a **Save as Test** button appears next to **Run All**. This lets you save the CAS table and column mapping configuration as a Test (score definition) back to SAS Intelligent Decisioning — without needing to run the batch first. See [Scenarios and Tests](#9-scenarios-and-tests) for details.

### Running and Results

Click **Run All** to start the batch. The results interface is identical to the CSV upload mode, with the same statistics, table, selection, and export capabilities.

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
2. A dialog lists all saved scenarios for the current decision.
3. Click a scenario to load its input values into the form.

### Tests

A **Test** captures a CAS table reference and column-to-variable mappings. Instead of static values, the test points to a table that can be re-scored at any time.

**Saving a test (from Parallel CAS Table):**

1. In the CAS Table tab, select a table and map all columns.
2. Click **Save as Test** (you do not need to run the batch first).
3. Fill in the dialog:
   - **Input Table** — Shown read-only, confirming the server, caslib, and table name.
   - **Name** — A name for this test.
   - **Description** — Optional description.
   - **SAS Content Folder** — Browse and select a folder (click "Select current folder" to confirm).
   - **CAS Output Library** — Choose where the output table will be written.
   - **Column Mappings** — A read-only summary showing each variable mapped to its CAS column.
4. Click **Save Test**.

Both Scenarios and Tests appear in SAS Intelligent Decisioning under the decision's test section, where they can be executed and validated.

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

The builder has three main areas:

**Toolbar (top):**

| Button | Description |
|--------|-------------|
| **Back** | Return to the UI Apps list |
| **Layout columns** (1 / 2 / 3) | Set the number of form columns |
| **Copy Standalone Link** | Copy a URL that opens this UI without the sidebar or header (see [Standalone Mode](#standalone-mode)) |
| **Replace Module** | Swap the underlying module while preserving as much of the field configuration as possible (available when editing an existing app) |
| **Preview / Edit** | Toggle between editing and previewing the live form |
| **Save** | Save the current configuration |
| **Delete** | Delete this UI App |

**Canvas (center):**

The canvas shows your form layout organized into **sections**. Each section has a title, can be collapsed, and contains one or more fields.

- Click **Add Section** to create a new section.
- Click **Add Text Block** to insert a static markdown text block (supports inline images).
- Use the **up/down arrows** on a section to reorder it.
- Click the **X** on a section to remove it.

**Field Configuration:**

Click any field to configure it. Each field has these properties:

| Property | Description |
|----------|-------------|
| **Label** | Display name shown to the user |
| **Description** | Help text shown below the field |
| **Widget** | The type of UI control (see below) |
| **Width** | Full, Half, or Third of the section width |
| **Direction** | Input (user provides value), Output (shows results), or Static (always visible) |
| **Default Value** | Pre-populated value |
| **Visible** | Whether the field is shown in the form |
| **Placeholder** | Hint text shown when the field is empty |

### Widget Types

| Widget | Use For | Configuration |
|--------|---------|---------------|
| **Text Input** | Free-text string inputs | Max length |
| **Number Input** | Numeric inputs | Min, Max, Step, Decimal places |
| **Slider** | Numeric inputs with a visual range | Min, Max, Step |
| **Dropdown** | Picking from a fixed list | Options (label/value pairs) |
| **Radio Buttons** | Picking from a small set of options | Options (label/value pairs) |
| **Toggle Switch** | Boolean (yes/no) inputs | — |
| **Text Area** | Multi-line text inputs | Max length |
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

### UI Settings

Open the settings panel to configure app-wide options:

| Setting | Options |
|---------|---------|
| **Title** | The heading shown at the top of the app |
| **Submit Button Label** | Text on the execute button (e.g. "Score", "Calculate", "Submit") |
| **Show Execution Time** | Display how long the scoring request took |
| **Theme** | Default, Compact, or Card |
| **Output Layout** | Inline (outputs mixed with inputs), Below (outputs in a separate section), or Side-by-side (inputs on the left, outputs on the right) |

### Running a UI App

From the **UI Apps** list, click **Run** on any app. The runner displays the form as configured in the builder.

1. Fill in the input fields.
2. Click the submit button (label configured in settings).
3. Output fields update with the results.
4. Click **Reset** to clear the form and start over.

**Header actions in the runner:**

- **Standalone** — Switch to standalone mode (see below).
- **Edit** — Open the builder to modify the app.
- **Back** — Return to the UI Apps list.

### Standalone Mode

Standalone mode removes the sidebar, header, and all navigation chrome, leaving only the UI App form centered on the page. This is useful for sharing a direct link with business users or embedding in other tools.

- From the runner, click **Standalone** in the header.
- From the builder, click **Copy Standalone Link** to get a shareable URL.
- In standalone mode, an **Exit Standalone** bar appears at the top to return to the full application.

The standalone URL follows the pattern: `#/ui-apps/{appId}?standalone=true`

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

### Replace Module

When editing an existing UI App, you can swap the underlying module without starting from scratch:

1. Click **Replace Module** in the builder toolbar.
2. Browse and search modules. Use the type filter to narrow results.
3. Select the new module and its step.
4. A parameter mapping screen appears showing the old and new parameters side by side. The app auto-matches parameters by name. You can manually remap or remove any field.
5. Click **Replace** to apply the changes.

Fields that map successfully keep their widget configuration, labels, and settings. Unmapped fields are removed.

---

## 13. View Flows

The **View Flows** page lets you explore SAS Intelligent Decisioning decision flows as interactive diagrams.

### Flow List

The list page shows all decision flows in your environment. Use the search box to filter by name or description. Click a decision to open its flow diagram.

### Flow Diagram

The diagram renders the full decision flow with all node types:

| Node Type | Description |
|-----------|-------------|
| **Start / End** | Entry and exit points of the flow |
| **Sub-Decision** | A nested decision flow (expanded recursively up to 3 levels deep) |
| **Rule Set** | Business rules with conditions and actions |
| **Model** | A published model |
| **Code File** | Custom code (DS2, Python, SQL) |
| **Condition** | A branching point based on a condition |
| **Assignment** | Variable assignment nodes |
| **A/B Test** | Random split for testing |
| **Parallel Process** | Nodes that run concurrently |
| **Record Contact** | Contact history recording |
| **Treatment Group** | Treatment assignment |
| **Segmentation Tree** | Decision tree segmentation |

**Diagram controls:**

- **Pan** — Click and drag the canvas.
- **Zoom** — Scroll wheel, or use the +/- controls in the bottom-left.
- **Fit View** — Click the fit-to-screen button to zoom the entire flow into view.
- **Mini Map** — A small overview in the bottom-right corner for navigation.
- **Legend** — Toggle the legend to see what each node color and shape represents.

### Node Details Side Panel

Click any node in the diagram to open a side panel with detailed information:

- **Rule Sets** — Shows individual rules with their conditions and actions.
- **Models** — Shows the algorithm, input/output variables, and model properties.
- **Code Files** — Shows a preview of the code with a button to open a full syntax-highlighted viewer.
- **Treatment Groups** — Shows member definitions, attributes, and eligibility criteria.
- **Segmentation Trees** — Shows split conditions and outcomes.

Where applicable, the side panel includes deep links to open the asset directly in SAS Intelligent Decisioning or SAS Model Manager.

### Code Viewer

When viewing a code file node, click the code link to open a full-screen code viewer with syntax highlighting for Python, DS2, SQL, and other languages. Press **Escape** to close.

### Workflow History

If the decision has an associated workflow, the flow header shows the current workflow state and last modifier. Click the workflow indicator to open a timeline view showing all state transitions — who made each change, when, and any comments.

### Export

Click **Export** to generate a Markdown document with a Mermaid diagram of the flow and enriched node details.

---

## 14. Test Coverage Analysis

The **Test Coverage** page helps you understand which of your SAS Intelligent Decisioning and Model Manager assets have test scenarios defined.

### Running an Analysis

1. Navigate to **Test Coverage** in the sidebar.
2. Click **Start Analysis** (or **Run Analysis** if you have previous results).
3. The app collects all assets from your environment:
   - Decisions
   - Business Rules
   - Code Files
   - Treatment Definitions
   - Segmentation Trees
4. It then cross-references these against Score Definitions to determine which assets have test scenarios.
5. A progress indicator shows the current phase and item count.

### Reading the Results

**Summary Dashboard:**

- **Coverage Gauge** — A circular gauge showing overall coverage percentage.
- **Stat Cards** — Total assets, assets with tests, and assets without tests.
- **Coverage by Asset Type** — A bar chart showing coverage percentage for each asset type (Decisions, Business Rules, Code Files, etc.), color-coded by coverage level.

**Detail Table:**

The table lists every asset with columns for Name, Type, Coverage status, number of Tests, Created By, and Modified date.

- **Search** — Filter by name or author.
- **Type filter** — Show only a specific asset type.
- **Coverage filter** — Show All, Covered only, or Uncovered only.
- Click a column header to sort.

**Expanding a Row:**

Click the chevron on any covered asset to expand it and see its individual test scenarios — including the scenario name, type, and description.

**Deep Links:**

Each asset row has a link icon that opens the asset in SAS Intelligent Decisioning. Decision assets also have a flow icon that opens the in-app flow viewer.

### Exporting

- **Export CSV** — Downloads a `test-coverage.csv` file with all assets and their coverage status.
- **Export Markdown** — Downloads a formatted `test-coverage-report.md` with the full analysis.

---

## 15. Keyboard and Interaction Tips

- **Shift+Click** on batch result checkboxes to select a range of rows.
- **Escape** closes the code viewer modal in the View Flows page.
- **Tab** moves between input fields in the scoring form.
- The scoring panel **remembers your last-used folder and CAS library** when saving scenarios and tests, so you do not need to re-select them each time.
- Switching between Single Execution, Parallel (CSV), and Parallel (CAS Table) modes **clears previous results** to avoid confusion.
- In the folder browser dialogs, you must click the **"Select current folder"** link at the bottom to confirm your folder choice. Simply navigating into a folder does not select it.

---

## Additional Resources

- [MAS API Documentation](https://developer.sas.com/rest-apis/microanalyticScore)
- [Score Definitions API Documentation](https://developer.sas.com/rest-apis/scoreDefinitions)
- [CHANGELOG.md](CHANGELOG.md) — Detailed list of changes in each release
- [MAS Module Scorer Playlist (YouTube)](https://youtube.com/playlist?list=PLncvHGGelzhUHszGZ39TPMCxNYjNTAp7B&si=9Y2iL7Kzk_iRQn1r) — Video walkthrough and update videos of the application
