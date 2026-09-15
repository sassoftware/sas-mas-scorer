// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardBody } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { SearchInput } from '../common/SearchInput';
import { PageHeader } from '../layout/Layout';
import { getSasViyaUrl } from '../../config';
import {
  collectCoverage,
  generateCoverageCSV,
  generateCoverageMarkdown,
  getContentTypeLabel,
  getDeepLink,
} from '../../api/coverage';
import { ContentType, CollectionProgress, CoverageResult } from '../../types/coverage';

type FilterType = 'all' | ContentType;
type CoverageFilter = 'all' | 'covered' | 'uncovered';
type SortField = 'name' | 'contentType' | 'testScenarioCount' | 'modifiedTimestamp';

/** Rows rendered per page; filtering, sorting and the exports still cover every asset. */
const PAGE_SIZE = 50;

/** One collator for every comparison — building Intl state per compare is what made sorting slow. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

let cachedResult: CoverageResult | null = null;

export const clearCoverageAnalysisCache = (): void => {
  cachedResult = null;
};

export const CoverageAnalysis: React.FC = () => {
  const [result, setResult] = useState<CoverageResult | null>(() => cachedResult);
  const [progress, setProgress] = useState<CollectionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Detail table state
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Debounce the search box so a keystroke does not re-filter and re-sort the whole tenant.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 200);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // A changed filter, search term or sort order starts again from the first page.
  useEffect(() => {
    setPage(0);
  }, [typeFilter, coverageFilter, debouncedSearch, sortField, sortDir]);

  const toggleRow = useCallback((id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRunAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress({ phase: 'starting', currentStep: 0, totalSteps: 7, message: 'Starting collection...', itemsCollected: 0 });

    try {
      const coverageResult = await collectCoverage((p) => setProgress({ ...p }));
      setResult(coverageResult);
      cachedResult = coverageResult;
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to collect coverage data');
      setProgress(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const filteredItems = useMemo(() => {
    if (!result) return [];
    let items = result.items;

    if (typeFilter !== 'all') {
      items = items.filter(i => i.contentType === typeFilter);
    }
    if (coverageFilter === 'covered') {
      items = items.filter(i => i.hasTestScenario);
    } else if (coverageFilter === 'uncovered') {
      items = items.filter(i => !i.hasTestScenario);
    }
    const term = debouncedSearch.trim().toLowerCase();
    if (term) {
      items = items.filter(i =>
        i.name.toLowerCase().includes(term) ||
        i.createdBy.toLowerCase().includes(term)
      );
    }
    return items;
  }, [result, typeFilter, coverageFilter, debouncedSearch]);

  // Sorting is keyed separately so toggling a column does not re-filter.
  const sortedItems = useMemo(() => {
    const items = [...filteredItems].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = collator.compare(a.name, b.name);
      else if (sortField === 'contentType') cmp = collator.compare(a.contentType, b.contentType);
      else if (sortField === 'testScenarioCount') cmp = a.testScenarioCount - b.testScenarioCount;
      else if (sortField === 'modifiedTimestamp') cmp = collator.compare(a.modifiedTimestamp ?? '', b.modifiedTimestamp ?? '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [filteredItems, sortField, sortDir]);

  // Clamp rather than only reset so a shrinking list never shows an empty page.
  const pageCount = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = useMemo(
    () => sortedItems.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
    [sortedItems, currentPage]
  );

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }, [sortField]);

  const handleExportCSV = useCallback(() => {
    if (!result) return;
    const csv = generateCoverageCSV(sortedItems);
    downloadFile(csv, 'test-coverage.csv', 'text/csv');
  }, [result, sortedItems]);

  const handleExportMarkdown = useCallback(() => {
    if (!result) return;
    const md = generateCoverageMarkdown(result);
    downloadFile(md, 'test-coverage-report.md', 'text/markdown');
  }, [result]);

  const baseUrl = getSasViyaUrl();

  return (
    <div className="coverage-analysis">
      <PageHeader
        title="Test Coverage Analysis"
        subtitle="Analyze test coverage across SAS Intelligent Decisioning &amp; Model Manager assets"
        actions={
          <>
            {result && (
              <>
                <Button variant="secondary" size="small" onClick={handleExportMarkdown}>
                  Export Markdown
                </Button>
                <Button variant="secondary" size="small" onClick={handleExportCSV}>
                  Export CSV
                </Button>
              </>
            )}
            <Button variant="primary" onClick={handleRunAnalysis} loading={loading}>
              {result ? 'Re-run Analysis' : 'Run Analysis'}
            </Button>
          </>
        }
      />

      {error && (
        <Alert variant="error" title="Analysis Failed" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Progress indicator */}
      {loading && progress && (
        <Card className="coverage-progress-card">
          <CardBody>
            <div className="coverage-progress">
              <div className="coverage-progress__header">
                <span className="coverage-progress__phase">
                  {progress.phase === 'collecting' ? 'Collecting data' : 'Analyzing coverage'}
                </span>
                <span className="coverage-progress__count">
                  {progress.itemsCollected} items collected
                </span>
              </div>
              <div className="coverage-progress__bar-track">
                <div
                  className="coverage-progress__bar-fill"
                  style={{ width: `${(progress.currentStep / progress.totalSteps) * 100}%` }}
                />
              </div>
              <div className="coverage-progress__message">{progress.message}</div>
              <div className="coverage-progress__step">
                Step {progress.currentStep} of {progress.totalSteps}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Welcome state */}
      {!result && !loading && (
        <Card>
          <CardBody>
            <div className="coverage-welcome">
              <svg className="coverage-welcome__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <h2 className="coverage-welcome__title">Discover Your Test Coverage</h2>
              <p className="coverage-welcome__text">
                This analysis collects all Decisions, Business Rules, Code Files, Treatment Definitions,
                and Segmentation Trees from your SAS Viya environment, then checks which assets have
                test scenarios defined via Score Definitions.
              </p>
              <p className="coverage-welcome__note">
                The collection process takes a few minutes depending on the number of assets in your environment.
              </p>
              <Button variant="primary" onClick={handleRunAnalysis}>
                Start Analysis
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Summary Dashboard */}
          <div className="coverage-dashboard">
            {/* Overall coverage gauge */}
            <Card className="coverage-gauge-card">
              <CardBody>
                <div className="coverage-gauge">
                  <svg viewBox="0 0 120 120" className="coverage-gauge__ring">
                    <circle cx="60" cy="60" r="52" className="coverage-gauge__track" />
                    <circle
                      cx="60" cy="60" r="52"
                      className="coverage-gauge__fill"
                      style={{
                        strokeDasharray: `${2 * Math.PI * 52}`,
                        strokeDashoffset: `${2 * Math.PI * 52 * (1 - result.stats.overall.coveragePercentage / 100)}`,
                      }}
                    />
                  </svg>
                  <div className="coverage-gauge__value">
                    {result.stats.overall.coveragePercentage}%
                  </div>
                  <div className="coverage-gauge__label">Overall Coverage</div>
                </div>
              </CardBody>
            </Card>

            {/* Stats cards */}
            <Card className="coverage-stats-card">
              <CardBody>
                <div className="coverage-stats-grid">
                  <div className="coverage-stat">
                    <div className="coverage-stat__value">{result.stats.overall.totalItems}</div>
                    <div className="coverage-stat__label">Total Assets</div>
                  </div>
                  <div className="coverage-stat coverage-stat--success">
                    <div className="coverage-stat__value">{result.stats.overall.itemsWithTests}</div>
                    <div className="coverage-stat__label">With Tests</div>
                  </div>
                  <div className="coverage-stat coverage-stat--error">
                    <div className="coverage-stat__value">{result.stats.overall.itemsWithoutTests}</div>
                    <div className="coverage-stat__label">Without Tests</div>
                  </div>
                  <div className="coverage-stat">
                    <div className="coverage-stat__value">
                      {new Date(result.collectionDate).toLocaleDateString()}
                    </div>
                    <div className="coverage-stat__label">Collected</div>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Coverage by Type Bars */}
          <Card className="coverage-by-type-card">
            <CardHeader>
              <h3>Coverage by Asset Type</h3>
            </CardHeader>
            <CardBody>
              <div className="coverage-type-bars">
                {(Object.entries(result.stats.byType) as [ContentType, typeof result.stats.byType[ContentType]][])
                  .filter(([, s]) => s.total > 0)
                  .sort((a, b) => b[1].total - a[1].total)
                  .map(([type, s]) => (
                    <div key={type} className="coverage-type-row">
                      <div className="coverage-type-row__label">
                        <span className="coverage-type-row__name">{getContentTypeLabel(type)}</span>
                        <span className="coverage-type-row__count">{s.withTests} / {s.total}</span>
                      </div>
                      <div className="coverage-type-row__bar-track">
                        <div
                          className={`coverage-type-row__bar-fill ${getCoverageClass(s.coveragePercentage)}`}
                          style={{ width: `${s.coveragePercentage}%` }}
                        />
                      </div>
                      <div className="coverage-type-row__pct">
                        {s.coveragePercentage}%
                      </div>
                    </div>
                  ))}
              </div>
            </CardBody>
          </Card>

          {/* Detail Table */}
          <Card className="coverage-detail-card">
            <CardHeader
              actions={
                <div className="coverage-detail__filters">
                  <SearchInput
                    className="coverage-detail__search"
                    aria-label="Search assets by name or author"
                    placeholder="Search by name or author..."
                    value={searchTerm}
                    onChange={setSearchTerm}
                  />
                  <label className="coverage-detail__filter">
                    <span className="coverage-detail__filter-label">Type:</span>
                    <select
                      className="coverage-detail__select"
                      value={typeFilter}
                      onChange={e => setTypeFilter(e.target.value as FilterType)}
                    >
                      <option value="all">All Types</option>
                      <option value="decision">Decisions</option>
                      <option value="businessRule">Business Rules</option>
                      <option value="codeFile">Code Files</option>
                      <option value="model">Models</option>
                      <option value="treatment">Treatments</option>
                      <option value="segmentationTree">Segmentation Trees</option>
                    </select>
                  </label>
                  <label className="coverage-detail__filter">
                    <span className="coverage-detail__filter-label">Coverage:</span>
                    <select
                      className="coverage-detail__select"
                      value={coverageFilter}
                      onChange={e => setCoverageFilter(e.target.value as CoverageFilter)}
                    >
                      <option value="all">All Coverage</option>
                      <option value="covered">Covered</option>
                      <option value="uncovered">Uncovered</option>
                    </select>
                  </label>
                </div>
              }
            >
              <h3>All Assets ({sortedItems.length})</h3>
            </CardHeader>
            <CardBody>
              <div className="sas-table__wrapper">
                <table className="sas-table sas-table--striped sas-table--hoverable">
                  <thead className="sas-table__head">
                    <tr>
                      <SortHeader field="name" label="Name" current={sortField} dir={sortDir} onSort={handleSort} />
                      <SortHeader field="contentType" label="Type" current={sortField} dir={sortDir} onSort={handleSort} width="140px" />
                      <th className="sas-table__th" style={{ width: '110px', textAlign: 'center' }}>Coverage</th>
                      <SortHeader field="testScenarioCount" label="Tests" current={sortField} dir={sortDir} onSort={handleSort} width="80px" align="center" />
                      <th className="sas-table__th" style={{ width: '120px' }}>Created By</th>
                      <SortHeader field="modifiedTimestamp" label="Modified" current={sortField} dir={sortDir} onSort={handleSort} width="110px" />
                      <th className="sas-table__th" style={{ width: '100px', textAlign: 'center' }}>Link</th>
                    </tr>
                  </thead>
                  <tbody className="sas-table__body">
                    {pageItems.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="sas-table__td coverage-detail__empty">
                          No assets match the current filters.
                        </td>
                      </tr>
                    ) : (
                      pageItems.map(item => {
                        const deepLink = getDeepLink(baseUrl, item);
                        const isExpanded = expandedRows.has(item.id);
                        const hasTests = item.testScenarios.length > 0;
                        return (
                          <React.Fragment key={item.id}>
                            <tr
                              className={`sas-table__row coverage-row ${hasTests ? 'coverage-row--expandable' : ''} ${isExpanded ? 'coverage-row--expanded' : ''}`}
                              onClick={hasTests ? () => toggleRow(item.id) : undefined}
                            >
                              <td className="sas-table__td">
                                {hasTests ? (
                                  // Same shape as DataTable's clickable rows: the row reacts to
                                  // the mouse, and a real button in the first cell carries the
                                  // toggle for the keyboard.
                                  <button
                                    type="button"
                                    className="sas-table__row-button coverage-row__name"
                                    aria-expanded={isExpanded}
                                    onClick={e => {
                                      e.stopPropagation();
                                      toggleRow(item.id);
                                    }}
                                  >
                                    <span className={`coverage-row__chevron ${isExpanded ? 'coverage-row__chevron--open' : ''}`}>
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true">
                                        <polyline points="9 18 15 12 9 6" />
                                      </svg>
                                    </span>
                                    <strong>{item.name}</strong>
                                  </button>
                                ) : (
                                  <span className="coverage-row__name">
                                    <strong>{item.name}</strong>
                                  </span>
                                )}
                              </td>
                              <td className="sas-table__td">
                                <Badge variant={getTypeBadgeVariant(item.contentType)} size="small">
                                  {getContentTypeLabel(item.contentType)}
                                </Badge>
                              </td>
                              <td className="sas-table__td" style={{ textAlign: 'center' }}>
                                {item.hasTestScenario ? (
                                  <Badge variant="success" size="small">Covered</Badge>
                                ) : (
                                  <Badge variant="error" size="small">No tests</Badge>
                                )}
                              </td>
                              <td className="sas-table__td" style={{ textAlign: 'center' }}>
                                {item.testScenarioCount > 0 && (
                                  <Badge variant="info" size="small">{item.testScenarioCount}</Badge>
                                )}
                              </td>
                              <td className="sas-table__td">{item.createdBy}</td>
                              <td className="sas-table__td">
                                {item.modifiedTimestamp ? new Date(item.modifiedTimestamp).toLocaleDateString() : ''}
                              </td>
                              <td className="sas-table__td" style={{ textAlign: 'center' }}>
                                <span className="coverage-detail__links">
                                  {item.contentType === 'decision' && (
                                    <a
                                      href={`#/flows/${item.id}`}
                                      className="coverage-deep-link"
                                      title="View Flow Diagram"
                                      aria-label={`View flow diagram for ${item.name}`}
                                      onClick={e => e.stopPropagation()}
                                    >
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                                        <circle cx="12" cy="5" r="2" />
                                        <circle cx="6" cy="19" r="2" />
                                        <circle cx="18" cy="19" r="2" />
                                        <path d="M12 7v4M12 11l-6 6M12 11l6 6" />
                                      </svg>
                                    </a>
                                  )}
                                  {deepLink && (
                                    <a
                                      href={deepLink.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="coverage-deep-link"
                                      title={deepLink.label}
                                      aria-label={`${deepLink.label}: ${item.name}`}
                                      onClick={e => e.stopPropagation()}
                                    >
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                        <polyline points="15 3 21 3 21 9" />
                                        <line x1="10" y1="14" x2="21" y2="3" />
                                      </svg>
                                    </a>
                                  )}
                                </span>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="coverage-expand-row">
                                <td colSpan={7} className="coverage-expand-cell">
                                  <div className="coverage-scenarios">
                                    <div className="coverage-scenarios__header">Test Scenarios</div>
                                    <table className="coverage-scenarios__table">
                                      <thead>
                                        <tr>
                                          <th>Name</th>
                                          <th style={{ width: '140px' }}>Type</th>
                                          <th>Description</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {item.testScenarios.map(ts => (
                                          <tr key={ts.scoreDefinitionId}>
                                            <td>{ts.name}</td>
                                            <td>
                                              <Badge variant={getScenarioTypeBadgeVariant(ts.scenarioType)} size="small">
                                                {ts.scenarioType}
                                              </Badge>
                                            </td>
                                            <td className="coverage-scenarios__desc">
                                              {ts.description || <span className="coverage-scenarios__none">No description</span>}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {pageCount > 1 && (
                <nav className="coverage-detail__pagination" aria-label="Asset pages">
                  <Button
                    variant="tertiary"
                    size="small"
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous
                  </Button>
                  <span className="coverage-detail__pagination-info">
                    Page {currentPage + 1} of {pageCount}
                  </span>
                  <Button
                    variant="tertiary"
                    size="small"
                    disabled={currentPage >= pageCount - 1}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next
                  </Button>
                </nav>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
};

// Helper components

interface SortHeaderProps {
  field: SortField;
  label: string;
  current: SortField;
  dir: 'asc' | 'desc';
  onSort: (field: SortField) => void;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

// Same shape as ModuleList's sortable headers: a real <button> inside the
// <th> so the sort is reachable by keyboard, with aria-sort on the cell.
const SortHeader: React.FC<SortHeaderProps> = ({ field, label, current, dir, onSort, width, align = 'left' }) => {
  const isActive = current === field;
  const ariaSort = isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th className="sas-table__th" style={{ width, textAlign: align }} aria-sort={ariaSort}>
      <button
        type="button"
        className={`coverage-detail__sort-header ${isActive ? 'coverage-detail__sort-header--active' : ''}`}
        onClick={() => onSort(field)}
      >
        {label}
        <span className="coverage-detail__sort-icon">
          <svg
            viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2}
            opacity={isActive ? 1 : 0.3}
            aria-hidden="true"
          >
            <path d={isActive && dir === 'asc' ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7'} />
          </svg>
        </span>
      </button>
    </th>
  );
};

// Helpers

function getCoverageClass(pct: number): string {
  if (pct >= 60) return 'coverage-type-row__bar-fill--good';
  if (pct >= 30) return 'coverage-type-row__bar-fill--moderate';
  return 'coverage-type-row__bar-fill--low';
}

function getTypeBadgeVariant(type: ContentType) {
  switch (type) {
    case 'decision': return 'success' as const;
    case 'businessRule': return 'info' as const;
    case 'codeFile': return 'warning' as const;
    case 'model': return 'info' as const;
    case 'treatment': return 'default' as const;
    case 'segmentationTree': return 'default' as const;
  }
}

function getScenarioTypeBadgeVariant(type: string) {
  switch (type) {
    case 'Test': return 'success' as const;
    case 'Scenario': return 'info' as const;
    case 'Publishing/Validation': return 'warning' as const;
    default: return 'default' as const;
  }
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default CoverageAnalysis;
