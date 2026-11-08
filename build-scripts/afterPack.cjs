// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * electron-builder afterPack hook: set the Electron fuses on the packaged
 * binary, before it is signed.
 *
 * Fuses are switches compiled into the Electron executable. Turned off here:
 * running the app as plain Node (ELECTRON_RUN_AS_NODE), NODE_OPTIONS and the
 * --inspect flags, so the signed app cannot be started as a general-purpose
 * script runner. Turned on: loading the app only from its app.asar, checking
 * that archive against the hash built into the executable, and encrypting the
 * cookie store.
 *
 * GrantFileProtocolExtraPrivileges stays on: the app's page is loaded from
 * file://, which needs those privileges. Moving it to a custom app:// protocol
 * would allow turning it off, but would also move the page's saved data
 * (UI Apps, SCR endpoints, settings in localStorage) to a new origin.
 */

const path = require('node:path');

exports.default = async function afterPack(context) {
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses');
  const { electronPlatformName, appOutDir, packager, arch } = context;

  const productFilename = packager.appInfo.productFilename;
  const executable =
    electronPlatformName === 'darwin'
      ? path.join(appOutDir, `${productFilename}.app`)
      : electronPlatformName === 'win32'
        ? path.join(appOutDir, `${productFilename}.exe`)
        : path.join(appOutDir, packager.executableName);

  await flipFuses(executable, {
    version: FuseVersion.V1,
    // Flipping fuses invalidates the ad-hoc signature macOS arm64 needs to run.
    resetAdHocDarwinSignature: electronPlatformName === 'darwin' && arch === 3 /* Arch.arm64 */,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  });
};
