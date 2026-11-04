// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../layout/Layout';
import { Card, CardBody, CardHeader } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge } from '../common/Badge';
import { Loading } from '../common/Loading';
import { EmptyState } from '../common/EmptyState';
import { InputForm } from '../scoring/InputForm';
import type { StepParameter } from '../../types';
import {
  describeStep,
  errorFromRequestLog,
  isUninformativeError,
  displayValue,
  getHealth,
  getMetrics,
  getRequestLog,
  inspectEndpoint,
  RUNTIME_LABELS,
  scoreBatch,
  scoreRecord,
  type ScrEndpointInfo,
  type ScrHealth,
  type ScrMetrics,
  type ScrScoreResult,
} from '../../api/scr';
import { prepareRows } from '../../utils/scrInputs';
import { getScrEndpoint, updateScrEndpoint, type SavedScrEndpoint } from '../../storage/scrEndpoints';
import { ScrSourcePanel } from './ScrSourcePanel';
import { ScrBatchPanel } from './ScrBatchPanel';

interface ScrEndpointPageProps {
  endpointId: string;
}

const toParameters = (info: ScrEndpointInfo): StepParameter[] =>
  info.inputs.map((v) => ({ name: v.name, type: v.type === 'string' ? 'string' : 'decimal', size: v.length }));

const formatNanos = (nanos: number | undefined): string | null =>
  nanos === undefined ? null : nanos >= 1e6 ? `${(nanos / 1e6).toFixed(1)} ms` : `${(nanos / 1e3).toFixed(0)} µs`;

const formatBytes = (bytes: number | null): string =>
  bytes === null ? '—' : bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;

const plural = (count: number | null, noun: string): string =>
  count === null ? `— ${noun}s` : `${count} ${noun}${count === 1 ? '' : 's'}`;

const healthBadge =(value: boolean | null, yes: string, no: string) =>
  value === null ? (
    <Badge size="small">Not reachable</Badge>
  ) : value ? (
    <Badge variant="success" size="small">{yes}</Badge>
  ) : (
    <Badge variant="error" size="small">{no}</Badge>
  );

export const ScrEndpointPage: React.FC<ScrEndpointPageProps> = ({ endpointId }) => {
  const navigate = useNavigate();
  const [saved] = useState<SavedScrEndpoint | null>(() => getScrEndpoint(endpointId));
  const [info, setInfo] = useState<ScrEndpointInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [health, setHealth] = useState<ScrHealth | null>(null);
  const [metrics, setMetrics] = useState<ScrMetrics | null | undefined>(undefined);
  const [lastStepId, setLastStepId] = useState<string | undefined>(undefined);

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [scoring, setScoring] = useState(false);
  const [result, setResult] = useState<ScrScoreResult | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [viewRaw, setViewRaw] = useState(false);
  const [log, setLog] = useState<{ text?: string; error?: string; loading: boolean } | null>(null);

  const refreshStatus = useCallback(async (endpoint: ScrEndpointInfo) => {
    const [h, m] = await Promise.all([getHealth(endpoint), getMetrics(endpoint)]);
    setHealth(h);
    setMetrics(m);
  }, []);

  const load = useCallback(async () => {
    if (!saved) return;
    setLoadError(null);
    setInfo(null);
    try {
      const next = await inspectEndpoint(saved.url);
      setInfo(next);
      updateScrEndpoint(saved.id, {
        lastSeen: {
          runtime: next.runtime,
          mode: next.mode,
          title: next.title,
          at: new Date().toISOString(),
        },
      });
      refreshStatus(next).catch(() => undefined);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [saved, refreshStatus]);

  useEffect(() => {
    load();
  }, [load]);

  const parameters = useMemo(() => (info ? toParameters(info) : []), [info]);

  /** Shows the request's log and returns its text (null when it could not be read). */
  const fetchLog = useCallback(async (endpoint: ScrEndpointInfo, requestId: string): Promise<string | null> => {
    setLog({ loading: true });
    try {
      const text = await getRequestLog(endpoint, requestId);
      setLog({ loading: false, text });
      return text;
    } catch (err) {
      setLog({ loading: false, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }, []);

  const handleScore = async () => {
    if (!info) return;
    setScoreError(null);
    setResult(null);
    setLog(null);
    // Only the fields the user filled in are sent; empty ones go as null.
    const record: Record<string, unknown> = {};
    for (const v of info.inputs) record[v.name] = values[v.name] ?? null;
    const prepared = prepareRows(info, [record], 0);
    const errors = prepared.issues.filter((i) => i.severity === 'error');
    setWarnings(prepared.issues.filter((i) => i.severity === 'warning').map((i) => i.message));
    if (errors.length > 0) {
      setScoreError(errors.map((e) => e.message).join('; '));
      return;
    }
    setScoring(true);
    try {
      let next: ScrScoreResult;
      if (info.mode === 'batch') {
        // A batch-mode container only takes batches: send a batch of one.
        const batch = await scoreBatch(info, prepared.rows);
        const row = batch.rows[0];
        next = {
          ok: batch.ok && !!row,
          status: batch.status,
          outputs: row?.outputs ?? {},
          metadata: row?.metadata ?? {},
          raw: batch.raw,
          durationMs: batch.durationMs,
          error: batch.error ?? (batch.ok && !row ? 'The batch response had no row.' : undefined),
        };
      } else {
        next = await scoreRecord(info, prepared.rows[0]);
      }
      setResult(next);
      if (next.metadata.stepId) setLastStepId(next.metadata.stepId);
      const logPromise =
        info.hasRequestLog && next.metadata.requestId ? fetchLog(info, next.metadata.requestId) : null;
      if (!next.ok) {
        let message = `HTTP ${next.status}: ${next.error ?? 'The score failed.'}`;
        if (logPromise) {
          // The image's own message can be an empty traceback line (^^^^):
          // the request log names the actual error.
          const logError = isUninformativeError(next.error) ? errorFromRequestLog((await logPromise) ?? '') : null;
          message = logError
            ? `${logError} (the model's Python code raised an error; the full request log is below)`
            : `${message} The request log below has the details.`;
        }
        setScoreError(message);
      }
      refreshStatus(info).catch(() => undefined);
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : String(err));
    } finally {
      setScoring(false);
    }
  };

  const title = saved ? saved.label || info?.name || saved.url : 'SCR endpoint';
  const breadcrumbs = [
    { label: 'SCR Endpoints', onClick: () => navigate('/scr') },
    { label: title },
  ];

  if (!saved) {
    return (
      <EmptyState
        title="Endpoint not found"
        hint="It may have been removed, or it was added in another browser."
        action={<Button variant="secondary" onClick={() => navigate('/scr')}>Back to SCR Endpoints</Button>}
      />
    );
  }

  return (
    <div className="scr-page">
      <PageHeader
        title={title}
        subtitle={saved.url}
        breadcrumbs={breadcrumbs}
        actions={
          <div className="scr-page__actions">
            <Badge variant="warning">SCR</Badge>
            <Button variant="primary" onClick={() => navigate(`/ui-apps/new-scr/${encodeURIComponent(saved.id)}`)} disabled={!info}>
              Build UI
            </Button>
            <Button variant="secondary" onClick={load}>
              Refresh
            </Button>
          </div>
        }
      />

      {loadError && (
        <Alert variant="error" title="The endpoint did not answer" actions={<Button size="small" variant="secondary" onClick={load}>Retry</Button>}>
          {loadError}
        </Alert>
      )}
      {!info && !loadError && <Loading message="Reading the endpoint's signature..." />}

      {info && (
        <>
          <Card>
            <CardHeader>What this endpoint is</CardHeader>
            <CardBody>
              <dl className="scr-facts">
                <div>
                  <dt>Runtime</dt>
                  <dd>
                    {RUNTIME_LABELS[info.runtime]}
                    <span className="scr-facts__source">signature title “{info.title || 'none'}”</span>
                  </dd>
                </div>
                <div>
                  <dt>Mode</dt>
                  <dd>
                    {info.mode === 'batch' ? (
                      <Badge variant="info" size="small">Batch</Badge>
                    ) : (
                      <Badge size="small">Single record</Badge>
                    )}
                    <span className="scr-facts__source">
                      {info.mode === 'batch'
                        ? 'the container runs with SAS_SCR_REST_API_TYPE=BATCH: it only takes batches of rows'
                        : 'one record per request'}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Content</dt>
                  <dd>
                    {describeStep(lastStepId) ?? <span className="scr-muted">Known after the first score, from the step id in the response</span>}
                  </dd>
                </div>
                <div>
                  <dt>Signature</dt>
                  <dd>
                    {info.inputs.length} inputs, {info.outputs.length} outputs
                    {info.inputsRequired && <span className="scr-facts__source">every input is required by this image</span>}
                  </dd>
                </div>
                <div>
                  <dt>Health</dt>
                  <dd className="scr-facts__badges">
                    {health ? (
                      <>
                        {healthBadge(health.live, 'Live', 'Not live')}
                        {healthBadge(health.ready, 'Ready', 'Not ready')}
                      </>
                    ) : (
                      <span className="scr-muted">Checking…</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Metrics</dt>
                  <dd>
                    {metrics === undefined ? (
                      <span className="scr-muted">Checking…</span>
                    ) : metrics === null ? (
                      <span className="scr-muted">This image serves no /prometheus metrics</span>
                    ) : (
                      <>
                        {plural(metrics.hits, 'request')}, {plural(metrics.executions, 'execution')}
                        {metrics.executions ? `, ${((metrics.executionMsTotal ?? 0) / metrics.executions).toFixed(1)} ms average` : ''}
                        , {formatBytes(metrics.memoryUsedBytes)} memory used
                        <span className="scr-facts__source">since the container started</span>
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Request log</dt>
                  <dd>
                    {info.hasRequestLog ? (
                      'Each request’s log can be read over HTTP (shown after a score)'
                    ) : (
                      <span className="scr-muted">
                        Not served over HTTP; SCR writes its log to the container’s standard output
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Transport</dt>
                  <dd>{info.tls ? 'HTTPS' : <>HTTP <span className="scr-facts__source">not encrypted</span></>}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <ScrSourcePanel info={info} />

          <Card>
            <CardHeader
              actions={
                <Button onClick={handleScore} loading={scoring} disabled={info.inputs.length === 0 && info.runtime !== 'scr'}>
                  Score
                </Button>
              }
            >
              Score one record
            </CardHeader>
            <CardBody>
              {info.inputs.length === 0 ? (
                <p className="scr-muted">The signature lists no inputs; Score sends an empty record.</p>
              ) : (
                <InputForm parameters={parameters} values={values} onChange={setValues} disabled={scoring} />
              )}
              {warnings.length > 0 && (
                <Alert variant="warning" title="Sent, but check these">
                  {warnings.join('; ')}
                </Alert>
              )}
              {scoreError && (
                <Alert variant="error" title="The score failed">
                  {scoreError}
                </Alert>
              )}
              {result?.ok && (
                <div className="scr-result">
                  <div className="scr-result__meta">
                    <span>Step <code>{result.metadata.stepId ?? '—'}</code></span>
                    {result.metadata.moduleId && <span>Module <code>{result.metadata.moduleId}</code></span>}
                    {formatNanos(result.metadata.elapsedNanos) && (
                      <span>Runtime {formatNanos(result.metadata.elapsedNanos)}</span>
                    )}
                    <span>Round trip {result.durationMs.toFixed(0)} ms</span>
                    <Button size="small" variant="tertiary" onClick={() => setViewRaw((v) => !v)}>
                      {viewRaw ? 'Show table' : 'Show response JSON'}
                    </Button>
                  </div>
                  {viewRaw ? (
                    <pre className="scr-pre">{JSON.stringify(result.raw, null, 2)}</pre>
                  ) : (
                    <OutputsTable info={info} outputs={result.outputs} />
                  )}
                </div>
              )}
              {log && (
                <div className="scr-log">
                  <h3 className="scr-log__title">Request log</h3>
                  {log.loading && <Loading message="Reading the request log..." />}
                  {log.error && <p className="scr-muted">{log.error}</p>}
                  {log.text !== undefined && <pre className="scr-pre">{log.text || '(empty)'}</pre>}
                </div>
              )}
            </CardBody>
          </Card>

          <ScrBatchPanel info={info} onStepId={setLastStepId} onDone={() => refreshStatus(info).catch(() => undefined)} />
        </>
      )}
    </div>
  );
};

/** Outputs in signature order, then any the signature does not list. Strings shown trimmed. */
const OutputsTable: React.FC<{ info: ScrEndpointInfo; outputs: Record<string, unknown> }> = ({ info, outputs }) => {
  const names = [
    ...info.outputs.map((v) => v.name),
    ...Object.keys(outputs).filter((k) => !info.outputs.some((v) => v.name === k)),
  ];
  const typeOf = (name: string) => info.outputs.find((v) => v.name === name)?.type;
  return (
    <div className="sas-table__wrapper">
      <table className="sas-table sas-table--compact">
        <thead className="sas-table__head">
          <tr>
            <th scope="col" className="sas-table__th">Output</th>
            <th scope="col" className="sas-table__th">Type</th>
            <th scope="col" className="sas-table__th">Value</th>
          </tr>
        </thead>
        <tbody>
          {names.map((name) => {
            const present = Object.prototype.hasOwnProperty.call(outputs, name);
            const value = displayValue(outputs[name]);
            return (
              <tr key={name} className="sas-table__row">
                <td className="sas-table__td"><code>{name}</code></td>
                <td className="sas-table__td">{typeOf(name) ?? 'not in signature'}</td>
                <td className="sas-table__td scr-value">
                  {!present ? (
                    <span className="scr-muted">not returned</span>
                  ) : value === null ? (
                    <span className="scr-muted">null</span>
                  ) : (
                    String(typeof value === 'object' ? JSON.stringify(value) : value)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default ScrEndpointPage;
