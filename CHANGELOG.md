# Changelog

All notable changes to the SAS MAS Scorer will be documented in this file.

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
