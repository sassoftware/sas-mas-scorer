// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Form fields shared by "Pull and run" and a container's settings: limits,
 * mode, environment variables and folders. The main process checks every
 * value again; the checks here only give quicker feedback.
 */

import React, { useState } from 'react';
import { Button } from '../common/Button';
import type { ImageKind, LocalContainersAPI, RunOptions } from '../../types/localContainers';
import {
  catalogEntry,
  catalogGroup,
  choicesFor,
  entriesIn,
  ENV_SOURCE,
  groupsFor,
  initialValue,
  type EnvCatalogEntry,
} from './scrEnvCatalog';

export interface EnvRow {
  key: string;
  name: string;
  value: string;
}

export interface MountRow {
  key: string;
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
  /** Why the main process refused the chosen folder. */
  error?: string;
}

export interface SettingsDraft {
  displayName: string;
  cpus: string;
  memoryMb: string;
  mode: 'SAS' | 'BATCH';
  env: EnvRow[];
  mounts: MountRow[];
}

let rowCounter = 0;
const rowKey = (): string => `row-${++rowCounter}`;

export const emptyDraft = (): SettingsDraft => ({
  displayName: '',
  cpus: '2',
  memoryMb: '2048',
  mode: 'SAS',
  env: [],
  mounts: [],
});

export const draftFromOptions = (o: RunOptions): SettingsDraft => ({
  displayName: o.displayName ?? '',
  cpus: String(o.cpus),
  memoryMb: String(o.memoryMb),
  mode: o.mode,
  env: o.env.map((e) => ({ key: rowKey(), ...e })),
  mounts: o.mounts.map((m) => ({ key: rowKey(), ...m })),
});

// Letters, digits, _ and dots: SCR logger variables have dotted names (SAS_SCR_LOG_LEVEL_App.tk.MAS).
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

/** The draft as run options, or the first thing to fix. Empty rows are left out. */
export function draftToOptions(d: SettingsDraft): { options: RunOptions } | { error: string } {
  const env = d.env.filter((r) => r.name.trim() || r.value);
  for (const r of env) {
    if (!r.name.trim()) return { error: 'An environment variable has a value but no name.' };
    if (!ENV_NAME_RE.test(r.name.trim())) {
      return { error: `"${r.name.trim()}" is not a valid variable name (letters, digits, _ and ., starting with a letter or _).` };
    }
  }
  const mounts = d.mounts.filter((r) => r.hostPath.trim());
  for (const r of mounts) {
    if (!r.containerPath.trim()) return { error: `Enter the path inside the container for ${r.hostPath}.` };
  }
  return {
    options: {
      displayName: d.displayName.trim() || undefined,
      cpus: Number(d.cpus),
      memoryMb: Number(d.memoryMb),
      mode: d.mode,
      env: env.map((r) => ({ name: r.name.trim(), value: r.value })),
      mounts: mounts.map((r) => ({ hostPath: r.hostPath.trim(), containerPath: r.containerPath.trim(), readOnly: r.readOnly })),
    },
  };
}

/** /data, then /data2, /data3 … whichever is free. */
const nextContainerPath = (rows: MountRow[]): string => {
  const used = new Set(rows.map((r) => r.containerPath.trim()));
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? '/data' : `/data${i}`;
    if (!used.has(candidate)) return candidate;
  }
};

interface FieldsProps {
  draft: SettingsDraft;
  onChange: (next: SettingsDraft) => void;
  disabled?: boolean;
}

/** CPUs, memory and mode. */
export const LimitsFields: React.FC<FieldsProps & { showMode?: boolean }> = ({ draft, onChange, disabled, showMode = true }) => (
  <>
    <label className="scr-field lc-field--narrow">
      <span className="scr-field__label">CPUs</span>
      <input
        className="sas-input"
        type="number"
        min={0.5}
        max={16}
        step={0.5}
        value={draft.cpus}
        onChange={(e) => onChange({ ...draft, cpus: e.target.value })}
        disabled={disabled}
      />
    </label>
    <label className="scr-field lc-field--narrow">
      <span className="scr-field__label">Memory (MB)</span>
      <input
        className="sas-input"
        type="number"
        min={512}
        max={32768}
        step={256}
        value={draft.memoryMb}
        onChange={(e) => onChange({ ...draft, memoryMb: e.target.value })}
        disabled={disabled}
      />
    </label>
    {showMode && (
      <label className="scr-field lc-field--narrow lc-field--mode">
        <span className="scr-field__label">Mode</span>
        <select
          className="sas-input"
          value={draft.mode}
          onChange={(e) => onChange({ ...draft, mode: e.target.value as 'SAS' | 'BATCH' })}
          disabled={disabled}
        >
          <option value="SAS">Single record</option>
          <option value="BATCH">Batch</option>
        </select>
      </label>
    )}
  </>
);

/** The value field of a variable: a list for documented levels and switches, a number or text field otherwise. */
const EnvValueInput: React.FC<{ row: EnvRow; entry: EnvCatalogEntry | undefined; onValue: (value: string) => void }> = ({
  row,
  entry,
  onValue,
}) => {
  const label = `Value of ${row.name || 'the variable'}`;
  const choices = entry ? choicesFor(entry) : null;
  if (entry && choices) {
    // A value typed before (or set outside the list) stays selectable rather than being lost.
    const options = choices.includes(row.value) ? choices : [row.value, ...choices];
    return (
      <select className="sas-input lc-env-row__value" aria-label={label} value={row.value} onChange={(e) => onValue(e.target.value)}>
        {options.map((v) => (
          <option key={v || '(empty)'} value={v}>
            {v === '' ? '(empty)' : v}
            {entry.default === v ? ' (default)' : ''}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className="sas-input lc-env-row__value"
      aria-label={label}
      type={entry?.kind === 'number' ? 'number' : 'text'}
      min={entry?.kind === 'number' ? entry.min : undefined}
      step={entry?.kind === 'number' ? 'any' : undefined}
      placeholder={entry?.default ? `default ${entry.default}` : 'value'}
      value={row.value}
      onChange={(e) => onValue(e.target.value)}
      spellCheck={false}
      autoComplete="off"
      maxLength={4096}
    />
  );
};

/** Environment variables and folders. */
export const ExtrasFields: React.FC<
  FieldsProps & {
    api: LocalContainersAPI;
    idPrefix: string;
    /** The image, when known (container settings): the quick add then lists only what fits it. */
    imageKind?: ImageKind;
  }
> = ({ draft, onChange, disabled, api, idPrefix, imageKind }) => {
  const [choosing, setChoosing] = useState<string | null>(null);

  const setEnv = (key: string, patch: Partial<EnvRow>) =>
    onChange({ ...draft, env: draft.env.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  const setMount = (key: string, patch: Partial<MountRow>) =>
    onChange({ ...draft, mounts: draft.mounts.map((r) => (r.key === key ? { ...r, ...patch } : r)) });

  const chooseFolder = async (row: MountRow) => {
    setChoosing(row.key);
    try {
      const result = await api.chooseFolder();
      if (result.ok) setMount(row.key, { hostPath: result.path, error: undefined });
      else if (result.problem.code !== 'cancelled') setMount(row.key, { error: result.problem.title });
    } finally {
      setChoosing(null);
    }
  };

  const listId = `${idPrefix}-env-names`;
  const groups = groupsFor(imageKind);
  const used = new Set(draft.env.map((r) => r.name.trim()));

  const quickAdd = (name: string) => {
    const entry = catalogEntry(name);
    if (!entry || used.has(name) || draft.env.length >= 50) return;
    onChange({ ...draft, env: [...draft.env, { key: rowKey(), name, value: initialValue(entry) }] });
  };

  return (
    <div className="lc-extras">
      <fieldset className="lc-extras__group" disabled={disabled}>
        <legend className="scr-field__label">Environment variables</legend>
        {draft.env.length === 0 && <p className="scr-muted lc-extras__empty">None.</p>}
        {draft.env.map((row) => {
          const entry = catalogEntry(row.name);
          const group = entry ? catalogGroup(entry.group) : undefined;
          return (
            <div key={row.key} className="lc-env">
              <div className="lc-env-row">
                <input
                  className="sas-input lc-env-row__name"
                  aria-label="Variable name"
                  placeholder="NAME"
                  list={listId}
                  value={row.name}
                  onChange={(e) => setEnv(row.key, { name: e.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={128}
                />
                <span className="lc-env-row__eq" aria-hidden="true">=</span>
                <EnvValueInput row={row} entry={entry} onValue={(value) => setEnv(row.key, { value })} />
                <Button
                  type="button"
                  variant="tertiary"
                  size="small"
                  aria-label={`Remove ${row.name || 'variable'}`}
                  onClick={() => onChange({ ...draft, env: draft.env.filter((r) => r.key !== row.key) })}
                >
                  Remove
                </Button>
              </div>
              {entry && (
                <p className="lc-env__desc">
                  {entry.description}
                  {entry.default !== undefined && <> Default: <code>{entry.default}</code>.</>}
                  {group?.note && <> {group.note}</>}
                  {entry.note && <span className="lc-env__note"> {entry.note}</span>}
                </p>
              )}
            </div>
          );
        })}
        <datalist id={listId}>
          {groups.flatMap((g) => entriesIn(g.id)).map((e) => (
            <option key={e.name} value={e.name}>
              {e.description}
            </option>
          ))}
        </datalist>
        <div className="lc-env-add">
          <select
            className="sas-input lc-env-add__quick"
            aria-label="Quick add a documented variable"
            value=""
            disabled={draft.env.length >= 50}
            onChange={(e) => quickAdd(e.target.value)}
          >
            <option value="">Quick add a documented variable…</option>
            {groups.map((g) => (
              <optgroup key={g.id} label={g.label}>
                {entriesIn(g.id).map((e) => (
                  <option key={e.name} value={e.name} disabled={used.has(e.name)}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Button
            type="button"
            variant="secondary"
            size="small"
            disabled={draft.env.length >= 50}
            onClick={() => onChange({ ...draft, env: [...draft.env, { key: rowKey(), name: '', value: '' }] })}
          >
            Add variable
          </Button>
        </div>
        <p className="scr-hint lc-env__source">
          Descriptions, defaults and values from {ENV_SOURCE}. Older images can ignore newer variables.
        </p>
      </fieldset>

      <fieldset className="lc-extras__group" disabled={disabled}>
        <legend className="scr-field__label">Folders from this computer</legend>
        {draft.mounts.length === 0 && <p className="scr-muted lc-extras__empty">None.</p>}
        {draft.mounts.map((row) => (
          <div key={row.key} className="lc-mount">
            <div className="lc-mount-row">
              <input
                className="sas-input lc-mount-row__host"
                aria-label="Folder on this computer"
                placeholder="Folder on this computer"
                value={row.hostPath}
                onChange={(e) => setMount(row.key, { hostPath: e.target.value, error: undefined })}
                spellCheck={false}
                autoComplete="off"
              />
              <Button type="button" variant="secondary" size="small" loading={choosing === row.key} onClick={() => void chooseFolder(row)}>
                Choose…
              </Button>
              <span className="lc-env-row__eq" aria-hidden="true">→</span>
              <input
                className="sas-input lc-mount-row__target"
                aria-label="Path inside the container"
                placeholder="/data"
                value={row.containerPath}
                onChange={(e) => setMount(row.key, { containerPath: e.target.value })}
                spellCheck={false}
                autoComplete="off"
              />
              <label className="lc-check">
                <input type="checkbox" checked={row.readOnly} onChange={(e) => setMount(row.key, { readOnly: e.target.checked })} />
                Read-only
              </label>
              <Button
                type="button"
                variant="tertiary"
                size="small"
                aria-label="Remove folder"
                onClick={() => onChange({ ...draft, mounts: draft.mounts.filter((r) => r.key !== row.key) })}
              >
                Remove
              </Button>
            </div>
            {row.error && <p className="lc-field-error" role="alert">{row.error}</p>}
            {!row.readOnly && (
              <p className="scr-hint lc-mount__warn">Read-write: the container can change and delete files in this folder.</p>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="small"
          disabled={draft.mounts.length >= 5}
          onClick={() =>
            onChange({
              ...draft,
              mounts: [...draft.mounts, { key: rowKey(), hostPath: '', containerPath: nextContainerPath(draft.mounts), readOnly: true }],
            })
          }
        >
          Add folder
        </Button>
        {draft.mounts.length > 0 && (
          <p className="scr-hint">
            Inside the container the files are under the container path, e.g. /data/photo.jpg; use that form in inputs
            that take a file path. System folders, your user folder as a whole, keys and this app&apos;s own data can&apos;t
            be mounted.
          </p>
        )}
      </fieldset>
    </div>
  );
};
