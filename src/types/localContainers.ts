// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Local containers (desktop app only).
 * Mirrors electron/containers/types.ts; keep the two in step.
 */

export type EngineKind = 'podman' | 'docker';
export type EngineChoice = 'auto' | EngineKind;
export type EngineState = 'ready' | 'machine-stopped' | 'not-running' | 'refused' | 'error';

export interface EngineCandidate {
  kind: EngineKind;
  binPath: string;
}

export interface EngineInfo {
  kind: EngineKind;
  binPath: string;
  state: EngineState;
  message?: string;
  clientVersion?: string;
  serverVersion?: string;
  arch?: string;
  machine?: { name: string; running: boolean };
  warnings: string[];
}

export interface EngineStatus {
  choice: EngineChoice;
  candidates: EngineCandidate[];
  engine: EngineInfo | null;
}

export type ImageKind = 'scr' | 'other';

export interface EnvVar {
  name: string;
  value: string;
}

export interface FolderMount {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

export interface RunOptions {
  displayName?: string;
  cpus: number;
  memoryMb: number;
  mode: 'SAS' | 'BATCH';
  env: EnvVar[];
  mounts: FolderMount[];
}

/** As listed: variable names only, no values. */
export interface StoredRunOptions extends Omit<RunOptions, 'env'> {
  envNames: string[];
}

export type ProblemCode =
  | 'invalid-input'
  | 'engine'
  | 'signin'
  | 'not-found'
  | 'tls'
  | 'network'
  | 'no-platform'
  | 'no-emulator'
  | 'exited'
  | 'not-ready'
  | 'port-in-use'
  | 'cancelled'
  | 'unknown';

export interface Problem {
  code: ProblemCode;
  title: string;
  detail?: string;
  hint?: string;
  /** A command for the user to run themselves, shown so it can be copied. */
  command?: string;
  /** A corrected image reference the user can take over with one click. */
  suggestedRef?: string;
}

export type ContainerPhase = 'starting' | 'ready' | 'not-ready' | 'running' | 'failed' | 'stopped' | 'missing' | 'unknown';

export interface ContainerView {
  managedId: string;
  containerId: string;
  name: string;
  displayName: string;
  engineKind: EngineKind;
  imageRef: string;
  digestRef: string | null;
  imageArch: string;
  engineArch: string;
  emulated: boolean;
  imageKind: ImageKind;
  appPath: string | null;
  /** Where appPath came from: the image's SAS_SCR_APP_PATH, or the model name in the container's start-up log. */
  appPathSource?: 'image' | 'log';
  hostPort: number;
  options: StoredRunOptions;
  createdAt: string;
  updatedAt?: string;
  phase: ContainerPhase;
  engineState?: string;
  exitCode?: number;
  problem?: Problem;
  scoreUrl: string | null;
  startingSince?: string;
}


/** What the engine's host (or VM) has: the ceiling for all containers together. */
export interface EngineCapacity {
  kind: EngineKind;
  cpus: number;
  memTotalBytes: number;
  /** Podman reports it; Docker does not. */
  memFreeBytes?: number;
}

export interface ContainerStats {
  managedId: string;
  /** CPUs in use (1 = one full CPU). */
  cpuCores: number | null;
  /** Podman's first reading: the average since the container started, not the current use. */
  cpuSinceStart: boolean;
  /** The container's CPU limit. */
  cpuLimit: number;
  memBytes: number | null;
  memLimitBytes: number | null;
  memPercent: number | null;
  pids: number | null;
  netRxBytes: number | null;
  netTxBytes: number | null;
  blockReadBytes: number | null;
  blockWriteBytes: number | null;
  /** When the engine was asked (ISO). */
  at: string;
}

export interface StatsResult {
  engines: EngineCapacity[];
  stats: ContainerStats[];
  /** Set when an engine could not be asked. */
  problem?: string;
}

/** Where a pull's byte counts come from. */
export type DownloadSource = 'machine-network' | 'host-network' | 'layers';

/**
 * Download progress of a pull. Engines print no byte counts when their output
 * goes to a program, so every field is put together by the app and may be
 * missing.
 */
export interface PullDownload {
  source: DownloadSource;
  /** Compressed size of the layers still to download; layers the engine already has are left out. */
  totalBytes?: number;
  /** Set when it is not known which layers the engine already has, so totalBytes counts all of them. */
  totalIsUpperBound?: boolean;
  receivedBytes?: number;
  /** Bytes per second over the last few seconds. */
  rateBps?: number;
}

export type OpStage = 'confirm' | 'pull' | 'inspect' | 'run' | 'replace';

export type ContainersEvent =
  | {
      type: 'progress';
      opId: string;
      stage: OpStage;
      text: string;
      layersDone?: number;
      layersTotal?: number;
      download?: PullDownload;
      elapsedMs: number;
    }
  | { type: 'notice'; opId: string; notice: 'emulated'; imageArch: string; engineArch: string }
  | { type: 'state'; managedId: string; phase: ContainerPhase; problem?: Problem };

export type OpResult<T extends object = object> = ({ ok: true } & T) | { ok: false; problem: Problem };

export interface DeployRequest {
  opId: string;
  imageRef: string;
  options: RunOptions;
}

export interface UpdateRequest {
  opId: string;
  managedId: string;
  options: RunOptions;
}

export interface LocalContainersAPI {
  status: () => Promise<EngineStatus>;
  setEngine: (choice: EngineChoice) => Promise<EngineStatus>;
  startMachine: () => Promise<OpResult<{ status: EngineStatus }>>;
  deploy: (req: DeployRequest) => Promise<OpResult<{ managedId: string }>>;
  cancel: (opId: string) => Promise<void>;
  list: () => Promise<{ containers: ContainerView[]; engineProblem?: string }>;
  start: (managedId: string) => Promise<OpResult>;
  stop: (managedId: string) => Promise<OpResult>;
  remove: (managedId: string) => Promise<OpResult>;
  logs: (managedId: string, lines: number) => Promise<OpResult<{ text: string }>>;
  /** Current settings, with the variable values read from the engine. */
  settings: (managedId: string) => Promise<OpResult<{ options: RunOptions }>>;
  /** New settings: replaces the container (after a native confirmation) unless only the name changed. */
  update: (req: UpdateRequest) => Promise<OpResult<{ replaced: boolean }>>;
  /** A native folder dialog; the folder comes back checked (its real path) or with the reason it can't be mounted. */
  chooseFolder: () => Promise<OpResult<{ path: string }>>;
  /** CPU, memory, processes and I/O of the running containers, and the engine host's capacity. */
  stats: () => Promise<StatsResult>;
  /** Returns the unsubscribe function. */
  onEvent: (callback: (event: ContainersEvent) => void) => () => void;
}
