// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Parsers for docker/podman CLI output. Pure functions. The shapes differ
 * between the engines (measured on Docker 29.9.3 and Podman 5.6.2):
 *   - version: Docker Server.Arch, Podman Server.OsArch ("linux/amd64")
 *   - ps --format json: Docker one object per line with a short ID and
 *     Names as a string; Podman one array with the full Id and Names[]
 *   - image/container inspect: a JSON array on both
 */

import type { ImageFacts } from './types';

export interface VersionFacts {
  clientVersion?: string;
  serverVersion?: string;
  /** Image-style architecture (amd64, arm64) of the engine's host or VM. */
  arch?: string;
  os?: string;
  /** False when the client could not reach the engine. */
  serverReachable: boolean;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function firstJson(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // Docker can print the JSON followed by more text; take the first line.
    try {
      return JSON.parse(text.split(/\r?\n/)[0]);
    } catch {
      return undefined;
    }
  }
}

export function parseVersion(stdout: string): VersionFacts {
  const j = firstJson(stdout) as { Client?: Record<string, unknown>; Server?: Record<string, unknown> | null } | undefined;
  const server = j?.Server && typeof j.Server === 'object' ? j.Server : null;
  const osArch = str(server?.OsArch);
  const [osFromPair, archFromPair] = osArch ? osArch.split('/') : [];
  return {
    clientVersion: str(j?.Client?.Version),
    serverVersion: str(server?.Version),
    arch: str(server?.Arch) ?? archFromPair,
    os: str(server?.Os) ?? osFromPair,
    serverReachable: !!server && !!str(server.Version),
  };
}

/** Major version number of a version string such as 28.5.1 or 29.0.0-rc.1. */
export function majorVersion(version: string | undefined): number | null {
  const m = version ? /^(\d+)\./.exec(version) : null;
  return m ? Number(m[1]) : null;
}

export interface PsRow {
  /** Full ID (Podman) or the 12-character short ID (Docker). */
  id: string;
  name: string;
  state: string;
  status: string;
  exitCode?: number;
}

export function parsePs(stdout: string): PsRow[] {
  const text = stdout.trim();
  if (!text) return [];
  let items: unknown[];
  if (text.startsWith('[')) {
    items = JSON.parse(text) as unknown[];
  } else {
    items = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as unknown);
  }
  return items.map((raw) => {
    const r = raw as Record<string, unknown>;
    const names = Array.isArray(r.Names) ? (r.Names as unknown[]).map(String) : String(r.Names ?? '').split(',');
    return {
      id: String(r.Id ?? r.ID ?? ''),
      name: names[0] ?? '',
      state: String(r.State ?? '').toLowerCase(),
      status: String(r.Status ?? ''),
      exitCode: typeof r.ExitCode === 'number' ? r.ExitCode : undefined,
    };
  });
}

export interface ContainerState {
  status: string;
  running: boolean;
  exitCode: number;
  error: string;
  startedAt?: string;
  finishedAt?: string;
  /** Image ID the container was created from (Docker: sha256:…, Podman: bare hex). */
  image: string;
  /** Config.Env: the image's variables, the engine's and the ones set at run, as NAME=value. */
  env: string[];
}

export function parseContainerInspect(stdout: string): ContainerState | null {
  const j = firstJson(stdout);
  const first = Array.isArray(j) ? (j[0] as Record<string, unknown> | undefined) : undefined;
  const s = first?.State as Record<string, unknown> | undefined;
  if (!s) return null;
  const config = (first?.Config ?? {}) as Record<string, unknown>;
  return {
    status: String(s.Status ?? '').toLowerCase(),
    running: s.Running === true,
    exitCode: typeof s.ExitCode === 'number' ? s.ExitCode : 0,
    error: String(s.Error ?? ''),
    startedAt: str(s.StartedAt),
    finishedAt: str(s.FinishedAt),
    image: String(first?.Image ?? ''),
    env: Array.isArray(config.Env) ? (config.Env as unknown[]).map(String) : [],
  };
}

/** Values of the named variables in a container's Config.Env (later entries win, as in the engine). */
export function envValues(env: string[], names: string[]): { name: string; value: string }[] {
  const wanted = new Set(names);
  const found = new Map<string, string>();
  for (const entry of env) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const name = entry.slice(0, eq);
    if (wanted.has(name)) found.set(name, entry.slice(eq + 1));
  }
  return names.filter((n) => found.has(n)).map((name) => ({ name, value: found.get(name) as string }));
}

/**
 * Facts the app keeps about a pulled image. Only SAS_SCR_APP_PATH is read
 * from the image's environment; no other value is kept.
 */
export function parseImageInspect(stdout: string, pulledRepo: string): ImageFacts | null {
  const j = firstJson(stdout);
  const img = Array.isArray(j) ? (j[0] as Record<string, unknown> | undefined) : undefined;
  if (!img) return null;
  const config = (img.Config ?? {}) as Record<string, unknown>;
  const env = Array.isArray(config.Env) ? (config.Env as unknown[]).map(String) : [];
  const appPathEntry = env.find((e) => e.startsWith('SAS_SCR_APP_PATH='));
  const appPath = appPathEntry ? appPathEntry.slice('SAS_SCR_APP_PATH='.length).replace(/^\/+/, '') || null : null;
  const entrypoint = Array.isArray(config.Entrypoint) ? (config.Entrypoint as unknown[]).map(String).join(' ') : '';
  const isScr = !!appPath || /com\.sas\.mas\.solo|\/opt\/scr\//.test(entrypoint);

  const repoDigests = Array.isArray(img.RepoDigests) ? (img.RepoDigests as unknown[]).map(String) : [];
  const wanted = pulledRepo.toLowerCase();
  const digestRef =
    repoDigests.find((d) => d.slice(0, d.indexOf('@')).toLowerCase() === wanted) ?? repoDigests[0] ?? null;

  return {
    id: String(img.Id ?? ''),
    digestRef,
    arch: String(img.Architecture ?? ''),
    os: String(img.Os ?? ''),
    sizeBytes: typeof img.Size === 'number' ? img.Size : 0,
    appPath,
    kind: isScr ? 'scr' : 'other',
  };
}

const RESERVED_PATHS = new Set(['internal', 'executions', 'query', 'openapi.json', 'apimeta', 'prometheus', 'documentation']);

/**
 * The model name a SAS Python Runtime container logs at start-up
 * ("… - root - INFO - The model name is XGBoost."; seen on
 * sas-score-python3-base 3.69.17 and 3.84.1). The container serves the model
 * at POST /<name>. The last mention wins (a restarted container logs it again);
 * the line "The model name is derived from …" is not a name.
 */
export function modelNameFromLog(log: string): string | null {
  let found: string | null = null;
  for (const line of log.split(/\r?\n/)) {
    const m = /The model name is ([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})\.\s*$/.exec(line);
    if (m && !RESERVED_PATHS.has(m[1].toLowerCase())) found = m[1];
  }
  return found;
}

export interface MachineRow {
  name: string;
  running: boolean;
  isDefault: boolean;
}

export function parseMachineList(stdout: string): MachineRow[] {
  const j = firstJson(stdout);
  if (!Array.isArray(j)) return [];
  return j.map((raw) => {
    const r = raw as Record<string, unknown>;
    return { name: String(r.Name ?? '').replace(/\*$/, ''), running: r.Running === true, isDefault: r.Default === true };
  });
}

/** URI of the default Podman connection, from `system connection list --format json`. */
export function parsePodmanDefaultConnection(stdout: string): string | null {
  const j = firstJson(stdout);
  if (!Array.isArray(j)) return null;
  const rows = j as Record<string, unknown>[];
  const def = rows.find((r) => r.Default === true) ?? rows[0];
  return def ? str(def.URI) ?? null : null;
}

/** Engine endpoint of the current Docker context, from `context inspect`. */
export function parseDockerContextHost(stdout: string): string | null {
  const j = firstJson(stdout);
  const first = Array.isArray(j) ? (j[0] as Record<string, unknown> | undefined) : undefined;
  const endpoints = first?.Endpoints as Record<string, { Host?: unknown }> | undefined;
  return str(endpoints?.docker?.Host) ?? null;
}

/**
 * Whether an engine endpoint is on this computer: a unix socket, a Windows
 * named pipe, or SSH to the loopback address (how Podman reaches its own
 * machine). TCP engines are refused even on loopback: an engine API on a TCP
 * port can be driven by any local program.
 */
export function isLocalEngineUri(uri: string | null | undefined): boolean {
  if (!uri) return true;
  const lower = uri.toLowerCase();
  if (lower.startsWith('unix://') || lower.startsWith('npipe://')) return true;
  if (lower.startsWith('ssh://')) {
    try {
      const host = new URL(uri).hostname.replace(/^\[|\]$/g, '');
      return host === '127.0.0.1' || host === 'localhost' || host === '::1';
    } catch {
      return false;
    }
  }
  return false;
}

export interface PullProgress {
  layersTotal: number;
  layersDone: number;
  /** Last meaningful line, for display. */
  text: string;
  /** Docker: each layer by its short id, and whether it is in place. */
  layers?: Record<string, 'waiting' | 'done'>;
}

/**
 * Pull progress from the CLI's plain-text output. Docker reports each layer
 * by the first 12 hex digits of its digest ("<id>: Pulling fs layer" …
 * "<id>: Pull complete", or "Already exists"; Docker 29 says "Pulling fs
 * layer" first for those too, and "Download complete" also for blobs that are
 * not layers). Podman only says when it starts copying a blob, so it gives no
 * count of finished layers.
 */
export function updatePullProgress(progress: PullProgress, line: string): PullProgress {
  const docker = /^([0-9a-f]{12}): (.+)$/.exec(line.trim());
  const next = { ...progress };
  if (docker) {
    const [, id, what] = docker;
    const layers = { ...(progress.layers ?? {}) };
    if (/^(Already exists|Pull complete)/.test(what)) layers[id] = 'done';
    else if (/^(Pulling fs layer|Waiting)/.test(what)) layers[id] ??= 'waiting';
    else return next;
    const states = Object.values(layers);
    next.layers = layers;
    next.layersTotal = states.length;
    next.layersDone = states.filter((s) => s === 'done').length;
    next.text = 'Downloading';
    return next;
  }
  if (/^Copying blob /.test(line)) {
    next.text = 'Downloading';
    return next;
  }
  if (/^Copying config|^Writing manifest|^Storing signatures/.test(line)) {
    next.text = 'Finishing';
    return next;
  }
  if (/^Digest: |^Status: /.test(line)) {
    next.text = 'Finishing';
  }
  return next;
}

export interface ManifestLayer {
  digest: string;
  /** Compressed size in bytes, as the registry stores it. */
  size: number;
}

export type ParsedManifest =
  | { kind: 'index'; manifests: { digest: string; os: string; arch: string; variant?: string }[] }
  | { kind: 'image'; layers: ManifestLayer[] };

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

/** `manifest inspect` output (Podman or Docker): an image index, or one image manifest (OCI or Docker v2). */
export function parseManifest(stdout: string): ParsedManifest | null {
  const j = firstJson(stdout) as { manifests?: unknown; layers?: unknown } | undefined;
  if (!j || typeof j !== 'object') return null;
  if (Array.isArray(j.manifests)) {
    const manifests: { digest: string; os: string; arch: string; variant?: string }[] = [];
    for (const m of j.manifests as { digest?: unknown; platform?: Record<string, unknown> }[]) {
      if (typeof m?.digest !== 'string' || !DIGEST_RE.test(m.digest) || !m.platform) continue;
      manifests.push({
        digest: m.digest,
        os: str(m.platform.os) ?? '',
        arch: str(m.platform.architecture) ?? '',
        variant: str(m.platform.variant),
      });
    }
    return { kind: 'index', manifests };
  }
  if (Array.isArray(j.layers)) {
    const layers: ManifestLayer[] = [];
    for (const l of j.layers as { digest?: unknown; size?: unknown }[]) {
      const size = num(l?.size);
      if (typeof l?.digest !== 'string' || !DIGEST_RE.test(l.digest) || size === null || size < 0) return null;
      layers.push({ digest: l.digest, size });
    }
    return { kind: 'image', layers };
  }
  return null;
}

/**
 * The index entry the engine pulls: Linux on the engine's own architecture,
 * else Linux on x86-64 (the emulated fallback the app then asks for).
 */
export function pickPlatformManifest(
  manifests: { digest: string; os: string; arch: string; variant?: string }[],
  engineArch: string | undefined
): string | null {
  const linux = manifests.filter((m) => m.os === 'linux');
  const find = (arch: string) =>
    linux.find((m) => m.arch === arch && (arch !== 'arm64' || !m.variant || m.variant === 'v8')) ?? linux.find((m) => m.arch === arch);
  return (engineArch ? find(engineArch) : undefined)?.digest ?? find('amd64')?.digest ?? null;
}

/** A /proc/net/dev line ("  eth0: 59453023 40430 0 …") → bytes received. */
export function parseNetDevRx(line: string): number | null {
  const m = /^\s*[^:\s]+:\s*(\d+)\s/.exec(line);
  if (!m) return null;
  const rx = Number(m[1]);
  return Number.isSafeInteger(rx) ? rx : null;
}

/** The interface of the default route, from /proc/net/route. */
export function defaultRouteInterface(routeTable: string): string | null {
  for (const line of routeTable.split('\n').slice(1)) {
    const [iface, destination] = line.trim().split(/\s+/);
    if (iface && destination === '00000000') return iface;
  }
  return null;
}

/** Compressed layer digests in Podman layer store text (layers.json, or lines grepped from it). */
export function parseLayerDigests(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(/"compressed-diff-digest"\s*:\s*"(sha256:[0-9a-f]{64})"/g)) found.add(m[1]);
  return found;
}

/** Podman `info --format json`: where the layer store is. */
export function parseStoreInfo(stdout: string): { graphRoot: string; driver: string } | null {
  const j = firstJson(stdout) as { store?: { graphRoot?: unknown; graphDriverName?: unknown } } | undefined;
  const graphRoot = str(j?.store?.graphRoot);
  const driver = str(j?.store?.graphDriverName);
  if (!graphRoot || !driver || !/^[a-z0-9]+$/.test(driver)) return null;
  return { graphRoot, driver };
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

/** "73.58MB", "1.766MiB", "0B", "1.04kB" → bytes. Docker mixes binary (memory) and decimal (I/O) units. */
export function parseSize(text: string | undefined): number | null {
  const m = /^\s*([\d.]+)\s*([kKmMgGtT]?i?B)\s*$/.exec(text ?? '');
  if (!m) return null;
  const factor = SIZE_UNITS[m[2].toLowerCase()];
  const value = Number(m[1]);
  return factor && Number.isFinite(value) ? Math.round(value * factor) : null;
}

const pair = (text: unknown): [number | null, number | null] => {
  const [a, b] = String(text ?? '').split('/');
  return [parseSize(a), parseSize(b)];
};

const percent = (text: unknown): number | null => {
  const v = Number.parseFloat(String(text ?? ''));
  return Number.isFinite(v) ? v : null;
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface StatsRow {
  /** Full ID (Podman, and Docker's Container field when IDs were passed) or the short ID. */
  id: string;
  /** Percent of one CPU, as the engine computed it. */
  cpuPercent: number | null;
  /** Podman: cumulative CPU time and the reading's time, both in nanoseconds. */
  cpuNano?: number;
  systemNano?: number;
  memBytes: number | null;
  memLimitBytes: number | null;
  memPercent: number | null;
  pids: number | null;
  netRxBytes: number | null;
  netTxBytes: number | null;
  blockReadBytes: number | null;
  blockWriteBytes: number | null;
}

/**
 * `stats --no-stream --format '{{json .}}'`. Podman (5.6.2) prints raw
 * numbers (CPU, CPUNano, SystemNano, MemUsage, MemLimit, Network{…},
 * BlockInput/Output, PIDs); Docker (29.9.3) prints the table's text
 * ("0.05%", "1.766MiB / 512MiB", "1.04kB / 126B").
 */
export function parseStats(stdout: string): StatsRow[] {
  const text = stdout.trim();
  if (!text) return [];
  const items: unknown[] = text.startsWith('[')
    ? (JSON.parse(text) as unknown[])
    : text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as unknown);
  return items.map((raw): StatsRow => {
    const r = raw as Record<string, unknown>;
    if (typeof r.MemUsage === 'number' || typeof r.CPUNano === 'number') {
      let rx: number | null = null;
      let tx: number | null = null;
      if (r.Network && typeof r.Network === 'object') {
        for (const nic of Object.values(r.Network as Record<string, Record<string, unknown>>)) {
          rx = (rx ?? 0) + (num(nic?.RxBytes) ?? 0);
          tx = (tx ?? 0) + (num(nic?.TxBytes) ?? 0);
        }
      }
      return {
        id: String(r.ContainerID ?? r.ID ?? ''),
        cpuPercent: num(r.CPU),
        cpuNano: num(r.CPUNano) ?? undefined,
        systemNano: num(r.SystemNano) ?? undefined,
        memBytes: num(r.MemUsage),
        memLimitBytes: num(r.MemLimit),
        memPercent: num(r.MemPerc),
        pids: num(r.PIDs),
        netRxBytes: rx,
        netTxBytes: tx,
        blockReadBytes: num(r.BlockInput),
        blockWriteBytes: num(r.BlockOutput),
      };
    }
    const [memBytes, memLimitBytes] = pair(r.MemUsage);
    const [netRxBytes, netTxBytes] = pair(r.NetIO);
    const [blockReadBytes, blockWriteBytes] = pair(r.BlockIO);
    const pids = Number.parseInt(String(r.PIDs ?? ''), 10);
    const container = String(r.Container ?? '');
    return {
      id: /^[0-9a-f]{12,64}$/.test(container) ? container : String(r.ID ?? ''),
      cpuPercent: percent(r.CPUPerc),
      memBytes,
      memLimitBytes,
      memPercent: percent(r.MemPerc),
      pids: Number.isFinite(pids) ? pids : null,
      netRxBytes,
      netTxBytes,
      blockReadBytes,
      blockWriteBytes,
    };
  });
}

/** CPUs and memory of the engine host, from `info` (Podman: host.*, Docker: NCPU/MemTotal). */
export function parseCapacity(stdout: string): { cpus: number; memTotalBytes: number; memFreeBytes?: number } | null {
  const j = firstJson(stdout) as Record<string, unknown> | undefined;
  if (!j || typeof j !== 'object') return null;
  const host = j.host as Record<string, unknown> | undefined;
  const cpus = num(host?.cpus) ?? num(j.NCPU);
  const memTotalBytes = num(host?.memTotal) ?? num(j.MemTotal);
  if (!cpus || !memTotalBytes) return null;
  const memFreeBytes = num(host?.memFree) ?? undefined;
  return { cpus, memTotalBytes, memFreeBytes };
}
