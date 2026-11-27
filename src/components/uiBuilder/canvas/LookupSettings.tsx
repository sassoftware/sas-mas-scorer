// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useId, useState } from 'react';
import { FieldValidation } from '../../../types/uiBuilder';
import { getCaslibs, getCasServers, getCasTables, getTableColumns } from '../../../api/cas';
import { SAS_NAME } from '../../../api/casSession';
import { readLookupOptions } from '../../../api/casLookup';

interface Props {
  validation: FieldValidation | undefined;
  onChange: (lookup: FieldValidation['lookup']) => void;
}

/**
 * "Options from a CAS table" for a Dropdown or Radio Buttons field: library,
 * table, value column and label column, read again every time the app opens.
 */
export const LookupSettings: React.FC<Props> = ({ validation, onChange }) => {
  const id = useId();
  const lookup = validation?.lookup;
  const [server, setServer] = useState<string | null>(null);
  const [caslibs, setCaslibs] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!lookup || server) return;
    getCasServers()
      .then(s => { const name = s[0]?.name ?? null; setServer(name); return name ? getCaslibs(name) : []; })
      .then(libs => setCaslibs(libs.map(l => l.name).filter(n => SAS_NAME.test(n))))
      .catch(e => setProblem(e instanceof Error ? e.message : String(e)));
  }, [lookup, server]);

  useEffect(() => {
    if (!server || !lookup?.caslib) return;
    getCasTables(server, lookup.caslib, 0, 500)
      .then(r => setTables(r.items.filter(t => t.state === undefined || t.state === 'loaded').map(t => t.name).filter(n => SAS_NAME.test(n))))
      .catch(() => setTables([]));
  }, [server, lookup?.caslib]);

  useEffect(() => {
    if (!server || !lookup?.caslib || !lookup.table) return;
    getTableColumns(server, lookup.caslib, lookup.table)
      .then(cols => setColumns(cols.map(c => c.name)))
      .catch(() => setColumns([]));
  }, [server, lookup?.caslib, lookup?.table]);

  const tryIt = async () => {
    if (!lookup) return;
    setPreview(null);
    setProblem(null);
    try {
      const options = await readLookupOptions(lookup);
      setPreview(`${options.length.toLocaleString()} option${options.length === 1 ? '' : 's'}${options.length ? `: ${options.slice(0, 6).map(o => o.label).join(', ')}${options.length > 6 ? ', …' : ''}` : ''}`);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const set = (patch: Partial<NonNullable<FieldValidation['lookup']>>) =>
    onChange({ caslib: 'CASUSER', table: '', valueColumn: '', ...lookup, ...patch });

  return (
    <div className="ui-builder__config-field">
      <label>
        <input
          type="checkbox"
          checked={!!lookup}
          onChange={(e) => onChange(e.target.checked ? { caslib: 'CASUSER', table: '', valueColumn: '' } : undefined)}
          aria-describedby={`${id}-hint`}
        />
        {' '}Options from a CAS table
      </label>
      <span className="ui-builder__config-type-hint" id={`${id}-hint`}>
        Read again every time the app opens (distinct values, sorted by label, up to 1,000). The table must be loaded in CAS, and app users need read access. The options below are used when the table can't be read.
      </span>
      {lookup && (
        <>
          <div className="ui-builder__config-row">
            <div className="ui-builder__config-field">
              <label htmlFor={`${id}-lib`}>CAS library</label>
              <select id={`${id}-lib`} className="sas-input" value={lookup.caslib}
                onChange={(e) => set({ caslib: e.target.value, table: '', valueColumn: '', labelColumn: undefined })}>
                {[...new Set(['CASUSER', ...caslibs, lookup.caslib])].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="ui-builder__config-field">
              <label htmlFor={`${id}-table`}>Table</label>
              <select id={`${id}-table`} className="sas-input" value={lookup.table}
                onChange={(e) => set({ table: e.target.value, valueColumn: '', labelColumn: undefined })}>
                <option value="">Choose a table</option>
                {[...new Set([...tables, ...(lookup.table ? [lookup.table] : [])])].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div className="ui-builder__config-row">
            <div className="ui-builder__config-field">
              <label htmlFor={`${id}-val`}>Value column (sent)</label>
              <select id={`${id}-val`} className="sas-input" value={lookup.valueColumn} onChange={(e) => set({ valueColumn: e.target.value })}>
                <option value="">Choose a column</option>
                {[...new Set([...columns, ...(lookup.valueColumn ? [lookup.valueColumn] : [])])].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="ui-builder__config-field">
              <label htmlFor={`${id}-lab`}>Label column (shown)</label>
              <select id={`${id}-lab`} className="sas-input" value={lookup.labelColumn ?? ''} onChange={(e) => set({ labelColumn: e.target.value || undefined })}>
                <option value="">Same as the value</option>
                {[...new Set([...columns, ...(lookup.labelColumn ? [lookup.labelColumn] : [])])].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <button type="button" className="sas-button sas-button--secondary sas-button--small" disabled={!lookup.table || !lookup.valueColumn} onClick={() => void tryIt()}>
            Read the options now
          </button>
          {preview && <span className="ui-builder__config-type-hint" role="status">{preview}</span>}
          {problem && <span className="ui-builder__config-type-hint" role="alert">Could not read the options: {problem}</span>}
        </>
      )}
    </div>
  );
};
