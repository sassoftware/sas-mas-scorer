// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback, useId } from 'react';
import { Button } from '../common/Button';
import { Card, CardHeader, CardBody, CardFooter } from '../common/Card';
import { Alert } from '../common/Alert';
import { ENV_COLOR_PRESETS, applyEnvironmentColor } from '../../utils/envColor';

const DEFAULT_HEADER_COLOR = '#0766D1'; // --sas-blue-brand, shown on the "Default" swatch

/** The pieces of the current view that the surrounding chrome lays out. */
export interface ConnectionSettingsFrameParts {
  /** Heading for the current view ("Connections", "Add Connection", ...). */
  title: string;
  /** Header-level actions (the "Add Connection" button on the list view). */
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Buttons for the bottom bar; absent when the view has none. */
  footer?: React.ReactNode;
}

interface ConnectionSettingsProps {
  onSave: () => void;
  onCancel?: () => void;
  onConnectionSwitch?: () => void;
  /**
   * Chrome around the settings body. Defaults to a Card (the first-run page);
   * App passes a Modal frame for the in-app dialog so no Card nests in a Modal.
   */
  frame?: (parts: ConnectionSettingsFrameParts) => React.ReactNode;
}

type ViewMode = 'list' | 'add' | 'edit';

const cardFrame = ({ title, actions, children, footer }: ConnectionSettingsFrameParts) => (
  <Card>
    <CardHeader actions={actions}>
      <h3>{title}</h3>
    </CardHeader>
    <CardBody>{children}</CardBody>
    {footer && <CardFooter>{footer}</CardFooter>}
  </Card>
);

interface ColorSwatchProps {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
}

// A native radio gives the swatch its keyboard semantics, checked state and
// accessible name; the checkmark makes the selection visible without colour.
const ColorSwatch: React.FC<ColorSwatchProps> = ({ name, value, checked, onSelect }) => (
  <label className="connection-settings__swatch" title={name}>
    <input
      type="radio"
      name="envColor"
      className="connection-settings__swatch-input"
      aria-label={name}
      checked={checked}
      onChange={onSelect}
    />
    <span className="connection-settings__swatch-color" style={{ background: value }} aria-hidden="true">
      {checked && (
        <svg
          className="connection-settings__swatch-check"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      )}
    </span>
  </label>
);

export const ConnectionSettings: React.FC<ConnectionSettingsProps> = ({
  onSave,
  onCancel,
  onConnectionSwitch,
  frame = cardFrame,
}) => {
  const fieldId = useId();
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
  const [color, setColor] = useState(''); // '' = default SAS branding
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
    setColor('');
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
    setColor(conn.color ?? '');
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
      color: color || undefined,
    };

    if (view === 'edit' && editingConnection) {
      await window.electronAPI.updateConnection({ ...connData, id: editingConnection.id });
      // Editing the active connection: recolor the chrome immediately
      if (editingConnection.id === activeId) {
        applyEnvironmentColor(connData.color ?? null);
      }
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
    const isPresetColor = color === '' || ENV_COLOR_PRESETS.some((p) => p.value === color);
    const nameId = `${fieldId}-name`;
    const urlId = `${fieldId}-url`;
    const clientIdId = `${fieldId}-client-id`;
    const clientSecretId = `${fieldId}-client-secret`;
    const colorLabelId = `${fieldId}-color-label`;

    return (
      <div className="connection-settings">
        {frame({
          title: view === 'edit' ? 'Edit Connection' : 'Add Connection',
          children: (
            <div className="connection-settings__form">
              {error && (
                <Alert variant="error" dismissible onClose={() => setError(null)}>
                  {error}
                </Alert>
              )}
              <div className="connection-settings__grid">
                <div className="connection-settings__group connection-settings__group--full">
                  <label className="connection-settings__label" htmlFor={nameId}>
                    <span className="connection-settings__label-text">Connection Name</span>
                    <span className="connection-settings__hint">A label for this connection (e.g. "Production", "Dev")</span>
                  </label>
                  <input
                    id={nameId}
                    type="text"
                    className="sas-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My Viya Server"
                    autoFocus
                  />
                </div>
                <div className="connection-settings__group connection-settings__group--full">
                  <label className="connection-settings__label" htmlFor={urlId}>
                    <span className="connection-settings__label-text">SAS Viya Server URL</span>
                  </label>
                  <input
                    id={urlId}
                    type="url"
                    className="sas-input"
                    value={viyaUrl}
                    onChange={(e) => setViyaUrl(e.target.value)}
                    placeholder="https://your-viya-server.example.com"
                  />
                </div>
                <div className="connection-settings__group">
                  <label className="connection-settings__label" htmlFor={clientIdId}>
                    <span className="connection-settings__label-text">Client ID</span>
                    <span className="connection-settings__hint">Default: vscode (works with Viya 2022.11+)</span>
                  </label>
                  <input
                    id={clientIdId}
                    type="text"
                    className="sas-input"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="vscode"
                  />
                </div>
                <div className="connection-settings__group">
                  <label className="connection-settings__label" htmlFor={clientSecretId}>
                    <span className="connection-settings__label-text">Client Secret</span>
                    <span className="connection-settings__hint">Leave empty for default public client</span>
                  </label>
                  <input
                    id={clientSecretId}
                    type="password"
                    className="sas-input"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="(empty)"
                  />
                </div>
                <div className="connection-settings__group connection-settings__group--full">
                  <div className="connection-settings__label">
                    <span className="connection-settings__label-text" id={colorLabelId}>Environment Color</span>
                    <span className="connection-settings__hint">
                      Colors the app header while this connection is active, so you can tell environments apart at a glance
                    </span>
                  </div>
                  <div className="connection-settings__swatches">
                    <div className="connection-settings__swatch-group" role="radiogroup" aria-labelledby={colorLabelId}>
                      <ColorSwatch
                        name="Default (SAS blue)"
                        value={DEFAULT_HEADER_COLOR}
                        checked={color === ''}
                        onSelect={() => setColor('')}
                      />
                      {ENV_COLOR_PRESETS.map((preset) => (
                        <ColorSwatch
                          key={preset.value}
                          name={preset.name}
                          value={preset.value}
                          checked={color === preset.value}
                          onSelect={() => setColor(preset.value)}
                        />
                      ))}
                    </div>
                    <label
                      className={`connection-settings__custom-color ${
                        isPresetColor ? '' : 'connection-settings__custom-color--active'
                      }`}
                      title="Custom color"
                    >
                      <input
                        type="color"
                        className="connection-settings__custom-color-input"
                        aria-label="Custom color"
                        value={color || DEFAULT_HEADER_COLOR}
                        onChange={(e) => setColor(e.target.value)}
                      />
                      <span className="connection-settings__hint">Custom</span>
                    </label>
                  </div>
                </div>
                <div className="connection-settings__group connection-settings__group--full">
                  <label className="connection-settings__checkbox">
                    <input
                      type="checkbox"
                      checked={insecureSsl}
                      onChange={(e) => setInsecureSsl(e.target.checked)}
                    />
                    <span className="connection-settings__label-text">Skip SSL certificate verification</span>
                  </label>
                  {insecureSsl && (
                    <Alert variant="warning">
                      SSL verification is disabled. Only use this for development or testing environments with self-signed certificates.
                    </Alert>
                  )}
                </div>
              </div>
            </div>
          ),
          footer: (
            <>
              <Button variant="tertiary" onClick={handleBackToList}>
                {connections.length === 0 && onCancel ? 'Cancel' : 'Back'}
              </Button>
              <Button variant="primary" onClick={handleSave}>
                {view === 'edit' ? 'Update Connection' : 'Save Connection'}
              </Button>
            </>
          ),
        })}
      </div>
    );
  }

  // --- List View ---
  return (
    <div className="connection-settings">
      {frame({
        title: 'Connections',
        actions: (
          <Button variant="primary" size="small" onClick={openAddForm}>
            Add Connection
          </Button>
        ),
        children:
          connections.length === 0 ? (
            <p className="connection-settings__empty">No connections configured.</p>
          ) : (
            <ul className="connection-settings__list">
              {connections.map((conn) => {
                const isActive = conn.id === activeId;
                return (
                  <li
                    key={conn.id}
                    className={`connection-settings__row ${isActive ? 'connection-settings__row--active' : ''}`}
                  >
                    <div className="connection-settings__row-main">
                      <span
                        className={`connection-settings__indicator ${
                          isActive ? 'connection-settings__indicator--active' : ''
                        }`}
                        aria-hidden="true"
                      />
                      {conn.color && (
                        <span
                          className="connection-settings__color-chip"
                          style={{ background: conn.color }}
                          role="img"
                          aria-label="Environment color"
                          title="Environment color"
                        />
                      )}
                      <div className="connection-settings__row-text">
                        <div className="connection-settings__row-name">
                          {conn.name}
                          {isActive && <span className="connection-settings__active-label">Active</span>}
                        </div>
                        <div className="connection-settings__row-url">{conn.viyaUrl}</div>
                      </div>
                    </div>
                    <div className="connection-settings__actions">
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
                          <Button variant="danger" size="small" onClick={() => handleDelete(conn.id)}>
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
                  </li>
                );
              })}
            </ul>
          ),
        footer: onCancel ? (
          <Button variant="tertiary" onClick={onCancel}>
            Close
          </Button>
        ) : undefined,
      })}
    </div>
  );
};

export default ConnectionSettings;
