// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { FolderBrowser } from './FolderBrowser';
import { getCasServers, getCaslibs, CasServer, CasLib } from '../../api/cas';
import {
  createScoreDefinition,
  ScoreDefinitionMapping,
  ScoreDefinitionPayload,
} from '../../api/scoreDefinitions';
import { getDecisionSignature, DecisionSignatureVariable } from '../../api/modules';
import { Module, StepParameter, Variable, StepOutput } from '../../types';

// --- localStorage helpers ---

const STORAGE_PREFIX = 'mas-scenario:';

const loadPref = (key: string): string | null =>
  localStorage.getItem(`${STORAGE_PREFIX}${key}`);

const savePref = (key: string, value: string): void =>
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);

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
  onClose,
}) => {
  // Form state
  const [baseName, setBaseName] = useState(`${module.name}_Scenario`);
  const [description, setDescription] = useState('');

  // Folder state
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    loadPref('lastFolderId')
  );
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(
    loadPref('lastFolderName')
  );

  // CAS state
  const [servers, setServers] = useState<CasServer[]>([]);
  const [caslibs, setCaslibs] = useState<CasLib[]>([]);
  const [selectedServer, setSelectedServer] = useState(loadPref('lastServer') ?? '');
  const [selectedCaslib, setSelectedCaslib] = useState(loadPref('lastCaslib') ?? '');
  const [loadingServers, setLoadingServers] = useState(true);
  const [loadingCaslibs, setLoadingCaslibs] = useState(false);

  // Decision signature state
  const [decisionSignature, setDecisionSignature] = useState<DecisionSignatureVariable[]>([]);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [done, setDone] = useState(false);

  // Load decision signature on mount
  useEffect(() => {
    getDecisionSignature(sourceURI)
      .then(setDecisionSignature)
      .catch(() => {/* best-effort */});
  }, [sourceURI]);

  // Load CAS servers on mount
  useEffect(() => {
    const load = async () => {
      try {
        const serverList = await getCasServers();
        setServers(serverList);
        const savedServer = loadPref('lastServer');
        if (savedServer && serverList.some(s => s.name === savedServer)) {
          setSelectedServer(savedServer);
        } else if (serverList.length > 0) {
          setSelectedServer(serverList[0].name);
        }
      } catch (err: unknown) {
        const e = err as { message?: string };
        setError(e.message ?? 'Failed to load CAS servers');
      } finally {
        setLoadingServers(false);
      }
    };
    load();
  }, []);

  // Load caslibs when server changes
  useEffect(() => {
    if (!selectedServer) {
      setCaslibs([]);
      return;
    }

    const load = async () => {
      setLoadingCaslibs(true);
      try {
        const caslibList = await getCaslibs(selectedServer);
        setCaslibs(caslibList);
        const savedCaslib = loadPref('lastCaslib');
        if (savedCaslib && caslibList.some(c => c.name === savedCaslib)) {
          setSelectedCaslib(savedCaslib);
        } else {
          const publicLib = caslibList.find(c => c.name.toLowerCase() === 'public');
          setSelectedCaslib(publicLib?.name ?? caslibList[0]?.name ?? '');
        }
      } catch (err: unknown) {
        const e = err as { message?: string };
        setError(e.message ?? 'Failed to load caslibs');
      } finally {
        setLoadingCaslibs(false);
      }
    };
    load();
  }, [selectedServer]);

  const handleFolderSelect = useCallback((folderId: string, folderName: string) => {
    setSelectedFolderId(folderId);
    setSelectedFolderName(folderName);
  }, []);

  // Validation
  const nameError = useMemo(() => validateName(baseName), [baseName]);
  const descriptionTooLong = description.length > 1000;
  const canSave = !nameError && !descriptionTooLong && selectedFolderId && selectedServer && selectedCaslib && !saving;

  // Save handler — creates scenarios sequentially
  const handleSave = useCallback(async () => {
    if (!canSave || !selectedFolderId) return;

    setSaving(true);
    setError(null);
    setSuccessCount(0);
    setFailCount(0);
    setSaveProgress({ current: 0, total: rows.length });

    const resolveName = buildNameLookup(decisionSignature);
    const parentFolderUri = `/folders/folders/${selectedFolderId}`;
    const trimmedBase = baseName.trim();
    const trimmedDesc = description.trim() || undefined;

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
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
        succeeded++;
      } catch {
        failed++;
      }

      setSaveProgress({ current: i + 1, total: rows.length });
      setSuccessCount(succeeded);
      setFailCount(failed);
    }

    // Persist selections for next time
    savePref('lastFolderId', selectedFolderId);
    if (selectedFolderName) savePref('lastFolderName', selectedFolderName);
    savePref('lastServer', selectedServer);
    savePref('lastCaslib', selectedCaslib);

    setSaving(false);
    setDone(true);
  }, [canSave, selectedFolderId, selectedFolderName, selectedServer, selectedCaslib, baseName, description, module.name, sourceURI, rows, inputParameters, decisionSignature]);

  return (
    <div className="save-scenario-overlay" onClick={onClose}>
      <div className="save-scenario-dialog" onClick={e => e.stopPropagation()}>
        <div className="save-scenario-dialog__header">
          <h3>Save {rows.length} Scenario{rows.length !== 1 ? 's' : ''}</h3>
          <button className="save-scenario-dialog__close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="save-scenario-dialog__body">
          {done ? (
            <div className="save-scenario-dialog__success">
              <Alert variant={failCount === 0 ? 'success' : 'warning'}>
                {successCount} scenario{successCount !== 1 ? 's' : ''} saved successfully
                {failCount > 0 && `, ${failCount} failed`}.
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
              <div className="save-scenario-dialog__actions">
                <Button variant="primary" onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="save-scenario-dialog__description-text">
                Each selected row will be saved as a separate scenario named <strong>{baseName.trim() || '...'}_1</strong> through <strong>{baseName.trim() || '...'}_{ rows.length}</strong>.
              </p>

              {/* Base Name */}
              <div className="save-scenario-dialog__field">
                <label className="save-scenario-dialog__label">Base Name *</label>
                <input
                  className="save-scenario-dialog__input"
                  type="text"
                  value={baseName}
                  onChange={e => setBaseName(e.target.value)}
                  placeholder="Scenario base name"
                  maxLength={100}
                  disabled={saving}
                />
                {nameError && baseName.length > 0 && (
                  <span className="save-scenario-dialog__field-error">{nameError}</span>
                )}
                <span className="save-scenario-dialog__hint">
                  Each scenario will be named {baseName.trim() || '...'}_1, {baseName.trim() || '...'}_2, etc.
                </span>
              </div>

              {/* Description */}
              <div className="save-scenario-dialog__field">
                <label className="save-scenario-dialog__label">Description</label>
                <textarea
                  className="save-scenario-dialog__textarea"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Optional description (applies to all scenarios)"
                  maxLength={1000}
                  rows={3}
                  disabled={saving}
                />
                {descriptionTooLong && (
                  <span className="save-scenario-dialog__field-error">Description must be 1000 characters or less</span>
                )}
              </div>

              {/* Folder selection */}
              <div className="save-scenario-dialog__field">
                <label className="save-scenario-dialog__label">SAS Content Folder *</label>
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
                <label className="save-scenario-dialog__label">CAS Output Library *</label>
                {loadingServers ? (
                  <span className="save-scenario-dialog__loading-text">Loading servers...</span>
                ) : (
                  <select
                    className="save-scenario-dialog__select"
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
                <label className="save-scenario-dialog__label">Caslib *</label>
                {loadingCaslibs ? (
                  <span className="save-scenario-dialog__loading-text">Loading caslibs...</span>
                ) : (
                  <select
                    className="save-scenario-dialog__select"
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

              {/* Error */}
              {error && (
                <Alert variant="error">{error}</Alert>
              )}

              {/* Save progress */}
              {saving && (
                <div className="save-scenario-dialog__progress">
                  <div className="score-panel__progress-bar">
                    <div
                      className="score-panel__progress-fill"
                      style={{ width: `${(saveProgress.current / saveProgress.total) * 100}%` }}
                    />
                  </div>
                  <span className="save-scenario-dialog__progress-text">
                    Saving scenario {saveProgress.current} of {saveProgress.total}...
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="save-scenario-dialog__actions">
                <Button variant="tertiary" onClick={onClose} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSave}
                  disabled={!canSave}
                  loading={saving}
                >
                  {saving ? 'Saving...' : `Save ${rows.length} Scenario${rows.length !== 1 ? 's' : ''}`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SaveBatchScenariosDialog;
