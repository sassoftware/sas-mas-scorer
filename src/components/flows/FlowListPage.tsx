// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listAllDecisions } from '../../api/decisions';
import type { DecisionFlow } from '../../types/sid';
import { formatTimestamp } from '../../utils/formatters';
import { parsePageParam, useDebouncedUrlText, useListUrlParams } from '../../utils/listUrlState';
import { registerViewCache } from '../../utils/viewCaches';
import { Alert, Badge, Button, Pagination } from '../common';
import {
  ListChip, ListColumn, ListSort, ListTable, ListToolbar,
  activeColumnFilters, filterOptions, formatSortParam, parseSortParam, sortRows, timeValue,
} from '../common/ListTable';
import { PageHeader } from '../layout/Layout';
import { masModuleRoute, type DecisionMasModules } from '../../api/modelPublish';
import { useDecisionMasIndex } from '../coverage/DecisionScoreAction';

const PAGE_SIZE = 20;

type MasFilter = 'all' | 'published' | 'not' | 'removed';

// Search, sort, filter and page live in the URL
// (#/flows?q=…&sort=modified:desc&mas=published&by=jdoe&page=2), so Back from a flow,
// a reload or a shared link shows the same view.
const LIST_DEFAULTS = { q: '', sort: 'name:asc', mas: 'all', by: '', page: '1' };

// The collection from the last visit. Coming back from a flow shows it at
// once; it is fetched again (in the background, the list stays on screen)
// only when older than CACHE_FRESH_MS. Dropped on logout and connection switch.
const CACHE_FRESH_MS = 60_000;
let cachedDecisions: { items: DecisionFlow[]; fetchedAt: number } | null = null;

registerViewCache('flowList', () => {
  cachedDecisions = null;
});

const MAS_ORDER: Record<Exclude<MasFilter, 'all'>, number> = { published: 0, removed: 1, not: 2 };

export default function FlowListPage() {
  const navigate = useNavigate();
  const [allDecisions, setAllDecisions] = useState<DecisionFlow[]>(() => cachedDecisions?.items ?? []);
  const [params, updateParams] = useListUrlParams('flows', LIST_DEFAULTS);
  const sort: ListSort = useMemo(
    () => parseSortParam(params.sort, 'name') ?? { key: 'name', dir: 'asc' },
    [params.sort]
  );
  const masFilter: MasFilter = (['published', 'not', 'removed'] as const).find(v => v === params.mas) ?? 'all';
  // 1-based, the page number <Pagination> speaks.
  const page = parsePageParam(params.page);
  // The box filters at once; the URL catches up when typing pauses.
  const commitSearch = useCallback((q: string) => updateParams({ q }), [updateParams]);
  const [search, setSearchText] = useDebouncedUrlText(params.q, commitSearch);
  const setSearch = (value: string) => {
    setSearchText(value);
    if (page !== 1) updateParams({ page: '1' });
  };
  const setPage = (next: number) => updateParams({ page: String(next) });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Bumped by Refresh and the alert's Retry button to re-run the load below.
  const [reloadToken, setReloadToken] = useState(0);

  // The whole collection is fetched once (server order: name ascending);
  // search, filter and sort are applied to that in-memory list below.
  useEffect(() => {
    const cached = cachedDecisions;
    if (reloadToken === 0 && cached && Date.now() - cached.fetchedAt < CACHE_FRESH_MS) return;
    let active = true;
    // With a list already on screen the refetch is silent.
    if (!cached || reloadToken > 0) setLoading(true);
    setError('');
    listAllDecisions()
      .then((items) => {
        cachedDecisions = { items, fetchedAt: Date.now() };
        if (active) setAllDecisions(items);
      })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadToken]);

  // Published / Not published, from one modelPublish query for every flow
  // (cached; it takes a few seconds, so the list never waits for it).
  const mas = useDecisionMasIndex(allDecisions.length > 0);
  const masKnown = !!mas.index && !mas.loading && !mas.error;
  const masState = useCallback((d: DecisionFlow): Exclude<MasFilter, 'all'> => {
    const m = mas.index?.[d.id];
    if (!m) return 'not';
    return m.latest ? 'published' : 'removed';
  }, [mas.index]);

  const modifiedBy = params.by || null;

  // Client-side case-insensitive search on name and description
  const textMatched = useMemo(() => {
    if (!search.trim()) return allDecisions;
    const term = search.trim().toLowerCase();
    return allDecisions.filter((d) =>
      (d.name ?? '').toLowerCase().includes(term) ||
      (d.description ?? '').toLowerCase().includes(term),
    );
  }, [allDecisions, search]);

  // The Modified by filter (in that column's menu) applies before the chips count.
  const searched = useMemo(
    () => (modifiedBy ? textMatched.filter(d => d.modifiedBy === modifiedBy) : textMatched),
    [textMatched, modifiedBy]
  );

  const chips: ListChip<MasFilter>[] = useMemo(() => {
    const count = (state: Exclude<MasFilter, 'all'>) =>
      masKnown ? searched.filter(d => masState(d) === state).length : null;
    return [
      { value: 'all', label: 'All', count: searched.length },
      { value: 'published', label: 'Published', count: count('published') },
      { value: 'not', label: 'Not published', count: count('not') },
      { value: 'removed', label: 'Module removed', count: count('removed') },
    ];
  }, [searched, masKnown, masState]);

  const filtered = useMemo(
    () => (masFilter === 'all' ? searched : masKnown ? searched.filter(d => masState(d) === masFilter) : []),
    [searched, masFilter, masKnown, masState]
  );

  const columns: ListColumn<DecisionFlow>[] = useMemo(() => [
    {
      key: 'name',
      label: 'Name',
      width: '26%',
      sortValue: (d) => d.name,
      render: (d) => <span className="list-cell__main">{d.name}</span>,
    },
    {
      key: 'description',
      label: 'Description',
      sortValue: (d) => d.description,
      render: (d) => (
        <span className="list-clamp" title={d.description && d.description.length > 80 ? d.description : undefined}>
          {d.description}
        </span>
      ),
    },
    {
      key: 'mas',
      label: 'MAS module',
      width: '22%',
      sortValue: (d) => (masKnown ? MAS_ORDER[masState(d)] : null),
      render: (d) => <MasStatus flowName={d.name} modules={mas.index?.[d.id]} loading={mas.loading} failed={!!mas.error} />,
    },
    {
      key: 'modifiedBy',
      label: 'Modified by',
      width: '13%',
      sortValue: (d) => d.modifiedBy,
      filter: {
        options: filterOptions(
          masFilter === 'all' || !masKnown ? textMatched : textMatched.filter(d => masState(d) === masFilter),
          d => d.modifiedBy,
        ),
        value: modifiedBy,
        onChange: (v) => updateParams({ by: v ?? '', page: '1' }),
      },
      render: (d) => d.modifiedBy,
    },
    {
      key: 'modified',
      label: 'Modified',
      width: '17%',
      firstSortDir: 'desc',
      sortValue: (d) => timeValue(d.modifiedTimeStamp),
      render: (d) => <span className="list-nowrap">{formatTimestamp(d.modifiedTimeStamp)}</span>,
    },
  ], [mas.index, mas.loading, mas.error, masKnown, masState, masFilter, textMatched, modifiedBy, updateParams]);

  const sorted = useMemo(() => sortRows(filtered, columns, sort), [filtered, columns, sort]);

  const total = sorted.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Clamped the way <Pagination> clamps its own page number, so a shorter
  // list after a reload cannot leave the table showing an empty page.
  const displayDecisions = useMemo(() => {
    const start = (Math.min(page, Math.max(1, totalPages)) - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [sorted, page, totalPages]);

  const empty = masFilter !== 'all' && !masKnown
    ? (mas.error ? 'The publish history could not be read, so flows cannot be filtered by MAS module.' : 'Checking which flows are published…')
    : search ? 'No decisions match your search.' : masFilter !== 'all' || modifiedBy ? 'No decisions match this filter.' : 'No decisions found.';

  return (
    <div className="list-page">
      <PageHeader
        title="Decision Flows"
        count={loading && allDecisions.length === 0 ? undefined : `${total} decision${total !== 1 ? 's' : ''}`}
        actions={
          <Button variant="secondary" onClick={() => setReloadToken((t) => t + 1)}>
            Refresh
          </Button>
        }
      />

      <ListToolbar
        chips={chips}
        activeChip={masFilter}
        onChipChange={(v) => updateParams({ mas: v, page: '1' })}
        chipsLabel="Filter by MAS module"
        activeFilters={activeColumnFilters(columns)}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search name or description',
          ariaLabel: 'Search decisions by name or description',
        }}
      />

      {error && (
        <Alert
          variant="error"
          actions={
            <Button variant="secondary" size="small" onClick={() => setReloadToken((t) => t + 1)}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      <ListTable
        label="Decision flows"
        storageKey="flows"
        columns={columns}
        rows={displayDecisions}
        rowKey={(d) => d.id}
        sort={sort}
        onSortChange={(s) => updateParams({ sort: formatSortParam(s), page: '1' })}
        onRowClick={(d) => navigate(`/flows/${d.id}`)}
        loading={loading}
        loadingMessage="Loading decisions..."
        emptyMessage={empty}
      />

      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          pageSize={PAGE_SIZE}
          totalItems={total}
          label="Decision list pages"
        />
      )}
    </div>
  );
}

/**
 * The flow's MAS module, from its completed publish records checked against
 * the MAS module list: Published (the module name links to the scorer), Not
 * published, or Module removed. The state is in the text, never the colour
 * alone.
 */
function MasStatus({
  flowName,
  modules,
  loading,
  failed,
}: {
  flowName: string;
  modules: DecisionMasModules | undefined;
  loading: boolean;
  failed: boolean;
}) {
  if (loading) return <span className="decision-mas__pending">Checking…</span>;
  if (failed) {
    return <span className="decision-mas__pending" title="The publish history could not be read">Unknown</span>;
  }
  if (!modules) {
    return <Badge variant="default" size="small">Not published</Badge>;
  }
  const { latest, others, removed, verified } = modules;
  if (!latest) {
    // Every module the publish records name is gone from MAS.
    const removedNames = removed.map((r) => r.publishName).join(', ');
    return (
      <span className="decision-mas__cell" title={`Published as ${removedNames}; MAS no longer has the module`}>
        <Badge variant="warning" size="small">Module removed</Badge>
        <span className="sr-only">: published as {removedNames}, which MAS no longer has</span>
      </span>
    );
  }
  const otherNames = others.map((o) => o.publishName).join(', ');
  return (
    <span className="decision-mas__cell">
      <Badge variant="success" size="small">Published</Badge>
      <Link
        to={masModuleRoute(latest.publishName)}
        className="decision-mas__cell-link"
        aria-label={`Score ${flowName} in MAS module ${latest.publishName}${verified ? '' : ' (not checked in MAS)'}`}
        title={verified
          ? `Score in MAS module ${latest.publishName}`
          : `Score in MAS module ${latest.publishName} (from the publish history; MAS could not be checked)`}
        onClick={(e) => e.stopPropagation()}
      >
        {latest.publishName}
      </Link>
      {others.length > 0 && (
        <span className="decision-mas__cell-more" title={`Also published as ${otherNames}`}>
          <span aria-hidden="true">+{others.length}</span>
          <span className="sr-only">, also published as {otherNames}</span>
        </span>
      )}
    </span>
  );
}
