# Changelog

All notable changes to the SAS MAS Scorer will be documented in this file.

## [2.0.0] - 2026-03-30

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
