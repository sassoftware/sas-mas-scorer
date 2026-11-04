// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useMemo, useRef, useState } from 'react';
import { Card, CardBody, CardHeader } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { ProgressBar } from '../common/ProgressBar';
import {
  displayValue,
  errorFromRequestLog,
  getRequestLog,
  isUninformativeError,
  scoreBatch,
  scoreRecord,
  type ScrEndpointInfo,
} from '../../api/scr';
import { csvRecords, prepareRows, toCsv, type ScrPreparedRows } from '../../utils/scrInputs';
import { downloadTextFile } from '../../utils/csv';

/** Rows per request on a batch-mode container. */
const BATCH_SIZE = 200;
/** Parallel requests on a single-record container. */
const CONCURRENCY = 4;
/** Result rows drawn on the page; the download has all of them. */
const PREVIEW_ROWS = 100;
/** Python images: failed rows whose request log is read for the real error. */
const LOG_LOOKUPS = 25;

interface RowResult {
  row: number;
  status: 'scored' | 'failed' | 'not sent';
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  error?: string;
  elapsedMs?: number;
  requestId?: string;
}

interface ScrBatchPanelProps {
  info: ScrEndpointInfo;
  onStepId: (stepId: string) => void;
  onDone: () => void;
}

export const ScrBatchPanel: React.FC<ScrBatchPanelProps> = ({ info, onStepId, onDone }) => {
  const [fileName, setFileName] = useState<string | null>(null);
  const [records, setRecords] = useState<Record<string, string>[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const cancelRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const prepared: ScrPreparedRows | null = useMemo(
    () => (records ? prepareRows(info, records) : null),
    [info, records]
  );
  const badRows = useMemo(
    () => new Set(prepared?.issues.filter((i) => i.severity === 'error').map((i) => i.row) ?? []),
    [prepared]
  );
  const blockedByMissing = info.inputsRequired && (prepared?.missingInputs.length ?? 0) > 0;
  const sendable = prepared ? prepared.rows.length - badRows.size : 0;

  const handleFile = async (file: File | undefined) => {
    setReadError(null);
    setResults(null);
    setRunError(null);
    if (!file) return;
    try {
      const parsed = csvRecords(await file.text());
      if (parsed.length === 0) throw new Error('The file has a header but no rows, or is empty.');
      setFileName(file.name);
      setRecords(parsed);
    } catch (err) {
      setFileName(null);
      setRecords(null);
      setReadError(err instanceof Error ? err.message : String(err));
    }
  };

  const run = async () => {
    if (!prepared) return;
    cancelRef.current = false;
    setRunning(true);
    setRunError(null);
    setProgress(0);
    const started = performance.now();
    const out: RowResult[] = prepared.rows.map((inputs, i) => ({
      row: i + 1,
      status: 'not sent',
      inputs,
      outputs: {},
      error: badRows.has(i + 1) ? 'Not sent: the row has errors' : undefined,
    }));
    const todo = out.filter((r) => !badRows.has(r.row));
    let done = 0;
    try {
      if (info.mode === 'batch') {
        for (let start = 0; start < todo.length && !cancelRef.current; start += BATCH_SIZE) {
          const chunk = todo.slice(start, start + BATCH_SIZE);
          const batch = await scoreBatch(info, chunk.map((r) => r.inputs));
          if (!batch.ok) {
            // SCR fails the whole batch for one bad value and does not say which row.
            for (const r of chunk) {
              r.status = 'failed';
              r.error = `Batch failed (HTTP ${batch.status}): ${batch.error ?? ''}`.trim();
            }
          } else {
            batch.rows.forEach((resultRow) => {
              const r = chunk[resultRow.rowId - 1];
              if (!r) return;
              r.status = 'scored';
              r.outputs = resultRow.outputs;
              r.elapsedMs = resultRow.metadata.elapsedNanos !== undefined ? resultRow.metadata.elapsedNanos / 1e6 : undefined;
              if (resultRow.metadata.stepId) onStepId(resultRow.metadata.stepId);
            });
            for (const r of chunk) if (r.status === 'not sent') { r.status = 'failed'; r.error = 'No result for this row'; }
          }
          done += chunk.length;
          setProgress(done / todo.length);
        }
      } else {
        let next = 0;
        let logLookups = 0;
        const worker = async () => {
          while (!cancelRef.current && next < todo.length) {
            const r = todo[next++];
            try {
              const res = await scoreRecord(info, r.inputs);
              r.requestId = res.metadata.requestId;
              r.elapsedMs = res.metadata.elapsedNanos !== undefined ? res.metadata.elapsedNanos / 1e6 : undefined;
              if (res.ok) {
                r.status = 'scored';
                r.outputs = res.outputs;
                if (res.metadata.stepId) onStepId(res.metadata.stepId);
              } else {
                r.status = 'failed';
                r.error = `HTTP ${res.status}: ${res.error ?? ''}`.trim();
                // An empty traceback line (^^^^) as the message: read the
                // error from the row's request log, for the first few rows.
                if (info.hasRequestLog && r.requestId && isUninformativeError(res.error) && logLookups < LOG_LOOKUPS) {
                  logLookups++;
                  const logError = await getRequestLog(info, r.requestId).then(errorFromRequestLog, () => null);
                  if (logError) r.error = `HTTP ${res.status}: ${logError}`;
                }
              }
            } catch (err) {
              r.status = 'failed';
              r.error = err instanceof Error ? err.message : String(err);
            }
            done++;
            setProgress(done / todo.length);
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
      }
      if (cancelRef.current) setRunError('Stopped. Rows not yet sent are marked “not sent”.');
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setResults([...out]);
      setDurationMs(performance.now() - started);
      setRunning(false);
      onDone();
    }
  };

  const outputNames = useMemo(() => {
    const names = info.outputs.map((v) => v.name);
    for (const r of results ?? []) for (const k of Object.keys(r.outputs)) if (!names.includes(k)) names.push(k);
    return names;
  }, [info.outputs, results]);

  const download = () => {
    if (!results) return;
    const inputNames = info.inputs.map((v) => v.name);
    const columns = ['_row', '_status', ...inputNames, ...outputNames, '_elapsed_ms', '_error'];
    if (info.hasRequestLog) columns.push('_request_id');
    const rows = results.map((r) => {
      const row: Record<string, unknown> = { _row: r.row, _status: r.status, _elapsed_ms: r.elapsedMs, _error: r.error, _request_id: r.requestId };
      for (const n of inputNames) row[n] = r.inputs[n];
      for (const n of outputNames) row[n] = displayValue(r.outputs[n]);
      return row;
    });
    const base = (fileName ?? 'scores').replace(/\.csv$/i, '');
    downloadTextFile(toCsv(columns, rows), `${base}_${info.name}_scored.csv`);
  };

  const scored = results?.filter((r) => r.status === 'scored').length ?? 0;
  const failed = results?.filter((r) => r.status === 'failed').length ?? 0;

  return (
    <Card>
      <CardHeader>Score a file</CardHeader>
      <CardBody>
        <p className="scr-hint">
          A CSV file with a header row; columns are matched to inputs by name (ignoring case).{' '}
          {info.mode === 'batch'
            ? `This container runs in batch mode: rows are sent ${BATCH_SIZE} per request.`
            : `Rows are sent one per request, ${CONCURRENCY} at a time.`}
        </p>
        <div className="scr-batch__pick">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            id={`scr-file-${info.name}`}
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={running}>
            Choose CSV file
          </Button>
          {fileName && records && (
            <span>
              {fileName}: {records.length} rows
            </span>
          )}
        </div>
        {readError && <Alert variant="error" title="The file could not be read">{readError}</Alert>}

        {prepared && (
          <div className="scr-batch__checks">
            {prepared.unknownColumns.length > 0 && (
              <Alert variant="warning" title="Columns the endpoint does not have">
                {prepared.unknownColumns.join(', ')}. They are not sent (SCR would ignore them without a warning).
              </Alert>
            )}
            {prepared.missingInputs.length > 0 && (
              <Alert variant={blockedByMissing ? 'error' : 'warning'} title="Inputs with no column">
                {prepared.missingInputs.join(', ')}.{' '}
                {blockedByMissing
                  ? 'This image requires every input, so it would reject each row. Add the columns to score.'
                  : 'They are scored as missing.'}
              </Alert>
            )}
            {prepared.issues.length > 0 && (
              <Alert variant={badRows.size > 0 ? 'error' : 'warning'} title={`${prepared.issues.length} value problem(s)`}>
                <ul className="scr-issues">
                  {prepared.issues.slice(0, 10).map((i, n) => (
                    <li key={n}>Row {i.row}: {i.message}</li>
                  ))}
                  {prepared.issues.length > 10 && <li>… and {prepared.issues.length - 10} more</li>}
                </ul>
                {badRows.size > 0 && (
                  <p>
                    {badRows.size} row(s) with errors are not sent
                    {info.mode === 'batch' ? ': in batch mode one bad value fails every row in its request.' : '.'}
                  </p>
                )}
              </Alert>
            )}
            <div className="scr-batch__run">
              <Button onClick={run} loading={running} disabled={running || sendable === 0 || blockedByMissing}>
                Score {sendable} row{sendable === 1 ? '' : 's'}
              </Button>
              {running && (
                <Button variant="tertiary" onClick={() => { cancelRef.current = true; }}>
                  Stop
                </Button>
              )}
              {running && <ProgressBar value={Math.round(progress * 100)} />}
            </div>
          </div>
        )}

        {runError && <Alert variant="warning">{runError}</Alert>}

        {results && (
          <div className="scr-result">
            <div className="scr-result__meta">
              <span>{scored} scored</span>
              {failed > 0 && <span className="scr-error-text">{failed} failed</span>}
              {results.length - scored - failed > 0 && <span>{results.length - scored - failed} not sent</span>}
              {durationMs !== null && <span>{(durationMs / 1000).toFixed(1)} s</span>}
              <Button size="small" variant="secondary" onClick={download}>
                Download results (CSV)
              </Button>
            </div>
            <div className="sas-table__wrapper scr-batch__table">
              <table className="sas-table sas-table--compact">
                <thead className="sas-table__head">
                  <tr>
                    <th scope="col" className="sas-table__th">Row</th>
                    <th scope="col" className="sas-table__th">Status</th>
                    {outputNames.map((n) => (
                      <th key={n} scope="col" className="sas-table__th">{n}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.slice(0, PREVIEW_ROWS).map((r) => (
                    <tr key={r.row} className="sas-table__row">
                      <td className="sas-table__td">{r.row}</td>
                      <td className="sas-table__td" title={r.error}>
                        {r.status === 'scored' ? 'Scored' : r.status === 'failed' ? <span className="scr-error-text">Failed</span> : 'Not sent'}
                      </td>
                      {r.status === 'scored' ? (
                        outputNames.map((n) => {
                          const v = displayValue(r.outputs[n]);
                          return (
                            <td key={n} className="sas-table__td scr-value">
                              {v === null || v === undefined ? <span className="scr-muted">—</span> : String(typeof v === 'object' ? JSON.stringify(v) : v)}
                            </td>
                          );
                        })
                      ) : (
                        <td className="sas-table__td scr-muted" colSpan={Math.max(outputNames.length, 1)}>
                          {r.error}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {results.length > PREVIEW_ROWS && (
              <p className="scr-muted">Showing the first {PREVIEW_ROWS} of {results.length} rows; the download has all of them.</p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
};
