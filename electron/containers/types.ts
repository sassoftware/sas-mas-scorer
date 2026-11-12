// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Types shared by the local-container modules (desktop app only). The
 * renderer has its own copy in
 * src/types/localContainers.ts; keep the two in step.
 */

export type EngineKind = 'podman' | 'docker';
export type EngineChoice = 'auto' | EngineKind;

export interface EngineCandidate {
  kind: EngineKind;
  /** Absolute path of the CLI binary (.exe on Windows). */
  binPath: string;
}

export type EngineState =
  /** Can pull and run. */
  | 'ready'
  /** Podman on Windows/macOS: the machine (VM) exists but is not running. */
  | 'machine-stopped'
  /** The CLI is there, but no engine answers (Docker Desktop closed, no Podman machine, service down). */
  | 'not-running'
  /** Found and running, but not used: a remote engine, or Docker Engine older than 28 on Linux. */
  | 'refused'
  /** The CLI could not be run or gave output the app does not understand. */
  | 'error';

export interface EngineInfo {
  kind: EngineKind;
  binPath: string;
  state: EngineState;
  message?: string;
  clientVersion?: string;
  serverVersion?: string;
  /** Architecture of the engine's Linux host or VM, in image naming (amd64, arm64). */
  arch?: string;
  machine?: { name: string; running: boolean };
  warnings: string[];
}

export interface EngineStatus {
  choice: EngineChoice;
  candidates: EngineCandidate[];
  engine: EngineInfo | null;
}

/** 'scr': a SAS Container Runtime (Java) image. 'other': Python/R model images and anything else. */
export type ImageKind = 'scr' | 'other';

export interface ImageFacts {
  id: string;
  /** host/repo@sha256:… for the pulled repository, or null (locally built image). */
  digestRef: string | null;
  arch: string;
  os: string;
  sizeBytes: number;
  /** The SAS_SCR_APP_PATH baked into the image, without a leading slash. */
  appPath: string | null;
  kind: ImageKind;
}

export interface EnvVar {
  name: string;
  value: string;
}

export interface FolderMount {
  /** Absolute folder on this computer (its real path, links resolved). */
  hostPath: string;
  /** Absolute path inside the container. */
  containerPath: string;
  readOnly: boolean;
}

export interface RunOptions {
  displayName?: string;
  cpus: number;
  memoryMb: number;
  /** SAS_SCR_REST_API_TYPE; applied to SCR images only. */
  mode: 'SAS' | 'BATCH';
  /** Environment variables for the container. The values go to the engine only, never into containers.json. */
  env: EnvVar[];
  /** Folders of this computer, bound into the container. */
  mounts: FolderMount[];
}

/** RunOptions as containers.json keeps them and the list shows them: variable names, no values. */
export interface StoredRunOptions extends Omit<RunOptions, 'env'> {
  envNames: string[];
}

export interface ManagedContainer {
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
  /** Score path below the host, without a leading slash. */
  appPath: string | null;
  /** Where appPath came from: the image's SAS_SCR_APP_PATH, or the model name in the container's start-up log. */
  appPathSource?: 'image' | 'log';
  hostPort: number;
  options: StoredRunOptions;
  createdAt: string;
  /** When the settings were last changed (the container was replaced). */
  updatedAt?: string;
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

export type ContainerPhase =
  /** Started, waiting for the score endpoint to answer. */
  | 'starting'
  | 'ready'
  /** Running, but its endpoint did not answer within the start-up time. */
  | 'not-ready'
  /** Running; readiness not checked in this session. */
  | 'running'
  /** Stopped during start-up (see problem). */
  | 'failed'
  | 'stopped'
  /** In the app's records, but the engine no longer has it. */
  | 'missing'
  /** The engine could not be asked. */
  | 'unknown';

export interface ContainerView extends ManagedContainer {
  phase: ContainerPhase;
  engineState?: string;
  exitCode?: number;
  problem?: Problem;
  /** http://127.0.0.1:<port>/<appPath>, when the image has an app path. */
  scoreUrl: string | null;
  /** When the current start began (ISO), while phase is 'starting'. */
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
