// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback } from 'react';
import { Module, getModuleStepCount, getModuleType } from '../../types';
import { DataTable, Column } from '../common/DataTable';
import { Badge, StatusBadge } from '../common/Badge';
import { Button } from '../common/Button';
import { PageHeader } from '../layout/Layout';
import { useSasAuth } from '../../auth';

interface ModuleListProps {
  modules: Module[];
  loading: boolean;
  error?: string | null;
  onSelectModule: (module: Module) => void;
  onRefresh: () => void;
  totalCount: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onSearch: (filter: string) => void;
  onSort: (field: string, direction: 'asc' | 'desc') => void;
  sortBy: string;
}

type SortDirection = 'asc' | 'desc' | null;

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
  totalCount,
  currentPage,
  pageSize,
  onPageChange,
  onSearch,
  onSort,
  sortBy,
}) => {
  const { isAuthenticated, login, isLoading: authLoading } = useSasAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Parse current sort state
  const currentSort = parseSortBy(sortBy);

  // Reset local search state when sortBy is cleared (indicating a reset)
  useEffect(() => {
    if (!sortBy && searchTerm) {
      setSearchTerm('');
      setDebouncedSearch('');
    }
  }, [sortBy]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Trigger server-side search when debounced value changes
  useEffect(() => {
    onSearch(debouncedSearch);
  }, [debouncedSearch, onSearch]);

  const handleClearSearch = useCallback(() => {
    setSearchTerm('');
  }, []);

  // Handle column header click for sorting
  const handleSortClick = useCallback((field: string) => {
    let newDirection: 'asc' | 'desc' = 'asc';
    if (currentSort.field === field) {
      // Toggle direction if same field
      newDirection = currentSort.direction === 'asc' ? 'desc' : 'asc';
    }
    onSort(field, newDirection);
  }, [currentSort, onSort]);

  // Render sortable header
  const renderSortableHeader = (label: string, field: string) => {
    const isActive = currentSort.field === field;
    const direction = isActive ? currentSort.direction : null;

    return (
      <button
        className={`module-list__sort-header ${isActive ? 'module-list__sort-header--active' : ''}`}
        onClick={() => handleSortClick(field)}
        type="button"
      >
        {label}
        <span className="module-list__sort-icon">
          {direction === 'asc' && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          )}
          {direction === 'desc' && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          )}
          {!direction && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          )}
        </span>
      </button>
    );
  };

  const columns: Column<Module>[] = [
    {
      key: 'name',
      header: renderSortableHeader('Module Name', 'name'),
      width: '25%',
      render: (module) => (
        <div className="module-name-cell">
          <span className="module-name-cell__name">{module.name}</span>
          <span className="module-name-cell__id">{module.id}</span>
        </div>
      ),
    },
    {
      key: 'scope',
      header: 'Scope',
      width: '10%',
      render: (module) => <StatusBadge status={module.scope} />,
    },
    {
      key: 'type',
      header: 'Type',
      width: '10%',
      render: (module) => {
        const moduleType = getModuleType(module);
        const variant = moduleType === 'Model' ? 'info' :
                       moduleType === 'Decision' ? 'success' :
                       moduleType === 'Data' ? 'warning' : 'default';
        return <Badge variant={variant}>{moduleType}</Badge>;
      },
    },
    {
      key: 'stepsIds',
      header: 'Steps',
      width: '10%',
      align: 'center',
      render: (module) => {
        const count = getModuleStepCount(module);
        // -1 means steps exist but count unknown
        return <Badge variant="default">{count === -1 ? '...' : count}</Badge>;
      },
    },
    {
      key: 'revision',
      header: 'Revision',
      width: '10%',
      align: 'center',
      render: (module) => <span>v{module.revision}</span>,
    },
    {
      key: 'modifiedTimeStamp',
      header: renderSortableHeader('Last Modified', 'modifiedTimeStamp'),
      width: '20%',
      render: (module) => (
        <span className="date-cell">
          {new Date(module.modifiedTimeStamp).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '15%',
      align: 'center',
      render: (module) => (
        <div className="action-buttons">
          <Button
            variant="tertiary"
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onSelectModule(module);
            }}
          >
            View
          </Button>
        </div>
      ),
    },
  ];

  const totalPages = Math.ceil(totalCount / pageSize);

  // Show login prompt when not authenticated
  if (!isAuthenticated && !authLoading) {
    return (
      <div className="module-list">
        <PageHeader
          title="Modules"
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
        title="Modules"
        subtitle={`${totalCount} modules loaded`}
        actions={
          <Button variant="secondary" onClick={onRefresh}>
            Refresh
          </Button>
        }
      />

      <div className="module-list__toolbar">
        <div className="module-list__search">
          <svg
            className="module-list__search-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            className="module-list__search-input"
            placeholder="Search all modules by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              className="module-list__search-clear"
              onClick={handleClearSearch}
              type="button"
              aria-label="Clear search"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        {debouncedSearch && (
          <span className="module-list__search-info">
            Showing results for "{debouncedSearch}"
          </span>
        )}
      </div>

      {error && (
        <div className="module-list__error">
          <span>{error}</span>
          <Button variant="tertiary" size="small" onClick={onRefresh}>
            Retry
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={modules}
        keyField="id"
        onRowClick={onSelectModule}
        loading={loading}
        emptyMessage={debouncedSearch ? `No modules found matching "${debouncedSearch}".` : "No modules found. Create a module to get started."}
      />

      {totalPages > 1 && (
        <div className="module-list__pagination">
          <Button
            variant="tertiary"
            size="small"
            disabled={currentPage === 0}
            onClick={() => onPageChange(currentPage - 1)}
          >
            Previous
          </Button>
          <span className="module-list__pagination-info">
            Page {currentPage + 1} of {totalPages}
          </span>
          <Button
            variant="tertiary"
            size="small"
            disabled={currentPage >= totalPages - 1}
            onClick={() => onPageChange(currentPage + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
};

export default ModuleList;
