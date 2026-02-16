# SAS MAS Scorer

## Overview

Application to score Models and Decisions deployed in the SAS Micro Analytics Service.

The following features are provided:
- Search & Browser all published Models and Decisions (called Modules)
- Get details about each individual module
- Score either a single manually entered row or upload and score full csv files
- When scoring csv files metrics are collected about the runtime
- Get code samples for calling a module with its inputs
- Can be deployed on a webserver or imported via the provided Transfer Package

### Prerequisites
Please choose if you want to deploy this on a webserver or as an integration with SAS Visual Analytics. The webserver variant provides a dedicated URL that users can access to use this application and maximizes the avaliable screen. The integration with SAS Visual Analytics provides the ability to just integrate this into any existing SAS Visual Analytics report so that users never have to leave the SAS Viya environment. Both have different prerequisites which are described below.

#### Standalone
A static webserver like the Apache HTTP Server is required.
The prerequisites described in for the SAS Visual Analytics SDK have to be followed - [SAS Documentation](https://developer.sas.com/sdk/va/docs/guides/viya-setup).

#### SAS Visual Analytics Integration
The following configurations have to be in the Content Security Policy - at least additional configurations are okay:
default-src 'self';script-src 'self' 'unsafe-inline';style-src 'self' 'unsafe-inline';connect-src 'self';img-src 'self' data:;

These configurations are done via the SAS Environment Manager > Configuration page > View Definitions > Search for _sas.commons.web.security_ > and then add this to Files service and SAS Visual Analytics services (or to the global if you feel comfortable with that) in the _content-security-policy_ property.

In addition please check that the _sas.visualanalytics_ definition has at least the following two entries for the _IFame Sandbox Attribute Value_: _allow-same-origin allow-scripts_

Here is an explanation on why they are needed.
| Directive                    | Reason                                          |
| ---------------------------- | ----------------------------------------------- |
| `script-src 'unsafe-inline'` | Inline `<script>` tag containing all JavaScript |
| `style-src 'unsafe-inline'`  | Inline `<style>` tag containing all CSS         |
| `connect-src 'self'`         | API calls to SAS Viya on same origin            |
| `img-src 'self' data:`       | SVG icons may use data URIs                     |

## Installation

### Standalone

You can just download the [./dist.zip](./dist.zip) and unzip that onto your webserver. If it is under the same URL origin as the SAS Viya environment you do not have to do anything else - otherwise edit the config.js file and enter the URL of your SAS Viya environment for the SAS_VIYA_URL value.

That is it, the application is now available under the URL that corresponds to the webserver you have deployed and the subdirectory that you put this application into.

If you want to build this from source you will require Node.js 18+ and npm installed on your system and then run
```bash
npm run build
```

### SAS Visual Analytics Integration

You have to import the [transfer packages](./SAS-Visual-Analytics-Integration.json) via the Import page in the SAS Environment Manager. This will add the following to your environment:
- New folder in Public called _MAS Module Scorer_ - all subsequent content is stored in there
- A Job Execution HTML Form called _MAS Module Scorer_ - this is the frontend of the application
- A SAS Visual Analytics report _MAS Module Scorer Report_ - this report also contains as its first page the change instructions and other tips around this report
- Change the URL in the Data Driven Content object of the report to correspond to the URL of your SAS Viya Server

### Getting Started
This YouTube video showcases both how you can deploy both variants and how to use them - [MAS Module Scorer Overview]([TBD](https://youtu.be/mSSoNryixUM)).

## Contributing
Maintainers are accepting patches and contributions to this project.
Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details about submitting contributions to this project.

## License
This project is licensed under the [Apache 2.0 License](LICENSE).

This project requires the usage of the following:

- [sas-auth-browser](https://github.com/sassoftware/sas-viya-sdk-js/tree/main/sdk/sas-auth-browser) ([License](https://github.com/sassoftware/sas-viya-sdk-js/blob/main/sdk/sas-auth-browser/LICENSE))
- [axios](https://github.com/axios/axios) (MIT)
- [react](https://github.com/facebook/react) (MIT)
- [react-dom](https://github.com/facebook/react/tree/main/packages/react-dom) (MIT)
- [react-dom-router](https://github.com/remix-run/react-router) (MIT)


## Additional Resources

* [MAS API Documentation](https://developer.sas.com/rest-apis/microanalyticScore)
