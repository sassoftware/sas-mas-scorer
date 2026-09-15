// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Modal } from '../common/Modal';
import { FolderBrowser } from './FolderBrowser';
import { getCasServers, getCaslibs, CasServer, CasLib } from '../../api/cas';
import {
  createScoreDefinition,
  ScoreDefinitionMapping,
  ScoreDefinitionPayload,
} from '../../api/scoreDefinitions';
import { getDecisionSignature, DecisionSignatureVariable } from '../../api/modules';
import { Module, StepParameter, Variable } from '../../types';

// --- localStorage helpers ---

const STORAGE_PREFIX = 'mas-scenario:';

const loadPref = (key: string): string | null =>
  localStorage.getItem(`${STORAGE_PREFIX}${key}`);

const savePref = (key: string, value: string): void =>
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);

// --- Props ---

interface SaveScenarioDialogProps {
  module: Module;
  sourceURI: string;
  inputValues: Record<string, unknown>;
  inputParameters: StepParameter[];
  outputValues: Variable[];
  outputParameters: StepParameter[];
  onClose: () => void;
}

// --- Mapping helpers ---

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;

function formatMappingValue(value: unknown): unknown {
  // Return null (not undefined) so the key survives JSON.stringify
  if (value === null || value === undefined) return null;

  // Booleans pass through
  if (typeof value === 'boolean') return value;

  // Numbers pass through
  if (typeof value === 'number') return value;

  // Strings: detect date/datetime patterns
  if (typeof value === 'string') {
    if (DATE_RE.test(value)) return { type: 'date', value };
    if (DATETIME_RE.test(value)) return { type: 'datetime', value };
    return value;
  }

  // Objects/arrays: JSON-stringify for datagrids or complex types
  if (typeof value === 'object') {
    // Already wrapped date/datetime objects pass through
    if ('type' in (value as Record<string, unknown>) && 'value' in (value as Record<string, unknown>)) {
      return value;
    }
    return JSON.stringify(value);
  }

  return value;
}

/**
 * Build a case-insensitive lookup from MAS variable names to the original
 * decision variable names. MAS lowercases and appends a trailing '_' to
 * variable names when publishing a decision (e.g. "Cylinders" → "cylinders_").
 *
 * The lookup tries two matches against each signature variable:
 *   1. Exact case-insensitive match (masName vs sigName)
 *   2. Case-insensitive match after stripping trailing '_' from the MAS name
 */
function buildNameLookup(signature: DecisionSignatureVariable[]): (masName: string) => string {
  // Map lowercase decision name → original decision name
  const lowerToOriginal = new Map<string, string>();
  for (const v of signature) {
    lowerToOriginal.set(v.name.toLowerCase(), v.name);
  }

  return (masName: string): string => {
    // Try exact case-insensitive match first
    const direct = lowerToOriginal.get(masName.toLowerCase());
    if (direct) return direct;

    // Try after stripping trailing '_' (MAS suffix)
    if (masName.endsWith('_')) {
      const stripped = masName.slice(0, -1);
      const matched = lowerToOriginal.get(stripped.toLowerCase());
      if (matched) return matched;
    }

    // Fallback: return as-is (strip trailing '_' at minimum)
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

  // Input mappings (static)
  for (const param of inputParameters) {
    const rawValue = inputValues[param.name];
    mappings.push({
      variableName: resolveName(param.name),
      mappingType: 'static',
      mappingValue: formatMappingValue(rawValue),
    });
  }

  // Output mappings (expected)
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

export const SaveScenarioDialog: React.FC<SaveScenarioDialogProps> = ({
  module,
  sourceURI,
  inputValues,
  inputParameters,
  outputValues,
  outputParameters: _outputParameters,
  onClose,
}) => {
  // Form state
  const [name, setName] = useState(`${module.name}_Scenario`);
  const [description, setDescription] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load decision signature on mount
  useEffect(() => {
    getDecisionSignature(sourceURI)
      .then(setDecisionSignature)
      .catch(() => {/* signature is best-effort; fallback to stripping _ */});
  }, [sourceURI]);

  // Load CAS servers on mount
  useEffect(() => {
    const load = async () => {
      try {
        const serverList = await getCasServers();
        setServers(serverList);
        // Restore or auto-select
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
        // Restore or auto-select
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

  // Folder selection handler
  const handleFolderSelect = useCallback((folderId: string, folderName: string) => {
    setSelectedFolderId(folderId);
    setSelectedFolderName(folderName);
  }, []);

  // Name change handler
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
  }, []);

  // Validation
  const nameError = useMemo(() => validateName(name), [name]);
  const descriptionTooLong = description.length > 1000;
  const canSave = !nameError && !descriptionTooLong && selectedFolderId && selectedServer && selectedCaslib && !saving;

  // Save handler
  const handleSave = useCallback(async () => {
    if (!canSave || !selectedFolderId) return;

    setSaving(true);
    setError(null);

    try {
      const resolveName = buildNameLookup(decisionSignature);
      const mappings = buildMappings(inputValues, inputParameters, outputValues, resolveName);

      const payload: ScoreDefinitionPayload = {
        name: name.trim(),
        description: description.trim() || undefined,
        inputData: { type: 'Scenario' },
        properties: {
          outputLibraryName: selectedCaslib,
          outputServerName: selectedServer,
          tableBaseName: name.trim(),
          version: '1.0',
          outputTableName: name.trim(),
        },
        objectDescriptor: {
          name: module.name,
          type: 'decision',
          uri: sourceURI,
        },
        mappings,
      };

      const parentFolderUri = `/folders/folders/${selectedFolderId}`;
      await createScoreDefinition(payload, parentFolderUri);

      // Persist selections for next time
      savePref('lastFolderId', selectedFolderId);
      if (selectedFolderName) savePref('lastFolderName', selectedFolderName);
      savePref('lastServer', selectedServer);
      savePref('lastCaslib', selectedCaslib);

      setSuccess(true);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to save scenario');
    } finally {
      setSaving(false);
    }
  }, [canSave, selectedFolderId, selectedFolderName, selectedServer, selectedCaslib, name, description, module.name, sourceURI, inputValues, inputParameters, outputValues, decisionSignature]);

  // A save in flight cannot be abandoned from the dialog
  const handleClose = useCallback(() => {
    if (!saving) onClose();
  }, [saving, onClose]);

  return (
    <Modal
      title="Save as Scenario"
      onClose={handleClose}
      closeOnBackdropClick={!saving}
      initialFocusRef={nameInputRef}
      footer={
        success ? (
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
              {saving ? 'Saving...' : 'Save Scenario'}
            </Button>
          </>
        )
      }
    >
      {success ? (
        <div className="save-scenario-dialog__success">
          <Alert variant="success">
            Scenario saved successfully!
          </Alert>
          <div className="save-scenario-dialog__result-info">
            <div className="save-scenario-dialog__result-row">
              <span className="save-scenario-dialog__result-label">Name</span>
              <span className="save-scenario-dialog__result-value">{name}</span>
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
              <span className="save-scenario-dialog__result-label">Inputs</span>
              <span className="save-scenario-dialog__result-value">{inputParameters.length}</span>
            </div>
            <div className="save-scenario-dialog__result-row">
              <span className="save-scenario-dialog__result-label">Outputs</span>
              <span className="save-scenario-dialog__result-value">{outputValues.length}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="save-scenario-dialog__fields">
          {/* Name */}
          <div className="save-scenario-dialog__field">
            <label className="save-scenario-dialog__label" htmlFor="save-scenario-name">Name *</label>
            <input
              id="save-scenario-name"
              ref={nameInputRef}
              className="sas-input"
              type="text"
              value={name}
              onChange={handleNameChange}
              placeholder="Scenario name"
              maxLength={100}
              disabled={saving}
              aria-invalid={!!nameError && name.length > 0}
              aria-describedby="save-scenario-name-hint"
            />
            {nameError && name.length > 0 && (
              <span className="save-scenario-dialog__field-error" role="alert">{nameError}</span>
            )}
            <span className="save-scenario-dialog__hint" id="save-scenario-name-hint">{name.length}/100 characters</span>
          </div>

          {/* Description */}
          <div className="save-scenario-dialog__field">
            <label className="save-scenario-dialog__label" htmlFor="save-scenario-description">Description</label>
            <textarea
              id="save-scenario-description"
              className="sas-textarea"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
              maxLength={1000}
              rows={3}
              disabled={saving}
              aria-describedby="save-scenario-description-hint"
            />
            {descriptionTooLong && (
              <span className="save-scenario-dialog__field-error" role="alert">Description must be 1000 characters or less</span>
            )}
            <span className="save-scenario-dialog__hint" id="save-scenario-description-hint">{description.length}/1000 characters</span>
          </div>

          {/* Folder selection */}
          <div className="save-scenario-dialog__field" role="group" aria-labelledby="save-scenario-folder-label">
            <span className="save-scenario-dialog__label" id="save-scenario-folder-label">SAS Content Folder *</span>
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
            <label className="save-scenario-dialog__label" htmlFor="save-scenario-server">CAS Output Library *</label>
            {loadingServers ? (
              <span className="save-scenario-dialog__loading-text">Loading servers...</span>
            ) : (
              <select
                id="save-scenario-server"
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
            <label className="save-scenario-dialog__label" htmlFor="save-scenario-caslib">Caslib *</label>
            {loadingCaslibs ? (
              <span className="save-scenario-dialog__loading-text">Loading caslibs...</span>
            ) : (
              <select
                id="save-scenario-caslib"
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

          {/* Error */}
          {error && (
            <Alert variant="error">{error}</Alert>
          )}
        </div>
      )}
    </Modal>
  );
};
