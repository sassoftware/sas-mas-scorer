// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Modal } from '../common/Modal';
import { ProgressBar } from '../common/ProgressBar';
import { StatusBadge } from '../common/Badge';
import { FolderBrowser } from './FolderBrowser';
import { useCasCatalog } from '../../hooks/useCasCatalog';
import {
  createScoreDefinition,
  ScoreDefinitionMapping,
  TestScoreDefinitionPayload,
} from '../../api/scoreDefinitions';
import { DecisionSignatureVariable } from '../../api/modules';
import { Module, StepParameter } from '../../types';
import { CasTableTestInfo } from './CasTableScore';
import { buildNameLookup, loadPref, savePref, validateName } from './scoreDefinitionHelpers';
import { ScoreExecution } from '../../api/scoreExecution';
import { OutputTableSize, getOutputTableSize, runScoreTest } from '../../api/scoreTests';
import { getFileText } from '../../api/files';
import { LogExcerpt, logExcerpt } from '../../utils/segTree/runLog';

/** What a "Run now" did: the execution, and either its output table size or why it failed. */
interface TestRun {
  phase: 'running' | 'reading' | 'done';
  execution?: ScoreExecution;
  size?: OutputTableSize;
  /** The request itself failed (no execution to show) */
  error?: string;
  /** Lines of the run log that explain a failed run */
  excerpt?: LogExcerpt;
  logError?: string;
  /** The user stopped waiting; the run continues on the server */
  stoppedWaiting?: boolean;
}

// --- Types ---

interface SaveTestDialogProps {
  module: Module;
  sourceURI: string;
  casTableInfo: CasTableTestInfo;
  inputParameters: StepParameter[];
  /** Decision signature, resolved once by ScorePanel and passed down. */
  decisionSignature: DecisionSignatureVariable[];
  onClose: () => void;
}

// --- Component ---

export const SaveTestDialog: React.FC<SaveTestDialogProps> = ({
  module,
  sourceURI,
  casTableInfo,
  inputParameters,
  decisionSignature,
  onClose,
}) => {
  // Form state
  const [name, setName] = useState(`${module.name}_Test`);
  const [description, setDescription] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Folder state
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    loadPref('lastFolderId')
  );
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(
    loadPref('lastFolderName')
  );

  // CAS output library state — the catalogue itself comes from the shared
  // session cache; only the two selections live here.
  const [selectedServer, setSelectedServer] = useState('');
  const [selectedCaslib, setSelectedCaslib] = useState('');
  const {
    servers,
    caslibs,
    loadingServers,
    loadingCaslibs,
    error: casError,
  } = useCasCatalog(selectedServer);

  // Save state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Run the test right after saving it, and what that run did
  const [runNow, setRunNow] = useState(true);
  const [definitionId, setDefinitionId] = useState<string | null>(null);
  const [testRun, setTestRun] = useState<TestRun | null>(null);
  const stopRef = useRef(false);
  const testRunning = testRun !== null && testRun.phase !== 'done';

  // Closing the dialog stops the polling (not the run on the server)
  useEffect(() => () => {
    stopRef.current = true;
  }, []);

  // Restore the last server, else the first one offered.
  useEffect(() => {
    if (selectedServer || servers.length === 0) return;
    const saved = loadPref('lastServer');
    setSelectedServer(saved && servers.some(s => s.name === saved) ? saved : servers[0].name);
  }, [servers, selectedServer]);

  // Restore the last caslib, else Public, else the first one.
  useEffect(() => {
    if (caslibs.length === 0) {
      setSelectedCaslib('');
      return;
    }
    const saved = loadPref('lastCaslib');
    setSelectedCaslib(
      saved && caslibs.some(c => c.name === saved)
        ? saved
        : (caslibs.find(c => c.name.toLowerCase() === 'public')?.name ?? caslibs[0].name)
    );
  }, [caslibs]);

  const handleFolderSelect = useCallback((folderId: string, folderName: string) => {
    setSelectedFolderId(folderId);
    setSelectedFolderName(folderName);
  }, []);

  // Validation
  const nameError = useMemo(() => validateName(name), [name]);
  const descriptionTooLong = description.length > 1000;

  const mappedCount = inputParameters.filter(p => casTableInfo.columnMappings[p.name]).length;
  const canSave = !nameError && !descriptionTooLong && selectedFolderId && selectedServer && selectedCaslib && !saving && mappedCount > 0;

  // Run a saved test: the execution id from the create call is polled (past
  // runs cannot be looked up by definition), then the output table is sized.
  // The rows are not read or compared here.
  const runTest = useCallback(async (id: string, testName: string) => {
    stopRef.current = false;
    setTestRun({ phase: 'running' });
    try {
      const execution = await runScoreTest(id, testName, () => stopRef.current);
      if (stopRef.current) {
        setTestRun({ phase: 'done', execution, stoppedWaiting: true });
        return;
      }
      if (execution.state === 'completed' && execution.outputTable) {
        setTestRun({ phase: 'reading', execution });
        const size = await getOutputTableSize(execution.outputTable);
        setTestRun({ phase: 'done', execution, size });
        return;
      }
      // A failed execution carries no message of its own; its log explains it
      const run: TestRun = { phase: 'done', execution };
      if (execution.logFileUri) {
        try {
          run.excerpt = logExcerpt(await getFileText(execution.logFileUri));
        } catch (err) {
          run.logError = err instanceof Error ? err.message : 'unknown error';
        }
      }
      setTestRun(run);
    } catch (err) {
      setTestRun({ phase: 'done', error: err instanceof Error ? err.message : 'The test could not be run' });
    }
  }, []);

  const handleStopWaiting = useCallback(() => {
    stopRef.current = true;
  }, []);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!canSave || !selectedFolderId) return;

    setSaving(true);
    setError(null);

    const resolveName = buildNameLookup(decisionSignature);
    const parentFolderUri = `/folders/folders/${selectedFolderId}`;
    const trimmedName = name.trim();
    const trimmedDesc = description.trim() || undefined;

    // Build datasource mappings: decision variable name -> CAS column name
    const mappings: ScoreDefinitionMapping[] = [];
    for (const param of inputParameters) {
      const columnName = casTableInfo.columnMappings[param.name];
      if (columnName) {
        mappings.push({
          variableName: resolveName(param.name),
          mappingType: 'datasource',
          mappingValue: columnName,
        });
      }
    }

    const payload: TestScoreDefinitionPayload = {
      name: trimmedName,
      description: trimmedDesc,
      inputData: {
        type: 'CASTable',
        serverName: casTableInfo.serverName,
        libraryName: casTableInfo.libraryName,
        tableName: casTableInfo.tableName,
      },
      properties: {
        outputLibraryName: selectedCaslib,
        outputServerName: selectedServer,
        tableBaseName: `${trimmedName}_${module.name}`,
        test: 'true',
        version: '1.0',
      },
      objectDescriptor: {
        name: module.name,
        type: 'decision',
        uri: sourceURI,
      },
      mappings,
    };

    try {
      const definition = await createScoreDefinition(payload, parentFolderUri);
      setDefinitionId(definition.id);

      // Persist selections for next time
      savePref('lastFolderId', selectedFolderId);
      if (selectedFolderName) savePref('lastFolderName', selectedFolderName);
      savePref('lastServer', selectedServer);
      savePref('lastCaslib', selectedCaslib);

      setDone(true);
      setSaving(false);
      if (runNow) await runTest(definition.id, trimmedName);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to save test');
      setSaving(false);
    }
  }, [canSave, selectedFolderId, selectedFolderName, selectedServer, selectedCaslib, name, description, module.name, sourceURI, inputParameters, casTableInfo, decisionSignature, runNow, runTest]);

  // A save in flight cannot be abandoned from the dialog; a run can (it goes
  // on in SAS Viya, only the waiting stops)
  const handleClose = useCallback(() => {
    if (saving) return;
    stopRef.current = true;
    onClose();
  }, [saving, onClose]);

  const execution = testRun?.execution;
  const runSection = testRun && (
    <section className="save-test__run" aria-labelledby="save-test-run-title">
      <h4 className="save-test__run-title" id="save-test-run-title">Test run</h4>
      {testRunning ? (
        <div className="save-test__run-progress">
          <ProgressBar
            indeterminate
            phase={testRun.phase === 'reading' ? 'Reading the output table size' : 'Running the test in SAS Viya'}
            label="Running the test"
            message="The test scores the table with the decision in SAS Viya; this can take a few minutes."
          />
          <Button variant="secondary" size="small" onClick={handleStopWaiting}>
            Stop waiting
          </Button>
        </div>
      ) : (
        <div role="status" aria-live="polite">
          {testRun.error && (
            <Alert variant="error" title="The test could not be run">{testRun.error}</Alert>
          )}
          {testRun.stoppedWaiting && execution && (
            <Alert variant="info">
              Stopped waiting while the run was {execution.state}. It continues in SAS Viya; see its
              result on the decision&rsquo;s Tests tab in SAS Intelligent Decisioning.
            </Alert>
          )}
          {!testRun.stoppedWaiting && execution && (
            <>
              <div className="save-scenario-dialog__result-info">
                <div className="save-scenario-dialog__result-row">
                  <span className="save-scenario-dialog__result-label">State</span>
                  <span className="save-scenario-dialog__result-value"><StatusBadge status={execution.state} /></span>
                </div>
                {execution.outputTable && (
                  <div className="save-scenario-dialog__result-row">
                    <span className="save-scenario-dialog__result-label">Output Table</span>
                    <span className="save-scenario-dialog__result-value">
                      {execution.outputTable.serverName} / {execution.outputTable.libraryName} / {execution.outputTable.tableName}
                    </span>
                  </div>
                )}
                {testRun.size && (
                  <div className="save-scenario-dialog__result-row">
                    <span className="save-scenario-dialog__result-label">Output Size</span>
                    <span className="save-scenario-dialog__result-value">
                      {testRun.size.rows !== null ? `${testRun.size.rows.toLocaleString()} rows` : 'row count not available'}
                      {', '}
                      {testRun.size.columns !== null ? `${testRun.size.columns.toLocaleString()} columns` : 'column count not available'}
                    </span>
                  </div>
                )}
              </div>
              {execution.state === 'completed' ? (
                <p className="save-test__run-note">
                  The run finished. This app reports the output table and its size only; review the
                  scored rows in SAS Intelligent Decisioning or in the CAS table itself.
                </p>
              ) : (
                <Alert variant="error" title={`The run ended as "${execution.state}"`}>
                  {execution.error?.message ?? (testRun.excerpt
                    ? 'These lines of its SAS log explain why:'
                    : 'Open the test in SAS Intelligent Decisioning to see its log.')}
                  {testRun.logError && ` The run log could not be read: ${testRun.logError}.`}
                </Alert>
              )}
              {testRun.excerpt && testRun.excerpt.lines.length > 0 && execution.state !== 'completed' && (
                <pre className="save-test__log" tabIndex={0} aria-label="Lines from the run log">
                  {testRun.excerpt.lines.join('\n')}
                  {testRun.excerpt.clipped ? '\n…' : ''}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );

  return (
    <Modal
      title="Save as Test"
      onClose={handleClose}
      closeOnBackdropClick={!saving}
      initialFocusRef={nameInputRef}
      footer={
        done ? (
          <>
            {definitionId && !testRunning && (
              <Button variant="secondary" onClick={() => runTest(definitionId, name.trim())}>
                {testRun ? 'Run again' : 'Run test now'}
              </Button>
            )}
            <Button variant="primary" onClick={handleClose}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="tertiary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!canSave}
              loading={saving}
            >
              {saving ? 'Saving...' : runNow ? 'Save and Run' : 'Save Test'}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="save-scenario-dialog__success">
          <Alert variant="success">
            Test saved successfully.
          </Alert>
          <div className="save-scenario-dialog__result-info">
            <div className="save-scenario-dialog__result-row">
              <span className="save-scenario-dialog__result-label">Name</span>
              <span className="save-scenario-dialog__result-value">{name.trim()}</span>
            </div>
            <div className="save-scenario-dialog__result-row">
              <span className="save-scenario-dialog__result-label">Folder</span>
              <span className="save-scenario-dialog__result-value">{selectedFolderName}</span>
            </div>
            <div className="save-scenario-dialog__result-row">
              <span className="save-scenario-dialog__result-label">Input Table</span>
              <span className="save-scenario-dialog__result-value">
                {casTableInfo.serverName} / {casTableInfo.libraryName} / {casTableInfo.tableName}
              </span>
            </div>
            <div className="save-scenario-dialog__result-row">
              <span className="save-scenario-dialog__result-label">Output Library</span>
              <span className="save-scenario-dialog__result-value">{selectedServer} / {selectedCaslib}</span>
            </div>
            <div className="save-scenario-dialog__result-row">
              <span className="save-scenario-dialog__result-label">Mapped Variables</span>
              <span className="save-scenario-dialog__result-value">{mappedCount}</span>
            </div>
          </div>
          {runSection}
        </div>
      ) : (
        <div className="save-scenario-dialog__fields">
          <p className="save-scenario-dialog__description-text">
            Save this CAS table scoring setup as a Test in SAS Intelligent Decisioning.
            The test will score <strong>{casTableInfo.tableName}</strong> from <strong>{casTableInfo.libraryName}</strong> using {mappedCount} mapped variable{mappedCount !== 1 ? 's' : ''}.
          </p>

          {/* Input Table Info (read-only) */}
          <div className="save-scenario-dialog__field">
            <span className="save-scenario-dialog__label" id="save-test-input-table-label">Input Table</span>
            <div className="save-scenario-dialog__readonly-value" aria-labelledby="save-test-input-table-label">
              {casTableInfo.serverName} / {casTableInfo.libraryName} / {casTableInfo.tableName}
            </div>
          </div>

          {/* Name */}
          <div className="save-scenario-dialog__field">
            <label className="save-scenario-dialog__label" htmlFor="save-test-name">Name *</label>
            <input
              id="save-test-name"
              ref={nameInputRef}
              className="sas-input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Test name"
              maxLength={100}
              disabled={saving}
              aria-invalid={!!nameError && name.length > 0}
            />
            {nameError && name.length > 0 && (
              <span className="save-scenario-dialog__field-error" role="alert">{nameError}</span>
            )}
          </div>

          {/* Description */}
          <div className="save-scenario-dialog__field">
            <label className="save-scenario-dialog__label" htmlFor="save-test-description">Description</label>
            <textarea
              id="save-test-description"
              className="sas-textarea"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
              maxLength={1000}
              rows={3}
              disabled={saving}
            />
            {descriptionTooLong && (
              <span className="save-scenario-dialog__field-error" role="alert">Description must be 1000 characters or less</span>
            )}
          </div>

          {/* Folder selection */}
          <div className="save-scenario-dialog__field" role="group" aria-labelledby="save-test-folder-label">
            <span className="save-scenario-dialog__label" id="save-test-folder-label">SAS Content Folder *</span>
            {selectedFolderName && (
              <div className="save-scenario-dialog__selected-folder">
                Selected: {selectedFolderName}
              </div>
            )}
            <div className="save-scenario-dialog__folder-section">
              <FolderBrowser
                selectedFolderId={selectedFolderId}
                onSelect={handleFolderSelect}
                initialFolderId={loadPref('lastFolderId')}
              />
            </div>
          </div>

          {/* CAS Output Library */}
          <div className="save-scenario-dialog__field">
            <label className="save-scenario-dialog__label" htmlFor="save-test-server">CAS Output Library *</label>
            {loadingServers ? (
              <span className="save-scenario-dialog__loading-text">Loading servers...</span>
            ) : (
              <select
                id="save-test-server"
                className="sas-input"
                value={selectedServer}
                onChange={e => setSelectedServer(e.target.value)}
                disabled={saving}
              >
                {servers.length === 0 && <option value="">No servers available</option>}
                {servers.map(s => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="save-scenario-dialog__field">
            <label className="save-scenario-dialog__label" htmlFor="save-test-caslib">Caslib *</label>
            {loadingCaslibs ? (
              <span className="save-scenario-dialog__loading-text">Loading caslibs...</span>
            ) : (
              <select
                id="save-test-caslib"
                className="sas-input"
                value={selectedCaslib}
                onChange={e => setSelectedCaslib(e.target.value)}
                disabled={saving || !selectedServer}
              >
                {caslibs.length === 0 && <option value="">No caslibs available</option>}
                {caslibs.map(c => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Column Mapping Summary */}
          <div className="save-scenario-dialog__field" role="group" aria-labelledby="save-test-mappings-label">
            <span className="save-scenario-dialog__label" id="save-test-mappings-label">
              Column Mappings ({mappedCount}/{inputParameters.length})
            </span>
            <div className="save-scenario-dialog__mapping-summary">
              {inputParameters.map(param => {
                const col = casTableInfo.columnMappings[param.name];
                // Inputs chosen as "Send as missing" get no mapping, which is
                // how a test leaves them missing; they are labelled as such.
                const unmappedLabel = casTableInfo.missingInputs?.includes(param.name)
                  ? '(missing)'
                  : '(unmapped)';
                return (
                  <div
                    key={param.name}
                    className={`save-scenario-dialog__mapping-row ${col ? '' : 'save-scenario-dialog__mapping-row--unmapped'}`}
                  >
                    <span className="save-scenario-dialog__mapping-var">{param.name}</span>
                    <span className="save-scenario-dialog__mapping-arrow" aria-hidden="true">&rarr;</span>
                    <span className="save-scenario-dialog__mapping-col">
                      {col ?? unmappedLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <label className="save-test__run-now">
            <input
              type="checkbox"
              checked={runNow}
              onChange={e => setRunNow(e.target.checked)}
              disabled={saving}
            />
            Run the test now and show its output table and row count
          </label>

          {/* Error — the save failure wins over a catalogue failure */}
          {(error ?? casError) && (
            <Alert variant="error">{error ?? casError}</Alert>
          )}
        </div>
      )}
    </Modal>
  );
};

export default SaveTestDialog;
