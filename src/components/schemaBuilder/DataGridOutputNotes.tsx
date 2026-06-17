// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Per-variable advisory shown on the Python Output screen for every DataGrid
// mapping. SAS Intelligent Decisioning cannot consume a DataGrid produced
// directly by a Python code node — the node can only return the grid as a
// serialized JSON string in a Character variable. To turn that string back into
// a real DataGrid in the decision flow, a downstream Rule Set or Variable
// Assignment node must call dataGrid_create(<grid>, <jsonString>).
//
// See: "How to access a DataGrid inside a Python code node in Intelligent
// Decisioning" (SAS Communities) — incl. the closing comment warning that an
// undersized Character length silently truncates the JSON.

import React, { useState } from 'react';
import type { VariableMapping } from '../../types/schemaBuilder';

interface Props {
  mappings: VariableMapping[];
}

/** The DataGrid target variable name suggested in the conversion snippet. */
function gridVarName(serializedName: string): string {
  // Keep within the 32-char SAS name limit even after the suffix is added.
  const suffix = '_dg';
  const base = serializedName.slice(0, 32 - suffix.length);
  return `${base}${suffix}`;
}

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable in non-secure contexts; ignore.
    }
  };
  return (
    <button type="button" className="schema-builder__dg-note-copy" onClick={onCopy}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
};

export const DataGridOutputNotes: React.FC<Props> = ({ mappings }) => {
  const gridVars = mappings.filter(m => m.dataType === 'DataGrid' || m.isArray);
  if (gridVars.length === 0) return null;

  return (
    <div className="schema-builder__dg-notes">
      <div className="schema-builder__dg-notes-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span>
          DataGrid output{gridVars.length > 1 ? 's' : ''} — extra step required in your decision
        </span>
      </div>

      <p className="schema-builder__dg-notes-intro">
        A Python code node <strong>cannot output a DataGrid directly</strong> into SAS Intelligent
        Decisioning. The generated code returns each grid as a <em>serialized JSON string</em> in a{' '}
        <strong>Character</strong> variable. To use it as a real DataGrid in your decision flow, add a{' '}
        <strong>Rule Set</strong> or <strong>Variable Assignment</strong> node <em>after</em> this code
        file and convert the string with <code>dataGrid_create()</code>.
      </p>

      {gridVars.map((m, i) => {
        const grid = gridVarName(m.variableName);
        const snippet = `dataGrid_create(${grid}, ${m.variableName})`;
        return (
          <div key={i} className="schema-builder__dg-note">
            <div className="schema-builder__dg-note-var">
              <code>{m.variableName}</code>
              <span className="schema-builder__dg-note-tag">Character (serialized DataGrid)</span>
            </div>
            <div className="schema-builder__dg-note-code">
              <code>{snippet}</code>
              <CopyButton text={snippet} />
            </div>
            <p className="schema-builder__dg-note-desc">
              In a downstream Rule Set / Variable Assignment node, declare a DataGrid variable{' '}
              <code>{grid}</code> as output and assign it from the Character output{' '}
              <code>{m.variableName}</code> using the statement above.
            </p>
          </div>
        );
      })}

      <p className="schema-builder__dg-notes-warning">
        <strong>Length matters:</strong> the Character variable holding the serialized grid must be
        long enough to hold the full JSON. If its length is left at the default (100), SAS Intelligent
        Decisioning silently truncates the string and the conversion fails. Set a generous length (up
        to 32672) on this variable in <em>both</em> the code file signature and the Rule Set.
      </p>
    </div>
  );
};

export default DataGridOutputNotes;
