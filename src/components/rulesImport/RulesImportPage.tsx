// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Business Rules Import — upload a SAS Intelligent Decisioning rule-set CSV,
 * validate it client-side with per-cell highlighting, edit inline, run server
 * pre-flight checks (create vs update, folder existence), then import via
 * POST /businessRules/rules and map the multipart response back into the grid.
 * Rejected rule sets can be fixed and re-imported alone.
 *
 * UX: step-wizard flow (like the Schema → Code page) — one panel at a time
 * with a step nav on top.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../layout/Layout';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Alert } from '../common/Alert';
import { useSasAuth } from '../../auth';
import { RulesGrid } from './RulesGrid';
import { ImportConfirmDialog, ConfirmEntry } from './ImportConfirmDialog';
import { ImportResultPanel } from './ImportResultPanel';
import { parseCsv, serializeCsv, stripBom, downloadTextFile } from '../../utils/csv';
import {
  mapHeader,
  loadRows,
  groupRuleSets,
  validateRows,
  autoFixNormalizable,
} from '../../utils/rulesImport/validate';
import { interpretImportResponse } from '../../utils/rulesImport/multipart';
import { postRulesCsv, runPreflight } from '../../api/businessRulesImport';
import { COL, ROWS_PER_PAGE } from '../../utils/rulesImport/constants';
import {
  RULE_CSV_COLUMNS,
  CellIssue,
  HeaderMapResult,
  ImportOutcome,
  ImportPhase,
  PreflightState,
} from '../../types/rulesImport';

const HEADER_LINE = RULE_CSV_COLUMNS.join(',');

type WizardStep = 'upload' | 'review' | 'checks' | 'import';

export const RulesImportPage: React.FC = () => {
  const { isAuthenticated } = useSasAuth();

  const [activeStep, setActiveStep] = useState<WizardStep>('upload');
  const [fileName, setFileName] = useState<string | null>(null);
  const [headerMap, setHeaderMap] = useState<HeaderMapResult | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [fileIssues, setFileIssues] = useState<CellIssue[]>([]);
  const [preflight, setPreflight] = useState<PreflightState | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [retryScope, setRetryScope] = useState<number[] | null>(null);
  const [phase, setPhase] = useState<ImportPhase>('empty');
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editedRows, setEditedRows] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);
  const [onlyIssueRows, setOnlyIssueRows] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Cell targeted by "Next error" — highlighted, scrolled into view (both
  // axes), and given keyboard focus. The nonce re-triggers the scroll even
  // when the same target is hit again.
  const [focusTarget, setFocusTarget] = useState<{ row: number; col: number | null; nonce: number } | null>(null);
  const lastErrorJumpRef = useRef<number>(-1);

  // ---- Derived validation state ----
  const clientIssues = useMemo(() => [...fileIssues, ...validateRows(rows)], [rows, fileIssues]);
  const groups = useMemo(() => groupRuleSets(rows), [rows]);
  const groupSignature = useMemo(() => JSON.stringify(groups.map((g) => g.key).sort()), [groups]);
  const preflightStale = preflight !== null && preflight.forSignature !== groupSignature;
  const serverIssues = useMemo(() => outcome?.serverIssues ?? [], [outcome]);

  // Rule sets whose CSV ruleset_id differs from the id of the rule set that
  // already exists in the target folder — the service rejects those with 400
  // (it tries to CREATE under the unknown id and collides with the name).
  const idConflicts = useMemo(() => {
    if (preflight === null || preflightStale) return [];
    return groups.filter((group) => {
      const result = preflight.results.find((r) => r.key === group.key);
      return (
        result?.action === 'update' &&
        result.existingRuleSetId !== undefined &&
        group.rulesetId !== null &&
        group.rulesetId.toLowerCase() !== result.existingRuleSetId.toLowerCase()
      );
    });
  }, [groups, preflight, preflightStale]);

  const idConflictIssues = useMemo(
    (): CellIssue[] =>
      idConflicts.map((group) => ({
        ruleId: 'P-06',
        row: group.rowIndexes[0],
        col: COL.RULESET_ID,
        severity: 'error',
        source: 'preflight',
        message:
          'ruleset_id does not match the rule set that already exists in this folder — the service rejects the import. Clear the ids to update it by name.',
        ruleSetKey: group.key,
      })),
    [idConflicts]
  );

  const allIssues = useMemo(
    () => [
      ...clientIssues,
      ...(preflight !== null && !preflightStale ? preflight.issues : []),
      ...idConflictIssues,
      ...serverIssues,
    ],
    [clientIssues, preflight, preflightStale, idConflictIssues, serverIssues]
  );

  const issuesByCell = useMemo(() => {
    const index = new Map<string, CellIssue[]>();
    for (const issue of allIssues) {
      if (issue.row < 0) continue;
      const key = issue.col === null ? `${issue.row}:*` : `${issue.row}:${issue.col}`;
      const list = index.get(key) ?? [];
      list.push(issue);
      index.set(key, list);
    }
    return index;
  }, [allIssues]);

  const fileLevelIssues = useMemo(() => allIssues.filter((i) => i.row < 0), [allIssues]);

  const counts = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    for (const issue of allIssues) {
      if (issue.severity === 'error') errors++;
      else if (issue.severity === 'warning') warnings++;
      else infos++;
    }
    return { errors, warnings, infos };
  }, [allIssues]);

  const scopeSet = useMemo(() => (retryScope === null ? null : new Set(retryScope)), [retryScope]);

  /** Client errors that block the next import (file-level always counts; row-level only within scope). */
  const scopedErrorCount = useMemo(
    () =>
      clientIssues.filter(
        (i) => i.severity === 'error' && (i.row < 0 || scopeSet === null || scopeSet.has(i.row))
      ).length,
    [clientIssues, scopeSet]
  );

  const rowsWithIssues = useMemo(() => {
    const set = new Set<number>();
    for (const issue of allIssues) {
      if (issue.row >= 0) set.add(issue.row);
    }
    return set;
  }, [allIssues]);

  const errorRows = useMemo(() => {
    const set = new Set<number>();
    for (const issue of allIssues) {
      if (issue.row >= 0 && issue.severity === 'error') set.add(issue.row);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [allIssues]);

  // Filtered (unpaged) row list, then the current page slice
  const filteredRowIndexes = useMemo(() => {
    const all = rows.map((_, i) => i);
    return onlyIssueRows ? all.filter((i) => rowsWithIssues.has(i)) : all;
  }, [rows, onlyIssueRows, rowsWithIssues]);

  const pageCount = Math.max(1, Math.ceil(filteredRowIndexes.length / ROWS_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRowIndexes = useMemo(
    () => filteredRowIndexes.slice(currentPage * ROWS_PER_PAGE, (currentPage + 1) * ROWS_PER_PAGE),
    [filteredRowIndexes, currentPage]
  );

  const scopeGroups = useMemo(
    () => (scopeSet === null ? groups : groups.filter((g) => g.rowIndexes.some((r) => scopeSet.has(r)))),
    [groups, scopeSet]
  );

  const scopeLabel =
    retryScope === null
      ? `all ${groups.length} rule set${groups.length === 1 ? '' : 's'}`
      : `${scopeGroups.length} previously rejected rule set${scopeGroups.length === 1 ? '' : 's'}`;

  const scopedIdConflictCount = useMemo(
    () => idConflicts.filter((g) => scopeSet === null || g.rowIndexes.some((r) => scopeSet.has(r))).length,
    [idConflicts, scopeSet]
  );

  const importBlockedReason = useMemo((): string | null => {
    if (rows.length === 0) return 'Upload a CSV file first.';
    if (scopedErrorCount > 0)
      return `Fix ${scopedErrorCount} validation error${scopedErrorCount === 1 ? '' : 's'} before importing.`;
    if (!isAuthenticated) return 'Log in to run server checks and import.';
    if (preflight === null || preflightStale) return 'Run server checks before importing.';
    if (scopedIdConflictCount > 0)
      return `Resolve ${scopedIdConflictCount} ruleset_id conflict${scopedIdConflictCount === 1 ? '' : 's'} — use "Clear conflicting IDs" in Server Checks.`;
    if (phase === 'importing' || phase === 'preflighting') return 'Please wait…';
    return null;
  }, [rows.length, scopedErrorCount, isAuthenticated, preflight, preflightStale, scopedIdConflictCount, phase]);

  // ---- File loading ----
  const resetForNewFile = useCallback(() => {
    setPreflight(null);
    setOutcome(null);
    setRetryScope(null);
    setEditedRows(new Set());
    setPage(0);
    setOnlyIssueRows(false);
    setGlobalError(null);
    setNotice(null);
    setFocusTarget(null);
    lastErrorJumpRef.current = -1;
  }, []);

  const handleFile = useCallback(async (file: File) => {
    try {
      const text = stripBom(await file.text());
      const parsed = parseCsv(text);
      resetForNewFile();
      setFileName(file.name);
      if (parsed.length === 0) {
        setHeaderMap(null);
        setRows([]);
        setFileIssues([{ ruleId: 'F-01', row: -1, col: null, severity: 'error', source: 'client', message: 'File is empty or has no data rows.' }]);
        setPhase('empty');
        setActiveStep('upload');
        return;
      }
      const map = mapHeader(parsed[0]);
      setHeaderMap(map);
      if (!map.ok) {
        setRows([]);
        setFileIssues(map.issues);
        setPhase('empty');
        setActiveStep('upload');
        return;
      }
      const loaded = loadRows(parsed, map, parsed[0].length);
      setRows(loaded.rows);
      setFileIssues([...map.issues, ...loaded.issues]);
      if (loaded.rows.length > 0) {
        setPhase('editing');
        setActiveStep('review');
      } else {
        setPhase('empty');
        setActiveStep('upload');
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to read the file.');
    }
  }, [resetForNewFile]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = '';
    },
    [handleFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleStartOver = () => {
    resetForNewFile();
    setFileName(null);
    setHeaderMap(null);
    setRows([]);
    setFileIssues([]);
    setPhase('empty');
    setActiveStep('upload');
  };

  // ---- Editing ----
  const handleCellChange = useCallback((row: number, col: number, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === row ? r.map((cell, c) => (c === col ? value : cell)) : r)));
    setEditedRows((prev) => {
      if (prev.has(row)) return prev;
      const next = new Set(prev);
      next.add(row);
      return next;
    });
  }, []);

  const handleAutoFix = () => {
    const result = autoFixNormalizable(rows);
    if (result.fixed > 0) {
      setRows(result.rows);
      setNotice(`Normalized formatting on ${result.fixed} row${result.fixed === 1 ? '' : 's'}.`);
    } else {
      setNotice('Nothing to normalize.');
    }
  };

  /** Rows still carrying a ruleset_id or rule_id from the environment they were exported from. */
  const rowsWithIds = rows.reduce(
    (n, row) => (row[COL.RULESET_ID].trim() !== '' || row[COL.RULE_ID].trim() !== '' ? n + 1 : n),
    0
  );

  /**
   * Blank both id columns across the file. A CSV exported from one environment carries
   * that environment's ids; elsewhere they match nothing, so the service tries to CREATE
   * a rule set whose name + folder already exists and rejects the import with a 400.
   * Without ids the import matches by name + folder and updates in place.
   */
  const handleClearAllIds = () => {
    const affected = new Set<number>();
    rows.forEach((row, i) => {
      if (row[COL.RULESET_ID].trim() !== '' || row[COL.RULE_ID].trim() !== '') affected.add(i);
    });
    if (affected.size === 0) {
      setNotice('No ids to clear.');
      return;
    }
    setRows((prev) =>
      prev.map((row, i) =>
        affected.has(i)
          ? row.map((cell, c) => (c === COL.RULESET_ID || c === COL.RULE_ID ? '' : cell))
          : row
      )
    );
    setEditedRows((prev) => new Set([...prev, ...affected]));
    setNotice(`Cleared ids on ${affected.size} row${affected.size === 1 ? '' : 's'}.`);
  };

  /**
   * Clear ruleset_id/rule_id on all rows of conflicted rule sets so the
   * import matches the existing rule set by name + folder and updates it.
   */
  const handleClearConflictIds = () => {
    const affected = new Set<number>();
    idConflicts.forEach((group) => group.rowIndexes.forEach((r) => affected.add(r)));
    if (affected.size === 0) return;
    setRows((prev) =>
      prev.map((row, i) =>
        affected.has(i)
          ? row.map((cell, c) => (c === COL.RULESET_ID || c === COL.RULE_ID ? '' : cell))
          : row
      )
    );
    setEditedRows((prev) => new Set([...prev, ...affected]));
    setNotice(`Cleared ids on ${affected.size} row${affected.size === 1 ? '' : 's'}.`);
  };

  const handleJumpToNextError = () => {
    if (errorRows.length === 0) return;
    const next = errorRows.find((r) => r > lastErrorJumpRef.current) ?? errorRows[0];
    lastErrorJumpRef.current = next;
    const positionSource = onlyIssueRows ? filteredRowIndexes : rows.map((_, i) => i);
    const position = positionSource.indexOf(next);
    if (position >= 0) setPage(Math.floor(position / ROWS_PER_PAGE));
    // First error cell of the row (row-level issues have col null → row scroll only)
    const firstErrorCol = allIssues
      .filter((i) => i.row === next && i.severity === 'error' && i.col !== null)
      .reduce<number | null>((min, i) => (min === null || (i.col as number) < min ? (i.col as number) : min), null);
    setFocusTarget((prev) => ({ row: next, col: firstErrorCol, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  // Scroll to the focused cell AFTER the (possibly new) page has rendered —
  // a timeout-based scroll races the re-render and can fire on the old page.
  // The cell also receives keyboard focus so the user can type the fix.
  useEffect(() => {
    if (focusTarget === null) return;
    const cellEl =
      focusTarget.col !== null
        ? document.getElementById(`rules-import-cell-${focusTarget.row}-${focusTarget.col}`)
        : null;
    if (cellEl) {
      cellEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      if (cellEl instanceof HTMLInputElement) {
        cellEl.focus({ preventScroll: true });
        cellEl.select();
      } else if (cellEl instanceof HTMLSelectElement) {
        cellEl.focus({ preventScroll: true });
      }
    } else {
      document
        .getElementById(`rules-import-row-${focusTarget.row}`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [focusTarget]);

  // ---- Downloads ----
  const baseName = (fileName ?? 'rules').replace(/\.csv$/i, '');
  const handleDownloadCorrected = () => {
    downloadTextFile(serializeCsv([[...RULE_CSV_COLUMNS], ...rows]), `${baseName}-corrected.csv`);
  };
  const handleDownloadRejected = () => {
    if (!outcome) return;
    const rejectedRows = outcome.rejectedRowIndexes.map((r) => rows[r]).filter(Boolean);
    downloadTextFile(serializeCsv([[...RULE_CSV_COLUMNS], ...rejectedRows]), `${baseName}-rejected.csv`);
  };
  const handleDownloadResponse = () => {
    if (!outcome) return;
    downloadTextFile(outcome.rawResponse, `${baseName}-import-response.txt`, 'text/plain;charset=utf-8;');
  };
  const handleDownloadTemplate = () => {
    downloadTextFile(`${HEADER_LINE}\r\n`, 'rule-set-template.csv');
  };

  // ---- Server pre-flight ----
  const handleRunPreflight = async () => {
    setPhase('preflighting');
    setGlobalError(null);
    try {
      const state = await runPreflight(groups, groupSignature);
      setPreflight(state);
      setPhase('ready');
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Server checks failed.');
      setPhase('editing');
    }
  };

  /** "Continue to server checks" also kicks the checks off when they're needed. */
  const handleContinueToChecks = () => {
    setActiveStep('checks');
    if (isAuthenticated && (preflight === null || preflightStale) && phase !== 'preflighting') {
      handleRunPreflight();
    }
  };

  // ---- Import ----
  const confirmEntries = useMemo((): ConfirmEntry[] => {
    return scopeGroups.map((group) => {
      const result = preflight?.results.find((r) => r.key === group.key);
      return {
        name: group.name,
        folderPath: group.folderPath,
        action: result?.action ?? 'unknown',
        existingRevision: result?.existingRevision,
      };
    });
  }, [scopeGroups, preflight]);

  const handleConfirmImport = async () => {
    setPhase('importing');
    setGlobalError(null);
    const scope = retryScope;
    const sentRows = scope === null ? rows : scope.map((r) => rows[r]).filter(Boolean);
    const csv = serializeCsv([[...RULE_CSV_COLUMNS], ...sentRows]);
    try {
      const { raw, contentType, status } = await postRulesCsv(csv);
      const result = interpretImportResponse(raw, contentType, rows, scope, status);
      setOutcome(result);
      setRetryScope(result.rejectedRowIndexes.length > 0 ? result.rejectedRowIndexes : null);
      setEditedRows(new Set());
      setPhase('imported');
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Import failed.');
      setPhase('ready');
    }
  };

  const hasRows = rows.length > 0;
  const importing = phase === 'importing';
  const preflighting = phase === 'preflighting';
  const preflightFresh = preflight !== null && !preflightStale;
  const totalRules = groups.reduce((sum, g) => sum + g.ruleCount, 0);

  return (
    <div className="rules-import">
      <PageHeader
        title="Business Rules Import"
        subtitle="Upload a SAS Intelligent Decisioning rule-set CSV, validate and fix it, then import it into SAS Viya."
        actions={
          <Button variant="secondary" size="small" onClick={handleDownloadTemplate}>
            Download template
          </Button>
        }
      />

      <nav className="rules-import__steps">
        <button
          className={`rules-import__step${activeStep === 'upload' ? ' rules-import__step--active' : ''}`}
          onClick={() => setActiveStep('upload')}
          type="button"
        >
          1. Upload
        </button>
        <button
          className={`rules-import__step${activeStep === 'review' ? ' rules-import__step--active' : ''}`}
          onClick={() => setActiveStep('review')}
          disabled={!hasRows}
          type="button"
        >
          2. Review &amp; Fix{hasRows ? ` (${rows.length})` : ''}
        </button>
        <button
          className={`rules-import__step${activeStep === 'checks' ? ' rules-import__step--active' : ''}`}
          onClick={() => setActiveStep('checks')}
          disabled={!hasRows}
          type="button"
        >
          3. Server Checks
        </button>
        <button
          className={`rules-import__step${activeStep === 'import' ? ' rules-import__step--active' : ''}`}
          onClick={() => setActiveStep('import')}
          disabled={!hasRows}
          type="button"
        >
          4. Import
        </button>
      </nav>

      {globalError && (
        <Alert variant="error" dismissible onClose={() => setGlobalError(null)}>
          {globalError}
        </Alert>
      )}

      {/* 1 · Upload */}
      {activeStep === 'upload' && (
        <div className="rules-import__panel">
          <div
            className={`rules-import__dropzone${dragOver ? ' rules-import__dropzone--active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="rules-import__file-input"
              id="rules-import-file-input"
            />
            <label htmlFor="rules-import-file-input" className="rules-import__file-label">
              Choose a CSV file
            </label>
            <span className="rules-import__dropzone-hint">or drag &amp; drop it here</span>
          </div>
          {fileName && (
            <div className="rules-import__file-summary">
              <strong>{fileName}</strong>
              {hasRows && (
                <span>
                  {' — '}{rows.length} row{rows.length === 1 ? '' : 's'}, {groups.length} rule set
                  {groups.length === 1 ? '' : 's'}, {totalRules} rule{totalRules === 1 ? '' : 's'}
                </span>
              )}
              {headerMap?.hasReasonColumn && (
                <span className="rules-import__file-note"> (rejection-reason column detected and ignored)</span>
              )}
            </div>
          )}
          {fileLevelIssues.length > 0 && (
            <div className="rules-import__file-issues">
              {fileLevelIssues.map((issue, i) => (
                <Alert key={`${issue.ruleId}-${i}`} variant={issue.severity}>
                  {issue.message}
                </Alert>
              ))}
            </div>
          )}
          {hasRows && (
            <div className="rules-import__panel-actions">
              <Button variant="tertiary" size="small" onClick={handleStartOver}>
                Start over
              </Button>
              <Button variant="primary" onClick={() => setActiveStep('review')}>
                Review &amp; fix rows
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 2 · Review & Fix */}
      {activeStep === 'review' && hasRows && (
        <div className="rules-import__panel">
          <div className="rules-import__panel-header">
            <div className="rules-import__panel-header-left">
              <Badge variant={counts.errors > 0 ? 'error' : 'success'}>
                {counts.errors} error{counts.errors === 1 ? '' : 's'}
              </Badge>
              <Badge variant={counts.warnings > 0 ? 'warning' : 'default'}>
                {counts.warnings} warning{counts.warnings === 1 ? '' : 's'}
              </Badge>
              <Badge variant="info">{counts.infos} info</Badge>
              <label className="rules-import__filter-toggle">
                <input
                  type="checkbox"
                  checked={onlyIssueRows}
                  onChange={(e) => {
                    setOnlyIssueRows(e.target.checked);
                    setPage(0);
                  }}
                />
                <span>Only rows with issues</span>
              </label>
              {errorRows.length > 0 && (
                <Button variant="tertiary" size="small" onClick={handleJumpToNextError}>
                  Next error →
                </Button>
              )}
              {notice && <span className="rules-import__notice">{notice}</span>}
            </div>
            <div className="rules-import__panel-header-right">
              <Button
                variant="tertiary"
                size="small"
                onClick={handleClearAllIds}
                disabled={rowsWithIds === 0}
                title={
                  rowsWithIds === 0
                    ? 'The ruleset_id and rule_id columns are already empty.'
                    : 'Blank ruleset_id and rule_id so the import matches rule sets by name and folder. Required when the CSV was exported from another environment.'
                }
              >
                Clear ID columns{rowsWithIds > 0 ? ` (${rowsWithIds})` : ''}
              </Button>
              <Button variant="tertiary" size="small" onClick={handleAutoFix}>
                Auto-fix formatting
              </Button>
              <Button variant="secondary" size="small" onClick={handleDownloadCorrected}>
                Download corrected CSV
              </Button>
              <Button variant="primary" size="small" onClick={handleContinueToChecks}>
                Continue to server checks
              </Button>
            </div>
          </div>

          <RulesGrid
            rows={rows}
            issuesByCell={issuesByCell}
            visibleRowIndexes={visibleRowIndexes}
            onCellChange={handleCellChange}
            highlightRowIndexes={scopeSet ?? undefined}
            focusRowIndex={focusTarget?.row ?? null}
          />

          {pageCount > 1 && (
            <div className="rules-import__pager">
              <Button
                variant="tertiary"
                size="small"
                onClick={() => setPage(Math.max(0, currentPage - 1))}
                disabled={currentPage === 0}
              >
                ← Previous
              </Button>
              <span>
                Page {currentPage + 1} of {pageCount} ({filteredRowIndexes.length} rows)
              </span>
              <Button
                variant="tertiary"
                size="small"
                onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
                disabled={currentPage >= pageCount - 1}
              >
                Next →
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 3 · Server Checks */}
      {activeStep === 'checks' && hasRows && (
        <div className="rules-import__panel">
          <div className="rules-import__panel-header">
            <div className="rules-import__panel-header-left">
              <span className="rules-import__count">
                Checks whether each rule set already exists (import updates it) and whether its target folder exists
                (missing folders are created automatically).
              </span>
            </div>
            <div className="rules-import__panel-header-right">
              <Button variant="secondary" size="small" onClick={() => setActiveStep('review')}>
                Back to review
              </Button>
              <Button
                variant={preflightFresh ? 'secondary' : 'primary'}
                size="small"
                onClick={handleRunPreflight}
                loading={preflighting}
                disabled={!isAuthenticated || preflighting || importing}
                title={!isAuthenticated ? 'Log in to run server checks' : undefined}
              >
                {preflightFresh ? 'Run checks again' : 'Run server checks'}
              </Button>
              <Button
                variant="primary"
                size="small"
                onClick={() => setActiveStep('import')}
                disabled={!preflightFresh}
                title={!preflightFresh ? 'Run the server checks first' : undefined}
              >
                Continue to import
              </Button>
            </div>
          </div>

          {!isAuthenticated && (
            <Alert variant="info">Log in to check which rule sets and folders already exist on the server.</Alert>
          )}
          {preflightStale && (
            <Alert variant="warning">Rule set names or folder paths changed since the last check — run the server checks again.</Alert>
          )}
          {idConflicts.length > 0 && (
            <Alert variant="error" title={`ruleset_id conflict in ${idConflicts.length} rule set${idConflicts.length === 1 ? '' : 's'}`}>
              <p className="rules-import__conflict-text">
                The file carries ruleset_id values from a different environment than the rule set{idConflicts.length === 1 ? '' : 's'} already
                in the target folder ({idConflicts.map((g) => g.name).join(', ')}). The service rejects such imports.
                Clearing the ids makes the import match by name and folder and update the existing rule set{idConflicts.length === 1 ? '' : 's'}.
              </p>
              <Button variant="secondary" size="small" onClick={handleClearConflictIds}>
                Clear conflicting IDs
              </Button>
            </Alert>
          )}
          {preflight && !preflightStale && (
            <table className="rules-import__preflight-table">
              <thead>
                <tr>
                  <th>Rule set</th>
                  <th>Folder</th>
                  <th>Folder exists</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {preflight.results.map((result) => (
                  <tr key={result.key}>
                    <td>{result.name}</td>
                    <td className="rules-import__preflight-folder">{result.folderPath}</td>
                    <td>
                      {result.folderExists === null ? '?' : result.folderExists ? 'yes' : 'no (will be created)'}
                    </td>
                    <td>
                      <Badge
                        variant={result.action === 'create' ? 'success' : result.action === 'update' ? 'warning' : 'default'}
                        size="small"
                      >
                        {result.action.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="rules-import__preflight-details">
                      {result.action === 'update' && result.existingRevision && `current revision ${result.existingRevision}`}
                      {result.checkError && ` ${result.checkError}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 4 · Import */}
      {activeStep === 'import' && hasRows && (
        <div className="rules-import__panel">
          <div className="rules-import__panel-header">
            <div className="rules-import__panel-header-left">
              <span className="rules-import__scope-line">
                Will send <strong>{scopeLabel}</strong>
                {retryScope !== null && (
                  <>
                    {' — '}
                    <button className="rules-import__link-button" onClick={() => setRetryScope(null)} type="button">
                      import everything instead
                    </button>
                  </>
                )}
              </span>
            </div>
            <div className="rules-import__panel-header-right">
              <Button variant="secondary" size="small" onClick={() => setActiveStep('checks')}>
                Back to server checks
              </Button>
              <Button
                variant="primary"
                onClick={() => setPhase('confirming')}
                loading={importing}
                disabled={importBlockedReason !== null}
                title={importBlockedReason ?? undefined}
              >
                Import…
              </Button>
            </div>
          </div>

          {importBlockedReason && <p className="rules-import__blocked-hint">{importBlockedReason}</p>}

          {outcome && (
            <ImportResultPanel
              outcome={outcome}
              groups={groups}
              editedRows={editedRows}
              onRetryRejected={() => setPhase('confirming')}
              onDownloadRejected={handleDownloadRejected}
              onDownloadResponse={handleDownloadResponse}
              retryDisabledReason={importBlockedReason}
            />
          )}
        </div>
      )}

      {phase === 'confirming' && (
        <ImportConfirmDialog
          entries={confirmEntries}
          scopeLabel={scopeLabel}
          onConfirm={handleConfirmImport}
          onCancel={() => setPhase(preflightFresh ? 'ready' : 'editing')}
        />
      )}
    </div>
  );
};

export default RulesImportPage;
