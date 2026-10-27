// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react';
import { Alert, Button, Modal } from '../common';
import { leafExpectedOutputs, pathNumber, type TreeIndex } from '../../utils/segTree/treeIndex';
import { sampleRecord } from '../../utils/segTree/formats';
import {
  describeStop,
  describeValue,
  parseRecordJson,
  testedVariables,
  traceRecord,
  type TraceResult,
} from '../../utils/segTree/traceRecord';

interface SegTreeTraceDialogProps {
  index: TreeIndex;
  /** The selected branch, offered as a starting record when it is a reachable path. */
  focusId: string | null;
  onClose: () => void;
  /** Select a branch on the tree (the predicted path, or where the walk stopped). */
  onShow: (branchId: string | null) => void;
}

type InputMode = 'json' | 'form';

interface Draft {
  mode: InputMode;
  json: string;
  form: Record<string, string>;
  absentAsMissing: boolean;
}

// The last record per tree, so reopening the dialog picks up where it was left.
const drafts = new Map<string, Draft>();

/** Form text → a JSON value of the variable's type; text that is not a number stays text, and the walk reports it. */
function formValue(text: string, type: string | undefined): unknown {
  if (text.trim() === '') return null;
  if (type === 'string') return text;
  const n = Number(text.trim());
  return Number.isFinite(n) ? n : text;
}

/**
 * "Find path for a record": paste the JSON that Copy → Sample input makes (or
 * fill in a form), and the dialog predicts the path from the tree's own branch
 * conditions, step by step, stopping where it cannot be sure.
 */
export default function SegTreeTraceDialog({ index, focusId, onClose, onShow }: SegTreeTraceDialogProps) {
  const variables = useMemo(() => testedVariables(index), [index]);
  const saved = drafts.get(index.tree.id);
  const [mode, setMode] = useState<InputMode>(saved?.mode ?? 'json');
  const [json, setJson] = useState(saved?.json ?? '');
  const [form, setForm] = useState<Record<string, string>>(saved?.form ?? {});
  const [absentAsMissing, setAbsentAsMissing] = useState(saved?.absentAsMissing ?? false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<TraceResult | null>(null);

  const remember = (patch: Partial<Draft>) =>
    drafts.set(index.tree.id, { mode, json, form, absentAsMissing, ...patch });

  const focus = focusId ? index.branches.get(focusId) : undefined;
  const canUseSample = !!focus && !focus.childSplitId && index.leafStatus.get(focus.id) !== 'shadowed';

  const formRecord = (): Record<string, unknown> => {
    const record: Record<string, unknown> = {};
    for (const v of variables) record[v] = formValue(form[v] ?? '', index.varTypes.get(v));
    return record;
  };

  const switchMode = (next: InputMode) => {
    if (next === mode) return;
    if (next === 'form') {
      // Carry what parses over; the form shows every tested variable.
      const parsed = parseRecordJson(json);
      if (typeof parsed !== 'string') {
        const lower = new Map(Object.entries(parsed).map(([k, v]) => [k.toLowerCase(), v]));
        const filled: Record<string, string> = {};
        for (const v of variables) {
          const value = lower.get(v.toLowerCase());
          filled[v] = value === null || value === undefined ? '' : String(value);
        }
        setForm(filled);
        remember({ mode: next, form: filled });
      } else {
        remember({ mode: next });
      }
    } else {
      const text = JSON.stringify(formRecord(), null, 2);
      setJson(text);
      remember({ mode: next, json: text });
    }
    setMode(next);
    setParseError(null);
  };

  const useSample = () => {
    if (!focus) return;
    const record = sampleRecord(index, focus.id);
    const text = JSON.stringify(record, null, 2);
    setJson(text);
    const filled: Record<string, string> = {};
    for (const v of variables) filled[v] = record[v] === null || record[v] === undefined ? '' : String(record[v]);
    setForm(filled);
    remember({ json: text, form: filled });
    setResult(null);
  };

  const run = () => {
    let record: Record<string, unknown>;
    if (mode === 'json') {
      const parsed = parseRecordJson(json);
      if (typeof parsed === 'string') {
        setParseError(parsed);
        setResult(null);
        return;
      }
      record = parsed;
    } else {
      record = formRecord();
    }
    setParseError(null);
    setResult(traceRecord(index, record, { absentAsMissing }));
  };

  const target = result ? (result.status === 'leaf' ? result.leafId : result.lastBranchId) : null;
  const outputs = result?.status === 'leaf' && result.leafId ? leafExpectedOutputs(index, result.leafId) : [];
  const leaf = result?.leafId ? index.branches.get(result.leafId) : undefined;

  // No matching branch is a prediction too (the record leaves the tree); everything else is a refusal.
  const stopTitle = result?.stop?.kind === 'noBranch'
    ? `No branch matches at step ${result.steps.length}`
    : `Stopped at step ${result?.steps.length ?? 0}: cannot decide`;

  const announcement = !result
    ? ''
    : result.status === 'leaf' && leaf
      ? `Predicted Path ${pathNumber(index, leaf.id)}, outcome ${leaf.outcomeName ?? 'none'}, in ${result.steps.length} steps.`
      : `${stopTitle}.`;

  const footer = (
    <>
      <Button variant="tertiary" onClick={onClose}>Close</Button>
      {result && (result.status === 'leaf' || result.lastBranchId !== null) && (
        <Button variant="secondary" onClick={() => { onShow(target); onClose(); }}>
          {result.status === 'leaf' ? 'Show the predicted path on the tree' : 'Show where it stopped'}
        </Button>
      )}
      <Button variant="primary" onClick={run}>Predict path</Button>
    </>
  );

  return (
    <Modal title="Find path for a record" size="large" onClose={onClose} footer={footer} className="segtree-trace-dialog">
      <div className="segtree-trace">
        <p className="segtree-trace__intro">
          Give a record's input values and this page predicts its path from the tree's branch conditions:
          at each split the branches are tried in order and the first that holds is taken. It is not run by SAS,
          and it stops wherever it cannot be sure (an expression, a type mismatch, a comparison whose SAS result is uncertain).
        </p>

        <div className="segtree-trace__bar">
          <div className="segtree-path__view" role="radiogroup" aria-label="Enter the record as">
            {(['json', 'form'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={`segtree-toggle${mode === m ? ' segtree-toggle--on' : ''}`}
                onClick={() => switchMode(m)}
              >
                {m === 'json' ? 'JSON' : 'Form'}
              </button>
            ))}
          </div>
          {canUseSample && (
            <Button variant="tertiary" size="small" onClick={useSample}>
              Start from Path {pathNumber(index, focus!.id)}'s sample input
            </Button>
          )}
        </div>

        {mode === 'json' ? (
          <div className="save-scenario-dialog__field">
            <label className="save-scenario-dialog__label" htmlFor="segtree-trace-json">Record (JSON)</label>
            <textarea
              id="segtree-trace-json"
              className="sas-textarea segtree-trace__json"
              rows={8}
              spellCheck={false}
              value={json}
              placeholder={'{\n  "Score": 640,\n  "Region": "North"\n}'}
              aria-invalid={!!parseError}
              aria-describedby="segtree-trace-json-hint"
              onChange={(e) => { setJson(e.target.value); remember({ json: e.target.value }); }}
            />
            <span className="save-scenario-dialog__hint" id="segtree-trace-json-hint">
              The format Copy → Sample input (JSON) produces. Numbers as JSON numbers, text in quotes, null for missing.
            </span>
            {parseError && <span className="save-scenario-dialog__field-error" role="alert">{parseError}</span>}
          </div>
        ) : (
          <fieldset className="segtree-trace__form">
            <legend className="save-scenario-dialog__label">Variables the tree tests (blank is missing)</legend>
            {variables.length === 0 && <p className="segtree-trace__empty">The tree tests no input variables.</p>}
            {variables.map((v, i) => (
              <div key={v} className="segtree-trace__field">
                <label htmlFor={`segtree-trace-v${i}`}>
                  {v} <span className="segtree-trace__type">{index.varTypes.get(v) ?? 'not in signature'}</span>
                </label>
                <input
                  id={`segtree-trace-v${i}`}
                  className="sas-input segtree-input--compact"
                  value={form[v] ?? ''}
                  placeholder="missing"
                  inputMode={index.varTypes.get(v) === 'string' ? 'text' : 'decimal'}
                  onChange={(e) => {
                    const next = { ...form, [v]: e.target.value };
                    setForm(next);
                    remember({ form: next });
                  }}
                />
              </div>
            ))}
          </fieldset>
        )}

        <label className="segtree-test__check">
          <input
            type="checkbox"
            checked={absentAsMissing}
            onChange={(e) => { setAbsentAsMissing(e.target.checked); remember({ absentAsMissing: e.target.checked }); }}
          />
          Take variables that are not in the record as missing (otherwise the prediction stops at them)
        </label>

        <p className="sr-only" role="status">{announcement}</p>
        <div>
          {result && (
            <section className="segtree-trace__result" aria-labelledby="segtree-trace-result-title">
              <h3 id="segtree-trace-result-title" className="segtree-trace__title">
                Predicted path <span className="segtree-trace__caveat">— from the tree's conditions, not executed by SAS</span>
              </h3>
              {result.status === 'leaf' && leaf ? (
                <Alert variant="info" title={`Path ${pathNumber(index, leaf.id)} → ${leaf.outcomeName ?? '(no outcome)'}`}>
                  {outputs.length > 0
                    ? outputs.map((o) => `${o.variable} = ${o.value === null ? '(not a literal)' : String(o.value)}`).join(' · ')
                    : 'The path assigns no output values.'}
                  {' '}Several paths can share an outcome, so check the steps below rather than only the outcome.
                </Alert>
              ) : (
                <Alert variant="warning" title={stopTitle}>
                  {result.stop ? describeStop(result.stop) : 'The walk could not continue.'}
                  {result.steps.length > 1 ? ' The steps before it are decided.' : ''}
                </Alert>
              )}
              {result.notes.length > 0 && (
                <ul className="segtree-trace__notes">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              )}
              <ol className="segtree-trace__steps">
                {result.steps.map((s, i) => {
                  const undecided = s.branchId === null;
                  return (
                    <li key={s.splitId} className={`segtree-trace__step${undecided ? ' segtree-trace__step--stopped' : ''}`}>
                      <div className="segtree-trace__step-head">
                        <span className="segtree-trace__var">{s.variable}</span>
                        {s.value && <span> = <code>{describeValue(s.value)}</code></span>}
                        {undecided && <span className="segtree-chip segtree-chip--warn">Not decided</span>}
                      </div>
                      <ul className="segtree-trace__tried" aria-label={`Step ${i + 1}: branches tried`}>
                        {s.tried.map((b) => (
                          <li key={b.branchId} className={b.matched ? 'segtree-trace__tried--hit' : 'segtree-trace__tried--miss'}>
                            <span className="segtree-trace__mark" aria-hidden="true">{b.matched ? '✓' : '✗'}</span>
                            <span>{b.label}</span>
                            <span className="segtree-trace__verdict">{b.matched ? 'matched, taken' : 'does not match'}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}
