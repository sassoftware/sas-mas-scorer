// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Modal } from '../common/Modal';
import { FolderBrowser } from '../scoring/FolderBrowser';
import {
  saveNewCodeFile,
  updateCodeFileWithRevision,
  getLatestRevisionUri,
  SaveCodeFileResult,
} from '../../api/decisionCodeFiles';
import { createScoreDefinition, ScoreDefinitionPayload } from '../../api/scoreDefinitions';
import { CodeFileSignatureTerm } from '../../api/codeFiles';
import { useCasCatalog } from '../../hooks/useCasCatalog';
import { buildDeepLink } from '../../utils/deepLinks';

interface Props {
  code: string;
  signature?: unknown[];
  exampleInput?: string;
  open: boolean;
  onClose: () => void;
}

type Mode = 'create' | 'update';
type SaveState = 'idle' | 'saving' | 'success' | 'error';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CODE_FILE_URI_PREFIX = '/decisions/codeFiles/';

interface ScenarioCasFieldsProps {
  selectedServer: string;
  onServerChange: (name: string) => void;
  selectedCaslib: string;
  onCaslibChange: (name: string) => void;
}

/**
 * CAS output target for the optional test scenario.
 *
 * Its own component so that it mounts only while the scenario checkbox is on:
 * `useCasCatalog` loads on mount, and SaveToSidDialog is kept mounted (closed)
 * by CodeOutput, so calling the hook a level up would fetch the catalogue for
 * every visitor of the Python Output step.
 */
const ScenarioCasFields: React.FC<ScenarioCasFieldsProps> = ({
  selectedServer,
  onServerChange,
  selectedCaslib,
  onCaslibChange,
}) => {
  const { servers, caslibs, loadingServers, loadingCaslibs, error: casError } =
    useCasCatalog(selectedServer);

  // Auto-select the first server once the list arrives.
  useEffect(() => {
    if (selectedServer || servers.length === 0) return;
    onServerChange(servers[0].name);
  }, [servers, selectedServer, onServerChange]);

  // Prefer Public, else the first caslib; clear the choice when the list empties.
  useEffect(() => {
    // useCasCatalog empties `caslibs` at the START of every uncached load, so
    // without the loading guard a server switch would wipe the user's caslib
    // before the new list arrives — and the "keep the same-named caslib across
    // servers" branch below would then never see it.
    if (loadingCaslibs) return;
    if (caslibs.length === 0) {
      onCaslibChange('');
      return;
    }
    if (selectedCaslib && caslibs.some(c => c.name === selectedCaslib)) return;
    onCaslibChange(caslibs.find(c => c.name.toLowerCase() === 'public')?.name ?? caslibs[0].name);
  }, [caslibs, loadingCaslibs, selectedCaslib, onCaslibChange]);

  return (
    <>
      {casError && <Alert variant="error">{casError}</Alert>}

      <div className="schema-builder__field">
        <label htmlFor="sb-scenario-server">
          CAS output library <span className="schema-builder__required">*</span>
        </label>
        <select
          id="sb-scenario-server"
          className="sas-input"
          value={selectedServer}
          onChange={e => onServerChange(e.target.value)}
          disabled={loadingServers}
        >
          {loadingServers && <option value="">Loading servers…</option>}
          {!loadingServers && servers.length === 0 && <option value="">No servers available</option>}
          {servers.map(s => (
            <option key={s.name} value={s.name}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="schema-builder__field">
        <label htmlFor="sb-scenario-caslib">
          Caslib <span className="schema-builder__required">*</span>
        </label>
        <select
          id="sb-scenario-caslib"
          className="sas-input"
          value={selectedCaslib}
          onChange={e => onCaslibChange(e.target.value)}
          disabled={loadingCaslibs || !selectedServer}
        >
          {loadingCaslibs && <option value="">Loading caslibs…</option>}
          {!loadingCaslibs && caslibs.length === 0 && <option value="">No caslibs available</option>}
          {caslibs.map(c => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
      </div>
    </>
  );
};

export const SaveToSidDialog: React.FC<Props> = ({ code, signature, exampleInput, open, onClose }) => {
  const [mode, setMode] = useState<Mode>('create');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [revisionType, setRevisionType] = useState<'minor' | 'major'>('minor');

  // Create mode: target folder
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFolderName, setSelectedFolderName] = useState('');

  // Update mode: target code file
  const [selectedCodeFileId, setSelectedCodeFileId] = useState<string | null>(null);
  const [selectedCodeFileName, setSelectedCodeFileName] = useState('');

  // Optional test scenario
  const [createScenario, setCreateScenario] = useState(false);
  const [selectedServer, setSelectedServer] = useState('');
  const [selectedCaslib, setSelectedCaslib] = useState('');
  const [scenarioFolderId, setScenarioFolderId] = useState<string | null>(null);
  const [scenarioFolderName, setScenarioFolderName] = useState('');

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [resultMsg, setResultMsg] = useState('');
  const [deepLink, setDeepLink] = useState<{ url: string; label: string } | null>(null);

  // Reset transient state when the dialog opens.
  useEffect(() => {
    if (open) {
      setSaveState('idle');
      setResultMsg('');
      setDeepLink(null);
    }
  }, [open]);

  // The CAS server/caslib lists live in <ScenarioCasFields> (shared cache).

  // Default the scenario folder to the code file's folder.
  useEffect(() => {
    if (createScenario && !scenarioFolderId && selectedFolderId) {
      setScenarioFolderId(selectedFolderId);
      setScenarioFolderName(selectedFolderName);
    }
  }, [createScenario, scenarioFolderId, selectedFolderId, selectedFolderName]);

  if (!open) return null;

  const inputVarName =
    (signature as CodeFileSignatureTerm[] | undefined)?.find(t => t.direction === 'input')?.name ??
    'input_string';

  const nameValid = NAME_RE.test(name) && name.length <= 32;
  const scenarioReady = !createScenario || (!!selectedServer && !!selectedCaslib && !!scenarioFolderId);
  const canSave =
    nameValid &&
    saveState !== 'saving' &&
    scenarioReady &&
    (mode === 'create' ? !!selectedFolderId : !!selectedCodeFileId);

  const maybeCreateScenario = async (result: SaveCodeFileResult): Promise<string> => {
    if (!createScenario) return '';
    try {
      const revisionUri = await getLatestRevisionUri(result.codeFileId);
      const scenarioName = `${name}_Scenario`;
      const payload: ScoreDefinitionPayload = {
        name: scenarioName,
        description: 'Auto-generated from the example schema',
        inputData: { type: 'Scenario' },
        properties: {
          outputLibraryName: selectedCaslib,
          outputServerName: selectedServer,
          tableBaseName: scenarioName,
          version: '1.0',
          outputTableName: scenarioName,
        },
        objectDescriptor: {
          name: result.codeFileName,
          type: 'codeFile',
          uri: revisionUri ?? `/decisions/codeFiles/${result.codeFileId}`,
        },
        mappings: [
          { variableName: inputVarName, mappingType: 'static', mappingValue: exampleInput ?? '' },
        ],
      };
      await createScoreDefinition(payload, `/folders/folders/${scenarioFolderId}`);
      return ` Test scenario "${scenarioName}" created.`;
    } catch (e) {
      return ` (Code file saved, but the test scenario could not be created: ${e instanceof Error ? e.message : 'unknown error'}.)`;
    }
  };

  const handleSave = async () => {
    setSaveState('saving');
    setResultMsg('');
    setDeepLink(null);
    try {
      let result: SaveCodeFileResult;
      let msg: string;
      if (mode === 'create') {
        result = await saveNewCodeFile(code, name, description, selectedFolderId!, signature);
        msg =
          `Code file "${result.codeFileName}" created (id: ${result.codeFileId}` +
          `${result.majorRevision != null ? `, revision ${result.majorRevision}.${result.minorRevision}` : ''}).`;
      } else {
        result = await updateCodeFileWithRevision(
          code,
          selectedCodeFileId!,
          name,
          description,
          revisionType,
          signature,
        );
        msg =
          `New ${revisionType} revision of "${result.codeFileName}" created` +
          `${result.majorRevision != null ? ` (revision ${result.majorRevision}.${result.minorRevision})` : ''}.`;
      }
      msg += await maybeCreateScenario(result);
      setResultMsg(msg);
      // Offer a deep link straight into SAS Intelligent Decisioning.
      setDeepLink(buildDeepLink('decisionPythonFile', result.codeFileId));
      setSaveState('success');
    } catch (e) {
      setSaveState('error');
      setResultMsg(e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const handleSelectFolder = (folderId: string, folderName: string) => {
    setSelectedFolderId(folderId);
    setSelectedFolderName(folderName);
  };

  const handleSelectCodeFile = (fileId: string, fileName: string) => {
    setSelectedCodeFileId(fileId);
    setSelectedCodeFileName(fileName);
    // Default the name to the existing file's name (sanitized) if empty.
    if (!name) {
      const base = fileName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '_');
      if (NAME_RE.test(base)) setName(base.substring(0, 32));
    }
  };

  return (
    <Modal
      title="Save to SAS Intelligent Decisioning"
      onClose={onClose}
      size="large"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {saveState === 'success' ? 'Close' : 'Cancel'}
          </Button>
          {saveState !== 'success' && (
            <Button variant="primary" onClick={handleSave} disabled={!canSave} loading={saveState === 'saving'}>
              {mode === 'create' ? 'Create code file' : 'Save new revision'}
            </Button>
          )}
        </>
      }
    >
      <div className="schema-builder__save-form">
        {/* Mode toggle */}
        <div className="schema-builder__mode-toggle">
          <button
            type="button"
            className={`schema-builder__mode-btn${mode === 'create' ? ' schema-builder__mode-btn--active' : ''}`}
            aria-pressed={mode === 'create'}
            onClick={() => setMode('create')}
          >
            Create new
          </button>
          <button
            type="button"
            className={`schema-builder__mode-btn${mode === 'update' ? ' schema-builder__mode-btn--active' : ''}`}
            aria-pressed={mode === 'update'}
            onClick={() => setMode('update')}
          >
            Update existing
          </button>
        </div>

        {/* Name */}
        <div className="schema-builder__field">
          <label htmlFor="sb-save-name">
            Name <span className="schema-builder__required">*</span>
          </label>
          <input
            id="sb-save-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
            maxLength={32}
            placeholder="my_parser_code"
            className={`sas-input schema-builder__input--mono${name && !nameValid ? ' schema-builder__input--error' : ''}`}
          />
          <span className="schema-builder__hint">
            Max 32 characters, letters/digits/underscore only ({name.length}/32)
          </span>
        </div>

        {/* Description */}
        <div className="schema-builder__field">
          <label htmlFor="sb-save-desc">Description</label>
          <textarea
            id="sb-save-desc"
            value={description}
            onChange={e => setDescription(e.target.value.slice(0, 1000))}
            maxLength={1000}
            placeholder="Optional description..."
            className="sas-textarea schema-builder__textarea"
            rows={2}
          />
          <span className="schema-builder__hint">{description.length}/1000</span>
        </div>

        {mode === 'update' && (
          <div className="schema-builder__field">
            <label htmlFor="sb-revision-type">Revision type</label>
            <select
              id="sb-revision-type"
              className="sas-input"
              value={revisionType}
              onChange={e => setRevisionType(e.target.value as 'minor' | 'major')}
            >
              <option value="minor">Minor (x.Y+1)</option>
              <option value="major">Major (X+1.0)</option>
            </select>
          </div>
        )}

        {/* Folder / code file picker */}
        <div className="schema-builder__field">
          {/* Not a <label htmlFor>: the browser is a group of controls, not one
              form field, so it is named through FolderBrowser's ariaLabelledBy. */}
          <span className="schema-builder__field-caption" id="sb-target-folder-label">
            {mode === 'create' ? 'Target folder' : 'Select code file to update'}{' '}
            <span className="schema-builder__required">*</span>
          </span>
          {mode === 'create' ? (
            <FolderBrowser
              selectedFolderId={selectedFolderId}
              onSelect={handleSelectFolder}
              ariaLabelledBy="sb-target-folder-label"
            />
          ) : (
            <FolderBrowser
              selectedFolderId={selectedFolderId}
              onSelect={handleSelectFolder}
              pickFileUriPrefix={CODE_FILE_URI_PREFIX}
              selectedFileId={selectedCodeFileId}
              onSelectFile={handleSelectCodeFile}
              ariaLabelledBy="sb-target-folder-label"
            />
          )}
          {mode === 'create' && selectedFolderName && (
            <span className="schema-builder__hint">Selected folder: {selectedFolderName}</span>
          )}
          {mode === 'update' && selectedCodeFileName && (
            <span className="schema-builder__hint">Selected code file: {selectedCodeFileName}</span>
          )}
        </div>

        {/* Optional test scenario */}
        <div className="schema-builder__field">
          <label className="schema-builder__checkbox">
            <input
              type="checkbox"
              checked={createScenario}
              onChange={e => setCreateScenario(e.target.checked)}
            />
            <span>Also create a test scenario (uses the example schema as input)</span>
          </label>
        </div>

        {createScenario && (
          <div className="schema-builder__scenario-section">
            <ScenarioCasFields
              selectedServer={selectedServer}
              onServerChange={setSelectedServer}
              selectedCaslib={selectedCaslib}
              onCaslibChange={setSelectedCaslib}
            />

            <div className="schema-builder__field">
              <span className="schema-builder__field-caption" id="sb-scenario-folder-label">
                Scenario folder <span className="schema-builder__required">*</span>
              </span>
              <FolderBrowser
                selectedFolderId={scenarioFolderId}
                onSelect={(id, n) => { setScenarioFolderId(id); setScenarioFolderName(n); }}
                initialFolderId={selectedFolderId}
                ariaLabelledBy="sb-scenario-folder-label"
              />
              {scenarioFolderName && (
                <span className="schema-builder__hint">Scenario folder: {scenarioFolderName}</span>
              )}
            </div>
          </div>
        )}

        {/* Status */}
        {resultMsg && (
          <Alert variant={saveState === 'success' ? 'success' : 'error'}>
            <div>{resultMsg}</div>
            {saveState === 'success' && deepLink && (
              <a
                className="sas-deep-link schema-builder__deep-link"
                href={deepLink.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg
                  className="sas-deep-link__icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                {deepLink.label}
              </a>
            )}
          </Alert>
        )}
      </div>
    </Modal>
  );
};

export default SaveToSidDialog;
