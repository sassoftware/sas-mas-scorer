// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { CellIssue, IssueSeverity, RULE_CSV_COLUMNS } from '../../types/rulesImport';
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

/** Shared empty list so issue-free rows keep one prop identity across renders. */
const NO_ISSUES: CellIssue[] = [];

interface RulesGridProps {
  rows: string[][];
  /** All issues of a row (cell-level and row-level), keyed by grid row index. */
  issuesByRow: Map<number, CellIssue[]>;
  /** Row indexes to render (already filtered + paged), in display order. */
  visibleRowIndexes: number[];
  onCellChange: (row: number, col: number, value: string) => void;
  /** Rows of rejected rule sets get a tinted background. */
  highlightRowIndexes?: Set<number>;
  /** Row targeted by "Next error" — gets a focus outline. */
  focusRowIndex?: number | null;
}

const severityRank = { error: 3, warning: 2, info: 1 } as const;

const SEVERITY_LABEL: Record<IssueSeverity, string> = { error: 'Error', warning: 'Warning', info: 'Info' };

/** Glyph per severity so the marker is not colour alone (WCAG 1.4.1). */
const SEVERITY_GLYPH: Record<IssueSeverity, string> = { error: '×', warning: '!', info: 'i' };

const worstSeverity = (issues: CellIssue[]): IssueSeverity | null => {
  let worst: IssueSeverity | null = null;
  for (const issue of issues) {
    if (worst === null || severityRank[issue.severity] > severityRank[worst]) worst = issue.severity;
  }
  return worst;
};

/** Same issues by content — the validation pass recreates some issue objects per run.
 *  Compares only the fields GridRow renders; ruleSetKey is deliberately left out.
 *  If a new CellIssue field ever reaches the DOM, add it here or rows will not re-render. */
const sameIssues = (a: CellIssue[], b: CellIssue[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x.ruleId !== y.ruleId || x.col !== y.col || x.severity !== y.severity || x.source !== y.source || x.message !== y.message) {
      return false;
    }
  }
  return true;
};

interface GridRowProps {
  rowIndex: number;
  row: string[];
  issues: CellIssue[];
  rejected: boolean;
  focused: boolean;
  onCellChange: (row: number, col: number, value: string) => void;
}

/**
 * One grid row. Memoized so a keystroke in one cell reconciles that row only:
 * the page keeps every unedited row array by identity, and the comparator
 * treats an unchanged issue list as equal even when its objects were rebuilt.
 */
const GridRow = React.memo(
  function GridRow({ rowIndex: r, row, issues, rejected, focused, onCellChange }: GridRowProps) {
    const byCol = new Map<number | null, CellIssue[]>();
    for (const issue of issues) {
      const list = byCol.get(issue.col) ?? [];
      list.push(issue);
      byCol.set(issue.col, list);
    }
    const rowIssues = byCol.get(null) ?? NO_ISSUES;
    const rowSeverity = worstSeverity(rowIssues);
    const rowMessages = rowIssues.map((i) => i.message).join('\n');
    const rowClasses = [
      rejected ? 'rules-import__row--rejected' : '',
      rowSeverity === 'error' ? 'rules-import__row--error' : '',
      focused ? 'rules-import__row--focus' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <tr id={`rules-import-row-${r}`} className={rowClasses || undefined}>
        <td className="rules-import__col-line">{r + 1}</td>
        <td className="rules-import__col-status">
          {rowSeverity && (
            <span
              className={`rules-import__status-dot rules-import__status-dot--${rowSeverity}`}
              role="img"
              tabIndex={0}
              aria-label={`${SEVERITY_LABEL[rowSeverity]}: ${rowMessages}`}
              title={rowMessages}
            >
              {SEVERITY_GLYPH[rowSeverity]}
            </span>
          )}
        </td>
        {row.map((cell, c) => {
          const cellIssues = byCol.get(c) ?? NO_ISSUES;
          const severity = worstSeverity(cellIssues);
          const tooltip = cellIssues.map((i) => i.message).join('\n') || undefined;
          const inputClass = `rules-import__cell-input${severity ? ` rules-import__cell-input--${severity}` : ''}`;
          const options = ENUM_OPTIONS[c];
          // Accessible name: column + row, plus the issue text when there is one
          // (title alone is undefined for a clean cell, leaving the control unnamed).
          const label = `${RULE_CSV_COLUMNS[c]}, row ${r + 1}${tooltip ? `: ${tooltip}` : ''}`;

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
                  aria-label={label}
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
                  aria-label={label}
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
                aria-label={label}
                spellCheck={false}
              />
            </td>
          );
        })}
      </tr>
    );
  },
  (prev, next) =>
    prev.row === next.row &&
    prev.rowIndex === next.rowIndex &&
    prev.rejected === next.rejected &&
    prev.focused === next.focused &&
    prev.onCellChange === next.onCellChange &&
    sameIssues(prev.issues, next.issues)
);

export const RulesGrid: React.FC<RulesGridProps> = ({
  rows,
  issuesByRow,
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
            <th scope="col" className="rules-import__col-line" title="Data row number (the CSV header row is not counted)">Row</th>
            <th scope="col" className="rules-import__col-status" aria-label="Row status" />
            {RULE_CSV_COLUMNS.map((name) => (
              <th
                key={name}
                scope="col"
                className={WIDE_COLS.has((RULE_CSV_COLUMNS as readonly string[]).indexOf(name)) ? 'rules-import__col-wide' : undefined}
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRowIndexes.map((r) => (
            <GridRow
              key={r}
              rowIndex={r}
              row={rows[r]}
              issues={issuesByRow.get(r) ?? NO_ISSUES}
              rejected={highlightRowIndexes?.has(r) ?? false}
              focused={focusRowIndex === r}
              onCellChange={onCellChange}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RulesGrid;
