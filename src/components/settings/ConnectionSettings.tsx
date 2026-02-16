// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../common/Button';
import { Card, CardHeader, CardBody, CardFooter } from '../common/Card';
import { Alert } from '../common/Alert';

interface ConnectionSettingsProps {
  onSave: () => void;
  onCancel?: () => void;
  onConnectionSwitch?: () => void;
}

type ViewMode = 'list' | 'add' | 'edit';

export const ConnectionSettings: React.FC<ConnectionSettingsProps> = ({
  onSave,
  onCancel,
  onConnectionSwitch,
}) => {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('list');
  const [editingConnection, setEditingConnection] = useState<SavedConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [viyaUrl, setViyaUrl] = useState('');
  const [clientId, setClientId] = useState('vscode');
  const [clientSecret, setClientSecret] = useState('');
  const [insecureSsl, setInsecureSsl] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    if (!window.electronAPI) return;
    const [conns, active] = await Promise.all([
      window.electronAPI.getAllConnections(),
      window.electronAPI.getActiveConnection(),
    ]);
    setConnections(conns);
    setActiveId(active?.id ?? null);
  }, []);

  useEffect(() => {
    const init = async () => {
      await loadConnections();
      setLoading(false);
    };
    init();
  }, [loadConnections]);

  // If zero connections, go straight to add form
  useEffect(() => {
    if (!loading && connections.length === 0 && view === 'list') {
      setView('add');
    }
  }, [loading, connections.length, view]);

  const resetForm = () => {
    setName('');
    setViyaUrl('');
    setClientId('vscode');
    setClientSecret('');
    setInsecureSsl(false);
    setError(null);
    setEditingConnection(null);
  };

  const openAddForm = () => {
    resetForm();
    setView('add');
  };

  const openEditForm = (conn: SavedConnection) => {
    setEditingConnection(conn);
    setName(conn.name);
    setViyaUrl(conn.viyaUrl);
    setClientId(conn.clientId);
    setClientSecret(conn.clientSecret);
    setInsecureSsl(conn.insecureSsl);
    setError(null);
    setView('edit');
  };

  const handleBackToList = () => {
    // If there are no connections and we're adding the first one, treat back as cancel
    if (connections.length === 0 && onCancel) {
      onCancel();
      return;
    }
    resetForm();
    setView('list');
  };

  const validateForm = (): boolean => {
    setError(null);
    if (!name.trim()) {
      setError('Connection name is required.');
      return false;
    }
    if (!viyaUrl.trim()) {
      setError('SAS Viya Server URL is required.');
      return false;
    }
    try {
      new URL(viyaUrl.trim());
    } catch {
      setError('Invalid URL format. Please enter a valid URL (e.g., https://viya.example.com).');
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validateForm() || !window.electronAPI) return;

    const connData = {
      name: name.trim(),
      viyaUrl: viyaUrl.trim().replace(/\/+$/, ''),
      clientId: clientId.trim() || 'vscode',
      clientSecret,
      insecureSsl,
    };

    if (view === 'edit' && editingConnection) {
      await window.electronAPI.updateConnection({ ...connData, id: editingConnection.id });
    } else {
      const saved = await window.electronAPI.addConnection(connData);
      // Auto-activate first connection
      if (connections.length === 0) {
        await window.electronAPI.setActiveConnection(saved.id);
      }
    }

    await loadConnections();
    resetForm();

    // If this was the first connection (auto-activated), close settings
    if (connections.length === 0) {
      onSave();
      return;
    }

    setView('list');
  };

  const handleSwitch = async (id: string) => {
    if (!window.electronAPI) return;
    await window.electronAPI.setActiveConnection(id);
    setActiveId(id);
    await loadConnections();
    onConnectionSwitch?.();
    onSave();
  };

  const handleDelete = async (id: string) => {
    if (!window.electronAPI) return;
    await window.electronAPI.deleteConnection(id);
    setDeleteConfirmId(null);
    await loadConnections();
    // If we deleted the active connection, notify parent
    if (id === activeId) {
      onConnectionSwitch?.();
    }
  };

  if (loading) {
    return null;
  }

  // --- Add / Edit Form ---
  if (view === 'add' || view === 'edit') {
    return (
      <div className="connection-settings">
        <Card padding="none">
          <CardHeader>
            <h3>{view === 'edit' ? 'Edit Connection' : 'Add Connection'}</h3>
          </CardHeader>
          <CardBody>
            {error && (
              <Alert variant="error" dismissible onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            <div className="input-form__grid" style={{ marginTop: error ? '16px' : 0 }}>
              <div className="input-form__group input-form__group--full">
                <label className="input-form__label">
                  <span className="input-form__label-text">Connection Name</span>
                  <span className="input-form__hint">A label for this connection (e.g. "Production", "Dev")</span>
                </label>
                <input
                  type="text"
                  className="sas-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Viya Server"
                  autoFocus
                />
              </div>
              <div className="input-form__group input-form__group--full">
                <label className="input-form__label">
                  <span className="input-form__label-text">SAS Viya Server URL</span>
                </label>
                <input
                  type="url"
                  className="sas-input"
                  value={viyaUrl}
                  onChange={(e) => setViyaUrl(e.target.value)}
                  placeholder="https://your-viya-server.example.com"
                />
              </div>
              <div className="input-form__group">
                <label className="input-form__label">
                  <span className="input-form__label-text">Client ID</span>
                  <span className="input-form__hint">Default: vscode (works with Viya 2022.11+)</span>
                </label>
                <input
                  type="text"
                  className="sas-input"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="vscode"
                />
              </div>
              <div className="input-form__group">
                <label className="input-form__label">
                  <span className="input-form__label-text">Client Secret</span>
                  <span className="input-form__hint">Leave empty for default public client</span>
                </label>
                <input
                  type="password"
                  className="sas-input"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="(empty)"
                />
              </div>
              <div className="input-form__group input-form__group--full">
                <label className="input-form__label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={insecureSsl}
                    onChange={(e) => setInsecureSsl(e.target.checked)}
                  />
                  <span className="input-form__label-text">Skip SSL certificate verification</span>
                </label>
                {insecureSsl && (
                  <Alert variant="warning">
                    SSL verification is disabled. Only use this for development or testing environments with self-signed certificates.
                  </Alert>
                )}
              </div>
            </div>
          </CardBody>
          <CardFooter>
            <Button variant="tertiary" onClick={handleBackToList}>
              {connections.length === 0 && onCancel ? 'Cancel' : 'Back'}
            </Button>
            <Button variant="primary" onClick={handleSave}>
              {view === 'edit' ? 'Update Connection' : 'Save Connection'}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // --- List View ---
  return (
    <div className="connection-settings">
      <Card padding="none">
        <CardHeader>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <h3>Connections</h3>
            <Button variant="primary" size="small" onClick={openAddForm}>
              Add Connection
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          {connections.length === 0 ? (
            <p style={{ color: 'var(--sas-gray-500)', textAlign: 'center', padding: '24px 0' }}>
              No connections configured.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {connections.map((conn) => {
                const isActive = conn.id === activeId;
                return (
                  <div
                    key={conn.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      border: `1px solid ${isActive ? 'var(--sas-blue-300, #66b2ff)' : 'var(--sas-gray-200, #e0e0e0)'}`,
                      background: isActive ? 'var(--sas-blue-50, #e6f2ff)' : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: isActive ? 'var(--sas-green-500, #28a745)' : 'var(--sas-gray-300, #ccc)',
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {conn.name}
                          {isActive && (
                            <span style={{ fontWeight: 400, fontSize: '0.8em', color: 'var(--sas-green-600, #218838)', marginLeft: '8px' }}>
                              Active
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.85em', color: 'var(--sas-gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {conn.viyaUrl}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0, marginLeft: '12px' }}>
                      {!isActive && (
                        <Button variant="primary" size="small" onClick={() => handleSwitch(conn.id)}>
                          Switch
                        </Button>
                      )}
                      <Button variant="tertiary" size="small" onClick={() => openEditForm(conn)}>
                        Edit
                      </Button>
                      {deleteConfirmId === conn.id ? (
                        <>
                          <Button variant="tertiary" size="small" onClick={() => handleDelete(conn.id)}
                            style={{ color: 'var(--sas-red-500, #dc3545)' }}>
                            Confirm
                          </Button>
                          <Button variant="tertiary" size="small" onClick={() => setDeleteConfirmId(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button variant="tertiary" size="small" onClick={() => setDeleteConfirmId(conn.id)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
        {onCancel && (
          <CardFooter>
            <Button variant="tertiary" onClick={onCancel}>
              Close
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
};

export default ConnectionSettings;
