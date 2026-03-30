// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import {
  getCasServers,
  getCaslibs,
  uploadToCas,
  saveTable,
  CasServer,
  CasLib,
  UploadResult,
} from '../../api/cas';

interface CasUploadDialogProps {
  csvContent: string;
  defaultTableName: string;
  onClose: () => void;
}

export const CasUploadDialog: React.FC<CasUploadDialogProps> = ({
  csvContent,
  defaultTableName,
  onClose,
}) => {
  // Selection state
  const [servers, setServers] = useState<CasServer[]>([]);
  const [caslibs, setCaslibs] = useState<CasLib[]>([]);
  const [selectedServer, setSelectedServer] = useState('');
  const [selectedCaslib, setSelectedCaslib] = useState('');
  const [tableName, setTableName] = useState(defaultTableName);

  // Loading/progress state
  const [loadingServers, setLoadingServers] = useState(true);
  const [loadingCaslibs, setLoadingCaslibs] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');

  // Options
  const [saveAfterUpload, setSaveAfterUpload] = useState(true);

  // Result state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<UploadResult | null>(null);

  // Load CAS servers on mount
  useEffect(() => {
    const load = async () => {
      try {
        const serverList = await getCasServers();
        setServers(serverList);
        if (serverList.length > 0) {
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
      setSelectedCaslib('');
      setError(null);
      try {
        const caslibList = await getCaslibs(selectedServer);
        setCaslibs(caslibList);
        if (caslibList.length > 0) {
          // Prefer "Public" caslib if available
          const publicLib = caslibList.find(c =>
            c.name.toLowerCase() === 'public'
          );
          setSelectedCaslib(publicLib?.name ?? caslibList[0].name);
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

  // Count rows in CSV for display
  const rowCount = csvContent.split('\n').filter(line => line.trim()).length - 1; // minus header

  return (
    <div className="cas-upload-overlay" onClick={onClose}>
      <div className="cas-upload-dialog" onClick={e => e.stopPropagation()}>
        <div className="cas-upload-dialog__header">
          <h3>Upload to CAS</h3>
          <button className="cas-upload-dialog__close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="cas-upload-dialog__body">
          {success ? (
            <div className="cas-upload-dialog__success">
              <Alert variant="success">
                Table uploaded successfully!
              </Alert>
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
              <div className="cas-upload-dialog__actions">
                <Button variant="primary" onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="cas-upload-dialog__description">
                Upload {rowCount} scored row{rowCount !== 1 ? 's' : ''} to a CAS table.
              </p>

              {/* Server selection */}
              <div className="cas-upload-dialog__field">
                <label className="cas-upload-dialog__label">CAS Server</label>
                {loadingServers ? (
                  <span className="cas-upload-dialog__loading">Loading servers...</span>
                ) : (
                  <select
                    className="cas-upload-dialog__select"
                    value={selectedServer}
                    onChange={e => setSelectedServer(e.target.value)}
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
                <label className="cas-upload-dialog__label">Caslib</label>
                {loadingCaslibs ? (
                  <span className="cas-upload-dialog__loading">Loading caslibs...</span>
                ) : (
                  <select
                    className="cas-upload-dialog__select"
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
                <label className="cas-upload-dialog__label">Table Name</label>
                <input
                  className="cas-upload-dialog__input"
                  type="text"
                  value={tableName}
                  onChange={handleTableNameChange}
                  placeholder="Enter table name"
                  disabled={uploading}
                />
                <span className="cas-upload-dialog__hint">
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

              {/* Error */}
              {error && (
                <Alert variant="error">
                  {error}
                </Alert>
              )}

              {/* Upload status */}
              {uploading && uploadStatus && (
                <div className="cas-upload-dialog__status">
                  <div className="cas-upload-dialog__spinner" />
                  <span>{uploadStatus}</span>
                </div>
              )}

              {/* Actions */}
              <div className="cas-upload-dialog__actions">
                <Button variant="tertiary" onClick={onClose} disabled={uploading}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => handleUpload()}
                  disabled={!canUpload}
                >
                  {uploading ? 'Uploading...' : 'Upload'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CasUploadDialog;
