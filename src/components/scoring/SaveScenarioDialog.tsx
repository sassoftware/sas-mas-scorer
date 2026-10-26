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
  ScoreDefinitionPayload,
} from '../../api/scoreDefinitions';
import { DecisionSignatureVariable } from '../../api/modules';
import { Module, StepParameter, Variable } from '../../types';
import {
  buildNameLookup,
  buildScenarioMappings,
  loadPref,
  savePref,
  validateName,
} from './scoreDefinitionHelpers';

// --- Props ---

interface SaveScenarioDialogProps {
  module: Module;
  sourceURI: string;
  inputValues: Record<string, unknown>;
  inputParameters: StepParameter[];
  outputValues: Variable[];
  outputParameters: StepParameter[];
  /** Decision signature, resolved once by ScorePanel and passed down. */
  decisionSignature: DecisionSignatureVariable[];
  onClose: () => void;
}

// --- Component ---

export const SaveScenarioDialog: React.FC<SaveScenarioDialogProps> = ({
  module,
  sourceURI,
  inputValues,
  inputParameters,
  outputValues,
  outputParameters: _outputParameters,
  decisionSignature,
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
      const mappings = buildScenarioMappings(inputValues, inputParameters, outputValues, resolveName);

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

          {/* Error — the save failure wins over a catalogue failure */}
          {(error ?? casError) && (
            <Alert variant="error">{error ?? casError}</Alert>
          )}
        </div>
      )}
    </Modal>
  );
};
