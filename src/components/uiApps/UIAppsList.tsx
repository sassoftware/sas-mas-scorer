// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback } from 'react';
import { UIDefinitionSummary } from '../../types/uiBuilder';
import { PageHeader } from '../layout/Layout';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Loading } from '../common/Loading';
import { UIAppCard } from './UIAppCard';
import {
  listUIDefinitions,
  deleteUIDefinition,
  duplicateUIDefinition,
  exportUIDefinition,
  importUIDefinition,
} from '../../storage/uiStorage';

interface Props {
  onRun: (id: string) => void;
  onEdit: (id: string) => void;
  onCreateNew: () => void;
}

export const UIAppsList: React.FC<Props> = ({ onRun, onEdit, onCreateNew }) => {
  const [apps, setApps] = useState<UIDefinitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadApps = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listUIDefinitions();
      setApps(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load UI apps');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadApps(); }, [loadApps]);

  const handleDelete = (id: string) => {
    setConfirmDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    await deleteUIDefinition(confirmDeleteId);
    setConfirmDeleteId(null);
    await loadApps();
  };

  const handleDuplicate = async (id: string) => {
    const original = apps.find(a => a.id === id);
    await duplicateUIDefinition(id, `${original?.name ?? 'App'} (Copy)`);
    await loadApps();
  };

  const handleExport = async (id: string) => {
    const json = await exportUIDefinition(id);
    if (!json) return;

    // In a sandboxed iframe, programmatic downloads are silently blocked.
    // Detect sandbox: if we're in an iframe without allow-downloads, use clipboard.
    const isSandboxed = window !== window.top;

    if (!isSandboxed) {
      const blob = new Blob([json], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `ui-app-${id}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } else {
      try {
        await navigator.clipboard.writeText(json);
        setSuccessMessage('JSON copied to clipboard (download not available in sandboxed mode).');
      } catch {
        setError('Export failed — clipboard access is blocked. Try running the app outside of SAS Visual Analytics.');
      }
    }
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        await importUIDefinition(text);
        await loadApps();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Import failed');
      }
    };
    input.click();
  };

  const filtered = searchTerm
    ? apps.filter(a =>
        a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.moduleId.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : apps;

  return (
    <div className="ui-apps-list">
      <PageHeader
        title="UI Apps"
        subtitle={`${apps.length} saved UI app${apps.length !== 1 ? 's' : ''}`}
        actions={
          <div className="ui-apps-list__actions">
            <Button variant="secondary" onClick={handleImport}>Import</Button>
            <Button variant="primary" onClick={onCreateNew}>Create New</Button>
          </div>
        }
      />

      {error && (
        <Alert variant="error" title="Error" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {successMessage && (
        <Alert variant="success" title="Success" dismissible onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}

      {confirmDeleteId && (
        <Alert variant="warning" title="Confirm Delete">
          <p>Delete this UI App?</p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <Button variant="danger" size="small" onClick={confirmDelete}>Delete</Button>
            <Button variant="tertiary" size="small" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
          </div>
        </Alert>
      )}

      <div className="ui-apps-list__search">
        <input
          type="text"
          className="sas-input"
          placeholder="Search UI apps..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {loading ? (
        <Loading message="Loading UI apps..." />
      ) : filtered.length === 0 ? (
        <div className="ui-apps-list__empty">
          {apps.length === 0 ? (
            <>
              <p>No UI apps yet.</p>
              <p>Create your first custom scoring interface by clicking "Create New" or by navigating to a module and clicking "Build UI".</p>
            </>
          ) : (
            <p>No apps match "{searchTerm}"</p>
          )}
        </div>
      ) : (
        <div className="ui-apps-list__grid">
          {filtered.map(app => (
            <UIAppCard
              key={app.id}
              app={app}
              onRun={onRun}
              onEdit={onEdit}
              onDuplicate={handleDuplicate}
              onExport={handleExport}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
};
