// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { UIDefinition, UIField } from '../../types/uiBuilder';
import { Step } from '../../types';
import { buildStepInput, executeStep } from '../../api/steps';
import { scoreForApp, ScrEndpointInfo } from '../../api/scr';
import { buildRunValues } from '../../utils/uiDefaults';
import { csvRecords, toCsv } from '../../utils/scrInputs';
import { sasDateFromIso, sasDatetimeFromIso } from '../../utils/sasDate';
import { saveTextFile, safeFilename } from '../../utils/download';
import { backoffDelay, isTransientFailure, MAX_TRANSIENT_RETRIES, sleep } from '../scoring/batchRunner';
import { validateInputs } from './fieldValidation';
import { ProgressBar } from '../common/ProgressBar';

interface Props {
  definition: UIDefinition;
  step: Step | null;
  /** Set for an app on a SAS Container Runtime endpoint. */
  scrInfo: ScrEndpointInfo | null;
}

interface RowResult {
  row: number;
  status: 'ok' | 'error' | 'skipped';
  outputs: Record<string, unknown>;
  message?: string;
}

/** Rows scored at the same time. */
const CONCURRENCY = 4;
/** Rows drawn in the results table; the download has them all. */
const SHOWN = 200;

const inputFields = (def: UIDefinition): UIField[] =>
  def.layout.sections.flatMap(s => s.fields).filter(f => f.direction === 'input');

/** A cell as the form would hold it: dates written as 2026-11-24 become SAS values. */
function cellValue(field: UIField, cell: string): unknown {
  const t = cell.trim();
  if (t === '') return null;
  if (field.widget === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(t)) return sasDateFromIso(t);
  if (field.widget === 'datetime' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(t)) return sasDatetimeFromIso(t.replace(' ', 'T'));
  return cell;
}

/**
 * Score every row of a CSV file with the app's module or endpoint. Columns
 * are matched to the app's inputs by name or label (case does not matter);
 * an input without a column gets its default, as in the form. Each row gets
 * the same checks as a single run and is not sent when they fail. Rows go out
 * four at a time, brief server errors are retried, and Cancel stops the rest.
 */
export const BatchFromFile: React.FC<Props> = ({ definition, step, scrInfo }) => {
  const [fileName, setFileName] = useState<string | null>(null);
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [results, setResults] = useState<RowResult[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [readError, setReadError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fields = useMemo(() => inputFields(definition), [definition]);

  const columns = records.length ? Object.keys(records[0]) : [];
  const columnFor = (f: UIField) =>
    columns.find(c => c.toLowerCase() === f.parameterId.toLowerCase())
    ?? columns.find(c => c.toLowerCase() === f.label.toLowerCase());
  const matched = fields.filter(f => columnFor(f));
  const unmatched = fields.filter(f => !columnFor(f));
  const outputNames = (step?.outputs ?? []).map(o => o.name);

  const load = async (file: File) => {
    setReadError(null);
    setResults([]);
    setDone(0);
    try {
      const rows = csvRecords(await file.text());
      setRecords(rows);
      setFileName(file.name);
      if (rows.length === 0) setReadError(`${file.name} has no data rows.`);
    } catch (e) {
      setRecords([]);
      setReadError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const scoreOne = async (index: number, signal: AbortSignal): Promise<RowResult> => {
    const rec = records[index];
    const formValues: Record<string, unknown> = {};
    for (const f of fields) {
      const col = columnFor(f);
      if (col !== undefined) formValues[f.parameterId] = cellValue(f, rec[col] ?? '');
    }
    const problems = validateInputs(definition, step, formValues);
    const keys = Object.keys(problems);
    if (keys.length > 0) {
      return { row: index + 1, status: 'skipped', outputs: {}, message: `Not sent: ${keys.map(k => `${k}: ${problems[k]}`).join(' ')}` };
    }
    const values = buildRunValues(definition, step!, formValues);
    for (let attempt = 0; ; attempt++) {
      try {
        if (scrInfo) {
          const data: Record<string, unknown> = {};
          for (const p of step!.inputs) data[p.name] = values[p.name] ?? null;
          const r = await scoreForApp(scrInfo, data);
          return { row: index + 1, status: 'ok', outputs: r.outputs };
        }
        const out = await executeStep(definition.moduleId, definition.stepId, buildStepInput(step!, values), { signal });
        const outputs: Record<string, unknown> = {};
        for (const v of out.outputs ?? []) outputs[v.name] = v.value;
        return { row: index + 1, status: 'ok', outputs };
      } catch (err) {
        if (axios.isCancel(err) || signal.aborted) throw err;
        if (attempt < MAX_TRANSIENT_RETRIES && isTransientFailure(err)) {
          await sleep(backoffDelay(attempt), signal);
          continue;
        }
        return { row: index + 1, status: 'error', outputs: {}, message: err instanceof Error ? err.message : String(err) };
      }
    }
  };

  const run = async () => {
    if (!step || records.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResults([]);
    setDone(0);
    const out: RowResult[] = new Array(records.length);
    let next = 0;
    const worker = async () => {
      while (!controller.signal.aborted) {
        const i = next++;
        if (i >= records.length) return;
        try {
          out[i] = await scoreOne(i, controller.signal);
        } catch {
          return; // cancelled
        }
        setDone(d => d + 1);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, records.length) }, worker));
    setResults(out.filter(Boolean));
    setRunning(false);
    abortRef.current = null;
  };

  const download = () => {
    const inputCols = matched.map(f => columnFor(f)!);
    const cols = ['row', 'status', ...inputCols, ...outputNames, 'message'];
    const rows = results.map(r => ({
      row: r.row,
      status: r.status === 'ok' ? 'Scored' : r.status === 'error' ? 'Failed' : 'Not sent',
      ...Object.fromEntries(inputCols.map(c => [c, records[r.row - 1]?.[c]])),
      ...r.outputs,
      message: r.message ?? '',
    }));
    saveTextFile(toCsv(cols, rows), safeFilename(`${(fileName ?? 'batch').replace(/\.csv$/i, '')}-scored.csv`), 'text/csv;charset=utf-8');
  };

  const ok = results.filter(r => r.status === 'ok').length;
  const failed = results.filter(r => r.status === 'error').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const shownOutputs = outputNames.slice(0, 6);

  return (
    <section className="ui-runner__batch" aria-labelledby="ui-batch-title">
      <h3 id="ui-batch-title">Score a file</h3>
      <p className="ui-runner__batch-hint">
        A CSV file with a header line. Columns are matched to the inputs by name or label; inputs without a column use their default.
        Values are sent as they are in the file, except dates written as 2026-11-24 for date inputs.
      </p>
      <div className="ui-runner__batch-row">
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file to score"
          disabled={running}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); }}
        />
        {records.length > 0 && !running && (
          <button type="button" className="sas-button sas-button--primary sas-button--small" onClick={() => void run()} disabled={!step}>
            Score {records.length.toLocaleString()} row{records.length === 1 ? '' : 's'}
          </button>
        )}
        {running && (
          <button type="button" className="sas-button sas-button--secondary sas-button--small" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        )}
      </div>
      {readError && <p className="ui-runner__batch-error" role="alert">{readError}</p>}
      {records.length > 0 && (
        <p className="ui-runner__batch-hint">
          {fileName}: {records.length.toLocaleString()} rows. Matched {matched.length} of {fields.length} inputs
          {unmatched.length > 0 ? `; without a column (default used): ${unmatched.map(f => f.label).join(', ')}` : ''}.
        </p>
      )}
      {running && (
        <ProgressBar value={done} max={records.length} label={`Scored ${done.toLocaleString()} of ${records.length.toLocaleString()} rows`} />
      )}
      {!running && results.length > 0 && (
        <>
          <p className="ui-runner__batch-summary" role="status">
            {ok.toLocaleString()} scored, {failed.toLocaleString()} failed, {skipped.toLocaleString()} not sent
            {results.length < records.length ? ` (cancelled after ${results.length.toLocaleString()} of ${records.length.toLocaleString()} rows)` : ''}.
          </p>
          <button type="button" className="sas-button sas-button--secondary sas-button--small" onClick={download}>
            Download all results (CSV)
          </button>
          <div className="ui-runner__table-wrap" tabIndex={0} role="region" aria-label="Scored rows">
            <table className="ui-runner__table">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Status</th>
                  {shownOutputs.map(n => <th key={n} scope="col">{n}</th>)}
                  <th scope="col">Message</th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, SHOWN).map(r => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.status === 'ok' ? 'Scored' : r.status === 'error' ? 'Failed' : 'Not sent'}</td>
                    {shownOutputs.map(n => <td key={n}>{r.outputs[n] === null || r.outputs[n] === undefined ? '' : typeof r.outputs[n] === 'object' ? JSON.stringify(r.outputs[n]) : String(r.outputs[n])}</td>)}
                    <td>{r.message ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {results.length > SHOWN && <p className="ui-runner__table-more">Showing {SHOWN} of {results.length.toLocaleString()} rows; the download has them all.</p>}
            {outputNames.length > shownOutputs.length && <p className="ui-runner__table-more">The table shows the first {shownOutputs.length} results; the download has all {outputNames.length}.</p>}
          </div>
        </>
      )}
    </section>
  );
};
