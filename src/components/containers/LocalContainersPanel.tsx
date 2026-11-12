// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Run SCR images locally with Podman or Docker (desktop app only, preview).
 * Everything that touches the engine happens in the main process; this panel
 * only shows state and asks.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardBody, CardHeader } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge, type BadgeVariant } from '../common/Badge';
import { copyText } from '../../utils/apiErrors';
import {
  draftFromOptions,
  draftToOptions,
  emptyDraft,
  ExtrasFields,
  LimitsFields,
  type SettingsDraft,
} from './RunSettingsFields';
import { ResourceMonitor } from './ResourceMonitor';
import { PullProgress } from './PullProgress';
import type {
  ContainerPhase,
  ContainersEvent,
  ContainerView,
  EngineChoice,
  EngineStatus,
  ImageKind,
  LocalContainersAPI,
  Problem,
} from '../../types/localContainers';

interface LocalContainersPanelProps {
  /** Adds the running container as an SCR endpoint and opens it. */
  onOpenEndpoint: (scoreUrl: string, label: string) => Promise<void>;
}

type ProgressEvent = Extract<ContainersEvent, { type: 'progress' }>;
type ArchNotice = { imageArch: string; engineArch: string };

interface EditState {
  managedId: string;
  title: string;
  imageKind: ImageKind;
  draft: SettingsDraft | null;
  loading: boolean;
  saving: boolean;
  progress: string | null;
  problem: Problem | null;
}

const archLabel = (arch: string): string => (arch === 'amd64' ? 'x86-64' : arch === 'arm64' ? 'ARM' : arch || 'unknown');

const newOpId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `op-${Date.now().toString(36)}`;

const seconds = (ms: number): string => `${Math.max(0, Math.round(ms / 1000))} s`;

const PHASES: Record<ContainerPhase, { label: string; variant: BadgeVariant }> = {
  starting: { label: 'Starting', variant: 'info' },
  ready: { label: 'Ready', variant: 'success' },
  running: { label: 'Running', variant: 'success' },
  'not-ready': { label: 'Not answering', variant: 'warning' },
  failed: { label: 'Stopped during start-up', variant: 'error' },
  stopped: { label: 'Stopped', variant: 'default' },
  missing: { label: 'Removed outside the app', variant: 'warning' },
  unknown: { label: 'Unknown', variant: 'default' },
};

const RESOURCES_KEY = 'mas-scorer.localContainers.showResources';

/** Whether the resource card was open last time (a convenience; storage may be unavailable). */
const readShowResources = (): boolean => {
  try {
    return localStorage.getItem(RESOURCES_KEY) === '1';
  } catch {
    return false;
  }
};

const isRunningPhase = (phase: ContainerPhase): boolean =>
  phase === 'starting' || phase === 'ready' || phase === 'running' || phase === 'not-ready';

const EMULATION_TOOLTIP =
  'Runs through an emulator: start-up and the first score are slower than on an x86-64 computer; later scores are close to native.';

const EmulationNotice: React.FC<{ notice: ArchNotice }> = ({ notice }) => (
  <Alert variant="info" title="Running under emulation">
    {notice.imageArch === 'amd64' && notice.engineArch === 'arm64' ? (
      <>
        This image is built for x86-64 (amd64) computers only, and this one is ARM, so it runs through an emulator. The
        model and its code are the same; only the speed changes. Start-up takes about 2–3 times longer than on an x86-64
        computer, and the first score can take up to a second. After that, scores are about as fast.
      </>
    ) : (
      <>
        This image is built for {archLabel(notice.imageArch)} and the container engine runs on{' '}
        {archLabel(notice.engineArch)}, so it runs through an emulator. The model and its code are the same; only the
        speed changes, mostly at start-up.
      </>
    )}
  </Alert>
);

/** A command for the user's own terminal, with a copy button. */
const CommandBox: React.FC<{ command: string }> = ({ command }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="lc-command">
      <code className="lc-command__text">{command}</code>
      <Button
        variant="secondary"
        size="small"
        onClick={async () => {
          if (await copyText(command)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
};

const ProblemAlert: React.FC<{ problem: Problem; onClose?: () => void; onUseRef?: (ref: string) => void }> = ({
  problem,
  onClose,
  onUseRef,
}) => (
  <Alert
    variant={problem.code === 'not-ready' ? 'warning' : 'error'}
    title={problem.title}
    dismissible={!!onClose}
    onClose={onClose}
  >
    {problem.suggestedRef && (
      <div className="lc-suggest">
        <span>Did you mean</span>
        <code className="lc-command__text">{problem.suggestedRef}</code>
        {onUseRef && (
          <Button size="small" onClick={() => onUseRef(problem.suggestedRef as string)}>
            Use this reference
          </Button>
        )}
      </div>
    )}
    {problem.hint && <p className="lc-hint">{problem.hint}</p>}
    {problem.command && <CommandBox command={problem.command} />}
    {problem.detail && (
      <details className="lc-details">
        <summary>Engine output</summary>
        <pre className="lc-detail">{problem.detail}</pre>
      </details>
    )}
  </Alert>
);

export const LocalContainersPanel: React.FC<LocalContainersPanelProps> = ({ onOpenEndpoint }) => {
  const api = window.electronAPI?.containers as LocalContainersAPI;

  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [startingMachine, setStartingMachine] = useState(false);
  const [engineProblem, setEngineProblem] = useState<Problem | null>(null);

  const [containers, setContainers] = useState<ContainerView[]>([]);
  const [listProblem, setListProblem] = useState<string | undefined>();

  const [imageRef, setImageRef] = useState('');
  const [draft, setDraft] = useState<SettingsDraft>(emptyDraft);

  const opRef = useRef<string | null>(null);
  const [opId, setOpId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [opStartedAt, setOpStartedAt] = useState(0);
  const [opProblem, setOpProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<ArchNotice | null>(null);

  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [rowProblems, setRowProblems] = useState<Record<string, Problem>>({});
  const [logs, setLogs] = useState<{ managedId: string; title: string; text: string; loading: boolean } | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [showResources, setShowResources] = useState(readShowResources);
  const toggleResources = (show: boolean) => {
    setShowResources(show);
    try {
      localStorage.setItem(RESOURCES_KEY, show ? '1' : '0');
    } catch {
      // Not remembered; the card still opens.
    }
  };
  const editOpRef = useRef<string | null>(null);
  const editCardRef = useRef<HTMLDivElement | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refreshStatus = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await api.status());
    } finally {
      setChecking(false);
    }
  }, [api]);

  const refreshList = useCallback(async () => {
    const result = await api.list();
    setContainers(result.containers);
    setListProblem(result.engineProblem);
  }, [api]);

  useEffect(() => {
    void refreshStatus();
    void refreshList();
    return api.onEvent((event) => {
      if (event.type === 'progress') {
        if (event.opId === opRef.current) setProgress(event);
        if (event.opId === editOpRef.current) setEdit((e) => (e ? { ...e, progress: event.text } : e));
      } else if (event.type === 'notice') {
        if (event.opId === opRef.current) setNotice({ imageArch: event.imageArch, engineArch: event.engineArch });
      } else if (event.type === 'state') {
        setContainers((list) =>
          list.map((c) =>
            c.managedId === event.managedId
              ? {
                  ...c,
                  phase: event.phase,
                  problem: event.problem,
                  startingSince: event.phase === 'starting' ? new Date().toISOString() : c.startingSince,
                }
              : c
          )
        );
        if (event.phase !== 'starting') void refreshList();
      }
    });
  }, [api, refreshList, refreshStatus]);

  // A clock for the elapsed times shown while something is under way.
  const ticking = !!opId || containers.some((c) => c.phase === 'starting');
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  const engine = status?.engine ?? null;
  const engineReady = engine?.state === 'ready';
  const likelyEmulated = !!engine?.arch && engine.arch !== 'amd64';

  const handleEngineChoice = async (choice: EngineChoice) => {
    setChecking(true);
    try {
      setStatus(await api.setEngine(choice));
    } finally {
      setChecking(false);
    }
  };

  const handleStartMachine = async () => {
    setEngineProblem(null);
    setStartingMachine(true);
    try {
      const result = await api.startMachine();
      if (result.ok) setStatus(result.status);
      else if (result.problem.code !== 'cancelled') setEngineProblem(result.problem);
      void refreshList();
    } finally {
      setStartingMachine(false);
    }
  };

  const handleDeploy = async (event: React.FormEvent) => {
    event.preventDefault();
    const converted = draftToOptions(draft);
    if ('error' in converted) {
      setOpProblem({ code: 'invalid-input', title: converted.error });
      return;
    }
    const id = newOpId();
    opRef.current = id;
    setOpId(id);
    setOpStartedAt(Date.now());
    setNow(Date.now());
    setProgress(null);
    setOpProblem(null);
    setNotice(null);
    try {
      const result = await api.deploy({
        opId: id,
        imageRef: imageRef.trim(),
        options: converted.options,
      });
      if (!result.ok) {
        if (result.problem.code !== 'cancelled') setOpProblem(result.problem);
        setNotice(null);
      }
      await refreshList();
    } finally {
      opRef.current = null;
      setOpId(null);
      setProgress(null);
    }
  };

  const runRowAction = async (managedId: string, action: () => Promise<{ ok: boolean; problem?: Problem }>) => {
    setBusy((b) => ({ ...b, [managedId]: true }));
    setRowProblems(({ [managedId]: _old, ...rest }) => rest);
    try {
      const result = await action();
      if (!result.ok && result.problem && result.problem.code !== 'cancelled') {
        setRowProblems((p) => ({ ...p, [managedId]: result.problem as Problem }));
      }
      await refreshList();
    } finally {
      setBusy(({ [managedId]: _done, ...rest }) => rest);
    }
  };

  const showLogs = async (container: ContainerView) => {
    setLogs({ managedId: container.managedId, title: container.displayName, text: '', loading: true });
    const result = await api.logs(container.managedId, 300);
    setLogs({
      managedId: container.managedId,
      title: container.displayName,
      text: result.ok ? result.text || '(no output yet)' : result.problem.title,
      loading: false,
    });
  };

  const openSettings = async (container: ContainerView) => {
    setEdit({
      managedId: container.managedId,
      title: container.displayName,
      imageKind: container.imageKind,
      draft: null,
      loading: true,
      saving: false,
      progress: null,
      problem: null,
    });
    setTimeout(() => editCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
    const result = await api.settings(container.managedId);
    setEdit((e) =>
      e && e.managedId === container.managedId
        ? result.ok
          ? { ...e, loading: false, draft: draftFromOptions(result.options) }
          : { ...e, loading: false, problem: result.problem }
        : e
    );
  };

  const saveSettings = async (current: EditState) => {
    if (!current.draft) return;
    const converted = draftToOptions(current.draft);
    if ('error' in converted) {
      setEdit({ ...current, problem: { code: 'invalid-input', title: converted.error } });
      return;
    }
    const id = newOpId();
    editOpRef.current = id;
    setEdit({ ...current, saving: true, progress: null, problem: null });
    try {
      const result = await api.update({ opId: id, managedId: current.managedId, options: converted.options });
      if (result.ok) setEdit(null);
      else {
        setEdit((e) =>
          e ? { ...e, saving: false, progress: null, problem: result.problem.code === 'cancelled' ? null : result.problem } : e
        );
      }
      await refreshList();
    } finally {
      editOpRef.current = null;
    }
  };

  const openEndpoint = async (container: ContainerView) => {
    if (!container.scoreUrl) return;
    await runRowAction(container.managedId, async () => {
      try {
        await onOpenEndpoint(container.scoreUrl as string, container.displayName);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          problem: { code: 'unknown', title: 'The endpoint could not be opened', detail: err instanceof Error ? err.message : String(err) },
        };
      }
    });
  };

  const stageText = (p: ProgressEvent | null): string => {
    if (!p) return 'Checking the engine';
    const layers = p.layersTotal ? ` (${p.layersDone ?? 0} of ${p.layersTotal} layers)` : '';
    return p.stage === 'pull' ? `Pulling: ${p.text}${layers}` : p.text;
  };

  const engineLine = engine ? (
    <span className="lc-engine__line">
      <strong>{engine.kind === 'podman' ? 'Podman' : 'Docker'}</strong>
      {engine.serverVersion ? ` ${engine.serverVersion}` : engine.clientVersion ? ` ${engine.clientVersion} (client)` : ''}
      {engine.arch && <> · runs on {archLabel(engine.arch)} ({engine.arch})</>}
      {engine.machine && <> · machine “{engine.machine.name}”</>}
      <span className="lc-path">{engine.binPath}</span>
    </span>
  ) : null;

  return (
    <>
      <Card>
        <CardHeader
          actions={
            <Button variant="secondary" size="small" onClick={() => void refreshStatus()} loading={checking}>
              Check again
            </Button>
          }
        >
          Run images locally <Badge variant="info" size="small">Preview</Badge>
        </CardHeader>
        <CardBody>
          <div className="lc-engine">
            <label className="scr-field">
              <span className="scr-field__label">Container engine</span>
              <select
                className="sas-input"
                value={status?.choice ?? 'auto'}
                onChange={(e) => void handleEngineChoice(e.target.value as EngineChoice)}
                disabled={checking || !!opId}
              >
                <option value="auto">Automatic (Podman first)</option>
                <option value="podman">Podman</option>
                <option value="docker">Docker</option>
              </select>
            </label>
            <div className="lc-engine__status">
              {!status ? (
                <span className="scr-muted">Looking for Podman or Docker…</span>
              ) : !engine ? (
                <span className="scr-muted">
                  {status.choice === 'auto' ? 'Neither Podman nor Docker was found.' : `${status.choice} was not found.`}
                </span>
              ) : (
                <>
                  <Badge variant={engineReady ? 'success' : engine.state === 'machine-stopped' ? 'warning' : 'error'} size="small">
                    {engineReady ? 'Ready' : engine.state === 'machine-stopped' ? 'Machine stopped' : engine.state === 'refused' ? 'Not used' : 'Not available'}
                  </Badge>
                  {engineLine}
                </>
              )}
            </div>
          </div>

          {engine && engine.state === 'machine-stopped' && (
            <Alert
              variant="warning"
              title={engine.message ?? 'The Podman machine is not running.'}
              actions={
                <Button size="small" onClick={() => void handleStartMachine()} loading={startingMachine}>
                  Start machine
                </Button>
              }
            >
              Podman runs containers inside this machine.
            </Alert>
          )}
          {engine && (engine.state === 'not-running' || engine.state === 'refused' || engine.state === 'error') && (
            <Alert variant={engine.state === 'refused' ? 'warning' : 'error'} title={engine.message ?? 'The engine is not available.'}>
              {engine.state === 'refused'
                ? 'MAS Scorer only uses a container engine on this computer that keeps published ports on 127.0.0.1.'
                : 'Start the engine, then select Check again.'}
            </Alert>
          )}
          {status && !engine && (
            <Alert variant="info" title="No container engine found">
              Install Podman (recommended) or Docker, then select Check again. On Windows, Podman also needs a machine:
              run <code>podman machine init</code> once in a terminal.
            </Alert>
          )}
          {engineProblem && <ProblemAlert problem={engineProblem} onClose={() => setEngineProblem(null)} />}
          {engine?.warnings.map((w) => (
            <p key={w} className="scr-hint">{w}</p>
          ))}

          <form className="scr-add" onSubmit={handleDeploy}>
            <div className="scr-add__fields">
              <label className="scr-field scr-field--grow">
                <span className="scr-field__label">Image</span>
                <input
                  className="sas-input"
                  required
                  value={imageRef}
                  onChange={(e) => setImageRef(e.target.value)}
                  placeholder="registry.example.com/library/my_model:latest"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={!!opId}
                />
              </label>
              <label className="scr-field">
                <span className="scr-field__label">Name (optional)</span>
                <input
                  className="sas-input"
                  value={draft.displayName}
                  onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                  maxLength={60}
                  placeholder="Shown in the list"
                  disabled={!!opId}
                />
              </label>
            </div>
            <div className="scr-add__fields lc-options">
              <LimitsFields draft={draft} onChange={setDraft} disabled={!!opId} />
              {opId ? (
                <Button type="button" variant="tertiary" onClick={() => void api.cancel(opId)}>
                  Cancel
                </Button>
              ) : (
                <Button type="submit" disabled={!engineReady || !imageRef.trim()}>
                  Pull and run
                </Button>
              )}
            </div>
            <details className="lc-more" open={draft.env.length > 0 || draft.mounts.length > 0 || undefined}>
              <summary>
                Environment variables and folders
                {draft.env.length + draft.mounts.length > 0 ? ` (${draft.env.length + draft.mounts.length})` : ''}
              </summary>
              <ExtrasFields draft={draft} onChange={setDraft} disabled={!!opId} api={api} idPrefix="lc-run" />
            </details>
            {likelyEmulated && Number(draft.cpus) < 2 && (
              <p className="scr-hint">
                Images built only for x86-64 run under emulation on this computer; with fewer than 2 CPUs, start-up roughly
                doubles.
              </p>
            )}
            <p className="scr-hint">
              The image is pulled with the engine&apos;s own registry sign-in (MAS Scorer never handles registry
              passwords) and published on 127.0.0.1 only, with no added privileges. Mode applies to SAS Container Runtime
              images. Variable values are passed to the engine and not kept by MAS Scorer. Containers keep running when
              you close the app.
            </p>
          </form>

          {opId && (
            <div className="lc-progress">
              <div role="status">
                {stageText(progress)} · {seconds(now - opStartedAt)}
              </div>
              {progress?.stage === 'pull' && progress.download && <PullProgress download={progress.download} />}
            </div>
          )}
          {notice && <EmulationNotice notice={notice} />}
          {opProblem && (
            <ProblemAlert
              problem={opProblem}
              onClose={() => setOpProblem(null)}
              onUseRef={(ref) => {
                setImageRef(ref);
                setOpProblem(null);
              }}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          actions={
            <>
              <Button
                variant="secondary"
                size="small"
                aria-pressed={showResources}
                disabled={containers.length === 0}
                onClick={() => toggleResources(!showResources)}
              >
                {showResources ? 'Hide resource use' : 'Resource use'}
              </Button>
              <Button variant="secondary" size="small" onClick={() => void refreshList()}>
                Refresh
              </Button>
            </>
          }
        >
          Local containers
        </CardHeader>
        <CardBody>
          {listProblem && (
            <Alert variant="warning" title="The engine could not be asked about the containers">
              {listProblem}
            </Alert>
          )}
          {containers.length === 0 ? (
            <p className="scr-muted">No containers yet. Containers started here are listed with their state.</p>
          ) : (
            <div className="sas-table__wrapper">
              <table className="sas-table sas-table--compact">
                <thead className="sas-table__head">
                  <tr>
                    <th scope="col" className="sas-table__th">Name</th>
                    <th scope="col" className="sas-table__th">Image</th>
                    <th scope="col" className="sas-table__th">State</th>
                    <th scope="col" className="sas-table__th">Address</th>
                    <th scope="col" className="sas-table__th"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {containers.map((c) => {
                    const phase = PHASES[c.phase] ?? PHASES.unknown;
                    const problem = rowProblems[c.managedId] ?? c.problem;
                    const rowBusy = !!busy[c.managedId];
                    return (
                      <React.Fragment key={c.managedId}>
                        <tr className="sas-table__row">
                          <td className="sas-table__td">
                            <div>{c.displayName}</div>
                            <div className="lc-path">{c.name}</div>
                            {((c.options.mounts ?? []).length > 0 || (c.options.envNames ?? []).length > 0) && (
                              <div className="lc-settings-summary">
                                {(c.options.mounts ?? []).map((m) => (
                                  <div key={m.containerPath}>
                                    Folder {m.hostPath} → {m.containerPath} ({m.readOnly ? 'read-only' : 'read-write'})
                                  </div>
                                ))}
                                {(c.options.envNames ?? []).length > 0 && <div>Variables: {c.options.envNames.join(', ')}</div>}
                              </div>
                            )}
                          </td>
                          <td className="sas-table__td">
                            <div className="scr-url">{c.imageRef}</div>
                            <div className="lc-image-meta">
                              {c.emulated ? (
                                <span title={EMULATION_TOOLTIP}>
                                  <Badge variant="warning" size="small">
                                    Emulated: {archLabel(c.imageArch)} on {archLabel(c.engineArch)}
                                  </Badge>
                                </span>
                              ) : (
                                <span className="scr-muted">{c.imageArch}</span>
                              )}
                              {c.digestRef && (
                                <span className="lc-path" title={c.digestRef}>
                                  {c.digestRef.slice(c.digestRef.indexOf('@') + 1, c.digestRef.indexOf('@') + 20)}…
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="sas-table__td">
                            <Badge variant={phase.variant} size="small">
                              {phase.label}
                              {c.phase === 'starting' && c.startingSince
                                ? ` · ${seconds(now - Date.parse(c.startingSince))}`
                                : ''}
                            </Badge>
                          </td>
                          <td className="sas-table__td">
                            <div className="scr-url">{c.scoreUrl ?? `127.0.0.1:${c.hostPort}`}</div>
                            {c.appPathSource === 'log' && (
                              <div className="lc-path" title="The model name the container logged at start-up; the app checked that it serves this route.">
                                Model name from the container log
                              </div>
                            )}
                          </td>
                          <td className="sas-table__td scr-actions">
                            {c.scoreUrl && c.phase === 'ready' && (
                              <Button variant="secondary" size="small" disabled={rowBusy} onClick={() => void openEndpoint(c)}>
                                Open
                              </Button>
                            )}
                            <Button variant="tertiary" size="small" disabled={c.phase === 'missing'} onClick={() => void showLogs(c)}>
                              Logs
                            </Button>
                            <Button
                              variant="tertiary"
                              size="small"
                              disabled={rowBusy || c.phase === 'missing' || c.phase === 'unknown' || edit?.saving}
                              onClick={() => void openSettings(c)}
                            >
                              Settings
                            </Button>
                            {isRunningPhase(c.phase) ? (
                              <Button
                                variant="tertiary"
                                size="small"
                                loading={rowBusy}
                                onClick={() => void runRowAction(c.managedId, () => api.stop(c.managedId))}
                              >
                                Stop
                              </Button>
                            ) : (
                              <Button
                                variant="tertiary"
                                size="small"
                                loading={rowBusy}
                                disabled={c.phase === 'missing' || c.phase === 'unknown'}
                                onClick={() => void runRowAction(c.managedId, () => api.start(c.managedId))}
                              >
                                Start
                              </Button>
                            )}
                            <Button
                              variant="tertiary"
                              size="small"
                              disabled={rowBusy}
                              onClick={() =>
                                void runRowAction(c.managedId, async () => {
                                  const result = await api.remove(c.managedId);
                                  if (result.ok && logs?.managedId === c.managedId) setLogs(null);
                                  if (result.ok && edit?.managedId === c.managedId) setEdit(null);
                                  return result;
                                })
                              }
                            >
                              Delete
                            </Button>
                          </td>
                        </tr>
                        {problem && (
                          <tr className="lc-problem-row">
                            <td className="sas-table__td" colSpan={5}>
                              <ProblemAlert problem={problem} />
                            </td>
                          </tr>
                        )}
                        {!c.scoreUrl && c.phase === 'ready' && (
                          <tr className="lc-problem-row">
                            <td className="sas-table__td" colSpan={5}>
                              <p className="scr-hint">
                                The container answers, but its score address is not known: the image has no SCR app
                                path, and no model name was found in its start-up log. Add it above as an endpoint by
                                hand: http://127.0.0.1:{c.hostPort}/&lt;model name&gt;.
                              </p>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {showResources && containers.length > 0 && (
        <ResourceMonitor api={api} containers={containers} onClose={() => toggleResources(false)} />
      )}

      {edit && (
        <div ref={editCardRef}>
          <Card>
            <CardHeader
              actions={
                <Button variant="tertiary" size="small" disabled={edit.saving} onClick={() => setEdit(null)}>
                  Close
                </Button>
              }
            >
              Settings: {edit.title}
            </CardHeader>
            <CardBody>
              {edit.loading && <p className="scr-muted">Reading the container&apos;s settings…</p>}
              {edit.draft && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveSettings(edit);
                  }}
                >
                  <div className="scr-add__fields">
                    <label className="scr-field">
                      <span className="scr-field__label">Name</span>
                      <input
                        className="sas-input"
                        value={edit.draft.displayName}
                        onChange={(e) => setEdit({ ...edit, draft: { ...(edit.draft as SettingsDraft), displayName: e.target.value } })}
                        maxLength={60}
                        disabled={edit.saving}
                      />
                    </label>
                    <LimitsFields
                      draft={edit.draft}
                      onChange={(next) => setEdit({ ...edit, draft: next })}
                      disabled={edit.saving}
                      showMode={edit.imageKind === 'scr'}
                    />
                  </div>
                  <ExtrasFields
                    draft={edit.draft}
                    onChange={(next) => setEdit({ ...edit, draft: next })}
                    disabled={edit.saving}
                    api={api}
                    idPrefix="lc-edit"
                    imageKind={edit.imageKind}
                  />
                  <p className="scr-hint">
                    A container keeps the settings it was created with, so applying them replaces it with a new container
                    from the same image, on the same address. A new name alone changes nothing else.
                  </p>
                  <div className="lc-settings-actions">
                    <Button type="submit" loading={edit.saving}>
                      Apply
                    </Button>
                    <Button type="button" variant="tertiary" disabled={edit.saving} onClick={() => setEdit(null)}>
                      Cancel
                    </Button>
                    {edit.saving && edit.progress && (
                      <span className="lc-progress" role="status">
                        {edit.progress}
                      </span>
                    )}
                  </div>
                </form>
              )}
              {edit.problem && <ProblemAlert problem={edit.problem} onClose={() => setEdit({ ...edit, problem: null })} />}
            </CardBody>
          </Card>
        </div>
      )}

      {logs && (
        <Card>
          <CardHeader
            actions={
              <>
                <Button
                  variant="secondary"
                  size="small"
                  loading={logs.loading}
                  onClick={() => {
                    const c = containers.find((x) => x.managedId === logs.managedId);
                    if (c) void showLogs(c);
                  }}
                >
                  Refresh
                </Button>
                <Button variant="tertiary" size="small" onClick={() => setLogs(null)}>
                  Close
                </Button>
              </>
            }
          >
            Logs: {logs.title}
          </CardHeader>
          <CardBody>
            <p className="scr-hint">The last 300 lines. Logs can contain scored data; they are kept in memory only.</p>
            <pre className="lc-logs">{logs.loading ? 'Loading…' : logs.text}</pre>
          </CardBody>
        </Card>
      )}
    </>
  );
};

export default LocalContainersPanel;
