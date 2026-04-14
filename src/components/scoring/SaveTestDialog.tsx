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
  TestScoreDefinitionPayload,
} from '../../api/scoreDefinitions';
import { getDecisionSignature, DecisionSignatureVariable } from '../../api/modules';
import { Module, StepParameter } from '../../types';
import { CasTableTestInfo } from './CasTableScore';

// --- localStorage helpers ---

const STORAGE_PREFIX = 'mas-scenario:';

const loadPref = (key: string): string | null =>
  localStorage.getItem(`${STORAGE_PREFIX}${key}`);

const savePref = (key: string, value: string): void =>
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);

// --- Types ---

interface SaveTestDialogProps {
  module: Module;
  sourceURI: string;
  casTableInfo: CasTableTestInfo;
  inputParameters: StepParameter[];
  onClose: () => void;
}

// --- Name resolution helper (same as SaveScenarioDialog) ---

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

// --- Name validation ---

const NAME_INVALID_CHARS = /[/{}]/;

function validateName(name: string): string | null {
  if (!name.trim()) return 'Name is required';
  if (name.length > 100) return 'Name must be 100 characters or less';
  if (NAME_INVALID_CHARS.test(name)) return 'Name cannot contain /, {, or } characters';
  return null;
}

// --- Component ---

export const SaveTestDialog: React.FC<SaveTestDialogProps> = ({
  module,
  sourceURI,
  casTableInfo,
  inputParameters,
  onClose,
}) => {
  // Form state
  const [name, setName] = useState(`${module.name}_Test`);
  const [description, setDescription] = useState('');

  // Folder state
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    loadPref('lastFolderId')
  );
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(
    loadPref('lastFolderName')
  );

  // CAS output library state
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
  const [error, setError] = useState<string | null>(null);
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
  const nameError = useMemo(() => validateName(name), [name]);
  const descriptionTooLong = description.length > 1000;

  const mappedCount = inputParameters.filter(p => casTableInfo.columnMappings[p.name]).length;
  const canSave = !nameError && !descriptionTooLong && selectedFolderId && selectedServer && selectedCaslib && !saving && mappedCount > 0;

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
      await createScoreDefinition(payload, parentFolderUri);

      // Persist selections for next time
      savePref('lastFolderId', selectedFolderId);
      if (selectedFolderName) savePref('lastFolderName', selectedFolderName);
      savePref('lastServer', selectedServer);
      savePref('lastCaslib', selectedCaslib);

      setDone(true);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to save test');
    } finally {
      setSaving(false);
    }
  }, [canSave, selectedFolderId, selectedFolderName, selectedServer, selectedCaslib, name, description, module.name, sourceURI, inputParameters, casTableInfo, decisionSignature]);

  return (
    <div className="save-scenario-overlay" onClick={onClose}>
      <div className="save-scenario-dialog" onClick={e => e.stopPropagation()}>
        <div className="save-scenario-dialog__header">
          <h3>Save as Test</h3>
          <button className="save-scenario-dialog__close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="save-scenario-dialog__body">
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
              <div className="save-scenario-dialog__actions">
                <Button variant="primary" onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="save-scenario-dialog__description-text">
                Save this CAS table scoring setup as a Test in SAS Intelligent Decisioning.
                The test will score <strong>{casTableInfo.tableName}</strong> from <strong>{casTableInfo.libraryName}</strong> using {mappedCount} mapped variable{mappedCount !== 1 ? 's' : ''}.
              </p>

              {/* Input Table Info (read-only) */}
              <div className="save-scenario-dialog__field">
                <label className="save-scenario-dialog__label">Input Table</label>
                <div className="save-scenario-dialog__readonly-value">
                  {casTableInfo.serverName} / {casTableInfo.libraryName} / {casTableInfo.tableName}
                </div>
              </div>

              {/* Name */}
              <div className="save-scenario-dialog__field">
                <label className="save-scenario-dialog__label">Name *</label>
                <input
                  className="save-scenario-dialog__input"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Test name"
                  maxLength={100}
                  disabled={saving}
                />
                {nameError && name.length > 0 && (
                  <span className="save-scenario-dialog__field-error">{nameError}</span>
                )}
              </div>

              {/* Description */}
              <div className="save-scenario-dialog__field">
                <label className="save-scenario-dialog__label">Description</label>
                <textarea
                  className="save-scenario-dialog__textarea"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Optional description"
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

              {/* Column Mapping Summary */}
              <div className="save-scenario-dialog__field">
                <label className="save-scenario-dialog__label">
                  Column Mappings ({mappedCount}/{inputParameters.length})
                </label>
                <div className="save-scenario-dialog__mapping-summary">
                  {inputParameters.map(param => {
                    const col = casTableInfo.columnMappings[param.name];
                    return (
                      <div
                        key={param.name}
                        className={`save-scenario-dialog__mapping-row ${col ? '' : 'save-scenario-dialog__mapping-row--unmapped'}`}
                      >
                        <span className="save-scenario-dialog__mapping-var">{param.name}</span>
                        <span className="save-scenario-dialog__mapping-arrow">&rarr;</span>
                        <span className="save-scenario-dialog__mapping-col">
                          {col ?? '(unmapped)'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Error */}
              {error && (
                <Alert variant="error">{error}</Alert>
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
                  {saving ? 'Saving...' : 'Save Test'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SaveTestDialog;
