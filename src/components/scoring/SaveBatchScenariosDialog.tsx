// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Modal } from '../common/Modal';
import { ProgressBar } from '../common/ProgressBar';
import { FolderBrowser } from './FolderBrowser';
import { useCasCatalog } from '../../hooks/useCasCatalog';
import {
  createScoreDefinition,
  ScoreDefinitionMapping,
  ScoreDefinitionPayload,
} from '../../api/scoreDefinitions';
import { DecisionSignatureVariable } from '../../api/modules';
import { Module, StepParameter, Variable, StepOutput } from '../../types';

// --- localStorage helpers ---

const STORAGE_PREFIX = 'mas-scenario:';

const loadPref = (key: string): string | null =>
  localStorage.getItem(`${STORAGE_PREFIX}${key}`);

const savePref = (key: string, value: string): void =>
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);

// Score definitions are created through a small worker pool (the same
// cursor-based shape as the batch scoring path) rather than one POST at a
// time: a few hundred selected rows otherwise take minutes.
const SAVE_CONCURRENCY = 4;

// --- Types ---

interface BatchRow {
  input: Record<string, unknown>;
  output: StepOutput;
}

interface SaveBatchScenariosDialogProps {
  module: Module;
  sourceURI: string;
  rows: BatchRow[];
  inputParameters: StepParameter[];
  outputParameters: StepParameter[];
  /** Decision signature, resolved once by ScorePanel and passed down. */
  decisionSignature: DecisionSignatureVariable[];
  onClose: () => void;
}

// --- Mapping helpers (same as SaveScenarioDialog) ---

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;

function formatMappingValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (DATE_RE.test(value)) return { type: 'date', value };
    if (DATETIME_RE.test(value)) return { type: 'datetime', value };
    return value;
  }
  if (typeof value === 'object') {
    if ('type' in (value as Record<string, unknown>) && 'value' in (value as Record<string, unknown>)) {
      return value;
    }
    return JSON.stringify(value);
  }
  return value;
}

function buildNameLookup(signature: DecisionSignatureVariable[]): (masName: string) => string {
  const lowerToOriginal = new Map<string, string>();
  for (const v of signature) {
    lowerToOriginal.set(v.name.toLowerCase(), v.name);
  }

  return (masName: string): string => {
    const direct = lowerToOriginal.get(masName.toLowerCase());
    if (direct) return direct;
    if (masName.endsWith('_')) {
      const stripped = masName.slice(0, -1);
      const matched = lowerToOriginal.get(stripped.toLowerCase());
      if (matched) return matched;
    }
    return masName.endsWith('_') ? masName.slice(0, -1) : masName;
  };
}

function buildMappings(
  inputValues: Record<string, unknown>,
  inputParameters: StepParameter[],
  outputValues: Variable[],
  resolveName: (masName: string) => string
): ScoreDefinitionMapping[] {
  const mappings: ScoreDefinitionMapping[] = [];

  for (const param of inputParameters) {
    const rawValue = inputValues[param.name];
    mappings.push({
      variableName: resolveName(param.name),
      mappingType: 'static',
      mappingValue: formatMappingValue(rawValue),
    });
  }

  for (const variable of outputValues) {
    mappings.push({
      variableName: resolveName(variable.name),
      mappingType: 'expected',
      mappingValue: formatMappingValue(variable.value),
    });
  }

  return mappings;
}

// --- Name validation ---

const NAME_INVALID_CHARS = /[/{}]/;

function validateName(name: string): string | null {
  if (!name.trim()) return 'Name is required';
  if (name.length > 100) return 'Name must be 100 characters or less';
  if (NAME_INVALID_CHARS.test(name)) return 'Name cannot contain /, {, or } characters';
  return null;
}

// --- Component ---

export const SaveBatchScenariosDialog: React.FC<SaveBatchScenariosDialogProps> = ({
  module,
  sourceURI,
  rows,
  inputParameters,
  outputParameters: _outputParameters,
  decisionSignature,
  onClose,
}) => {
  // Form state
  const [baseName, setBaseName] = useState(`${module.name}_Scenario`);
  const [description, setDescription] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Folder state
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    loadPref('lastFolderId')
  );
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(
    loadPref('lastFolderName')
  );

  // CAS state — the catalogue itself comes from the shared session cache;
  // only the two selections live here.
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
  const [completedCount, setCompletedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [done, setDone] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  // Set by Stop while saving: no new creates are started, in-flight ones land
  const abortRef = useRef(false);

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
  const nameError = useMemo(() => validateName(baseName), [baseName]);
  const descriptionTooLong = description.length > 1000;
  const canSave = !nameError && !descriptionTooLong && selectedFolderId && selectedServer && selectedCaslib && !saving;

  // Save handler — creates scenarios through a bounded worker pool
  const handleSave = useCallback(async () => {
    if (!canSave || !selectedFolderId) return;

    abortRef.current = false;
    setSaving(true);
    setStopped(false);
    setStopRequested(false);
    setError(null);
    setSuccessCount(0);
    setFailCount(0);
    setCompletedCount(0);

    const resolveName = buildNameLookup(decisionSignature);
    const parentFolderUri = `/folders/folders/${selectedFolderId}`;
    const trimmedBase = baseName.trim();
    const trimmedDesc = description.trim() || undefined;

    const saveRow = async (i: number) => {
      const row = rows[i];
      const scenarioName = `${trimmedBase}_${i + 1}`;
      const mappings = buildMappings(row.input, inputParameters, row.output.outputs, resolveName);

      const payload: ScoreDefinitionPayload = {
        name: scenarioName,
        description: trimmedDesc,
        inputData: { type: 'Scenario' },
        properties: {
          outputLibraryName: selectedCaslib,
          outputServerName: selectedServer,
          tableBaseName: scenarioName,
          version: '1.0',
          outputTableName: scenarioName,
        },
        objectDescriptor: {
          name: module.name,
          type: 'decision',
          uri: sourceURI,
        },
        mappings,
      };

      try {
        await createScoreDefinition(payload, parentFolderUri);
        setSuccessCount(c => c + 1);
      } catch {
        setFailCount(c => c + 1);
      }
      setCompletedCount(c => c + 1);
    };

    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < rows.length && !abortRef.current) {
        const index = nextIndex++;
        await saveRow(index);
      }
    };
    await Promise.all(
      Array(Math.min(SAVE_CONCURRENCY, rows.length)).fill(null).map(() => worker())
    );

    // Persist selections for next time
    savePref('lastFolderId', selectedFolderId);
    if (selectedFolderName) savePref('lastFolderName', selectedFolderName);
    savePref('lastServer', selectedServer);
    savePref('lastCaslib', selectedCaslib);

    setStopped(abortRef.current);
    setSaving(false);
    setDone(true);
  }, [canSave, selectedFolderId, selectedFolderName, selectedServer, selectedCaslib, baseName, description, module.name, sourceURI, rows, inputParameters, decisionSignature]);

  const handleStop = useCallback(() => {
    abortRef.current = true;
    setStopRequested(true);
  }, []);

  // While saving, closing means "stop after the in-flight creates"; the
  // dialog stays open to show the outcome.
  const handleClose = useCallback(() => {
    if (saving) {
      handleStop();
      return;
    }
    onClose();
  }, [saving, handleStop, onClose]);

  const plural = rows.length !== 1 ? 's' : '';

  return (
    <Modal
      title={`Save ${rows.length} Scenario${plural}`}
      onClose={handleClose}
      closeOnBackdropClick={!saving}
      initialFocusRef={nameInputRef}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            {saving ? (
              <Button variant="tertiary" onClick={handleStop} disabled={stopRequested}>
                {stopRequested ? 'Stopping...' : 'Stop'}
              </Button>
            ) : (
              <Button variant="tertiary" onClick={onClose}>
                Cancel
              </Button>
            )}
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!canSave}
              loading={saving}
            >
              {saving ? 'Saving...' : `Save ${rows.length} Scenario${plural}`}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="save-scenario-dialog__success">
          <Alert variant={failCount === 0 && !stopped ? 'success' : 'warning'}>
            {successCount} scenario{successCount !== 1 ? 's' : ''} saved successfully
            {failCount > 0 && `, ${failCount} failed`}
            {stopped && `, ${rows.length - completedCount} not started (stopped)`}.
          </Alert>
          <div className="save-scenario-dialog__result-info">
            <div className="save-scenario-dialog__result-row">
              <span className="save-scenario-dialog__result-label">Name Pattern</span>
              <span className="save-scenario-dialog__result-value">{baseName.trim()}_1 ... _{rows.length}</span>
            </div>
            <div className="save-scenario-dialog__result-row">
              <span className="save-scenario-dialog__result-label">Folder</span>
              <span className="save-scenario-dialog__result-value">{selectedFolderName}</span>
            </div>
            <div className="save-scenario-dialog__result-row">
              <span className="save-scenario-dialog__result-label">Output Library</span>
              <span className="save-scenario-dialog__result-value">{selectedServer} / {selectedCaslib}</span>
            </div>
            <div className="save-scenario-dialog__result-row">
              <span className="save-scenario-dialog__result-label">Succeeded</span>
              <span className="save-scenario-dialog__result-value">{successCount}</span>
            </div>
            {failCount > 0 && (
              <div className="save-scenario-dialog__result-row">
                <span className="save-scenario-dialog__result-label">Failed</span>
                <span className="save-scenario-dialog__result-value">{failCount}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="save-scenario-dialog__fields">
          <p className="save-scenario-dialog__description-text">
            Each selected row will be saved as a separate scenario named <strong>{baseName.trim() || '...'}_1</strong> through <strong>{baseName.trim() || '...'}_{ rows.length}</strong>.
          </p>

          {/* Base Name */}
          <div className="save-scenario-dialog__field">
            <label className="save-scenario-dialog__label" htmlFor="save-batch-base-name">Base Name *</label>
            <input
              id="save-batch-base-name"
              ref={nameInputRef}
              className="sas-input"
              type="text"
              value={baseName}
              onChange={e => setBaseName(e.target.value)}
              placeholder="Scenario base name"
              maxLength={100}
              disabled={saving}
              aria-invalid={!!nameError && baseName.length > 0}
              aria-describedby="save-batch-base-name-hint"
            />
            {nameError && baseName.length > 0 && (
              <span className="save-scenario-dialog__field-error" role="alert">{nameError}</span>
            )}
            <span className="save-scenario-dialog__hint" id="save-batch-base-name-hint">
              Each scenario will be named {baseName.trim() || '...'}_1, {baseName.trim() || '...'}_2, etc.
            </span>
          </div>

          {/* Description */}
          <div className="save-scenario-dialog__field">
            <label className="save-scenario-dialog__label" htmlFor="save-batch-description">Description</label>
            <textarea
              id="save-batch-description"
              className="sas-textarea"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description (applies to all scenarios)"
              maxLength={1000}
              rows={3}
              disabled={saving}
            />
            {descriptionTooLong && (
              <span className="save-scenario-dialog__field-error" role="alert">Description must be 1000 characters or less</span>
            )}
          </div>

          {/* Folder selection */}
          <div className="save-scenario-dialog__field" role="group" aria-labelledby="save-batch-folder-label">
            <span className="save-scenario-dialog__label" id="save-batch-folder-label">SAS Content Folder *</span>
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
            <label className="save-scenario-dialog__label" htmlFor="save-batch-server">CAS Output Library *</label>
            {loadingServers ? (
              <span className="save-scenario-dialog__loading-text">Loading servers...</span>
            ) : (
              <select
                id="save-batch-server"
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
            <label className="save-scenario-dialog__label" htmlFor="save-batch-caslib">Caslib *</label>
            {loadingCaslibs ? (
              <span className="save-scenario-dialog__loading-text">Loading caslibs...</span>
            ) : (
              <select
                id="save-batch-caslib"
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

          {/* Error — the save failure wins over a catalogue failure */}
          {(error ?? casError) && (
            <Alert variant="error">{error ?? casError}</Alert>
          )}

          {/* Save progress. The role="status" wrapper is load-bearing: a
              progressbar's aria-valuenow is not reliably announced, so the
              "Saved n of m" message is what a screen reader hears change
              (WCAG 2.1 AA 4.1.3). Keep it if <ProgressBar> is ever swapped. */}
          {saving && (
            <div role="status">
              <ProgressBar
                value={completedCount}
                max={rows.length}
                label="Scenario save progress"
                message={`Saved ${completedCount} of ${rows.length} scenario${plural}...`}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default SaveBatchScenariosDialog;
