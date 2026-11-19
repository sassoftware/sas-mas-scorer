// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Resource use of the running local containers: CPU, memory, processes and
 * I/O as the container engine reports them, read every few seconds while this
 * card is open and the window is visible. History stays in memory only.
 */

import React, { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader } from '../common/Card';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import type { ContainerStats, ContainerView, EngineCapacity, LocalContainersAPI } from '../../types/localContainers';

const POLL_MS = 5_000;
/** Readings kept per container: five minutes at one every five seconds. */
const KEEP = 60;
const NEAR_LIMIT_PERCENT = 90;

const isRunning = (c: ContainerView): boolean =>
  c.phase === 'starting' || c.phase === 'ready' || c.phase === 'running' || c.phase === 'not-ready';

/** Binary units, as the memory limit is set (2048 MB = 2 GiB). */
export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const formatCores = (v: number): string => (v < 0.01 ? '0' : v < 10 ? v.toFixed(2) : v.toFixed(1));
const clock = (iso: string): string => new Date(iso).toLocaleTimeString();

interface Point {
  at: string;
  v: number;
}

/** One series against a fixed ceiling (the container's limit), newest on the right; hover a point for its value. */
const Sparkline: React.FC<{ points: Point[]; max: number; label: string; format: (v: number) => string }> = ({
  points,
  max,
  label,
  format,
}) => {
  const w = 132;
  const h = 30;
  const pad = 2;
  const step = w / (KEEP - 1);
  const x = (i: number) => w - (points.length - 1 - i) * step;
  const y = (v: number) => h - pad - (Math.min(Math.max(v, 0), max) / (max || 1)) * (h - 2 * pad);
  const peak = points.reduce((m, p) => Math.max(m, p.v), 0);
  const summary = points.length
    ? `${label}: now ${format(points[points.length - 1].v)}, peak ${format(peak)} over the last ${Math.max(1, Math.round((points.length * POLL_MS) / 60_000))} min`
    : `${label}: no readings yet`;
  return (
    <svg className="lc-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={summary}>
      <line x1={0} x2={w} y1={h - pad} y2={h - pad} className="lc-spark__base" />
      {points.length > 1 && (
        <polyline className="lc-spark__line" points={points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} />
      )}
      {points.length === 1 && <circle className="lc-spark__dot" cx={x(0)} cy={y(points[0].v)} r={2.5} />}
      {points.map((p, i) => (
        <rect key={p.at} x={x(i) - step / 2} y={0} width={step} height={h} className="lc-spark__hit">
          <title>{`${clock(p.at)} · ${format(p.v)}`}</title>
        </rect>
      ))}
    </svg>
  );
};

interface ResourceMonitorProps {
  api: LocalContainersAPI;
  containers: ContainerView[];
  onClose: () => void;
}

export const ResourceMonitor: React.FC<ResourceMonitorProps> = ({ api, containers, onClose }) => {
  const [history, setHistory] = useState<Record<string, ContainerStats[]>>({});
  const [engines, setEngines] = useState<EngineCapacity[]>([]);
  const [problem, setProblem] = useState<string | undefined>();
  const [paused, setPaused] = useState(false);
  const [lastAt, setLastAt] = useState<string | null>(null);

  const running = containers.filter(isRunning);
  const runningKey = running.map((c) => c.managedId).join(',');

  useEffect(() => {
    if (paused || !runningKey) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const result = await api.stats();
          if (stopped) return;
          setEngines(result.engines);
          setProblem(result.problem);
          if (result.stats.length) setLastAt(result.stats[0].at);
          const ids = new Set(runningKey.split(','));
          setHistory((prev) => {
            const next: Record<string, ContainerStats[]> = {};
            for (const id of ids) if (prev[id]) next[id] = prev[id];
            for (const s of result.stats) next[s.managedId] = [...(next[s.managedId] ?? []), s].slice(-KEEP);
            return next;
          });
        } catch (err) {
          if (!stopped) setProblem(err instanceof Error ? err.message : String(err));
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, paused, runningKey]);

  const limitsByEngine = new Map<string, number>();
  for (const c of running) {
    limitsByEngine.set(c.engineKind, (limitsByEngine.get(c.engineKind) ?? 0) + c.options.memoryMb * 1024 * 1024);
  }

  return (
    <Card>
      <CardHeader
        actions={
          <>
            <Button variant="secondary" size="small" onClick={() => setPaused((p) => !p)} disabled={!running.length}>
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="tertiary" size="small" onClick={onClose}>
              Close
            </Button>
          </>
        }
      >
        Resource use
      </CardHeader>
      <CardBody>
        {engines.map((e) => {
          const limits = limitsByEngine.get(e.kind) ?? 0;
          return (
            <div key={e.kind} className="lc-capacity">
              <p className="lc-capacity__line">
                <strong>{e.kind === 'podman' ? 'Podman' : 'Docker'} host:</strong> {e.cpus} CPUs · {formatBytes(e.memTotalBytes)} memory
                {e.memFreeBytes !== undefined && <>, {formatBytes(e.memFreeBytes)} free</>}
              </p>
              {limits > e.memTotalBytes && (
                <p className="lc-capacity__warn" role="status">
                  <Badge variant="warning" size="small">Over-committed</Badge> The memory limits of the running containers add up
                  to {formatBytes(limits)}, more than the host&apos;s {formatBytes(e.memTotalBytes)}. If they all use their
                  limit, the system stops one of them.
                </p>
              )}
            </div>
          );
        })}
        {problem && <p className="lc-field-error">{problem}</p>}
        {!running.length ? (
          <p className="scr-muted">No container is running.</p>
        ) : (
          <div className="sas-table__wrapper">
            <table className="sas-table sas-table--compact lc-res-table">
              <thead className="sas-table__head">
                <tr>
                  <th scope="col" className="sas-table__th">Container</th>
                  <th scope="col" className="sas-table__th">CPU</th>
                  <th scope="col" className="sas-table__th">Memory</th>
                  <th scope="col" className="sas-table__th">Processes</th>
                  <th scope="col" className="sas-table__th">Network in / out</th>
                  <th scope="col" className="sas-table__th">Disk read / write</th>
                </tr>
              </thead>
              <tbody>
                {running.map((c) => {
                  const samples = history[c.managedId] ?? [];
                  const s = samples[samples.length - 1];
                  const cpuPoints = samples.filter((x) => x.cpuCores !== null && !x.cpuSinceStart).map((x) => ({ at: x.at, v: x.cpuCores as number }));
                  const memPoints = samples.filter((x) => x.memBytes !== null).map((x) => ({ at: x.at, v: x.memBytes as number }));
                  const memLimit = s?.memLimitBytes ?? c.options.memoryMb * 1024 * 1024;
                  const memPct = s?.memPercent ?? (s?.memBytes != null && memLimit ? (s.memBytes / memLimit) * 100 : null);
                  const near = memPct !== null && memPct >= NEAR_LIMIT_PERCENT;
                  return (
                    <tr key={c.managedId} className="sas-table__row">
                      <td className="sas-table__td">
                        <div>{c.displayName}</div>
                        <div className="lc-path">{c.name}</div>
                      </td>
                      <td className="sas-table__td">
                        {!s ? (
                          <span className="scr-muted">Reading…</span>
                        ) : (
                          <>
                            <div className="lc-res__value">
                              {s.cpuCores === null ? '–' : `${formatCores(s.cpuCores)} of ${c.options.cpus} CPUs`}
                              {s.cpuSinceStart && <span className="scr-muted"> (average since start)</span>}
                            </div>
                            <Sparkline points={cpuPoints} max={c.options.cpus} label={`CPU of ${c.displayName}`} format={(v) => `${formatCores(v)} CPUs`} />
                          </>
                        )}
                      </td>
                      <td className="sas-table__td">
                        {!s ? (
                          <span className="scr-muted">Reading…</span>
                        ) : (
                          <>
                            <div className="lc-res__value">
                              {formatBytes(s.memBytes)} of {formatBytes(memLimit)}
                              {memPct !== null && ` (${Math.round(memPct)}%)`}{' '}
                              {near && <Badge variant="warning" size="small">Near its limit</Badge>}
                            </div>
                            <div className="lc-meter" aria-hidden="true">
                              <div
                                className={`lc-meter__fill${near ? ' lc-meter__fill--warn' : ''}`}
                                style={{ width: `${Math.min(100, Math.max(0, memPct ?? 0))}%` }}
                              />
                            </div>
                            <Sparkline points={memPoints} max={memLimit} label={`Memory of ${c.displayName}`} format={formatBytes} />
                          </>
                        )}
                      </td>
                      <td className="sas-table__td">{s?.pids ?? '–'}</td>
                      <td className="sas-table__td">
                        {s ? `${formatBytes(s.netRxBytes)} / ${formatBytes(s.netTxBytes)}` : '–'}
                      </td>
                      <td className="sas-table__td">
                        {s ? `${formatBytes(s.blockReadBytes)} / ${formatBytes(s.blockWriteBytes)}` : '–'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="scr-hint">
          {paused ? 'Paused. ' : `Read from the container engine every ${POLL_MS / 1000} seconds while this card is open${lastAt ? `, last at ${clock(lastAt)}` : ''}. `}
          CPU is shown as CPUs in use (1 = one full CPU) against the container&apos;s limit; the lines show the last five
          minutes, scaled to the limit. Network and disk are totals since the container started.
        </p>
      </CardBody>
    </Card>
  );
};

export default ResourceMonitor;
