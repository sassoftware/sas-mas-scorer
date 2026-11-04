// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../layout/Layout';
import { Card, CardBody, CardHeader } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';
import { inspectEndpoint, normalizeScoreUrl, reachableFromHere, RUNTIME_LABELS } from '../../api/scr';
import {
  addScrEndpoint,
  listScrEndpoints,
  removeScrEndpoint,
  updateScrEndpoint,
  type SavedScrEndpoint,
} from '../../storage/scrEndpoints';

export const scrEndpointRoute = (id: string): string => `/scr/${encodeURIComponent(id)}`;

const isElectron = !!window.electronAPI;

const endpointName = (endpoint: SavedScrEndpoint): string =>
  endpoint.label || decodeURIComponent(endpoint.url.slice(endpoint.url.lastIndexOf('/') + 1));

export const ScrEndpointsPage: React.FC = () => {
  const navigate = useNavigate();
  const [endpoints, setEndpoints] = useState<SavedScrEndpoint[]>(() => listScrEndpoints());
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    let scoreUrl: string;
    try {
      scoreUrl = normalizeScoreUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    const reach = reachableFromHere(scoreUrl);
    if (!reach.reachable) {
      setError(reach.reason ?? 'This endpoint cannot be reached from here.');
      return;
    }
    setBusy(true);
    try {
      // Read the signature first, so only an endpoint that answers is kept.
      const info = await inspectEndpoint(scoreUrl);
      const entry = addScrEndpoint(scoreUrl, label);
      updateScrEndpoint(entry.id, {
        lastSeen: { runtime: info.runtime, mode: info.mode, title: info.title, at: new Date().toISOString() },
      });
      setUrl('');
      setLabel('');
      navigate(scrEndpointRoute(entry.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = (id: string) => {
    removeScrEndpoint(id);
    setEndpoints(listScrEndpoints());
  };

  return (
    <div className="scr-page">
      <PageHeader
        title="SCR Endpoints"
        subtitle="Score models and decisions running in SAS Container Runtime, using only the endpoint URL."
      />

      <Card>
        <CardHeader>Add an endpoint</CardHeader>
        <CardBody>
          <form className="scr-add" onSubmit={handleAdd}>
            <div className="scr-add__fields">
              <label className="scr-field scr-field--grow">
                <span className="scr-field__label">Score URL</span>
                <input
                  className="sas-input"
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://host/path/model_name"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label className="scr-field">
                <span className="scr-field__label">Name (optional)</span>
                <input
                  className="sas-input"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Shown in the list"
                />
              </label>
              <Button type="submit" loading={busy} disabled={!url.trim()}>
                Connect
              </Button>
            </div>
            <p className="scr-hint">
              The URL a score is posted to: the container address followed by the model or decision name,
              e.g. <code>http://scr-host:8080/my_model</code>. The app reads its signature from{' '}
              <code>/apiMeta/api</code> and checks it before saving.
              {!isElectron && (
                <>
                  {' '}In the browser, only endpoints on this app&apos;s host ({window.location.origin}) can be
                  reached, because SAS Container Runtime does not send CORS headers.
                </>
              )}
            </p>
          </form>
          {error && (
            <Alert variant="error" title="Could not add the endpoint">
              {error}
            </Alert>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>Saved endpoints</CardHeader>
        <CardBody>
          {endpoints.length === 0 ? (
            <EmptyState
              title="No endpoints yet"
              hint={isElectron ? 'Add one above.' : 'Add one above. The list is kept in this browser only.'}
            />
          ) : (
            <div className="sas-table__wrapper">
              <table className="sas-table sas-table--compact">
                <thead className="sas-table__head">
                  <tr>
                    <th scope="col" className="sas-table__th">Name</th>
                    <th scope="col" className="sas-table__th">Runtime</th>
                    <th scope="col" className="sas-table__th">Mode</th>
                    <th scope="col" className="sas-table__th">URL</th>
                    <th scope="col" className="sas-table__th"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map((endpoint) => (
                    <tr key={endpoint.id} className="sas-table__row">
                      <td className="sas-table__td">
                        <button
                          type="button"
                          className="scr-link"
                          onClick={() => navigate(scrEndpointRoute(endpoint.id))}
                        >
                          {endpointName(endpoint)}
                        </button>
                      </td>
                      <td className="sas-table__td">
                        {endpoint.lastSeen ? RUNTIME_LABELS[endpoint.lastSeen.runtime] : '—'}
                      </td>
                      <td className="sas-table__td">
                        {endpoint.lastSeen ? (
                          <Badge variant={endpoint.lastSeen.mode === 'batch' ? 'info' : 'default'} size="small">
                            {endpoint.lastSeen.mode === 'batch' ? 'Batch' : 'Single record'}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="sas-table__td scr-url">{endpoint.url}</td>
                      <td className="sas-table__td scr-actions">
                        <Button variant="tertiary" size="small" onClick={() => handleRemove(endpoint.id)}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

export default ScrEndpointsPage;
