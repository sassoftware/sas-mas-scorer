// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Modal, Pagination, ProgressBar } from '../common';
import { FolderBrowser } from '../scoring/FolderBrowser';
import { useCasCatalog } from '../../hooks/useCasCatalog';
import { createScoreDefinition } from '../../api/scoreDefinitions';
import {
  casTableState,
  getAllTableRows,
  getTableColumns,
  saveTable,
  unloadCasTable,
  uploadToCas,
} from '../../api/cas';
import { pathNumber, type TreeIndex } from '../../utils/segTree/treeIndex';
import {
  buildTestRows,
  casTableName,
  compareResults,
  emptyCustomRow,
  EXPECTED_PREFIX,
  PATH_ID_COLUMN,
  scenarioPayload,
  tableTestPayload,
  testTableCsv,
  usedInputColumns,
  type SidTarget,
  type TestRow,
  type TestRunResults,
} from '../../utils/segTree/testRows';
import { readTestResults, runFailureText, runScoreDefinition, type RunFailure } from './runTreeTest';
import SegTreeRunFailure from './SegTreeRunFailure';

export interface TestRunSummary {
  testName: string;
  ranAt: string;
  outputTable: string;
  results: TestRunResults;
  /** Which tree revision the run scored, as shown to the user ("Ran against revision 1.3 (current)"). */
  revisionNote?: string;
}

interface SegTreeTestDialogProps {
  index: TreeIndex;
  /** What is being tested ("Path 12", "Outcome Scenario_75", "Whole tree"). */
  title: string;
  leafIds: string[];
  onClose: () => void;
  /**
   * A table test finished and its results should be shown on the tree. Called
   * as soon as the comparison is done, so closing the dialog in any way
   * (Done, X, Escape) keeps them.
   */
  onResults: (summary: TestRunSummary) => void;
  /** Select the first failed path on the tree (offered when a run has failures). */
  onShowFailure?: () => void;
}

type Step = 'rows' | 'save' | 'run';
type Mode = 'test' | 'scenarios';

const STORAGE_PREFIX = 'segtree-test:';
const loadPref = (key: string): string | null => {
  try { return localStorage.getItem(`${STORAGE_PREFIX}${key}`); } catch { return null; }
};
const savePref = (key: string, value: string): void => {
  try { localStorage.setItem(`${STORAGE_PREFIX}${key}`, value); } catch { /* private mode */ }
};

const PAGE_SIZE = 25;
const SAVE_CONCURRENCY = 4;
/** Each scenario run is its own SAS job; past this many a table test is the better tool. */
const SCENARIO_RUN_LIMIT = 25;
const RUN_CONCURRENCY = 2;
const NAME_INVALID_CHARS = /[/{}]/;

function validateName(name: string): string | null {
  if (!name.trim()) return 'Name is required';
  if (name.length > 100) return 'Name must be 100 characters or less';
  if (NAME_INVALID_CHARS.test(name)) return 'Name cannot contain /, {, or } characters';
  return null;
}

const message = (err: unknown, fallback: string) =>
  (err as { message?: string })?.message ?? fallback;

export default function SegTreeTestDialog({ index, title, leafIds, onClose, onResults, onShowFailure }: SegTreeTestDialogProps) {
  const generated = useMemo(() => buildTestRows(index, leafIds), [index, leafIds]);

  const [step, setStep] = useState<Step>('rows');
  const [rows, setRows] = useState<TestRow[]>(generated.rows);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(generated.rows.map((r) => r.key)));
  const [page, setPage] = useState(1);

  const [mode, setMode] = useState<Mode>(generated.rows.length === 1 ? 'scenarios' : 'test');
  const defaultName = `${index.tree.name} - ${title}`.replace(/[/{}]/g, '-').slice(0, 100);
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [tableName, setTableName] = useState(casTableName(defaultName));
  const [tableNameEdited, setTableNameEdited] = useState(false);
  const [replaceTable, setReplaceTable] = useState(false);
  const [runNow, setRunNow] = useState(true);

  const [folderId, setFolderId] = useState<string | null>(loadPref('lastFolderId'));
  const [folderName, setFolderName] = useState<string | null>(loadPref('lastFolderName'));
  const [server, setServer] = useState('');
  const [caslib, setCaslib] = useState('');
  const { servers, caslibs, loadingServers, loadingCaslibs, error: casError } = useCasCatalog(server);

  // Run state
  const [busy, setBusy] = useState(false);
  const [phase, setPhaseState] = useState('');
  // The step in progress, read by the error handler after an await.
  const phaseRef = useRef('');
  const setPhase = (p: string) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<TestRunSummary | null>(null);
  const [failure, setFailure] = useState<RunFailure | null>(null);
  const [created, setCreated] = useState<{ ok: number; failed: string[] } | null>(null);
  /** Scenarios that were created but whose run did not complete, with the reason. */
  const [runFailures, setRunFailures] = useState<string[]>([]);
  const stopRef = useRef(false);

  useEffect(() => {
    if (server || servers.length === 0) return;
    const saved = loadPref('lastServer');
    setServer(saved && servers.some((s) => s.name === saved) ? saved : servers[0].name);
  }, [servers, server]);

  useEffect(() => {
    if (caslibs.length === 0) {
      setCaslib('');
      return;
    }
    const saved = loadPref('lastCaslib');
    setCaslib(
      saved && caslibs.some((c) => c.name === saved)
        ? saved
        : (caslibs.find((c) => c.name.toLowerCase() === 'public')?.name ?? caslibs[0].name)
    );
  }, [caslibs]);

  // The table name follows the test name until the user types their own.
  useEffect(() => {
    if (!tableNameEdited) setTableName(casTableName(name));
  }, [name, tableNameEdited]);

  // ─── Row editing ───

  const { inputVariables, outputVariables } = generated;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((Math.min(page, totalPages) - 1) * PAGE_SIZE, Math.min(page, totalPages) * PAGE_SIZE);
  const selectedRows = rows.filter((r) => selected.has(r.key));
  const needsValues = rows.filter((r) => r.note).length;

  const updateCell = (key: string, kind: 'inputs' | 'expected', variable: string, value: string) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [kind]: { ...r[kind], [variable]: value } } : r)));
  };

  const addRow = () => {
    const row = emptyCustomRow();
    setRows((prev) => [...prev, row]);
    setSelected((prev) => new Set(prev).add(row.key));
    setPage(Math.ceil((rows.length + 1) / PAGE_SIZE));
  };

  const deleteRows = (keys: string[]) => {
    const drop = new Set(keys);
    setRows((prev) => prev.filter((r) => !drop.has(r.key)));
    setSelected((prev) => new Set([...prev].filter((k) => !drop.has(k))));
  };

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allSelected = rows.length > 0 && selected.size === rows.length;

  const reset = () => {
    setRows(generated.rows);
    setSelected(new Set(generated.rows.map((r) => r.key)));
    setPage(1);
  };

  // ─── Saving ───

  const nameError = validateName(name);
  const rowsForMode = mode === 'test' ? rows : selectedRows;
  const canSave =
    !busy && !nameError && !!folderId && !!server && !!caslib && rowsForMode.length > 0 &&
    (mode === 'scenarios' || tableName.trim() !== '');

  const target = (): SidTarget => ({
    serverName: server,
    caslibName: caslib,
    treeName: index.tree.name,
    treeRevisionUri: index.tree.revisionUri ?? `/decisions/segmentationTrees/${index.tree.id}/revisions/${index.tree.revisionId}`,
  });

  const rememberLocation = () => {
    if (folderId) savePref('lastFolderId', folderId);
    if (folderName) savePref('lastFolderName', folderName);
    savePref('lastServer', server);
    savePref('lastCaslib', caslib);
  };

  const runTableTest = async () => {
    const parentFolderUri = `/folders/folders/${folderId}`;
    const table = tableName.trim();
    const columns = usedInputColumns(generated, rows);

    setPhase('Checking the CAS table');
    const existing = await casTableState(server, caslib, table);
    if (existing !== 'none' && !replaceTable) {
      throw new Error(`A table named ${table} already exists in ${caslib}. Choose another table name or tick "Replace it".`);
    }
    // The save below overwrites a saved file of the same name; a loaded copy has to go first.
    if (existing === 'loaded') await unloadCasTable(server, caslib, table);

    setPhase(`Uploading ${rows.length.toLocaleString()} rows to ${caslib}.${table}`);
    const upload = await uploadToCas(server, caslib, table, testTableCsv(generated, rows));
    if (!upload.success) throw new Error(upload.error ?? 'Upload failed');
    try {
      await saveTable(server, caslib, table);
    } catch (err) {
      // The test still works while the table stays loaded.
      setNotice(`The table is loaded but could not be saved to the caslib (${message(err, 'unknown error')}); the test needs it reloaded after a CAS restart.`);
    }

    setPhase('Creating the test in SAS Intelligent Decisioning');
    const definition = await createScoreDefinition(
      tableTestPayload(name.trim(), description.trim() || undefined, table, columns, target()),
      parentFolderUri
    );
    rememberLocation();
    if (!runNow) {
      setPhase('Test created');
      return;
    }

    const outcome = await runScoreDefinition(definition.id, `Execution for ${name.trim()}`, () => stopRef.current, setPhase);
    if (outcome.kind === 'stopped') return;
    if (outcome.kind === 'failed') {
      // The error names the step that failed: the run itself, not the log read.
      setPhase('Running the test');
      setFailure(outcome.failure);
      throw new Error(runFailureText(outcome.failure));
    }

    setPhase('Reading the results');
    const out = outcome.execution.outputTable;
    const results = await readTestResults(out, outputVariables);
    const finishedRun: TestRunSummary = {
      testName: name.trim(),
      ranAt: new Date().toISOString(),
      outputTable: `${out.libraryName}.${out.tableName}`,
      results,
      revisionNote: 'Ran against the revision on screen',
    };
    setSummary(finishedRun);
    // Shown on the tree right away: however the dialog is closed now, the
    // comparison the user waited for stays.
    onResults(finishedRun);
    setPhase('Test finished');
  };

  const createScenarios = async () => {
    const parentFolderUri = `/folders/folders/${folderId}`;
    const base = name.trim();
    const desc = description.trim() || undefined;
    const list = selectedRows;
    let ok = 0;
    const failed: string[] = [];
    let customN = 0;
    // One scenario keeps the name as typed; several get a per-row suffix.
    const names = list.length === 1
      ? [base]
      : list.map((r) => (r.leafId ? `${base}_Path_${pathNumber(index, r.leafId)}` : `${base}_Custom_${++customN}`).slice(0, 100));

    setTotal(list.length);
    setDone(0);
    setPhase(`Creating ${list.length} scenario${list.length !== 1 ? 's' : ''}`);
    const definitionIds: (string | null)[] = new Array(list.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < list.length && !stopRef.current) {
        const i = next++;
        try {
          const definition = await createScoreDefinition(scenarioPayload(names[i], desc, list[i], generated, index, target()), parentFolderUri);
          definitionIds[i] = definition.id;
          ok += 1;
        } catch (err) {
          failed.push(`${names[i]}: ${message(err, 'failed')}`);
        }
        setDone((d) => d + 1);
      }
    };
    await Promise.all(Array.from({ length: Math.min(SAVE_CONCURRENCY, list.length) }, worker));
    rememberLocation();
    setCreated({ ok, failed });
    if (stopRef.current) {
      setPhase('Stopped');
      return;
    }
    if (!runNow || list.length > SCENARIO_RUN_LIMIT || ok === 0) {
      setPhase('Scenarios created');
      return;
    }
    await runScenarios(list, names, definitionIds);
  };

  // Run each new scenario in SAS Intelligent Decisioning, read its output row
  // and compare it with the row's expected values, the same way as a table test.
  const runScenarios = async (list: TestRow[], names: string[], definitionIds: (string | null)[]) => {
    const toRun = list.map((row, i) => ({ row, name: names[i], id: definitionIds[i] })).filter((s) => s.id);
    const actuals = new Map<string, Record<string, string>>();
    const outputTables: string[] = [];
    const problems: string[] = [];
    let lastFailure: RunFailure | null = null;

    setTotal(toRun.length);
    setDone(0);
    setPhase(`Running ${toRun.length} scenario${toRun.length !== 1 ? 's' : ''}`);
    let next = 0;
    const worker = async () => {
      while (next < toRun.length && !stopRef.current) {
        const s = toRun[next++];
        try {
          const outcome = await runScoreDefinition(s.id!, `Execution for ${s.name}`, () => stopRef.current, () => {});
          if (outcome.kind === 'completed') {
            const out = outcome.execution.outputTable;
            const [cols, data] = await Promise.all([
              getTableColumns(out.serverName, out.libraryName, out.tableName),
              getAllTableRows(out.serverName, out.libraryName, out.tableName),
            ]);
            const lower = cols.map((c) => c.name.toLowerCase());
            const first = data.rows[0] ?? [];
            const actual: Record<string, string> = {};
            for (const v of outputVariables) {
              const at = lower.indexOf(v.toLowerCase());
              actual[v] = at >= 0 ? String(first[at] ?? '') : '';
            }
            actuals.set(s.row.key, actual);
            outputTables.push(`${out.libraryName}.${out.tableName}`);
          } else if (outcome.kind === 'failed') {
            lastFailure = outcome.failure;
            problems.push(`${s.name}: ${runFailureText(outcome.failure)}`);
          }
        } catch (err) {
          problems.push(`${s.name}: ${message(err, 'the run could not be read')}`);
        }
        setDone((d) => d + 1);
      }
    };
    await Promise.all(Array.from({ length: Math.min(RUN_CONCURRENCY, toRun.length) }, worker));
    setRunFailures(problems);
    if (problems.length === 1 && lastFailure) setFailure(lastFailure);
    if (actuals.size === 0) {
      setPhase(stopRef.current ? 'Stopped' : 'Scenarios created');
      return;
    }

    // The same comparison as a table test: one row per scenario with its
    // actual outputs next to the row's expected values.
    const columns = [PATH_ID_COLUMN, ...outputVariables, ...outputVariables.map((v) => `${EXPECTED_PREFIX}${v}`)];
    const tableRows = toRun
      .filter((s) => actuals.has(s.row.key))
      .map((s) => {
        const key = s.row.key;
        const actual = actuals.get(key)!;
        return [key, ...outputVariables.map((v) => actual[v]), ...outputVariables.map((v) => s.row.expected[v] ?? '')];
      });
    const finishedRun: TestRunSummary = {
      testName: names.length === 1 ? names[0] : name.trim(),
      ranAt: new Date().toISOString(),
      outputTable: outputTables.length === 1 ? outputTables[0] : `${outputTables.length} output tables in ${caslib}`,
      results: compareResults(columns, tableRows, outputVariables),
      revisionNote: 'Ran against the revision on screen',
    };
    setSummary(finishedRun);
    onResults(finishedRun);
    setPhase('Scenarios finished');
  };

  const handleSave = async () => {
    if (!canSave) return;
    stopRef.current = false;
    setStep('run');
    setBusy(true);
    setError(null);
    setNotice(null);
    setSummary(null);
    setFailure(null);
    setCreated(null);
    setRunFailures([]);
    try {
      if (mode === 'test') await runTableTest();
      else await createScenarios();
    } catch (err) {
      setError(`${phaseRef.current ? `${phaseRef.current} failed: ` : ''}${message(err, 'Something went wrong')}`);
    } finally {
      setBusy(false);
    }
  };

  const handleClose = useCallback(() => {
    // Closing mid-run stops waiting; work already sent to the server continues there.
    stopRef.current = true;
    onClose();
  }, [onClose]);

  // ─── Rendering ───

  const rowsStep = (
    <div className="segtree-test">
      <p className="segtree-test__intro">
        One generated record per path. Each row's inputs take its path and its expected values are the
        outcome it should assign. Edit any cell, add your own rows, or delete rows you do not need.
      </p>
      {generated.shadowed.length > 0 && (
        <Alert variant="warning" title={`${generated.shadowed.length} unreachable path${generated.shadowed.length !== 1 ? 's' : ''} left out`}>
          Earlier branches already take every value these paths accept, so no record can reach them:{' '}
          {generated.shadowed.slice(0, 12).map((id) => `Path ${pathNumber(index, id)}`).join(', ')}
          {generated.shadowed.length > 12 ? ` and ${generated.shadowed.length - 12} more` : ''}.
        </Alert>
      )}
      {needsValues > 0 && (
        <Alert variant="info">
          {needsValues} row{needsValues !== 1 ? 's need' : ' needs'} a value this page could not work out; they are marked below.
        </Alert>
      )}

      <div className="segtree-test__toolbar">
        <Button variant="secondary" size="small" onClick={addRow}>Add row</Button>
        <Button variant="secondary" size="small" disabled={selected.size === 0} onClick={() => deleteRows([...selected])}>
          Delete selected
        </Button>
        <Button variant="tertiary" size="small" onClick={reset}>Reset to generated</Button>
        <span className="segtree-test__count" role="status">
          {rows.length.toLocaleString()} row{rows.length !== 1 ? 's' : ''} · {selected.size.toLocaleString()} selected
        </span>
      </div>

      <div className="segtree-test__grid-wrap">
        <table className="sas-table sas-table--compact segtree-test__grid">
          <thead className="sas-table__head">
            <tr>
              <th className="sas-table__th segtree-test__col-check">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.key)))}
                />
              </th>
              <th className="sas-table__th">Row</th>
              {inputVariables.map((v) => <th key={v} className="sas-table__th">{v}</th>)}
              {outputVariables.map((v) => (
                <th key={v} className="sas-table__th segtree-test__col-expected">expected {v}</th>
              ))}
              <th className="sas-table__th"><span className="sr-only">Delete</span></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.key} className={`sas-table__row${r.note ? ' segtree-test__row--attention' : ''}`}>
                <td className="sas-table__td segtree-test__col-check">
                  <input type="checkbox" aria-label={`Select ${r.label}`} checked={selected.has(r.key)} onChange={() => toggle(r.key)} />
                </td>
                <th scope="row" className="sas-table__td segtree-test__label">
                  {r.label}
                  {r.note && <span className="segtree-test__note">{r.note}</span>}
                </th>
                {inputVariables.map((v) => (
                  <td key={v} className="sas-table__td">
                    <input
                      className="sas-input segtree-test__cell"
                      value={r.inputs[v] ?? ''}
                      aria-label={`${r.label} ${v}`}
                      placeholder="missing"
                      onChange={(e) => updateCell(r.key, 'inputs', v, e.target.value)}
                    />
                  </td>
                ))}
                {outputVariables.map((v) => (
                  <td key={v} className="sas-table__td segtree-test__col-expected">
                    <input
                      className="sas-input segtree-test__cell"
                      value={r.expected[v] ?? ''}
                      aria-label={`${r.label} expected ${v}`}
                      placeholder="not checked"
                      onChange={(e) => updateCell(r.key, 'expected', v, e.target.value)}
                    />
                  </td>
                ))}
                <td className="sas-table__td">
                  <button type="button" className="segtree-test__delete" aria-label={`Delete ${r.label}`} title="Delete row" onClick={() => deleteRows([r.key])}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr className="sas-table__row">
                <td className="sas-table__td segtree-test__empty" colSpan={inputVariables.length + outputVariables.length + 3}>
                  No rows. Add one, or reset to the generated rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <Pagination page={Math.min(page, totalPages)} totalPages={totalPages} onPageChange={setPage} pageSize={PAGE_SIZE} totalItems={rows.length} label="Test row pages" />
      )}
    </div>
  );

  const saveStep = (
    <div className="save-scenario-dialog__fields">
      <fieldset className="segtree-test__modes">
        <legend className="save-scenario-dialog__label">Save as</legend>
        <label className="segtree-test__mode">
          <input type="radio" name="segtree-test-mode" checked={mode === 'test'} onChange={() => setMode('test')} />
          <span>
            <strong>{rows.length === 1 ? 'One table test with this row' : `One table test with all ${rows.length.toLocaleString()} rows`}</strong>
            <span className="save-scenario-dialog__hint">Uploads the rows as a CAS table and creates a test on it. It can run right away, with the results shown on the tree.</span>
          </span>
        </label>
        <label className="segtree-test__mode">
          <input type="radio" name="segtree-test-mode" checked={mode === 'scenarios'} onChange={() => setMode('scenarios')} />
          <span>
            <strong>{rows.length === 1 ? 'One scenario' : `One scenario per selected row (${selectedRows.length.toLocaleString()})`}</strong>
            <span className="save-scenario-dialog__hint">Each row becomes a scenario with its inputs and expected outputs. They can run right away, with the results shown on the tree, or later from the tree's Scenarios tab in SAS Intelligent Decisioning.</span>
          </span>
        </label>
      </fieldset>
      {mode === 'scenarios' && selectedRows.length > 50 && (
        <Alert variant="warning">
          This creates {selectedRows.length.toLocaleString()} separate scenarios. For this many rows a single table test is usually easier to manage.
        </Alert>
      )}

      <div className="save-scenario-dialog__field">
        <label className="save-scenario-dialog__label" htmlFor="segtree-test-name">
          {mode === 'test' ? 'Test name *' : selectedRows.length > 1 ? 'Scenario name prefix *' : 'Scenario name *'}
        </label>
        <input
          id="segtree-test-name"
          className="sas-input"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!nameError}
          aria-describedby="segtree-test-name-hint"
        />
        {nameError && <span className="save-scenario-dialog__field-error" role="alert">{nameError}</span>}
        <span className="save-scenario-dialog__hint" id="segtree-test-name-hint">
          {mode === 'scenarios' && selectedRows.length > 1 ? `Scenarios are named ${name.trim() || '…'}_Path_<n>.` : `${name.length}/100 characters`}
        </span>
      </div>

      <div className="save-scenario-dialog__field">
        <label className="save-scenario-dialog__label" htmlFor="segtree-test-desc">Description</label>
        <textarea id="segtree-test-desc" className="sas-textarea" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="save-scenario-dialog__field" role="group" aria-labelledby="segtree-test-folder-label">
        <span className="save-scenario-dialog__label" id="segtree-test-folder-label">SAS Content folder *</span>
        {folderName && <div className="save-scenario-dialog__selected-folder">Selected: {folderName}</div>}
        <div className="save-scenario-dialog__folder-section">
          <FolderBrowser
            selectedFolderId={folderId}
            onSelect={(id, n) => { setFolderId(id); setFolderName(n); }}
            initialFolderId={loadPref('lastFolderId')}
            ariaLabelledBy="segtree-test-folder-label"
          />
        </div>
      </div>

      <div className="segtree-test__cas">
        <div className="save-scenario-dialog__field">
          <label className="save-scenario-dialog__label" htmlFor="segtree-test-server">CAS server *</label>
          {loadingServers ? (
            <span className="save-scenario-dialog__loading-text">Loading servers...</span>
          ) : (
            <select id="segtree-test-server" className="sas-input" value={server} onChange={(e) => setServer(e.target.value)}>
              {servers.length === 0 && <option value="">No servers available</option>}
              {servers.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          )}
        </div>
        <div className="save-scenario-dialog__field">
          <label className="save-scenario-dialog__label" htmlFor="segtree-test-caslib">
            {mode === 'test' ? 'Caslib for the input and output tables *' : 'Caslib for scenario output *'}
          </label>
          {loadingCaslibs ? (
            <span className="save-scenario-dialog__loading-text">Loading caslibs...</span>
          ) : (
            <select id="segtree-test-caslib" className="sas-input" value={caslib} onChange={(e) => setCaslib(e.target.value)} disabled={!server}>
              {caslibs.length === 0 && <option value="">No caslibs available</option>}
              {caslibs.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {mode === 'test' && (
        <>
          <div className="save-scenario-dialog__field">
            <label className="save-scenario-dialog__label" htmlFor="segtree-test-table">Input table name *</label>
            <input
              id="segtree-test-table"
              className="sas-input"
              value={tableName}
              maxLength={100}
              onChange={(e) => { setTableName(e.target.value); setTableNameEdited(true); }}
            />
            <label className="segtree-test__check">
              <input type="checkbox" checked={replaceTable} onChange={(e) => setReplaceTable(e.target.checked)} />
              Replace it if a table with this name already exists
            </label>
          </div>
          <label className="segtree-test__check">
            <input type="checkbox" checked={runNow} onChange={(e) => setRunNow(e.target.checked)} />
            Run the test now and show the results on the tree
          </label>
        </>
      )}
      {mode === 'scenarios' && (
        selectedRows.length <= SCENARIO_RUN_LIMIT ? (
          <label className="segtree-test__check">
            <input type="checkbox" checked={runNow} onChange={(e) => setRunNow(e.target.checked)} />
            {selectedRows.length === 1 ? 'Run the scenario now' : `Run the ${selectedRows.length} scenarios now`} and show the results on the tree
          </label>
        ) : (
          <p className="save-scenario-dialog__hint">
            Each scenario runs as its own job, so running them from here is offered for up to {SCENARIO_RUN_LIMIT}. For more rows, a table test runs them all at once.
          </p>
        )
      )}

      {casError && <Alert variant="error">{casError}</Alert>}
    </div>
  );

  const runStep = (
    <div className="segtree-test__run">
      {busy && (
        <ProgressBar
          phase={phase}
          value={mode === 'scenarios' ? done : undefined}
          max={mode === 'scenarios' ? total : undefined}
          indeterminate={mode === 'test'}
          count={mode === 'scenarios' ? `${done} of ${total}` : undefined}
          label="Saving to SAS Intelligent Decisioning"
        />
      )}
      {!busy && error && <Alert variant="error" title="Stopped">{error}</Alert>}
      {notice && <Alert variant="warning">{notice}</Alert>}
      {!busy && !error && mode === 'test' && !summary && (
        <Alert variant="success">
          Test <strong>{name.trim()}</strong> created in {folderName ?? 'the selected folder'}, reading {caslib}.{tableName.trim()}. Run it from the tree's Tests tab in SAS Intelligent Decisioning.
        </Alert>
      )}
      {!busy && summary && (
        <div className="segtree-test__summary">
          <Alert variant={summary.results.failed > 0 ? 'warning' : 'success'} title={summary.results.failed > 0 ? 'Some paths failed' : 'All checked paths passed'}>
            {summary.results.passed.toLocaleString()} passed · {summary.results.failed.toLocaleString()} failed
            {summary.results.unchecked > 0 ? ` · ${summary.results.unchecked.toLocaleString()} without expected values` : ''}
            . Output table: <code>{summary.outputTable}</code>. The results are now shown on the tree and stay there when you close this dialog.
          </Alert>
        </div>
      )}
      {!busy && runFailures.length > 1 && (
        <Alert variant="warning" title={`${runFailures.length} scenario runs did not complete`}>
          <ul className="segtree-test__failures">
            {runFailures.slice(0, 10).map((f) => <li key={f}>{f}</li>)}
            {runFailures.length > 10 && <li>and {runFailures.length - 10} more</li>}
          </ul>
        </Alert>
      )}
      {!busy && failure && <SegTreeRunFailure failure={failure} treeId={index.tree.id} logFileName={casTableName(name)} />}
      {!busy && created && (
        <Alert variant={created.failed.length ? 'warning' : 'success'}>
          {created.ok} scenario{created.ok !== 1 ? 's' : ''} created in {folderName ?? 'the selected folder'}.
          {!summary && runFailures.length === 0 && ' Run them from the tree\'s Scenarios tab in SAS Intelligent Decisioning.'}
          {created.failed.length > 0 && (
            <ul className="segtree-test__failures">
              {created.failed.slice(0, 10).map((f) => <li key={f}>{f}</li>)}
              {created.failed.length > 10 && <li>and {created.failed.length - 10} more</li>}
            </ul>
          )}
        </Alert>
      )}
    </div>
  );

  const steps: Record<Step, React.ReactNode> = { rows: rowsStep, save: saveStep, run: runStep };

  const footer = (() => {
    if (step === 'rows') {
      return (
        <>
          <Button variant="tertiary" onClick={handleClose}>Cancel</Button>
          <Button variant="primary" disabled={rows.length === 0} onClick={() => setStep('save')}>Next</Button>
        </>
      );
    }
    if (step === 'save') {
      return (
        <>
          <Button variant="tertiary" onClick={() => setStep('rows')}>Back</Button>
          <Button variant="primary" disabled={!canSave} onClick={handleSave}>
            {mode === 'test'
              ? (runNow ? 'Create and run test' : 'Create test')
              : `${runNow && selectedRows.length <= SCENARIO_RUN_LIMIT ? 'Create and run' : 'Create'} ${selectedRows.length} scenario${selectedRows.length !== 1 ? 's' : ''}`}
          </Button>
        </>
      );
    }
    if (busy) {
      return <Button variant="tertiary" onClick={handleClose}>{mode === 'scenarios' ? 'Stop' : 'Close'}</Button>;
    }
    return (
      <>
        {error && <Button variant="tertiary" onClick={() => setStep('save')}>Back</Button>}
        {summary && summary.results.failed > 0 && onShowFailure && (
          <Button variant="secondary" onClick={() => { onClose(); onShowFailure(); }}>Close and show failed paths</Button>
        )}
        <Button variant="primary" onClick={onClose}>{summary ? 'Close and view on the tree' : 'Done'}</Button>
      </>
    );
  })();

  return (
    <Modal
      title={`Test: ${title}`}
      size="wide"
      onClose={handleClose}
      closeOnBackdropClick={!busy}
      footer={footer}
      className="segtree-test-dialog"
    >
      <ol className="segtree-test__steps" aria-label="Steps">
        {(['rows', 'save', 'run'] as const).map((s, i) => (
          <li key={s} className={`segtree-test__step${s === step ? ' segtree-test__step--current' : ''}`} aria-current={s === step ? 'step' : undefined}>
            {i + 1}. {s === 'rows' ? 'Review rows' : s === 'save' ? 'Save to SID' : 'Result'}
          </li>
        ))}
      </ol>
      {steps[step]}
    </Modal>
  );
}
