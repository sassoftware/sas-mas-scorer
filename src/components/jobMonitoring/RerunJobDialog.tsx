// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useId, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { rerunJob, type RerunEligibility } from '../../api/jobs';
import type { ExecutionJob } from '../../types/jobExecution';

interface RerunJobDialogProps {
  job: ExecutionJob;
  /** The job's display name. */
  name: string;
  eligibility: RerunEligibility;
  /** True for "Rerun with changes…": the argument values can be edited first. */
  withChanges: boolean;
  onSubmitted: (newJob: ExecutionJob) => void;
  onCancel: () => void;
}

interface ArgumentRow {
  name: string;
  /** The value sent with the original run; null for a declared parameter it did not pass. */
  original: string | null;
  label?: string;
  type?: string;
  defaultValue?: string;
}

/**
 * Confirms a rerun of a finished job and submits it. With `withChanges`, the
 * arguments of the original request (and the parameters its definition
 * declares, when the stored request has them) can be edited first.
 */
export const RerunJobDialog: React.FC<RerunJobDialogProps> = ({
  job,
  name,
  eligibility,
  withChanges,
  onSubmitted,
  onCancel,
}) => {
  const idBase = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo<ArgumentRow[]>(() => {
    const args = job.jobRequest.arguments ?? {};
    const declared = job.jobRequest.jobDefinition?.parameters ?? [];
    const declaredByName = new Map(declared.map((p) => [p.name, p]));
    const passed: ArgumentRow[] = Object.keys(args).map((argName) => {
      const p = declaredByName.get(argName);
      return { name: argName, original: args[argName], label: p?.label, type: p?.type, defaultValue: p?.defaultValue };
    });
    const notPassed: ArgumentRow[] = declared
      .filter((p) => !Object.prototype.hasOwnProperty.call(args, p.name))
      .map((p) => ({ name: p.name, original: null, label: p.label, type: p.type, defaultValue: p.defaultValue }));
    return [...passed, ...notPassed];
  }, [job]);

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.name, row.original ?? '']))
  );

  // Arguments that were passed are always sent (an emptied one is sent
  // empty); a declared parameter the original did not pass is sent only when
  // a value is entered, so it otherwise keeps its default.
  const argumentsToSend = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const row of rows) {
      const value = values[row.name] ?? '';
      if (row.original !== null || value !== '') out[row.name] = value;
    }
    return out;
  };

  const changedCount = rows.filter((row) => (values[row.name] ?? '') !== (row.original ?? '')).length;

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const newJob = await rerunJob(job, withChanges ? argumentsToSend() : undefined);
      onSubmitted(newJob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit the job.');
      setBusy(false);
    }
  };

  const definitionNote =
    eligibility.definition === 'uri' ? (
      <p>
        It runs the job definition <code className="job-rerun__code">{job.jobRequest.jobDefinitionUri}</code> as
        it is now, which may differ from the version this job ran.
      </p>
    ) : (
      <p>It runs the same code this job ran (the definition stored with its request).</p>
    );

  const argCount = Object.keys(job.jobRequest.arguments ?? {}).length;

  return (
    <ConfirmDialog
      title={withChanges ? 'Rerun with changes' : 'Rerun this job?'}
      size={withChanges ? 'medium' : 'small'}
      initialFocusRef={withChanges && rows.length > 0 ? firstFieldRef : undefined}
      message={
        <>
          <p>
            This submits <strong>{name}</strong> again as a new job, under your user. The new job opens with its
            live log; this job stays as it is.
          </p>
          {definitionNote}
          {!eligibility.application && (
            <p>The original request does not name the application that submitted it.</p>
          )}
          {!withChanges && (
            <p>
              {argCount === 0
                ? 'The original request passed no arguments.'
                : `It passes the same ${argCount} argument${argCount === 1 ? '' : 's'} as the original run.`}
            </p>
          )}
          {withChanges && (rows.length === 0 ? (
            <p>The original request has no arguments to change.</p>
          ) : (
            <form
              className="job-rerun__form"
              onSubmit={(e) => {
                e.preventDefault();
                void handleConfirm();
              }}
            >
              <p className="job-rerun__hint">
                Only the arguments of the original request
                {rows.some((r) => r.original === null) ? ' and the parameters its definition declares' : ''} can be
                changed. An argument the original passed is always sent, even when emptied; a declared parameter
                left empty keeps its default.
              </p>
              {rows.map((row, i) => {
                const fieldId = `${idBase}-arg-${i}`;
                const changed = (values[row.name] ?? '') !== (row.original ?? '');
                const hintId = `${fieldId}-hint`;
                const hint = [
                  row.label && row.label !== row.name ? row.label : null,
                  row.type ?? null,
                  row.original === null
                    ? `not passed originally${row.defaultValue !== undefined ? `; default ${row.defaultValue || '(empty)'}` : ''}`
                    : null,
                ].filter(Boolean).join(' · ');
                return (
                  <div key={row.name} className="job-rerun__field">
                    <label htmlFor={fieldId} className="job-rerun__label">
                      <span className="job-rerun__name">{row.name}</span>
                      {changed && <span className="job-params__override-tag">changed</span>}
                    </label>
                    <input
                      id={fieldId}
                      ref={i === 0 ? firstFieldRef : undefined}
                      className="sas-input job-rerun__input"
                      type="text"
                      value={values[row.name] ?? ''}
                      disabled={busy}
                      aria-describedby={hint ? hintId : undefined}
                      onChange={(e) => {
                        const value = e.target.value;
                        setValues((prev) => ({ ...prev, [row.name]: value }));
                      }}
                      onKeyDown={(e) => {
                        // Enter submits, as in a one-field form; the buttons are in the footer.
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleConfirm();
                        }
                      }}
                    />
                    {hint && <span id={hintId} className="job-rerun__field-hint">{hint}</span>}
                  </div>
                );
              })}
            </form>
          ))}
          {withChanges && rows.length > 0 && (
            <p className="job-rerun__summary" aria-live="polite">
              {changedCount === 0 ? 'No values changed.' : `${changedCount} value${changedCount === 1 ? '' : 's'} changed.`}
            </p>
          )}
        </>
      }
      confirmLabel={withChanges ? 'Rerun with these values' : 'Rerun job'}
      cancelLabel="Cancel"
      confirmVariant="primary"
      busy={busy}
      error={error}
      onConfirm={() => void handleConfirm()}
      onCancel={onCancel}
    />
  );
};
