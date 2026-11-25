// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIDefinition } from '../../types/uiBuilder';
import { saveTextFile, safeFilename } from '../../utils/download';
import { toCsv } from '../../utils/scrInputs';

export interface LastRun {
  /** The values sent, keyed by input name, as converted for the request. */
  inputs: Record<string, unknown>;
  /** When the run was started (ISO). */
  at: string;
}

interface Props {
  definition: UIDefinition;
  run: LastRun | null;
  outputs: Record<string, unknown>;
}

/**
 * Download buttons for the last run's inputs and results, when the app
 * author turned them on. CSV has one line per value (kind, name, value; a
 * DataGrid or list as JSON text); JSON keeps the values' own types.
 */
export const ResultDownloads: React.FC<Props> = ({ definition, run, outputs }) => {
  const kinds = definition.settings.downloads ?? [];
  if (kinds.length === 0 || !run || Object.keys(outputs).length === 0) return null;
  const base = safeFilename(`${definition.name || definition.moduleId}-${run.at.replace(/[:.]/g, '-')}`);
  const source = definition.scrUrl ? { scrEndpoint: definition.scrUrl } : { masModule: definition.moduleId, step: definition.stepId };

  const csv = () => {
    const rows = [
      ...Object.entries(run.inputs).map(([name, value]) => ({ kind: 'input', name, value })),
      ...Object.entries(outputs).map(([name, value]) => ({ kind: 'result', name, value })),
    ];
    saveTextFile(toCsv(['kind', 'name', 'value'], rows), `${base}.csv`, 'text/csv;charset=utf-8');
  };
  const json = () => {
    const doc = { app: definition.name, ...source, ranAt: run.at, inputs: run.inputs, results: outputs };
    saveTextFile(JSON.stringify(doc, null, 2), `${base}.json`, 'application/json');
  };

  return (
    <div className="ui-runner__downloads" role="group" aria-label="Download this run">
      {kinds.includes('csv') && (
        <button type="button" className="sas-button sas-button--secondary sas-button--small" onClick={csv}>
          Download results (CSV)
        </button>
      )}
      {kinds.includes('json') && (
        <button type="button" className="sas-button sas-button--secondary sas-button--small" onClick={json}>
          Download results (JSON)
        </button>
      )}
    </div>
  );
};
