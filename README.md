# SAS MAS Scorer

## Overview

Application to score Models and Decisions deployed in the SAS Micro Analytics Service.

The following features are provided:
- Search & browse all published Models and Decisions (called Modules)
- Get details about each individual module
- Score either a single manually entered row or upload and score full csv files
- When scoring csv files metrics are collected about the runtime
- Get code samples for calling a module with its inputs
- View Decision Flows as interactive visual diagrams
- Test Coverage analysis across modules and decisions with CSV/Markdown export
- UI Apps builder — drag-and-drop form builder to create custom UIs on top of modules
- Can be deployed on a webserver, imported via the provided Transfer Package, or run as a desktop app (Electron)
- Desktop app supports multiple named Viya connections (e.g. dev, staging, production) with per-connection authentication

## Deployment

There are three ways to run this application. Choose the one that best fits your environment.

### Web Server (Standalone)

Deploy to a static web server for a dedicated URL that maximizes the available screen.

1. Download [dist.zip](./dist.zip) and unzip it onto your web server
2. If the web server is on the **same origin** as SAS Viya, no further configuration is needed
3. If it is on a **different origin**, edit the `config.js` file and set `SAS_VIYA_URL` to the URL of your SAS Viya environment. CORS must also be configured on the Viya server to allow requests from the web server origin - please see [SAS Viya Platform documentation](https://developer.sas.com/sdk/js/getting-started#sas-viya-platform-setup) for the required setup instructions.

The application is then available at the URL corresponding to your web server and the subdirectory you deployed to.

### SAS Visual Analytics Integration (Job Definition)

Embed the application directly inside a SAS Visual Analytics report so users never have to leave the SAS Viya environment.

#### SAS Environment Manager Configuration

The following Content Security Policy directives must be present in **three** places. Configure them via SAS Environment Manager > Configuration > View Definitions:

1. **SAS Visual Analytics** (_sas.commons.web.security_ > _SAS Visual Analytics_ > _content-security-policy_):

   ```
   default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src * blob: data:; frame-src * blob: data: mailto:; connect-src 'self' *.sas.com login.microsoftonline.com graph.microsoft.com *.arcgis.com *.arcgisonline.com; object-src 'none'
   ```

2. **SAS Job Execution** (_sas.commons.web.security_ > _SAS Job Execution_ > _content-security-policy_) - make sure to replace \<sas-viya-host\> with your environments URL:

    ```
    default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://<sas-viya-host>; style-src 'self' 'unsafe-inline'; img-src * blob: data:; child-src 'self' blob: data: ; frame-ancestors 'self'; form-action 'self';
    ```

Also check that the _sas.visualanalytics_ definition has at least the following entries for the _IFrame Sandbox Attribute Value_: _allow-same-origin allow-scripts_

Here is an explanation on why these directives are needed.

| Directive                      | Reason                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `script-src 'unsafe-inline'`   | Inline `<script>` tag containing the bootstrap loader                                    |
| `script-src 'unsafe-eval'`     | The JS bundle is base64-encoded to survive Go template processing (see below) and decoded at runtime via `new Function()` |
| `style-src 'unsafe-inline'`    | Inline `<style>` tag containing all CSS                                                  |
| `connect-src 'self'`           | API calls to SAS Viya on same origin                                                     |
| `img-src 'self' data:`         | SVG icons may use data URIs                                                              |

> **Why base64-encoded scripts?** SAS Job Execution serves HTML through a Go template engine that interprets `{{` and `}}` as template directives. A minified JS bundle inevitably contains these sequences (in regex, template literals, destructuring, etc.), causing syntax errors. The build encodes the entire JS bundle as base64 and decodes it at runtime, eliminating all `{{` sequences from the raw HTML.

#### Import

Import the [transfer package](./SAS-Visual-Analytics-Integration.json) via the Import page in the SAS Environment Manager. This will add the following to your environment:
- A folder in Public called _MAS Module Scorer_ — all subsequent content is stored in there
- A Job Execution HTML Form called _MAS Module Scorer_ — this is the frontend of the application
- A SAS Visual Analytics report _MAS Module Scorer Report_ — this report also contains change instructions and tips on its first page

After importing, change the URL in the Data Driven Content object of the report to correspond to the URL of your SAS Viya server.

### Desktop App (Electron)

A standalone desktop application for **Windows**, **macOS**, and **Linux** with support for multiple named Viya connections and per-connection authentication.

Download the latest installer for your platform from the [Releases](https://github.com/sassoftware/sas-mas-scorer/releases) page.

#### First launch

On first launch the app will show an **Add Connection** form. You will need:

| Field | Description |
|-------|-------------|
| **Connection Name** | A label for this connection (e.g. "Production", "Dev") |
| **SAS Viya Server URL** | The base URL of your Viya environment (e.g. `https://viya.example.com`) |
| **Client ID** | An OAuth client registered on the Viya server. The default `vscode` works on Viya 2022.11+ |
| **Client Secret** | Leave empty for the default public client |
| **Skip SSL verification** | Enable for dev/test environments with self-signed certificates |

After saving, click **Login** to authenticate via the browser-based OAuth flow. You can add multiple connections and switch between them from the settings panel (gear icon).

#### Registering a custom OAuth client

The desktop app uses the OAuth 2.0 authorization code flow with PKCE. The default `vscode` client works on Viya 2022.11+, but you can register your own client if preferred.

**Using the SAS Viya CLI** (requires the oauth plugin):
```bash
sas-viya --profile my-admin-profile auth login
sas-viya oauth register-client \
      --grant-authorization-code \
      --grant-refresh-token \
      --scope openid \
      --id mas-scorer \
      --secret your-client-secret
```

**Using curl** (requires a bearer token from a SAS Administrators account):

```bash
curl -k -X POST "https://your-viya-server.example.com/SASLogon/oauth/clients" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $BEARER_TOKEN" \
    -d '{
        "client_id": "mas-scorer",
        "client_secret": "your-client-secret",
        "scope": ["openid"],
        "authorized_grant_types": ["authorization_code", "refresh_token"],
        "redirect_uri": "urn:ietf:wg:oauth:2.0:oob"
    }'
```

See the [SAS Viya Authentication documentation](https://go.documentation.sas.com/doc/en/sasadmincdc/v_074/calauthmdl/titlepage.htm) for details.

### Getting Started

Check out the [User Guide](./USER-GUIDE.md) included in this repository.

[MAS Module Scorer Playlist (YouTube)](https://youtube.com/playlist?list=PLncvHGGelzhUHszGZ39TPMCxNYjNTAp7B&si=9Y2iL7Kzk_iRQn1r) — Video walkthrough and update videos of the application.

## Building from Source

All build targets require [Node.js](https://nodejs.org/) 22.12+ and npm.

```bash
git clone <repo-url>
cd sas-mas-scorer
npm install
```

### Web Server

```bash
npm run build
```

This outputs the application to the `dist/` directory and packages it as `dist.zip`.

### Job Definition (SAS Visual Analytics)

```bash
npm run build:jobdef
```

This outputs a single-file `dist-jobdef/index-jobdef.html` that can be uploaded to SAS Content.

### Desktop App (Electron)

For development with hot-reload:
```bash
npm run electron:dev
```

To build a distributable installer:
```bash
npm run electron:build
```

This produces a platform-specific installer in the `release/` directory (NSIS `.exe` on Windows, `.dmg` on macOS, `.AppImage` on Linux).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a detailed list of changes in each release.

## Contributing
Maintainers are accepting patches and contributions to this project.
Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details about submitting contributions to this project.

## License
This project is licensed under the [Apache 2.0 License](LICENSE).

## Additional Resources

* [MAS API Documentation](https://developer.sas.com/rest-apis/microanalyticScore)
* [MAS Module Scorer Playlist (YouTube)](https://youtube.com/playlist?list=PLncvHGGelzhUHszGZ39TPMCxNYjNTAp7B&si=9Y2iL7Kzk_iRQn1r) — Video walkthrough and update videos of the application
