// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Turns engine CLI failures into messages a user can act on. Pure functions.
 *
 * Classified by text, never by exit code: Podman exits 125 for every pull
 * failure and Docker 1, and a container without an emulator exits 255 on
 * Docker and 1 on Podman. The patterns come from captured output of Docker
 * 29.9.3 / 28.5.1 and Podman 5.6.2.
 */

import type { EngineKind, Problem } from './types';

/** Removes things that look like secrets from text shown to the user. */
export function redact(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[redacted token]')
    .replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//[redacted]@')
    .replace(/(password|passwd|secret|token)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1$2[redacted]')
    // Long runs mixing upper case, lower case and digits, as encoded secrets do.
    // Digests and IDs (lowercase hex) and file paths (split at '/') stay.
    .replace(/(?=[A-Za-z0-9+]*[A-Z])(?=[A-Za-z0-9+]*[a-z])(?=[A-Za-z0-9+]*[0-9])[A-Za-z0-9+]{41,}={0,2}/g, '[redacted]');
}

/** The last non-empty lines, redacted, for a problem's detail. */
export function tail(text: string, lines = 4): string {
  return redact(
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-lines)
      .join('\n')
  );
}

export const signInCommand = (kind: EngineKind, host: string): string => `${kind} login ${host}`;

export const SIGN_IN_HINT =
  'Run this in a terminal, then try again. For Harbor, a pull-only robot account is the safest choice. ' +
  'MAS Scorer never asks for, stores or passes on registry passwords.';

/** The parts of an image reference the classifier needs. */
export interface RefParts {
  host: string;
  repo: string;
  tag: string | null;
  digest: string | null;
}

const refString = (ref: RefParts, repo = ref.repo): string =>
  `${ref.host}/${repo}${ref.tag ? `:${ref.tag}` : ''}${ref.digest ? `@${ref.digest}` : ''}`;

export function classifyPullError(stderr: string, kind: EngineKind, ref: RefParts): Problem {
  const { host } = ref;
  const detail = tail(stderr);
  // Harbor answers a pull from a project it does not have with
  // "unauthorized: project <name> not found" (measured, Podman and Docker 28).
  // The cause is the path, not the sign-in.
  const harborProject = /project (\S+) not found/i.exec(stderr);
  if (harborProject) {
    const project = harborProject[1].replace(/[:;,]+$/, '');
    // "/harbor/" starts the addresses of Harbor's web pages. Copied from there,
    // the path has it in front of the real project: offer the path without it.
    const rest = ref.repo.split('/').slice(1).join('/');
    const fromWebAddress = project === 'harbor' && ref.repo.startsWith('harbor/') && rest.includes('/');
    return {
      code: 'not-found',
      title: `${host} has no project "${project}"`,
      detail,
      hint: fromWebAddress
        ? '"/harbor/" belongs to the addresses of Harbor\'s web pages, not to image paths. The image path starts with the Harbor project.'
        : 'The first part of the path after the host is the Harbor project (for example library). Check the image ' +
          'reference. If the project does exist, check that your account may pull from it.',
      suggestedRef: fromWebAddress ? refString(ref, rest) : undefined,
    };
  }
  if (/no matching manifest|does not provide the specified platform|no image found in manifest list/i.test(stderr)) {
    return { code: 'no-platform', title: 'The image has no variant for this computer', detail };
  }
  if (/x509:|certificate signed by unknown authority|tls: failed to verify|certificate is not valid/i.test(stderr)) {
    return {
      code: 'tls',
      title: `The container engine does not trust ${host}'s certificate`,
      detail,
      hint:
        "The engine has its own certificate trust, separate from this app's and often from the operating system's. " +
        `Add the registry's CA certificate for the engine (Docker: /etc/docker/certs.d/${host}/ca.crt; ` +
        `Podman: /etc/containers/certs.d/${host}/ca.crt inside its machine), or restart the engine if the system ` +
        'store was updated after it started. The app never pulls without TLS verification.',
    };
  }
  if (
    /unauthorized|401 Unauthorized|403 Forbidden|requested access to the resource is denied|pull access denied|authentication required|denied: /i.test(
      stderr
    )
  ) {
    return {
      code: 'signin',
      title: `Not signed in to ${host}, or no access to this repository`,
      detail,
      command: signInCommand(kind, host),
      hint: SIGN_IN_HINT,
    };
  }
  if (/manifest unknown|name unknown|: not found\b|artifact .+ not found|not found: manifest|reading manifest .+ not found/i.test(stderr)) {
    return {
      code: 'not-found',
      title: 'Image or tag not found',
      detail,
      hint: 'Check the reference. The tag may have moved or the image may have been deleted from the registry.',
    };
  }
  if (/no such host|dial tcp|i\/o timeout|connection refused|network is unreachable|TLS handshake timeout|context deadline exceeded|connection reset/i.test(stderr)) {
    return { code: 'network', title: `Cannot reach ${host}`, detail, hint: 'Check the network connection or VPN.' };
  }
  return { code: 'unknown', title: 'The pull failed', detail };
}

export function isPortInUse(stderr: string): boolean {
  return /port is already allocated|address already in use|bind: .*in use|ports are not available/i.test(stderr);
}

export function classifyRunError(stderr: string): Problem {
  if (isPortInUse(stderr)) {
    return { code: 'port-in-use', title: 'No free local port could be bound', detail: tail(stderr) };
  }
  // Podman: "statfs /mnt/c/…: no such file or directory"; Docker: "bind source path does not exist".
  if (/statfs .*no such file or directory|bind source path does not exist|invalid mount config/i.test(stderr)) {
    return {
      code: 'engine',
      title: 'The container engine cannot see a folder to mount',
      detail: tail(stderr),
      hint:
        'The folder exists on this computer, but not where the engine looks. Podman on Windows and macOS sees ' +
        'local drives through its machine; network and removable drives are often not shared with it.',
    };
  }
  return { code: 'engine', title: 'The container could not be started', detail: tail(stderr) };
}

/**
 * A container that stopped before its endpoint answered. Without an emulator
 * for the image's architecture, `run -d` still succeeds; only the log says
 * why (Docker: "exec /x: exec format error", crun: "Exec format error").
 */
export function classifyEarlyExit(logs: string, exitCode: number, imageArch: string, engineArch: string): Problem {
  if (/exec format error/i.test(logs)) {
    return {
      code: 'no-emulator',
      title: `This computer can't run ${archLabel(imageArch)} images yet`,
      detail: `The image is built for ${archLabel(imageArch)} and the container engine runs on ${archLabel(engineArch)}, but it has no emulator for ${archLabel(imageArch)}.`,
      hint:
        'Install an emulator for the container engine, then start the container again. On Linux that is the ' +
        'qemu-user-static package (Debian/Ubuntu: sudo apt install qemu-user-static; Fedora: sudo dnf install qemu-user-static). ' +
        'Docker Desktop on a Mac: turn on "Use Rosetta for x86_64/amd64 emulation on Apple Silicon". ' +
        'MAS Scorer never installs an emulator itself.',
    };
  }
  return {
    code: 'exited',
    title: `The container stopped during start-up (exit code ${exitCode})`,
    detail: tail(logs, 6) || undefined,
    hint: 'Open the logs for the full output.',
  };
}

export function archLabel(arch: string): string {
  if (arch === 'amd64') return 'x86-64';
  if (arch === 'arm64') return 'ARM';
  return arch || 'an unknown architecture';
}
