// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useId, useMemo, useState } from 'react';
import { StepParameter } from '../../types';
import { Badge, StatusBadge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card, CardHeader, CardBody } from '../common/Card';
import { formatCheckValue, valuesEqual } from '../../utils/expectedValues';
import { HISTORY_LIMIT, RunRecord } from './scoringSession';

interface RunHistoryProps {
  runs: RunRecord[];
  inputParameters: StepParameter[];
  outputParameters: StepParameter[];
  onRestore: (run: RunRecord) => void;
  onClear: () => void;
  disabled?: boolean;
}

const timeOf = (at: number): string =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const shortValue = (value: unknown): string => {
  const text = formatCheckValue(value);
  if (text === '') return 'null';
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
};

interface DiffRow {
  name: string;
  a: unknown;
  b: unknown;
  changed: boolean;
}

const diffValues = (
  names: string[],
  a: Record<string, unknown>,
  b: Record<string, unknown>
): DiffRow[] => names.map(name => ({ name, a: a[name], b: b[name], changed: !valuesEqual(a[name], b[name]) }));

const outputsOf = (run: RunRecord): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  for (const o of run.outputs ?? []) values[o.name] = o.value;
  return values;
};

/**
 * The last runs of this step in this browser session: restore a run's inputs
 * into the form, or pick two runs and see which inputs and outputs changed.
 * The history stays in this browser tab and is never sent anywhere.
 */
export const RunHistory: React.FC<RunHistoryProps> = ({
  runs,
  inputParameters,
  outputParameters,
  onRestore,
  onClear,
  disabled = false,
}) => {
  const uid = useId();
  const [open, setOpen] = useState(false);
  // Ids of the (at most two) runs picked for the diff, in the order picked
  const [picked, setPicked] = useState<string[]>([]);
  const [changedOnly, setChangedOnly] = useState(false);

  // Picks of runs that dropped out of the history are forgotten
  const pickedRuns = useMemo(
    () => picked.map(id => runs.find(r => r.id === id)).filter((r): r is RunRecord => !!r),
    [picked, runs]
  );

  const togglePick = (id: string) => {
    setPicked(prev => {
      if (prev.includes(id)) return prev.filter(p => p !== id);
      // A third pick replaces the oldest pick
      return [...prev, id].slice(-2);
    });
  };

  const diff = useMemo(() => {
    if (pickedRuns.length !== 2) return null;
    // Older run on the left
    const [first, second] = [...pickedRuns].sort((x, y) => x.at - y.at);
    const inputNames = Array.from(new Set([
      ...inputParameters.map(p => p.name),
      ...Object.keys(first.inputs),
      ...Object.keys(second.inputs),
    ]));
    const outA = outputsOf(first);
    const outB = outputsOf(second);
    const outputNames = Array.from(new Set([
      ...outputParameters.map(p => p.name).filter(n => n in outA || n in outB),
      ...Object.keys(outA),
      ...Object.keys(outB),
    ]));
    const inputs = diffValues(inputNames, first.inputs, second.inputs);
    const outputs = diffValues(outputNames, outA, outB);
    return {
      first,
      second,
      inputs,
      outputs,
      inputsChanged: inputs.filter(r => r.changed).length,
      outputsChanged: outputs.filter(r => r.changed).length,
    };
  }, [pickedRuns, inputParameters, outputParameters]);

  const bodyId = `${uid}-body`;

  const renderDiffSection = (title: string, rows: DiffRow[], changed: number) => {
    const shown = changedOnly ? rows.filter(r => r.changed) : rows;
    return (
      <>
        <tr className="run-history__diff-section">
          <th className="sas-table__td" scope="rowgroup" colSpan={4}>
            {title} — {changed} of {rows.length} changed
          </th>
        </tr>
        {shown.map(row => (
          <tr
            key={`${title}-${row.name}`}
            className={`sas-table__row${row.changed ? ' run-history__diff-row--changed' : ''}`}
          >
            <th className="sas-table__td run-history__diff-name" scope="row">{row.name}</th>
            <td className="sas-table__td run-history__diff-value">{shortValue(row.a)}</td>
            <td className="sas-table__td run-history__diff-value">{shortValue(row.b)}</td>
            <td className="sas-table__td">
              {row.changed ? (
                <span className="run-history__changed">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                  Changed
                </span>
              ) : (
                <span className="run-history__same">Same</span>
              )}
            </td>
          </tr>
        ))}
      </>
    );
  };

  return (
    <Card className="run-history">
      <CardHeader
        actions={runs.length > 0 && open ? (
          <Button variant="tertiary" size="small" onClick={() => { onClear(); setPicked([]); }} disabled={disabled}>
            Clear history
          </Button>
        ) : undefined}
      >
        <h3 className="run-history__title">
          <button
            type="button"
            className="run-history__toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(v => !v)}
          >
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={`expected-mapping__chevron${open ? ' expected-mapping__chevron--open' : ''}`}
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
            Run history ({runs.length})
          </button>
        </h3>
      </CardHeader>
      <div id={bodyId} hidden={!open}>
        <CardBody>
          <p className="run-history__intro">
            The last {HISTORY_LIMIT} runs of this step in this browser tab. They stay in this tab only, are
            never sent anywhere, and are cleared when you log out or close the tab. Pick two runs to see
            which inputs and outputs changed.
          </p>
          {runs.length === 0 ? (
            <p className="run-history__empty">No runs yet. Each Execute Score adds one.</p>
          ) : (
            <ul className="run-history__list">
              {runs.map(run => {
                const isPicked = picked.includes(run.id);
                const checkboxId = `${uid}-pick-${run.id}`;
                return (
                  <li key={run.id} className={`run-history__item${isPicked ? ' run-history__item--picked' : ''}`}>
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={isPicked}
                      onChange={() => togglePick(run.id)}
                      disabled={disabled}
                    />
                    <label htmlFor={checkboxId} className="run-history__item-label">
                      <span className="run-history__time">{timeOf(run.at)}</span>
                      {run.error
                        ? <StatusBadge status="failed" />
                        : <StatusBadge status={run.executionState ?? 'completed'} />}
                      <Badge variant="default" size="small">{run.latencyMs.toFixed(0)} ms</Badge>
                      <span className="run-history__summary">
                        {run.error
                          ? run.error
                          : (run.outputs ?? []).slice(0, 3).map(o => `${o.name} = ${shortValue(o.value)}`).join(', ')}
                      </span>
                    </label>
                    <Button
                      variant="tertiary"
                      size="small"
                      onClick={() => onRestore(run)}
                      disabled={disabled}
                      aria-label={`Restore the inputs of the run at ${timeOf(run.at)}`}
                    >
                      Restore inputs
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          {pickedRuns.length === 1 && (
            <p className="run-history__hint" role="status">Pick one more run to compare.</p>
          )}

          {diff && (
            <section className="run-history__diff" aria-labelledby={`${uid}-diff-title`}>
              <div className="run-history__diff-header">
                <h4 id={`${uid}-diff-title`}>
                  Run at {timeOf(diff.first.at)} compared with run at {timeOf(diff.second.at)}
                </h4>
                <label className="run-history__changed-only">
                  <input
                    type="checkbox"
                    checked={changedOnly}
                    onChange={e => setChangedOnly(e.target.checked)}
                  />
                  Only changed values
                </label>
              </div>
              <p className="run-history__diff-summary" role="status" aria-live="polite">
                {diff.inputsChanged} input{diff.inputsChanged === 1 ? '' : 's'} and {diff.outputsChanged} output
                {diff.outputsChanged === 1 ? '' : 's'} changed. Values are compared as in the expected-value
                checks: numbers within 1&nbsp;×&nbsp;10<sup>−9</sup>, text trimmed, all missing values alike.
              </p>
              <div className="sas-table__wrapper">
                <table className="sas-table sas-table--compact run-history__diff-table">
                  <thead className="sas-table__head">
                    <tr>
                      <th className="sas-table__th" scope="col">Name</th>
                      <th className="sas-table__th" scope="col">{timeOf(diff.first.at)}</th>
                      <th className="sas-table__th" scope="col">{timeOf(diff.second.at)}</th>
                      <th className="sas-table__th" scope="col">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renderDiffSection('Inputs', diff.inputs, diff.inputsChanged)}
                    {renderDiffSection('Outputs', diff.outputs, diff.outputsChanged)}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </CardBody>
      </div>
    </Card>
  );
};

export default RunHistory;
