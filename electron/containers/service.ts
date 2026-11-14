// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Orchestration for local SCR containers: pull, run, watch start-up, and the
 * lifecycle of containers this install created.
 *
 * Architecture (decision D11): the image is pulled without --platform, so the
 * engine takes a native variant when there is one. The image's architecture
 * is then compared with the engine's. On a mismatch the container runs under
 * emulation and the user is told so before it starts. Whether an emulator is
 * installed shows only after the start (run -d succeeds either way), so the
 * start-up watch reads the log of a container that stopped early.
 */

import http from 'node:http';
import net from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { runCli } from './exec';
import {
  containerInspectArgs,
  imageInspectArgs,
  infoArgs,
  listArgs,
  logsArgs,
  logsFromStartArgs,
  podmanLoginStatusArgs,
  podmanMachineStartArgs,
  pullArgs,
  removeArgs,
  runArgs,
  startArgs,
  statsArgs,
  stopArgs,
  type RunSpec,
} from './argv';
import { classifyEarlyExit, classifyPullError, classifyRunError, isPortInUse, redact, tail } from './classify';
import { findCandidates, pickCandidate, probeEngine } from './detect';
import { PullMeter, type DownloadTracker } from './download';
import type { AnonymousFetch } from './registry';
import {
  envValues,
  modelNameFromLog,
  parseCapacity,
  parseContainerInspect,
  parseImageInspect,
  parsePs,
  parseStats,
  updatePullProgress,
  type PullProgress,
} from './parse';
import { containerName, hasUnsafeChars, parseImageRef, readHostPath, readRunOptions, type ImageRef } from './validate';
import type { HostFolderCheck } from './mounts';
import type { ContainerStore } from './store';
import type {
  ContainerPhase,
  ContainerStats,
  EngineCapacity,
  ContainersEvent,
  ContainerView,
  EngineCandidate,
  EngineInfo,
  EngineKind,
  EngineStatus,
  ManagedContainer,
  OpResult,
  OpStage,
  PullDownload,
  Problem,
  RunOptions,
  StatsResult,
  StoredRunOptions,
} from './types';

export interface ConfirmRequest {
  title: string;
  message: string;
  detail: string;
  confirmLabel: string;
}

export interface ServiceDeps {
  store: ContainerStore;
  emit: (event: ContainersEvent) => void;
  /** A native dialog in the main process; script in the page cannot answer it. */
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  /** Whether a folder of this computer may be mounted (mounts.ts), with its real path. */
  checkFolder: (folder: string) => HostFolderCheck;
  /** Fetch without cookies or credentials, for reading public image manifests (download progress only). */
  fetchAnonymous?: AnonymousFetch;
}

/** Start-up limits. Measured: 13–26 s native; 37–81 s under QEMU on ARM (1–4 CPUs). */
const READY_TIMEOUT_MS = 180_000;
const READY_TIMEOUT_EMULATED_MS = 600_000;
const WATCH_INTERVAL_MS = 1_500;
const PULL_TIMEOUT_MS = 60 * 60 * 1000;

/** What a progress event carries besides its text. */
interface PullExtra {
  layersDone?: number;
  layersTotal?: number;
  download?: PullDownload;
}
const PORT_RANGE = { from: 18100, to: 18999 };
const MAX_LOG_LINES = 1000;

const problem = (code: Problem['code'], title: string, extra: Partial<Problem> = {}): { ok: false; problem: Problem } => ({
  ok: false,
  problem: { code, title, ...extra },
});

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/** One HTTP GET to the container on 127.0.0.1 (never "localhost": it may resolve to ::1, which a 127.0.0.1 publish never answers). */
function httpStatus(port: number, path: string, timeoutMs = 2_000): Promise<number | null> {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode ?? null);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

/** Variable names are kept; values only go to the engine. */
const stored = ({ env, ...rest }: RunOptions): StoredRunOptions => ({ ...rest, envNames: env.map((e) => e.name) });

/** The folders and variables, for a confirmation dialog. Values are not shown. */
function settingsLines(options: RunOptions): string[] {
  const lines = options.mounts.map(
    (m) =>
      `Folder ${m.hostPath} → ${m.containerPath}, ${m.readOnly ? 'read-only' : 'READ-WRITE: the container can change and delete files in it'}`
  );
  if (options.env.length) lines.push(`Environment variables: ${options.env.map((e) => e.name).join(', ')}`);
  return lines;
}

const sameEnv = (a: { name: string; value: string }[], b: { name: string; value: string }[]): boolean =>
  a.length === b.length && a.every((x) => b.some((y) => y.name === x.name && y.value === x.value));

const sameMounts = (a: StoredRunOptions['mounts'], b: RunOptions['mounts']): boolean =>
  a.length === b.length &&
  a.every((x) => b.some((y) => y.hostPath === x.hostPath && y.containerPath === x.containerPath && y.readOnly === x.readOnly));

/** The last part of the repository, the default name of a container. */
function repoName(imageRef: string): string {
  try {
    const { repo } = parseImageRef(imageRef);
    return repo.slice(repo.lastIndexOf('/') + 1);
  } catch {
    return 'container';
  }
}

interface Runtime {
  phase: ContainerPhase;
  problem?: Problem;
  exitCode?: number;
  startingSince?: string;
}

export class ContainerService {
  private candidates: EngineCandidate[] = [];
  private engine: EngineInfo | null = null;
  private readonly ops = new Map<string, AbortController>();
  private readonly watchers = new Map<string, AbortController>();
  private readonly runtime = new Map<string, Runtime>();

  constructor(private readonly deps: ServiceDeps) {}

  // --- Engine ---

  async status(): Promise<EngineStatus> {
    this.candidates = findCandidates();
    const choice = this.deps.store.engineChoice;
    const candidate = pickCandidate(this.candidates, choice);
    this.engine = candidate ? await probeEngine(candidate) : null;
    return { choice, candidates: this.candidates, engine: this.engine };
  }

  private async readyEngine(): Promise<EngineInfo | { ok: false; problem: Problem }> {
    const { engine } = await this.status();
    if (!engine) {
      return problem('engine', 'No container engine found', {
        hint: 'Install Podman (recommended) or Docker, then check again. On Windows, Podman needs a machine: podman machine init.',
      });
    }
    if (engine.state !== 'ready') return problem('engine', engine.message ?? `The ${engine.kind} engine is not ready.`);
    return engine;
  }

  /** The CLI for containers started with a given engine, even if the choice changed since. */
  private binFor(kind: EngineKind): string | null {
    if (this.engine?.kind === kind) return this.engine.binPath;
    if (!this.candidates.length) this.candidates = findCandidates();
    return this.candidates.find((c) => c.kind === kind)?.binPath ?? null;
  }

  async startMachine(): Promise<OpResult<{ status: EngineStatus }>> {
    const status = await this.status();
    const engine = status.engine;
    if (!engine || engine.kind !== 'podman' || engine.state !== 'machine-stopped' || !engine.machine) {
      return { ok: true, status };
    }
    const approved = await this.deps.confirm({
      title: 'Start Podman machine',
      message: `Start the Podman machine "${engine.machine.name}"?`,
      detail: 'Podman runs containers inside this machine. Starting it can take a minute.',
      confirmLabel: 'Start machine',
    });
    if (!approved) return problem('cancelled', 'Not started.');
    const res = await runCli(engine.binPath, podmanMachineStartArgs(engine.machine.name), { timeoutMs: 300_000 });
    if (res.code !== 0) {
      return problem('engine', 'The Podman machine did not start', { detail: tail(res.stderr || res.stdout) });
    }
    return { ok: true, status: await this.status() };
  }

  // --- Deploy: pull, inspect, run ---

  cancel(opId: string): void {
    this.ops.get(opId)?.abort();
  }

  async deploy(opId: string, rawRef: unknown, rawOptions: unknown): Promise<OpResult<{ managedId: string }>> {
    let ref: ImageRef;
    let options: RunOptions;
    try {
      ref = parseImageRef(rawRef);
      options = this.withCheckedFolders(readRunOptions(rawOptions));
    } catch (err) {
      return problem('invalid-input', err instanceof Error ? err.message : String(err));
    }
    if (this.ops.has(opId)) return problem('invalid-input', 'This operation is already running.');

    const controller = new AbortController();
    this.ops.set(opId, controller);
    const started = Date.now();
    const progress = (stage: OpStage, text: string, extra: PullExtra = {}) =>
      this.deps.emit({ type: 'progress', opId, stage, text, elapsedMs: Date.now() - started, ...extra });

    try {
      const engine = await this.readyEngine();
      if ('ok' in engine) return engine;

      // Download progress: the network counter and the local layer list are
      // read while the confirmation is open; the registry only after it.
      const meter = new PullMeter(engine, ref, controller.signal, this.deps.fetchAnonymous);
      let pulled: { ok: true } | { ok: false; problem: Problem };
      try {
        progress('confirm', 'Waiting for your confirmation');
        const approved = await this.deps.confirm({
          title: 'Run image locally',
          message: `Pull and run ${ref.normalized}?`,
          detail: [
            `Engine: ${engine.kind} ${engine.serverVersion ?? ''} (${engine.binPath})`,
            'The container is published on 127.0.0.1 only. SAS Container Runtime has no authentication, so other programs on this computer can call it.',
            'Signing in to the registry is up to the engine. MAS Scorer never sees registry credentials.',
            settingsLines(options).join('\n'),
          ]
            .filter(Boolean)
            .join('\n\n'),
          confirmLabel: 'Pull and run',
        });
        if (!approved) return problem('cancelled', 'Cancelled.');

        meter.readSizes();
        await meter.ready();
        pulled = await this.pull(engine, ref, undefined, controller.signal, progress, meter.tracker);
        if (!pulled.ok && pulled.problem.code === 'no-platform' && engine.arch !== 'amd64') {
          // A multi-platform image without this computer's architecture: take the
          // x86-64 variant, which then runs emulated.
          pulled = await this.pull(engine, ref, 'linux/amd64', controller.signal, progress, meter.tracker);
        }
      } finally {
        meter.stop();
      }
      if (!pulled.ok) return pulled;

      progress('inspect', 'Reading the image');
      const inspected = await runCli(engine.binPath, imageInspectArgs(ref.normalized), { timeoutMs: 30_000 });
      const facts = inspected.code === 0 ? parseImageInspect(inspected.stdout, `${ref.host}/${ref.repo}`) : null;
      if (!facts) return problem('unknown', 'The pulled image could not be read', { detail: tail(inspected.stderr) });
      if (facts.os && facts.os !== 'linux') return problem('unknown', `The image is for ${facts.os}, not Linux.`);

      const engineArch = engine.arch ?? '';
      const imageArch = facts.arch || engineArch;
      const emulated = !!engineArch && !!imageArch && imageArch !== engineArch;
      if (emulated) this.deps.emit({ type: 'notice', opId, notice: 'emulated', imageArch, engineArch });

      progress('run', emulated ? 'Starting the container under emulation' : 'Starting the container');
      const name = containerName(ref.repo, randomBytes(3).toString('hex'));
      const ran = await this.runContainer(
        engine.binPath,
        {
          name,
          installId: this.deps.store.installId,
          image: facts.digestRef ?? facts.id,
          platform: `linux/${imageArch}`,
          kind: facts.kind,
          cpus: options.cpus,
          memoryMb: options.memoryMb,
          mode: options.mode,
          env: options.env,
          mounts: options.mounts,
        },
        controller.signal
      );
      if (!ran.ok) return ran;

      const record: ManagedContainer = {
        managedId: randomUUID(),
        containerId: ran.containerId,
        name,
        displayName: options.displayName || ref.repo.slice(ref.repo.lastIndexOf('/') + 1),
        engineKind: engine.kind,
        imageRef: ref.normalized,
        digestRef: facts.digestRef,
        imageArch,
        engineArch,
        emulated,
        imageKind: facts.kind,
        appPath: facts.appPath,
        appPathSource: facts.appPath ? 'image' : undefined,
        hostPort: ran.hostPort,
        options: stored(options),
        createdAt: new Date().toISOString(),
      };
      this.deps.store.put(record);
      this.watch(record);
      return { ok: true, managedId: record.managedId };
    } finally {
      this.ops.delete(opId);
    }
  }

  /** Mount folders replaced by their checked real paths; throws with the reason a folder is refused. */
  private withCheckedFolders(options: RunOptions): RunOptions {
    return { ...options, mounts: options.mounts.map((m) => ({ ...m, hostPath: this.checkFolderInput(m.hostPath) })) };
  }

  /** A folder the user typed or picked: its real path, if it may be mounted. Throws otherwise. */
  checkFolderInput(raw: unknown): string {
    const checked = this.deps.checkFolder(readHostPath(raw));
    if (!checked.ok) throw new Error(checked.reason);
    // The real path is checked again: a link can lead to a path the engine cannot take.
    return readHostPath(checked.path);
  }

  /**
   * `run -d` on a free loopback port, up to three tries when the port is
   * taken meanwhile. preferredPort (the address of a container being
   * replaced) is tried first, for a few seconds while the engine lets go of it.
   */
  private async runContainer(
    bin: string,
    spec: Omit<RunSpec, 'hostPort'>,
    signal: AbortSignal,
    preferredPort?: number
  ): Promise<{ ok: true; containerId: string; hostPort: number } | { ok: false; problem: Problem }> {
    const taken = new Set(this.deps.store.list().map((c) => c.hostPort));
    let wanted = 0;
    if (preferredPort) {
      taken.delete(preferredPort);
      for (let i = 0; i < 10 && !signal.aborted; i++) {
        if (await portIsFree(preferredPort)) {
          wanted = preferredPort;
          break;
        }
        await sleep(500, signal);
      }
      if (!wanted) taken.add(preferredPort);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const hostPort = attempt === 0 && wanted ? wanted : await this.freePort(taken);
      if (!hostPort) return problem('port-in-use', `No free port between ${PORT_RANGE.from} and ${PORT_RANGE.to} on 127.0.0.1.`);
      const res = await runCli(bin, runArgs({ ...spec, hostPort }), { timeoutMs: 120_000, signal });
      if (res.code === 0) {
        const containerId = res.stdout.trim().split(/\r?\n/).pop()?.trim() ?? '';
        if (!/^[0-9a-f]{12,64}$/.test(containerId)) {
          return problem('unknown', 'The engine did not return a container ID.', { detail: redact(containerId).slice(0, 200) });
        }
        return { ok: true, containerId, hostPort };
      }
      // A failed run can leave a container in Created state behind (Docker,
      // port already taken). It carries this install's name, so it is removed.
      await runCli(bin, removeArgs(spec.name), { timeoutMs: 30_000 });
      if (res.aborted) return problem('cancelled', 'Cancelled.');
      if (isPortInUse(res.stderr) && attempt < 2) {
        taken.add(hostPort);
        continue;
      }
      return { ok: false, problem: classifyRunError(res.stderr) };
    }
    return problem('port-in-use', 'No free local port could be bound.');
  }

  private async pull(
    engine: EngineInfo,
    ref: ImageRef,
    platform: string | undefined,
    signal: AbortSignal,
    progress: (stage: OpStage, text: string, extra?: PullExtra) => void,
    tracker?: DownloadTracker
  ): Promise<{ ok: true } | { ok: false; problem: Problem }> {
    let state: PullProgress = { layersTotal: 0, layersDone: 0, text: platform ? `Starting (the ${platform} variant)` : 'Starting' };
    let lastEmit = 0;
    const emit = () => {
      lastEmit = Date.now();
      progress('pull', state.text, {
        layersDone: state.layersDone,
        layersTotal: state.layersTotal || undefined,
        download: tracker?.snapshot(),
      });
    };
    tracker?.start();
    emit();
    // Podman prints nothing while it downloads, so the numbers are sent once a second as well.
    const ticker = tracker ? setInterval(() => Date.now() - lastEmit >= 900 && emit(), 1_000) : undefined;
    let res: Awaited<ReturnType<typeof runCli>>;
    try {
      res = await runCli(engine.binPath, pullArgs(ref.normalized, platform), {
        timeoutMs: PULL_TIMEOUT_MS,
        signal,
        maxBytes: 512 * 1024,
        onLine: (line) => {
          state = updatePullProgress(state, line);
          tracker?.line(line);
          if (Date.now() - lastEmit > 300) emit();
        },
      });
    } finally {
      if (ticker) clearInterval(ticker);
    }
    if (res.aborted) return problem('cancelled', 'Cancelled.');
    if (res.timedOut) return problem('network', 'The pull took longer than an hour and was stopped.');
    if (res.code !== 0) {
      const found = classifyPullError(`${res.stderr}\n${res.stdout}`, engine.kind, ref);
      return { ok: false, problem: found.code === 'signin' ? await this.refineSignIn(engine, ref.host, found) : found };
    }
    return { ok: true };
  }

  /**
   * A refused pull reads like a sign-in problem. Podman can say whether it
   * holds a sign-in for the registry (the user name only); if it does, the
   * user is told that signing in again will not help.
   */
  private async refineSignIn(engine: EngineInfo, host: string, found: Problem): Promise<Problem> {
    if (engine.kind !== 'podman') return found;
    const res = await runCli(engine.binPath, podmanLoginStatusArgs(host), { timeoutMs: 15_000, maxBytes: 4096 });
    const user = res.stdout.trim().split(/\r?\n/)[0]?.trim();
    if (res.code !== 0 || !user || hasUnsafeChars(user) || user.length > 200) return found;
    return {
      code: 'signin',
      title: `Podman is signed in to ${host} as ${user}, but the registry refused the pull`,
      detail: found.detail,
      hint: 'Signing in again will not help. Check the image reference, and that this account may pull from the project.',
    };
  }

  private async freePort(taken: Set<number>): Promise<number> {
    const span = PORT_RANGE.to - PORT_RANGE.from + 1;
    const start = PORT_RANGE.from + Math.floor(Math.random() * span);
    for (let i = 0; i < span; i++) {
      const port = PORT_RANGE.from + ((start - PORT_RANGE.from + i) % span);
      if (!taken.has(port) && (await portIsFree(port))) return port;
    }
    return 0;
  }

  // --- Start-up watch ---

  private setPhase(managedId: string, phase: ContainerPhase, extra: Omit<Runtime, 'phase'> = {}): void {
    this.runtime.set(managedId, { phase, ...extra });
    this.deps.emit({ type: 'state', managedId, phase, problem: extra.problem });
  }

  /**
   * Whether the container's endpoint answers. SCR images: their signature
   * (GET /<app path>/apiMeta/api) is 200. Python/R images: GET /internal/ready
   * is 200, or 404 from an image without that route (the server answers).
   */
  private async endpointAnswers(record: ManagedContainer, timeoutMs = 2_000): Promise<{ ready: boolean; status: number | null }> {
    if (record.imageKind === 'scr' && record.appPath) {
      const status = await httpStatus(record.hostPort, `/${record.appPath}/apiMeta/api`, timeoutMs);
      return { ready: status === 200, status };
    }
    const status = await httpStatus(record.hostPort, '/internal/ready', timeoutMs);
    return { ready: status === 200 || status === 404, status };
  }

  /** Containers whose log was already searched for a model name in this session, without result. */
  private readonly modelNameNotFound = new Set<string>();

  /**
   * Python/R images have no SAS_SCR_APP_PATH: they serve the model at
   * POST /<model name>, and log that name at start-up. The name is taken from
   * the log only if the container really has that route (GET answers 405
   * "method not allowed" there, 404 elsewhere), then kept with the container.
   */
  private async learnModelPath(record: ManagedContainer, bin: string): Promise<ManagedContainer> {
    if (record.appPath || record.imageKind === 'scr' || this.modelNameNotFound.has(record.managedId)) return record;
    const found: { name: string | null } = { name: null };
    const stop = new AbortController();
    await runCli(bin, logsFromStartArgs(record.containerId), {
      timeoutMs: 20_000,
      maxBytes: 2 * 1024 * 1024,
      signal: stop.signal,
      onLine: (line) => {
        if (found.name) return;
        found.name = modelNameFromLog(line);
        if (found.name) stop.abort(); // the line comes early in the log: no need to read the rest
      },
    });
    const name = found.name;
    const status = name ? await httpStatus(record.hostPort, `/${encodeURIComponent(name)}`) : null;
    if (!name || status === null || status === 404) {
      this.modelNameNotFound.add(record.managedId);
      return record;
    }
    const updated: ManagedContainer = { ...record, appPath: name, appPathSource: 'log' };
    this.deps.store.put(updated);
    return updated;
  }

  /** Polls until the endpoint answers, the container stops, or the start-up time runs out. */
  private watch(record: ManagedContainer): void {
    this.watchers.get(record.managedId)?.abort();
    const controller = new AbortController();
    this.watchers.set(record.managedId, controller);
    this.setPhase(record.managedId, 'starting', { startingSince: new Date().toISOString() });

    const bin = this.binFor(record.engineKind);
    const limitMs = record.emulated ? READY_TIMEOUT_EMULATED_MS : READY_TIMEOUT_MS;
    const t0 = Date.now();
    this.modelNameNotFound.delete(record.managedId);

    void (async () => {
      while (!controller.signal.aborted) {
        await sleep(WATCH_INTERVAL_MS, controller.signal);
        if (controller.signal.aborted || !bin) return;
        const inspected = await runCli(bin, containerInspectArgs(record.containerId), { timeoutMs: 20_000 });
        if (controller.signal.aborted) return;
        const state = inspected.code === 0 ? parseContainerInspect(inspected.stdout) : null;
        if (!state) {
          if (/no such (container|object)|no container with name or id/i.test(inspected.stderr)) {
            this.setPhase(record.managedId, 'missing');
            return;
          }
          continue; // the engine did not answer this time
        }
        if (!state.running) {
          const logs = await this.readLogs(bin, record.containerId, 60);
          this.setPhase(record.managedId, 'failed', {
            exitCode: state.exitCode,
            problem: classifyEarlyExit(logs, state.exitCode, record.imageArch, record.engineArch),
          });
          return;
        }
        const { ready, status } = await this.endpointAnswers(record);
        if (ready) {
          // Python/R: find the score path before reporting ready, so the list
          // can offer Open straight away.
          await this.learnModelPath(record, bin);
          this.setPhase(record.managedId, 'ready');
          return;
        }
        if (Date.now() - t0 > limitMs) {
          this.setPhase(record.managedId, 'not-ready', {
            problem: {
              code: 'not-ready',
              title: `The endpoint did not answer within ${Math.round(limitMs / 1000)} s`,
              hint:
                status === null
                  ? `The container is running, but nothing answers on 127.0.0.1:${record.hostPort}. If another container engine runs in WSL at the same time, its firewall rules can block this port. Open the logs to see how far start-up got.`
                  : 'The container is running. Open the logs to see how far start-up got.',
            },
          });
          return;
        }
      }
    })().finally(() => {
      if (this.watchers.get(record.managedId) === controller) this.watchers.delete(record.managedId);
    });
  }

  private async readLogs(bin: string, containerId: string, lines: number): Promise<string> {
    const out: string[] = [];
    await runCli(bin, logsArgs(containerId, lines), {
      timeoutMs: 20_000,
      maxBytes: 2 * 1024 * 1024,
      onLine: (line) => {
        out.push(line);
        if (out.length > MAX_LOG_LINES) out.shift();
      },
    });
    return redact(out.join('\n'));
  }

  // --- Lifecycle of owned containers ---

  async list(): Promise<{ containers: ContainerView[]; engineProblem?: string }> {
    const records = this.deps.store.list();
    if (!records.length) return { containers: [] };
    if (!this.candidates.length) this.candidates = findCandidates();

    const rowsByKind = new Map<EngineKind, ReturnType<typeof parsePs> | null>();
    let engineProblem: string | undefined;
    for (const kind of new Set(records.map((r) => r.engineKind))) {
      const bin = this.binFor(kind);
      if (!bin) {
        rowsByKind.set(kind, null);
        engineProblem = `${kind} is no longer installed.`;
        continue;
      }
      const res = await runCli(bin, listArgs(this.deps.store.installId), { timeoutMs: 30_000 });
      if (res.code !== 0) {
        rowsByKind.set(kind, null);
        engineProblem = `${kind} did not answer: ${tail(res.stderr, 1) || 'no details'}`;
        continue;
      }
      try {
        rowsByKind.set(kind, parsePs(res.stdout));
      } catch {
        rowsByKind.set(kind, null);
        engineProblem = `${kind} gave a container list the app could not read.`;
      }
    }

    const containers = records.map((record): ContainerView => {
      const rows = rowsByKind.get(record.engineKind);
      const rt = this.runtime.get(record.managedId);
      const scoreUrl = record.appPath ? `http://127.0.0.1:${record.hostPort}/${record.appPath}` : null;
      const view: ContainerView = { ...record, scoreUrl, phase: 'unknown', problem: rt?.problem, startingSince: rt?.startingSince };
      if (!rows) return view;
      const row = rows.find((r) => r.id && (record.containerId.startsWith(r.id) || r.id.startsWith(record.containerId)));
      if (!row) return { ...view, phase: 'missing', problem: undefined };
      view.engineState = row.state;
      view.exitCode = row.exitCode;
      if (row.state === 'running') {
        view.phase = rt && (rt.phase === 'starting' || rt.phase === 'ready' || rt.phase === 'not-ready') ? rt.phase : 'running';
      } else {
        view.phase = rt?.phase === 'failed' ? 'failed' : 'stopped';
        if (view.phase === 'stopped') view.problem = undefined;
      }
      return view;
    });

    // Running containers this session has not watched (the app was restarted):
    // one quick look at whether their endpoint answers.
    await Promise.all(
      containers
        .filter((c) => c.phase === 'running')
        .map(async (c) => {
          if ((await this.endpointAnswers(c, 1_500)).ready) {
            c.phase = 'ready';
            this.runtime.set(c.managedId, { phase: 'ready' });
          }
        })
    );

    // Python/R containers that answer but have no score path yet (started
    // before the name was looked for, or the log line came late).
    await Promise.all(
      containers
        .filter((c) => c.phase === 'ready' && !c.appPath && c.imageKind !== 'scr')
        .map(async (c) => {
          const bin = this.binFor(c.engineKind);
          const record = this.deps.store.get(c.managedId);
          if (!bin || !record) return;
          const learned = await this.learnModelPath(record, bin);
          if (learned.appPath) {
            c.appPath = learned.appPath;
            c.appPathSource = learned.appPathSource;
            c.scoreUrl = `http://127.0.0.1:${c.hostPort}/${learned.appPath}`;
          }
        })
    );
    return { containers, engineProblem };
  }

  private owned(managedId: string): { record: ManagedContainer; bin: string } | { ok: false; problem: Problem } {
    const record = this.deps.store.get(managedId);
    if (!record) return problem('invalid-input', 'This container is not one this install created.');
    const bin = this.binFor(record.engineKind);
    if (!bin) return problem('engine', `${record.engineKind} is not installed any more.`);
    return { record, bin };
  }

  async start(managedId: string): Promise<OpResult> {
    const found = this.owned(managedId);
    if ('ok' in found) return found;
    const res = await runCli(found.bin, startArgs(found.record.containerId), { timeoutMs: 120_000 });
    if (res.code !== 0) return { ok: false, problem: classifyRunError(res.stderr) };
    this.watch(found.record);
    return { ok: true };
  }

  async stop(managedId: string): Promise<OpResult> {
    const found = this.owned(managedId);
    if ('ok' in found) return found;
    this.watchers.get(managedId)?.abort();
    const res = await runCli(found.bin, stopArgs(found.record.containerId), { timeoutMs: 60_000 });
    if (res.code !== 0 && !/is not running|container already stopped|not running/i.test(res.stderr)) {
      return problem('engine', 'The container did not stop', { detail: tail(res.stderr) });
    }
    this.setPhase(managedId, 'stopped');
    return { ok: true };
  }

  async remove(managedId: string): Promise<OpResult> {
    const found = this.owned(managedId);
    if ('ok' in found) return found;
    const approved = await this.deps.confirm({
      title: 'Delete container',
      message: `Delete the container "${found.record.displayName}"?`,
      detail: `${found.record.name} is stopped and removed; if you opened it as an SCR endpoint, that entry goes too. The image stays on disk (${found.record.imageRef}).`,
      confirmLabel: 'Delete',
    });
    if (!approved) return problem('cancelled', 'Not deleted.');
    this.watchers.get(managedId)?.abort();
    // Podman's rm -f waits its default 10 s for a container to stop, and SCR
    // ignores SIGTERM; a short stop first makes the delete take 2 s.
    await runCli(found.bin, stopArgs(found.record.containerId), { timeoutMs: 30_000 });
    const res = await runCli(found.bin, removeArgs(found.record.containerId), { timeoutMs: 60_000 });
    if (res.code !== 0 && !/no such container|no container with name or id/i.test(res.stderr)) {
      return problem('engine', 'The container was not deleted', { detail: tail(res.stderr) });
    }
    this.deps.store.remove(managedId);
    this.runtime.delete(managedId);
    this.lastCpu.delete(managedId);
    return { ok: true };
  }

  async logs(managedId: string, lines: number): Promise<OpResult<{ text: string }>> {
    const found = this.owned(managedId);
    if ('ok' in found) return found;
    const count = Math.max(1, Math.min(MAX_LOG_LINES, Math.floor(lines) || 200));
    return { ok: true, text: await this.readLogs(found.bin, found.record.containerId, count) };
  }

  // --- Resource use ---

  /** The last Podman CPU-time reading per container, to turn the cumulative counter into current use. */
  private readonly lastCpu = new Map<string, { cpuNano: number; systemNano: number }>();
  private readonly capacity = new Map<EngineKind, { value: EngineCapacity | null; at: number }>();
  private statsRun: Promise<StatsResult> | null = null;

  /** One reading for all running containers of this install. Calls that overlap share one reading. */
  stats(): Promise<StatsResult> {
    this.statsRun ??= this.readStats().finally(() => {
      this.statsRun = null;
    });
    return this.statsRun;
  }

  private async engineCapacity(kind: EngineKind, bin: string): Promise<EngineCapacity | null> {
    const cached = this.capacity.get(kind);
    if (cached && Date.now() - cached.at < 30_000) return cached.value;
    const res = await runCli(bin, infoArgs(kind), { timeoutMs: 30_000 });
    const parsed = res.code === 0 ? parseCapacity(res.stdout) : null;
    const value = parsed ? { kind, ...parsed } : null;
    this.capacity.set(kind, { value, at: Date.now() });
    return value;
  }

  private async readStats(): Promise<StatsResult> {
    const records = this.deps.store.list();
    const result: StatsResult = { engines: [], stats: [] };
    if (!records.length) return result;
    if (!this.candidates.length) this.candidates = findCandidates();

    for (const kind of new Set(records.map((r) => r.engineKind))) {
      const bin = this.binFor(kind);
      if (!bin) continue;
      const listed = await runCli(bin, listArgs(this.deps.store.installId), { timeoutMs: 30_000 });
      if (listed.code !== 0) {
        result.problem = `${kind} did not answer: ${tail(listed.stderr, 1) || 'no details'}`;
        continue;
      }
      let rows: ReturnType<typeof parsePs>;
      try {
        rows = parsePs(listed.stdout);
      } catch {
        result.problem = `${kind} gave a container list the app could not read.`;
        continue;
      }
      const matches = (id: string, record: ManagedContainer) => !!id && (record.containerId.startsWith(id) || id.startsWith(record.containerId));
      const running = records.filter(
        (r) => r.engineKind === kind && rows.some((row) => row.state === 'running' && matches(row.id, r))
      );
      const capacity = await this.engineCapacity(kind, bin);
      if (capacity) result.engines.push(capacity);
      if (!running.length) continue;

      const read = await runCli(bin, statsArgs(running.map((r) => r.containerId)), { timeoutMs: 30_000 });
      if (read.code !== 0) {
        result.problem = `${kind} gave no resource readings: ${tail(read.stderr, 1) || 'no details'}`;
        continue;
      }
      let statsRows: ReturnType<typeof parseStats>;
      try {
        statsRows = parseStats(read.stdout);
      } catch {
        result.problem = `${kind} gave resource readings the app could not read.`;
        continue;
      }
      const at = new Date().toISOString();
      for (const record of running) {
        const row = statsRows.find((s) => matches(s.id, record));
        if (!row) continue;
        let cpuCores = row.cpuPercent === null ? null : row.cpuPercent / 100;
        let cpuSinceStart = false;
        if (row.cpuNano !== undefined && row.systemNano !== undefined) {
          // Podman's percentage from a single --no-stream reading is the average since start.
          const prev = this.lastCpu.get(record.managedId);
          this.lastCpu.set(record.managedId, { cpuNano: row.cpuNano, systemNano: row.systemNano });
          if (prev && row.systemNano > prev.systemNano && row.cpuNano >= prev.cpuNano) {
            cpuCores = (row.cpuNano - prev.cpuNano) / (row.systemNano - prev.systemNano);
          } else {
            cpuSinceStart = true;
          }
        }
        const stat: ContainerStats = {
          managedId: record.managedId,
          cpuCores,
          cpuSinceStart,
          cpuLimit: record.options.cpus,
          memBytes: row.memBytes,
          memLimitBytes: row.memLimitBytes,
          memPercent: row.memPercent,
          pids: row.pids,
          netRxBytes: row.netRxBytes,
          netTxBytes: row.netTxBytes,
          blockReadBytes: row.blockReadBytes,
          blockWriteBytes: row.blockWriteBytes,
          at,
        };
        result.stats.push(stat);
      }
    }
    return result;
  }

  // --- Settings ---

  /** The container's settings for editing; variable values come from the engine, not from containers.json. */
  async settings(managedId: string): Promise<OpResult<{ options: RunOptions }>> {
    const found = this.owned(managedId);
    if ('ok' in found) return found;
    const res = await runCli(found.bin, containerInspectArgs(found.record.containerId), { timeoutMs: 20_000 });
    const state = res.code === 0 ? parseContainerInspect(res.stdout) : null;
    if (!state) return problem('engine', 'The container settings could not be read', { detail: tail(res.stderr) });
    const { envNames, ...rest } = found.record.options;
    return { ok: true, options: { ...rest, displayName: found.record.displayName, env: envValues(state.env, envNames) } };
  }

  /**
   * New settings for a container. A container's variables, folders and limits
   * are fixed when it is created, so it is replaced: stop the old one, run a
   * new one from the same image on the same port, then delete the old one.
   * If the new one does not start, the old one is kept (and started again).
   * A new name alone needs no new container.
   */
  async update(opId: string, managedId: string, rawOptions: unknown): Promise<OpResult<{ replaced: boolean }>> {
    let options: RunOptions;
    try {
      options = this.withCheckedFolders(readRunOptions(rawOptions));
    } catch (err) {
      return problem('invalid-input', err instanceof Error ? err.message : String(err));
    }
    const found = this.owned(managedId);
    if ('ok' in found) return found;
    if (this.ops.has(opId)) return problem('invalid-input', 'This operation is already running.');
    const { record, bin } = found;

    const controller = new AbortController();
    this.ops.set(opId, controller);
    const started = Date.now();
    const progress = (stage: OpStage, text: string) =>
      this.deps.emit({ type: 'progress', opId, stage, text, elapsedMs: Date.now() - started });

    try {
      const inspected = await runCli(bin, containerInspectArgs(record.containerId), { timeoutMs: 20_000 });
      const state = inspected.code === 0 ? parseContainerInspect(inspected.stdout) : null;
      if (!state) {
        return problem('engine', 'The container could not be read', {
          detail: tail(inspected.stderr),
          hint: 'If it was removed outside the app, delete it here and run the image again.',
        });
      }
      const displayName = options.displayName || repoName(record.imageRef);
      const unchanged =
        record.options.cpus === options.cpus &&
        record.options.memoryMb === options.memoryMb &&
        (record.imageKind !== 'scr' || record.options.mode === options.mode) &&
        sameEnv(envValues(state.env, record.options.envNames), options.env) &&
        sameMounts(record.options.mounts, options.mounts);
      if (unchanged) {
        this.deps.store.put({ ...record, displayName, options: { ...stored(options), mode: record.options.mode } });
        return { ok: true, replaced: false };
      }

      progress('confirm', 'Waiting for your confirmation');
      const approved = await this.deps.confirm({
        title: 'Change container settings',
        message: `Replace "${record.displayName}" with a container that has the new settings?`,
        detail: [
          'A container keeps the settings it was created with. The app stops this one, starts a new one from the ' +
            `same image on the same address (127.0.0.1:${record.hostPort}) and then deletes the old one. If the new ` +
            `one cannot be started, the old one is kept${state.running ? ' and started again' : ''}.`,
          `CPUs ${options.cpus} · memory ${options.memoryMb} MB${record.imageKind === 'scr' ? ` · mode ${options.mode}` : ''}`,
          settingsLines(options).join('\n'),
        ]
          .filter(Boolean)
          .join('\n\n'),
        confirmLabel: 'Replace container',
      });
      if (!approved) return problem('cancelled', 'Not changed.');

      this.watchers.get(managedId)?.abort();
      if (state.running) {
        progress('replace', 'Stopping the current container');
        await runCli(bin, stopArgs(record.containerId), { timeoutMs: 30_000 });
      }
      progress('run', 'Starting the new container');
      const name = containerName(parseImageRef(record.imageRef).repo, randomBytes(3).toString('hex'));
      const ran = await this.runContainer(
        bin,
        {
          name,
          installId: this.deps.store.installId,
          image: record.digestRef ?? state.image,
          platform: `linux/${record.imageArch}`,
          kind: record.imageKind,
          cpus: options.cpus,
          memoryMb: options.memoryMb,
          mode: options.mode,
          env: options.env,
          mounts: options.mounts,
        },
        controller.signal,
        record.hostPort
      );
      if (!ran.ok) {
        if (state.running) {
          await runCli(bin, startArgs(record.containerId), { timeoutMs: 120_000 });
          this.watch(record);
        }
        const kept = state.running ? 'The previous container was kept and started again.' : 'The previous container was kept.';
        return { ok: false, problem: { ...ran.problem, hint: [ran.problem.hint, kept].filter(Boolean).join(' ') } };
      }

      progress('replace', 'Deleting the previous container');
      const removed = await runCli(bin, removeArgs(record.containerId), { timeoutMs: 60_000 });
      const updated: ManagedContainer = {
        ...record,
        containerId: ran.containerId,
        name,
        displayName,
        hostPort: ran.hostPort,
        options: stored(options),
        updatedAt: new Date().toISOString(),
      };
      this.deps.store.put(updated);
      this.lastCpu.delete(managedId);
      this.watch(updated);
      if (removed.code !== 0 && !/no such container|no container with name or id/i.test(removed.stderr)) {
        return {
          ok: false,
          problem: {
            code: 'engine',
            title: `The new container runs, but the previous one (${record.name}) was not deleted`,
            detail: tail(removed.stderr),
            hint: `Delete it with the engine's own tools: ${record.engineKind} rm -f ${record.name}`,
          },
        };
      }
      return { ok: true, replaced: true };
    } finally {
      this.ops.delete(opId);
    }
  }
}
