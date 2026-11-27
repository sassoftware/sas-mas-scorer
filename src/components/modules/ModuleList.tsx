// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Module, ModuleType, getModuleStepCount, getModuleType } from '../../types';
import { ListColumn, ListSort, ListTable, ListToolbar } from '../common/ListTable';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Pagination } from '../common/Pagination';
import { PageHeader } from '../layout/Layout';
import { useSasAuth } from '../../auth';
import { useDebouncedUrlText } from '../../utils/listUrlState';
import type { ModuleTypeCounts } from '../../hooks/useModules';

interface ModuleListProps {
  modules: Module[];
  loading: boolean;
  error?: string | null;
  onSelectModule: (module: Module) => void;
  onRefresh: () => void;
  /** Modules per type for the filter chips; null while they are counted. */
  typeCounts?: ModuleTypeCounts | null;
  /** Saved UI apps per module (lowercased module id). */
  appCounts?: Record<string, number>;
  totalCount: number;
  filteredCount: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** The applied search term (kept in the URL by the caller). */
  searchTerm: string;
  /** Called with the box's text once typing pauses. */
  onSearch: (searchTerm: string) => void;
  onSort: (field: string, direction: 'asc' | 'desc') => void;
  onTypeFilter: (type: ModuleType | 'All') => void;
  sortBy: string;
  typeFilter: ModuleType | 'All';
}

type SortDirection = 'asc' | 'desc' | null;

/** Chip order as in the design; a type with no modules is left out (except the active one). */
const TYPE_CHIPS: (ModuleType | 'All')[] = ['All', 'Decision', 'Data', 'Model'];

// Parse sortBy string like "name:ascending" into field and direction
const parseSortBy = (sortBy: string): { field: string; direction: SortDirection } => {
  if (!sortBy) return { field: '', direction: null };
  const [field, dir] = sortBy.split(':');
  return {
    field,
    direction: dir === 'ascending' ? 'asc' : dir === 'descending' ? 'desc' : null,
  };
};

export const ModuleList: React.FC<ModuleListProps> = ({
  modules,
  loading,
  error,
  onSelectModule,
  onRefresh,
  typeCounts = null,
  appCounts = {},
  totalCount,
  filteredCount,
  currentPage,
  pageSize,
  onPageChange,
  searchTerm,
  onSearch,
  onSort,
  onTypeFilter,
  sortBy,
  typeFilter,
}) => {
  const { isAuthenticated, login, isLoading: authLoading } = useSasAuth();
  // The box starts from the applied search, so coming back to the list (or
  // reloading it) shows the term the list is filtered by; the server search
  // runs once typing pauses. A reset from outside (the sidebar's All Modules)
  // clears the box.
  const [searchText, setSearchText] = useDebouncedUrlText(searchTerm, onSearch);

  const parsedSort = parseSortBy(sortBy);
  const listSort: ListSort | null = parsedSort.field && parsedSort.direction
    ? { key: parsedSort.field, dir: parsedSort.direction }
    : null;

  const displayCount = typeFilter !== 'All' ? filteredCount : totalCount;

  // MAS sorts on the server, by name and modified time only.
  const columns: ListColumn<Module>[] = [
    {
      key: 'name',
      label: 'Name',
      width: '36%',
      sortable: true,
      // Inline wrapper: ListTable puts the first column inside a <button>.
      render: (module) => {
        const apps = appCounts[module.id.toLowerCase()] ?? 0;
        return (
          <span className="list-cell">
            <span className="module-list__name-cell-line">
              <span className="list-cell__main">{module.name}</span>
              {apps > 0 && (
                <span className="module-list__apps" title={`${apps} saved UI app${apps === 1 ? '' : 's'} use this module`}>
                  {apps} {apps === 1 ? 'app' : 'apps'}
                </span>
              )}
            </span>
            <span className="list-cell__sub">{module.description || module.id}</span>
          </span>
        );
      },
    },
    {
      key: 'type',
      label: 'Type',
      width: '12%',
      render: (module) => {
        const moduleType = getModuleType(module);
        const variant = moduleType === 'Model' ? 'info' :
                       moduleType === 'Decision' ? 'success' :
                       moduleType === 'Data' ? 'warning' : 'default';
        return <Badge variant={variant}>{moduleType}</Badge>;
      },
    },
    {
      key: 'steps',
      label: 'Steps',
      width: '10%',
      align: 'center',
      render: (module) => {
        const count = getModuleStepCount(module);
        // -1 means steps exist but count unknown
        return count === -1 ? '…' : count;
      },
    },
    {
      key: 'createdBy',
      label: 'Created by',
      width: '16%',
      render: (module) => module.createdBy ?? '',
    },
    {
      key: 'modifiedTimeStamp',
      label: 'Modified',
      width: '20%',
      sortable: true,
      firstSortDir: 'desc',
      render: (module) => (
        <span className="list-nowrap">{new Date(module.modifiedTimeStamp).toLocaleString()}</span>
      ),
    },
  ];

  const totalPages = Math.ceil(displayCount / pageSize);

  // Show login prompt when not authenticated
  if (!isAuthenticated && !authLoading) {
    return (
      <div className="module-list">
        <PageHeader
          title="All Modules"
          subtitle="Please log in to view modules"
        />
        <div className="module-list__login-prompt">
          <div className="module-list__login-card">
            <svg
              className="module-list__login-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <h3 className="module-list__login-title">Authentication Required</h3>
            <p className="module-list__login-text">
              Please log in to your SAS Viya account to view and score modules.
            </p>
            <Button variant="primary" onClick={login}>
              Log In to SAS Viya
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="module-list">
      <PageHeader
        title="All Modules"
        count={loading && modules.length === 0 ? undefined : `${displayCount} ${displayCount === 1 ? 'module' : 'modules'}`}
        actions={
          <Button variant="secondary" onClick={onRefresh}>
            Refresh
          </Button>
        }
      />

      <ListToolbar
        chips={TYPE_CHIPS.map(c => ({ value: c, label: c, count: typeCounts ? typeCounts[c] : null }))}
        activeChip={typeFilter}
        onChipChange={onTypeFilter}
        chipsLabel="Filter by type"
        search={{
          value: searchText,
          onChange: setSearchText,
          placeholder: 'Search modules by name',
          ariaLabel: 'Search all modules by name',
        }}
      />

      {error && (
        <Alert
          variant="error"
          title="Failed to load modules"
          actions={
            <Button variant="tertiary" size="small" onClick={onRefresh}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      <ListTable
        label="Modules"
        storageKey="modules"
        columns={columns}
        rows={modules}
        rowKey={(m) => m.id}
        sort={listSort}
        onSortChange={(s) => onSort(s.key, s.dir)}
        onRowClick={onSelectModule}
        loading={loading}
        loadingMessage="Loading modules..."
        emptyMessage={searchTerm ? `No modules found matching "${searchTerm}".` : 'No modules found. Create a module to get started.'}
      />

      {totalPages > 1 && (
        <Pagination
          label="Module pages"
          page={currentPage + 1}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={displayCount}
          onPageChange={(p) => onPageChange(p - 1)}
        />
      )}
    </div>
  );
};

export default ModuleList;
