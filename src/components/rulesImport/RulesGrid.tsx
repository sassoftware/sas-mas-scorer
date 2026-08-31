// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { CellIssue, RULE_CSV_COLUMNS } from '../../types/rulesImport';
import { COL, CONDITIONALS, DATATYPE_DISPLAY, EXPRESSION_TYPES, FLAG_VALUES } from '../../utils/rulesImport/constants';

/** Columns rendered as a select with a fixed value domain. */
const ENUM_OPTIONS: Partial<Record<number, readonly string[]>> = {
  [COL.CONDITIONAL]: CONDITIONALS,
  [COL.RECORD_RULE_FIRED_FLAG]: FLAG_VALUES,
  [COL.DATATYPE]: DATATYPE_DISPLAY,
  [COL.EXPRESSION_TYPE]: EXPRESSION_TYPES,
};

/** Columns whose values routinely span several lines (14% of rows in a real export). */
const MULTILINE_COLS = new Set<number>([COL.EXPRESSION]);

/** Wide free-text columns get a wider input. */
const WIDE_COLS = new Set<number>([COL.FOLDER_PATH, COL.EXPRESSION, COL.RULESET_DESC, COL.RULE_DESC]);

interface RulesGridProps {
  rows: string[][];
  /** Issues indexed by `${row}:${col}` for cells and `${row}:*` for row level. */
  issuesByCell: Map<string, CellIssue[]>;
  /** Row indexes to render (already filtered + paged), in display order. */
  visibleRowIndexes: number[];
  onCellChange: (row: number, col: number, value: string) => void;
  /** Rows of rejected rule sets get a tinted background. */
  highlightRowIndexes?: Set<number>;
  /** Row targeted by "Next error" — gets a focus outline. */
  focusRowIndex?: number | null;
}

const severityRank = { error: 3, warning: 2, info: 1 } as const;

const worstSeverity = (issues: CellIssue[]): 'error' | 'warning' | 'info' | null => {
  let worst: 'error' | 'warning' | 'info' | null = null;
  for (const issue of issues) {
    if (worst === null || severityRank[issue.severity] > severityRank[worst]) worst = issue.severity;
  }
  return worst;
};

export const RulesGrid: React.FC<RulesGridProps> = ({
  rows,
  issuesByCell,
  visibleRowIndexes,
  onCellChange,
  highlightRowIndexes,
  focusRowIndex,
}) => {
  if (visibleRowIndexes.length === 0) {
    return <div className="rules-import__grid-empty">No rows to display.</div>;
  }

  return (
    <div className="rules-import__grid-wrapper">
      <table className="rules-import__grid">
        <thead>
          <tr>
            <th className="rules-import__col-line" title="Data row number (the CSV header row is not counted)">Row</th>
            <th className="rules-import__col-status" aria-label="Row status" />
            {RULE_CSV_COLUMNS.map((name) => (
              <th key={name} className={WIDE_COLS.has((RULE_CSV_COLUMNS as readonly string[]).indexOf(name)) ? 'rules-import__col-wide' : undefined}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRowIndexes.map((r) => {
            const row = rows[r];
            const rowIssues = issuesByCell.get(`${r}:*`) ?? [];
            const rowSeverity = worstSeverity(rowIssues);
            const rejected = highlightRowIndexes?.has(r) ?? false;
            const rowClasses = [
              rejected ? 'rules-import__row--rejected' : '',
              rowSeverity === 'error' ? 'rules-import__row--error' : '',
              focusRowIndex === r ? 'rules-import__row--focus' : '',
            ].filter(Boolean).join(' ');

            return (
              <tr key={r} id={`rules-import-row-${r}`} className={rowClasses || undefined}>
                <td className="rules-import__col-line">{r + 1}</td>
                <td className="rules-import__col-status">
                  {rowSeverity && (
                    <span
                      className={`rules-import__status-dot rules-import__status-dot--${rowSeverity}`}
                      title={rowIssues.map((i) => i.message).join('\n')}
                    />
                  )}
                </td>
                {row.map((cell, c) => {
                  const cellIssues = issuesByCell.get(`${r}:${c}`) ?? [];
                  const severity = worstSeverity(cellIssues);
                  const tooltip = cellIssues.map((i) => i.message).join('\n') || undefined;
                  const inputClass = `rules-import__cell-input${severity ? ` rules-import__cell-input--${severity}` : ''}`;
                  const options = ENUM_OPTIONS[c];

                  const cellId = `rules-import-cell-${r}-${c}`;
                  if (options) {
                    // Keep out-of-domain values visible (and red) until fixed
                    const known = options.some((o) => o === cell);
                    return (
                      <td key={c}>
                        <select
                          id={cellId}
                          className={inputClass}
                          value={cell}
                          onChange={(e) => onCellChange(r, c, e.target.value)}
                          title={tooltip}
                        >
                          {!known && <option value={cell}>{cell === '' ? '(blank)' : cell}</option>}
                          {options.map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      </td>
                    );
                  }
                  if (MULTILINE_COLS.has(c) || cell.includes('\n')) {
                    const lineCount = cell.split('\n').length;
                    return (
                      <td key={c} className="rules-import__col-wide">
                        <textarea
                          id={cellId}
                          className={`${inputClass} rules-import__cell-textarea`}
                          value={cell}
                          rows={Math.min(lineCount, 6)}
                          onChange={(e) => onCellChange(r, c, e.target.value)}
                          title={tooltip}
                          spellCheck={false}
                        />
                      </td>
                    );
                  }
                  return (
                    <td key={c} className={WIDE_COLS.has(c) ? 'rules-import__col-wide' : undefined}>
                      <input
                        id={cellId}
                        type="text"
                        className={inputClass}
                        value={cell}
                        onChange={(e) => onCellChange(r, c, e.target.value)}
                        title={tooltip}
                        spellCheck={false}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default RulesGrid;
