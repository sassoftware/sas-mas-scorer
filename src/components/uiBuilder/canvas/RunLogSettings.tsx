// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useId, useState } from 'react';
import { UISettings } from '../../../types/uiBuilder';
import { getCaslibs, getCasServers } from '../../../api/cas';
import { SAS_NAME } from '../../../api/casRunLog';

interface Props {
  settings: UISettings;
  onChange: (settings: UISettings) => void;
}

/** "Write each run to a CAS table": on/off, the CAS library and the table name. */
export const RunLogSettings: React.FC<Props> = ({ settings, onChange }) => {
  const id = useId();
  const log = settings.runLog;
  const [caslibs, setCaslibs] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!log || caslibs) return;
    let live = true;
    getCasServers()
      .then(servers => (servers[0] ? getCaslibs(servers[0].name) : []))
      .then(libs => { if (live) setCaslibs(libs.map(l => l.name).filter(n => SAS_NAME.test(n))); })
      .catch(e => { if (live) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [log, caslibs]);

  const tableOk = !log || SAS_NAME.test(log.table);
  return (
    <div className="ui-builder__config-field">
      <label>
        <input
          type="checkbox"
          checked={!!log}
          onChange={(e) => onChange({ ...settings, runLog: e.target.checked ? { caslib: 'CASUSER', table: 'MSS_RUN_LOG' } : undefined })}
          aria-describedby={`${id}-hint`}
        />
        {' '}Write each run to a CAS table
      </label>
      <span className="ui-builder__config-type-hint" id={`${id}-hint`}>
        After every run (also failed ones) a row is added with the app, module, time, user, status, and the inputs and results as JSON text. The table is created on the first run and kept in memory as a global table. App users need write access to the library. Inputs can be personal data: choose a library whose access fits.
      </span>
      {log && (
        <div className="ui-builder__config-row">
          <div className="ui-builder__config-field">
            <label htmlFor={`${id}-lib`}>CAS library</label>
            <select
              id={`${id}-lib`}
              className="sas-input"
              value={log.caslib}
              onChange={(e) => onChange({ ...settings, runLog: { ...log, caslib: e.target.value } })}
            >
              {[...new Set(['CASUSER', ...(caslibs ?? []), log.caslib])].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            {loadError && <span className="ui-builder__config-type-hint">Could not list the libraries: {loadError}</span>}
          </div>
          <div className="ui-builder__config-field">
            <label htmlFor={`${id}-table`}>Table</label>
            <input
              id={`${id}-table`}
              className="sas-input"
              value={log.table}
              aria-invalid={!tableOk || undefined}
              aria-describedby={`${id}-table-hint`}
              onChange={(e) => onChange({ ...settings, runLog: { ...log, table: e.target.value } })}
            />
            <span className="ui-builder__config-type-hint" id={`${id}-table-hint`}>
              {tableOk ? 'Letters, digits and underscores, up to 32.' : 'Use letters, digits and underscores only, starting with a letter or underscore (up to 32).'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
