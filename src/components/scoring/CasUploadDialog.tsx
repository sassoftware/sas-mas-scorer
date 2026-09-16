// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Modal } from '../common/Modal';
import { uploadToCas, saveTable, UploadResult } from '../../api/cas';
import { useCasCatalog } from '../../hooks/useCasCatalog';

interface CasUploadDialogProps {
  csvContent: string;
  /** Number of data rows in `csvContent` (excluding the header). */
  rowCount: number;
  defaultTableName: string;
  onClose: () => void;
}

export const CasUploadDialog: React.FC<CasUploadDialogProps> = ({
  csvContent,
  rowCount,
  defaultTableName,
  onClose,
}) => {
  // Selection state — the catalogue itself comes from the shared session
  // cache; only the two selections live here.
  const [selectedServer, setSelectedServer] = useState('');
  const [selectedCaslib, setSelectedCaslib] = useState('');
  const [tableName, setTableName] = useState(defaultTableName);
  const {
    servers,
    caslibs,
    loadingServers,
    loadingCaslibs,
    error: casError,
  } = useCasCatalog(selectedServer);

  // Loading/progress state
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');

  // Options
  const [saveAfterUpload, setSaveAfterUpload] = useState(true);

  // Result state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<UploadResult | null>(null);

  // Auto-select the first server offered. This is the initial fill, not a
  // user switch, so it must not clear an error the way handleServerChange does.
  useEffect(() => {
    if (selectedServer || servers.length === 0) return;
    setSelectedServer(servers[0].name);
  }, [servers, selectedServer]);

  // A user server switch drops the caslib under it and clears any stale
  // failure — an upload error from the previous server must not sit under the
  // new selection. (The old caslib-load effect did this reset; the shared
  // catalogue hook owns that load now, so the handler has to.)
  const handleServerChange = useCallback((serverName: string) => {
    setSelectedServer(serverName);
    setSelectedCaslib('');
    setError(null);
  }, []);

  // Prefer the "Public" caslib, else the first one.
  useEffect(() => {
    if (caslibs.length === 0) {
      setSelectedCaslib('');
      return;
    }
    setSelectedCaslib(
      caslibs.find(c => c.name.toLowerCase() === 'public')?.name ?? caslibs[0].name
    );
  }, [caslibs]);

  // Sanitize table name
  const handleTableNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = e.target.value.replace(/[^a-zA-Z0-9_]/g, '');
    setTableName(sanitized);
  }, []);

  // Build a unique table name: base name + _<short id>, max 32 chars
  const buildUniqueTableName = useCallback((base: string): string => {
    const suffix = '_' + Date.now().toString(36);
    const maxBase = 32 - suffix.length;
    return base.slice(0, maxBase) + suffix;
  }, []);

  const [finalTableName, setFinalTableName] = useState('');

  const handleUpload = useCallback(async () => {
    setUploading(true);
    setError(null);
    setSuccess(null);

    const uniqueName = buildUniqueTableName(tableName);
    setFinalTableName(uniqueName);

    try {
      const result = await uploadToCas(
        selectedServer,
        selectedCaslib,
        uniqueName,
        csvContent,
        setUploadStatus
      );

      if (result.success) {
        // Save (persist) the table to the caslib data source if requested
        if (saveAfterUpload) {
          setUploadStatus('Saving table to disk...');
          try {
            await saveTable(selectedServer, selectedCaslib, uniqueName);
          } catch {
            // Upload succeeded but save failed — still show success with a note
            setSuccess(result);
            setError('Table was uploaded to CAS but could not be saved to disk. You can save it manually from SAS Environment Manager.');
            return;
          }
        }
        setSuccess(result);
      } else {
        setError(result.error ?? 'Upload failed');
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      setUploadStatus('');
    }
  }, [selectedServer, selectedCaslib, tableName, csvContent, saveAfterUpload, buildUniqueTableName]);

  const canUpload = selectedServer && selectedCaslib && tableName && !uploading;

  // An upload in flight cannot be abandoned from the dialog
  const handleClose = useCallback(() => {
    if (!uploading) onClose();
  }, [uploading, onClose]);

  return (
    <Modal
      title="Upload to CAS"
      onClose={handleClose}
      closeOnBackdropClick={!uploading}
      footer={
        success ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="tertiary" onClick={onClose} disabled={uploading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => handleUpload()}
              disabled={!canUpload}
              loading={uploading}
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </>
        )
      }
    >
      {success ? (
        <div className="cas-upload-dialog__success">
          <Alert variant="success">
            Table uploaded successfully!
          </Alert>
          {error && (
            <Alert variant="warning">
              {error}
            </Alert>
          )}
          <div className="cas-upload-dialog__result-info">
            <div className="cas-upload-dialog__result-row">
              <span className="cas-upload-dialog__result-label">Server</span>
              <span className="cas-upload-dialog__result-value">{selectedServer}</span>
            </div>
            <div className="cas-upload-dialog__result-row">
              <span className="cas-upload-dialog__result-label">Caslib</span>
              <span className="cas-upload-dialog__result-value">{selectedCaslib}</span>
            </div>
            <div className="cas-upload-dialog__result-row">
              <span className="cas-upload-dialog__result-label">Table</span>
              <span className="cas-upload-dialog__result-value">{finalTableName}</span>
            </div>
            {success.tableInfo?.rowCount != null && (
              <div className="cas-upload-dialog__result-row">
                <span className="cas-upload-dialog__result-label">Rows</span>
                <span className="cas-upload-dialog__result-value">{success.tableInfo.rowCount}</span>
              </div>
            )}
            {success.tableInfo?.columnCount != null && (
              <div className="cas-upload-dialog__result-row">
                <span className="cas-upload-dialog__result-label">Columns</span>
                <span className="cas-upload-dialog__result-value">{success.tableInfo.columnCount}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="cas-upload-dialog__fields">
          <p className="cas-upload-dialog__description">
            Upload {rowCount} scored row{rowCount !== 1 ? 's' : ''} to a CAS table.
          </p>

          {/* Server selection */}
          <div className="cas-upload-dialog__field">
            <label className="cas-upload-dialog__label" htmlFor="cas-upload-server">CAS Server</label>
            {loadingServers ? (
              <span className="cas-upload-dialog__loading" role="status">Loading servers...</span>
            ) : (
              <select
                id="cas-upload-server"
                className="sas-input"
                value={selectedServer}
                onChange={e => handleServerChange(e.target.value)}
                disabled={uploading}
              >
                {servers.length === 0 && <option value="">No servers available</option>}
                {servers.map(s => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Caslib selection */}
          <div className="cas-upload-dialog__field">
            <label className="cas-upload-dialog__label" htmlFor="cas-upload-caslib">Caslib</label>
            {loadingCaslibs ? (
              <span className="cas-upload-dialog__loading" role="status">Loading caslibs...</span>
            ) : (
              <select
                id="cas-upload-caslib"
                className="sas-input"
                value={selectedCaslib}
                onChange={e => setSelectedCaslib(e.target.value)}
                disabled={uploading || !selectedServer}
              >
                {caslibs.length === 0 && <option value="">No caslibs available</option>}
                {caslibs.map(c => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Table name */}
          <div className="cas-upload-dialog__field">
            <label className="cas-upload-dialog__label" htmlFor="cas-upload-table-name">Table Name</label>
            <input
              id="cas-upload-table-name"
              className="sas-input"
              type="text"
              value={tableName}
              onChange={handleTableNameChange}
              placeholder="Enter table name"
              disabled={uploading}
              aria-describedby="cas-upload-table-name-hint"
            />
            <span className="cas-upload-dialog__hint" id="cas-upload-table-name-hint">
              Only letters, numbers, and underscores allowed. A unique suffix will be appended automatically.
            </span>
          </div>

          {/* Save to disk checkbox */}
          <label className="cas-upload-dialog__checkbox-label">
            <input
              type="checkbox"
              checked={saveAfterUpload}
              onChange={e => setSaveAfterUpload(e.target.checked)}
              disabled={uploading}
            />
            <span>Save table to disk after upload</span>
          </label>

          {/* Error — the upload failure wins over a catalogue failure */}
          {(error ?? casError) && (
            <Alert variant="error">
              {error ?? casError}
            </Alert>
          )}

          {/* Upload status */}
          {uploading && uploadStatus && (
            <div className="cas-upload-dialog__status" role="status">
              <span className="sas-spinner" aria-hidden="true" />
              <span>{uploadStatus}</span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default CasUploadDialog;
