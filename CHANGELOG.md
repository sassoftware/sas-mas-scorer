# Changelog

All notable changes to the SAS MAS Scorer will be documented in this file.

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
