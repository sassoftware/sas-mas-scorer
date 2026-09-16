// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Modal } from '../common/Modal';
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
  /** Decision signature, resolved once by ScorePanel and passed down. */
  decisionSignature: DecisionSignatureVariable[];
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

  // A save in flight cannot be abandoned from the dialog
  const handleClose = useCallback(() => {
    if (!saving) onClose();
  }, [saving, onClose]);

  return (
    <Modal
      title="Save as Test"
      onClose={handleClose}
      closeOnBackdropClick={!saving}
      initialFocusRef={nameInputRef}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
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
              {saving ? 'Saving...' : 'Save Test'}
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
                return (
                  <div
                    key={param.name}
                    className={`save-scenario-dialog__mapping-row ${col ? '' : 'save-scenario-dialog__mapping-row--unmapped'}`}
                  >
                    <span className="save-scenario-dialog__mapping-var">{param.name}</span>
                    <span className="save-scenario-dialog__mapping-arrow" aria-hidden="true">&rarr;</span>
                    <span className="save-scenario-dialog__mapping-col">
                      {col ?? '(unmapped)'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

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
