// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { Suspense, lazy, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../layout/Layout';
import { Card, CardBody, CardHeader } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';
import { inspectEndpoint, normalizeScoreUrl, reachableFromHere, RUNTIME_LABELS, type ScrRuntime } from '../../api/scr';
import {
  ListChip, ListColumn, ListSort, ListTable, ListToolbar, activeColumnFilters, filterOptions, sortRows,
} from '../common/ListTable';
import {
  addScrEndpoint,
  listScrEndpoints,
  removeLocalContainerEndpoints,
  removeScrEndpoint,
  updateScrEndpoint,
  type SavedScrEndpoint,
} from '../../storage/scrEndpoints';

export const scrEndpointRoute = (id: string): string => `/scr/${encodeURIComponent(id)}`;

const isElectron = !!window.electronAPI;

// Local containers: desktop build only. The build-mode check lets the web and
// jobdef builds drop the panel's code entirely.
const LocalContainersPanel =
  __BUILD_MODE__ === 'electron' ? lazy(() => import('../containers/LocalContainersPanel')) : null;
const showLocalContainers = !!LocalContainersPanel && !!window.electronAPI?.containers;

type RuntimeFilter = 'all' | ScrRuntime;

const modeLabel = (mode: string): string => (mode === 'batch' ? 'Batch' : 'Single record');

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

  // The saved list: runtime chips, a Mode filter in its column menu, search.
  const [runtime, setRuntime] = useState<RuntimeFilter>('all');
  const [mode, setMode] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ListSort | null>({ key: 'name', dir: 'asc' });
  const term = search.trim().toLowerCase();
  const searched = endpoints.filter(e =>
    !term || endpointName(e).toLowerCase().includes(term) || e.url.toLowerCase().includes(term)
  );
  const runtimeOf = (e: SavedScrEndpoint): RuntimeFilter => e.lastSeen?.runtime ?? 'unknown';
  const modeOf = (e: SavedScrEndpoint): string | null => (e.lastSeen ? modeLabel(e.lastSeen.mode) : null);
  const runtimeChips: ListChip<RuntimeFilter>[] = [
    { value: 'all', label: 'All', count: searched.filter(e => !mode || modeOf(e) === mode).length },
    ...(['scr', 'python', 'python-legacy', 'unknown'] as const).map(r => ({
      value: r,
      label: RUNTIME_LABELS[r],
      count: searched.filter(e => runtimeOf(e) === r && (!mode || modeOf(e) === mode)).length,
    })),
  ];
  const columns: ListColumn<SavedScrEndpoint>[] = [
    {
      key: 'name',
      label: 'Name',
      width: '28%',
      sortValue: endpointName,
      render: (e) => <span className="list-cell__main">{endpointName(e)}</span>,
    },
    {
      key: 'runtime',
      label: 'Runtime',
      width: '16%',
      sortValue: (e) => (e.lastSeen ? RUNTIME_LABELS[e.lastSeen.runtime] : null),
      render: (e) => (e.lastSeen ? RUNTIME_LABELS[e.lastSeen.runtime] : '—'),
    },
    {
      key: 'mode',
      label: 'Mode',
      width: '14%',
      sortValue: modeOf,
      filter: {
        options: filterOptions(searched.filter(e => runtime === 'all' || runtimeOf(e) === runtime), modeOf),
        value: mode,
        onChange: setMode,
      },
      render: (e) => e.lastSeen ? (
        <Badge variant={e.lastSeen.mode === 'batch' ? 'info' : 'default'} size="small">
          {modeLabel(e.lastSeen.mode)}
        </Badge>
      ) : '—',
    },
    {
      key: 'url',
      label: 'URL',
      sortValue: (e) => e.url,
      className: 'scr-url',
      render: (e) => e.url,
    },
  ];
  const sorted = sortRows(
    searched.filter(e => (runtime === 'all' || runtimeOf(e) === runtime) && (!mode || modeOf(e) === mode)),
    columns,
    sort,
  );

  const handleRemove = (id: string) => {
    removeScrEndpoint(id);
    setEndpoints(listScrEndpoints());
  };

  /** A local container that is ready: saved like any endpoint (signature read first), then opened. */
  const openLocalEndpoint = async (scoreUrl: string, name: string, managedId: string) => {
    const info = await inspectEndpoint(scoreUrl);
    const entry = addScrEndpoint(scoreUrl, `${name} (local)`);
    updateScrEndpoint(entry.id, {
      lastSeen: { runtime: info.runtime, mode: info.mode, title: info.title, at: new Date().toISOString() },
      localContainerId: managedId,
    });
    setEndpoints(listScrEndpoints());
    navigate(scrEndpointRoute(entry.id));
  };

  const forgetLocalEndpoint = (managedId: string, hostPort: number | undefined) => {
    if (removeLocalContainerEndpoints(managedId, hostPort) > 0) setEndpoints(listScrEndpoints());
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

      <section className="list-page scr-saved" aria-labelledby="scr-saved-title">
        <h2 className="scr-saved__title" id="scr-saved-title">
          Saved endpoints
          {endpoints.length > 0 && <span className="sas-page-header__count">{endpoints.length}</span>}
        </h2>
        {endpoints.length === 0 ? (
          <EmptyState
            title="No endpoints yet"
            hint={isElectron ? 'Add one above.' : 'Add one above. The list is kept in this browser only.'}
          />
        ) : (
          <>
            <ListToolbar
              chips={runtimeChips}
              activeChip={runtime}
              onChipChange={setRuntime}
              chipsLabel="Filter by runtime"
              activeFilters={activeColumnFilters(columns)}
              search={endpoints.length > 8 ? {
                value: search,
                onChange: setSearch,
                placeholder: 'Search name or URL',
                ariaLabel: 'Search saved endpoints by name or URL',
              } : undefined}
            />
            <ListTable
              label="Saved endpoints"
              storageKey="scr-endpoints"
              columns={columns}
              rows={sorted}
              rowKey={(e) => e.id}
              sort={sort}
              onSortChange={setSort}
              onRowClick={(e) => navigate(scrEndpointRoute(e.id))}
              rowActions={(e) => [{ id: 'remove', label: 'Remove from the list', onSelect: () => handleRemove(e.id) }]}
              rowActionsLabel={(e) => `More actions for ${endpointName(e)}`}
              emptyMessage="No saved endpoints match."
            />
          </>
        )}
      </section>

      {showLocalContainers && LocalContainersPanel && (
        <Suspense fallback={null}>
          <LocalContainersPanel onOpenEndpoint={openLocalEndpoint} onDeleted={forgetLocalEndpoint} />
        </Suspense>
      )}
    </div>
  );
};

export default ScrEndpointsPage;
