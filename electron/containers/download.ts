// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Download progress for a pull.
 *
 * The engine CLIs print no byte counts when their output goes to a program,
 * so the numbers are put together here, through the same CLIs:
 *
 * - Size: the image manifest, less the layers the engine already has
 *   (Podman's layer store; Docker says "Already exists" per layer). Docker
 *   reads the manifest with its own sign-in (`docker manifest inspect`).
 *   Podman's CLI cannot print the manifest of a single-platform image, so for
 *   Podman, and when Docker cannot, it is read without signing in
 *   (registry.ts): public repositories only.
 * - Received bytes and rate: the receive counter of the engine host's network
 *   interface, inside the Podman machine or, on Linux, of this computer. Other
 *   traffic there counts too.
 * - Docker Desktop has no counter the app can read: there, the received bytes
 *   are the finished layers, and there is no rate.
 */

import fs from 'node:fs';
import { runCli } from './exec';
import { infoArgs, layerDigestsScript, machineSshArgs, manifestInspectArgs, NET_COUNTER_SCRIPT } from './argv';
import {
  defaultRouteInterface,
  parseLayerDigests,
  parseManifest,
  parseNetDevRx,
  parseStoreInfo,
  pickPlatformManifest,
  type ManifestLayer,
  type ParsedManifest,
} from './parse';
import { readManifestAnonymously, type AnonymousFetch } from './registry';
import type { DownloadSource, EngineInfo, PullDownload } from './types';
import type { ImageRef } from './validate';

/** The rate is taken over this much of the latest readings. */
const RATE_WINDOW_MS = 3_000;
/** How long a pull waits for the first counter reading, so that its first bytes are counted. */
const FIRST_SAMPLE_WAIT_MS = 3_000;
/** The counter script stops by itself after two hours; the process gets a little longer. */
const COUNTER_LIMIT_MS = 2 * 60 * 60 * 1000 + 60_000;

/** Docker names a layer by the first 12 hex digits of its digest. */
const shortId = (digest: string): string => digest.slice('sha256:'.length, 'sha256:'.length + 12);
const sum = (layers: ManifestLayer[]): number => layers.reduce((s, l) => s + l.size, 0);

/** Combines what is known about a pull into one PullDownload. No I/O. */
export class DownloadTracker {
  private layers: ManifestLayer[] | null = null;
  private present: Set<string> | null = null;
  private readonly dockerLayers = new Map<string, 'announced' | 'exists' | 'downloaded'>();
  private readonly samples: { at: number; rx: number }[] = [];
  private baseline: number | null = null;
  private started = false;

  constructor(readonly source: DownloadSource) {}

  /** The layers of the image being pulled, from its manifest. */
  setLayers(layers: ManifestLayer[]): void {
    this.layers = layers;
  }

  /** Compressed digests of the layers the engine already has. */
  setPresent(digests: Set<string>): void {
    this.present = digests;
  }

  /** A line of pull output. Only Docker's per-layer lines say anything here. */
  line(text: string): void {
    const m = /^([0-9a-f]{12}): (.+)$/.exec(text.trim());
    if (!m) return;
    const [, id, what] = m;
    const prev = this.dockerLayers.get(id);
    if (what.startsWith('Already exists')) {
      this.dockerLayers.set(id, 'exists');
    } else if (/^(Download complete|Verifying Checksum|Extracting|Pull complete)/.test(what)) {
      if (prev !== 'exists') this.dockerLayers.set(id, 'downloaded');
    } else if (!prev) {
      this.dockerLayers.set(id, 'announced');
    }
  }

  /** A reading of the receive counter (bytes) at a time (ms). */
  sample(rx: number, at: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && rx < last.rx) {
      // The counter went back (the interface was reset): carry on from here.
      this.samples.length = 0;
      if (this.baseline !== null) this.baseline = rx - (last.rx - this.baseline);
    }
    this.samples.push({ at, rx });
    while (this.samples.length > 2 && at - this.samples[1].at >= RATE_WINDOW_MS) this.samples.shift();
    if (this.started && this.baseline === null) this.baseline = rx;
  }

  hasSample(): boolean {
    return this.samples.length > 0;
  }

  /** The pull starts: bytes received from now on count. Called again for a second attempt, it changes nothing. */
  start(): void {
    this.started = true;
    const last = this.samples[this.samples.length - 1];
    if (last && this.baseline === null) this.baseline = last.rx;
  }

  snapshot(): PullDownload | undefined {
    const out: PullDownload = { source: this.source };
    const layers = this.layers;
    if (layers) {
      const have = (l: ManifestLayer) => !!this.present?.has(l.digest) || this.dockerLayers.get(shortId(l.digest)) === 'exists';
      out.totalBytes = sum(layers.filter((l) => !have(l)));
      const known = this.present !== null || layers.every((l) => this.dockerLayers.has(shortId(l.digest)));
      if (!known) out.totalIsUpperBound = true;
    }
    if (this.source === 'layers') {
      if (layers) out.receivedBytes = sum(layers.filter((l) => this.dockerLayers.get(shortId(l.digest)) === 'downloaded'));
    } else if (this.baseline !== null && this.samples.length) {
      const first = this.samples[0];
      const last = this.samples[this.samples.length - 1];
      out.receivedBytes = last.rx - this.baseline;
      if (this.samples.length >= 2 && last.at > first.at) {
        out.rateBps = Math.max(0, ((last.rx - first.rx) * 1000) / (last.at - first.at));
      }
    }
    if (out.totalBytes !== undefined && out.receivedBytes !== undefined && out.receivedBytes > out.totalBytes) {
      out.receivedBytes = out.totalBytes;
    }
    return out.totalBytes === undefined && out.receivedBytes === undefined ? undefined : out;
  }
}

interface NetworkCounter {
  source: DownloadSource;
  stop(): void;
}

/** Starts reading the engine host's receive counter about once a second. Null when there is none (Docker Desktop). */
function startNetworkCounter(engine: EngineInfo, onSample: (rx: number, at: number) => void): NetworkCounter | null {
  if (engine.kind === 'podman' && engine.machine) {
    const controller = new AbortController();
    runCli(engine.binPath, machineSshArgs(engine.machine.name, NET_COUNTER_SCRIPT), {
      timeoutMs: COUNTER_LIMIT_MS,
      signal: controller.signal,
      maxBytes: 16 * 1024,
      onLine: (line, stream) => {
        if (stream !== 'stdout') return;
        const rx = parseNetDevRx(line);
        if (rx !== null) onSample(rx, Date.now());
      },
    }).catch(() => undefined);
    return { source: 'machine-network', stop: () => controller.abort() };
  }
  if (process.platform === 'linux' && !engine.machine) {
    const read = () => {
      try {
        const dev = defaultRouteInterface(fs.readFileSync('/proc/net/route', 'utf8'));
        const line = dev ? fs.readFileSync('/proc/net/dev', 'utf8').split('\n').find((l) => l.trim().startsWith(`${dev}:`)) : undefined;
        const rx = line ? parseNetDevRx(line) : null;
        if (rx !== null) onSample(rx, Date.now());
      } catch {
        // No reading this time.
      }
    };
    read();
    const timer = setInterval(read, 1_000);
    return { source: 'host-network', stop: () => clearInterval(timer) };
  }
  return null;
}

/** Compressed digests of the layers Podman already has; null when that is not known (Docker, or an unreadable store). */
async function readPresentLayers(engine: EngineInfo, signal: AbortSignal): Promise<Set<string> | null> {
  if (engine.kind !== 'podman') return null;
  const info = await runCli(engine.binPath, infoArgs('podman'), { timeoutMs: 30_000, signal });
  const store = info.code === 0 ? parseStoreInfo(info.stdout) : null;
  if (!store) return null;
  const dir = `${store.graphRoot}/${store.driver}-layers`;
  const files = [`${dir}/layers.json`, `${dir}/volatile-layers.json`];
  if (engine.machine) {
    const res = await runCli(engine.binPath, machineSshArgs(engine.machine.name, layerDigestsScript(files)), {
      timeoutMs: 30_000,
      signal,
      maxBytes: 4 * 1024 * 1024,
    });
    // grep exits 1 when it finds nothing: no layers yet.
    if (res.code === 0) return parseLayerDigests(res.stdout);
    return res.code === 1 && !res.stderr.trim() ? new Set() : null;
  }
  let text = '';
  for (const file of files) {
    try {
      text += fs.readFileSync(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    }
  }
  return parseLayerDigests(text);
}

type ManifestReader = (reference: string) => Promise<ParsedManifest | null>;

/** The image's layers through one reader: the index first when there is one, then the platform the engine pulls. */
async function layersVia(read: ManifestReader, ref: ImageRef, engineArch: string | undefined): Promise<ManifestLayer[] | null> {
  let manifest = await read(ref.digest ?? ref.tag ?? 'latest');
  if (manifest?.kind === 'index') {
    const digest = pickPlatformManifest(manifest.manifests, engineArch);
    manifest = digest ? await read(digest) : null;
  }
  return manifest?.kind === 'image' ? manifest.layers : null;
}

/** Layer sizes of the image the engine will pull; null when no manifest could be read. */
async function readManifestLayers(
  engine: EngineInfo,
  ref: ImageRef,
  signal: AbortSignal,
  fetchAnonymous: AnonymousFetch | undefined
): Promise<ManifestLayer[] | null> {
  const viaCli: ManifestReader = async (reference) => {
    const target = reference.startsWith('sha256:') ? `${ref.host}/${ref.repo}@${reference}` : ref.normalized;
    const res = await runCli(engine.binPath, manifestInspectArgs(target), { timeoutMs: 60_000, signal, maxBytes: 1024 * 1024 });
    return res.code === 0 ? parseManifest(res.stdout) : null;
  };
  const viaRegistry: ManifestReader = async (reference) => {
    const text = fetchAnonymous ? await readManifestAnonymously(fetchAnonymous, ref.host, ref.repo, reference, signal) : null;
    return text ? parseManifest(text) : null;
  };
  if (engine.kind === 'docker') {
    const layers = await layersVia(viaCli, ref, engine.arch).catch(() => null);
    if (layers) return layers;
  }
  return fetchAnonymous ? layersVia(viaRegistry, ref, engine.arch) : null;
}

/**
 * Everything a deploy needs for download progress. Created before the user
 * confirms: it starts the counter and reads the local layer store then. The
 * registry is asked for the manifest only after the user agreed (readSizes).
 */
export class PullMeter {
  readonly tracker: DownloadTracker;
  private readonly counter: NetworkCounter | null;
  private readonly local = new AbortController();

  constructor(
    private readonly engine: EngineInfo,
    private readonly ref: ImageRef,
    signal: AbortSignal,
    private readonly fetchAnonymous?: AnonymousFetch
  ) {
    if (signal.aborted) this.local.abort();
    else signal.addEventListener('abort', () => this.local.abort(), { once: true });
    let tracker: DownloadTracker | undefined;
    let counter: NetworkCounter | null = null;
    try {
      counter = startNetworkCounter(engine, (rx, at) => tracker?.sample(rx, at));
    } catch {
      counter = null;
    }
    this.counter = counter;
    tracker = new DownloadTracker(counter?.source ?? 'layers');
    this.tracker = tracker;
    const present = tracker;
    readPresentLayers(engine, this.local.signal)
      .then((digests) => digests && present.setPresent(digests))
      .catch(() => undefined);
  }

  /** Asks the registry for the layer sizes (in the background). */
  readSizes(): void {
    readManifestLayers(this.engine, this.ref, this.local.signal, this.fetchAnonymous)
      .then((layers) => layers && this.tracker.setLayers(layers))
      .catch(() => undefined);
  }

  /** Waits a little for the first counter reading, so that the pull's first bytes are counted. */
  async ready(): Promise<void> {
    if (!this.counter) return;
    const until = Date.now() + FIRST_SAMPLE_WAIT_MS;
    while (!this.tracker.hasSample() && Date.now() < until && !this.local.signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  stop(): void {
    this.counter?.stop();
    this.local.abort();
  }
}
