// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { UIDefinitionSummary } from '../../types/uiBuilder';
import { PageHeader } from '../layout/Layout';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Loading } from '../common/Loading';
import { EmptyState } from '../common/EmptyState';
import { UIAppCard } from './UIAppCard';
import { ListToolbar } from '../common/ListTable';
import { saveTextFile } from '../../utils/download';
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
  const [runtime, setRuntime] = useState<'all' | 'mas' | 'scr'>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

    // Where an embed blocks downloads, the shared fallback offers a copy.
    saveTextFile(json, `ui-app-${id}.json`, 'application/json');
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

  const searched = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return q
      ? apps.filter(a =>
          a.name.toLowerCase().includes(q) ||
          a.moduleId.toLowerCase().includes(q) ||
          (a.description ?? '').toLowerCase().includes(q)
        )
      : apps;
  }, [apps, searchTerm]);
  const filtered = searched.filter(a => runtime === 'all' || (runtime === 'scr') === !!a.scrUrl);
  const deleting = apps.find(a => a.id === confirmDeleteId);

  return (
    <div className="ui-apps-list">
      <PageHeader
        title="UI Apps"
        count={loading ? undefined : `${apps.length} app${apps.length === 1 ? '' : 's'}`}
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

      {confirmDeleteId && (
        <Alert variant="warning" title="Confirm Delete">
          <p>Delete the UI app <strong>{deleting?.name ?? ''}</strong>? This can't be undone; Export it first to keep a copy.</p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <Button variant="danger" size="small" onClick={confirmDelete}>Delete</Button>
            <Button variant="tertiary" size="small" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
          </div>
        </Alert>
      )}

      <ListToolbar
        chips={[
          { value: 'all', label: 'All', count: searched.length },
          { value: 'mas', label: 'MAS module', count: searched.filter(a => !a.scrUrl).length },
          { value: 'scr', label: 'SCR endpoint', count: searched.filter(a => !!a.scrUrl).length },
        ]}
        activeChip={runtime}
        onChipChange={setRuntime}
        chipsLabel="Filter by where the app scores"
        search={{ value: searchTerm, onChange: setSearchTerm, placeholder: 'Search UI apps', ariaLabel: 'Search UI apps' }}
      />

      {loading ? (
        <Loading message="Loading UI apps..." />
      ) : filtered.length === 0 ? (
        apps.length === 0 ? (
          <EmptyState
            title="No UI apps yet"
            hint='Create your first custom scoring interface by clicking "Create New" or by opening a MAS module or an SCR endpoint and clicking "Build UI".'
          />
        ) : (
          <EmptyState title={searchTerm ? `No apps match "${searchTerm}"` : 'No apps of this kind'} />
        )
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
