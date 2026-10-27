// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge } from '../common/Badge';
import { Loading } from '../common/Loading';
import { Modal } from '../common/Modal';
import { SearchInput } from '../common/SearchInput';
import {
  ScoreExecutionSummary,
  ScoreTestDefinition,
  getLastScoreTestExecution,
  getScoreTest,
  listDecisionTests,
} from '../../api/scoreTests';

interface LoadTestDialogProps {
  sourceURI: string;
  /** Called with the full test definition; the caller applies table and mappings. */
  onLoad: (test: ScoreTestDefinition) => void;
  onClose: () => void;
}

// Past runs are looked up for this many tests at most (one request each)
const LAST_RUN_LOOKUPS = 25;

const tableOf = (test: ScoreTestDefinition): string => {
  const d = test.inputData;
  if (!d?.tableName) return 'no input table';
  return [d.serverName, d.libraryName, d.tableName].filter(Boolean).join(' / ');
};

const formatWhen = (iso?: string): string => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
};

/**
 * Lists the decision's CAS-table tests (SAS Intelligent Decisioning tests
 * that read a CAS table) and hands the chosen one back so the CAS Table tab
 * can select its table and apply its column mappings.
 */
export const LoadTestDialog: React.FC<LoadTestDialogProps> = ({ sourceURI, onLoad, onClose }) => {
  const [tests, setTests] = useState<ScoreTestDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // definition id → last run (null: never run, undefined: not known)
  const [lastRuns, setLastRuns] = useState<Record<string, ScoreExecutionSummary | null>>({});

  useEffect(() => {
    let cancelled = false;
    listDecisionTests(sourceURI)
      .then(list => {
        if (cancelled) return;
        setTests(list);
        // Best-effort: when each test last ran. A failure just shows nothing.
        list.slice(0, LAST_RUN_LOOKUPS).forEach(test => {
          getLastScoreTestExecution(test.id)
            .then(run => {
              if (!cancelled) setLastRuns(prev => ({ ...prev, [test.id]: run }));
            })
            .catch(() => undefined);
        });
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load tests');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceURI]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tests;
    return tests.filter(t =>
      [t.name, t.description, t.createdBy, t.inputData?.tableName, t.inputData?.libraryName]
        .some(v => v?.toLowerCase().includes(q))
    );
  }, [tests, query]);

  const handleSelect = useCallback(async (test: ScoreTestDefinition) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const detail = await getScoreTest(test.id);
      if (!detail.inputData?.tableName || !detail.inputData.serverName || !detail.inputData.libraryName) {
        setError(`The test “${test.name}” names no complete input table (server, caslib and table), so it cannot be loaded here.`);
        return;
      }
      onLoad(detail);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the test');
    } finally {
      setLoadingDetail(false);
    }
  }, [onLoad, onClose]);

  const handleClose = useCallback(() => {
    if (!loadingDetail) onClose();
  }, [loadingDetail, onClose]);

  return (
    <Modal
      title="Load Test"
      onClose={handleClose}
      closeOnBackdropClick={!loadingDetail}
      footer={
        <Button variant="tertiary" onClick={handleClose} disabled={loadingDetail}>
          Cancel
        </Button>
      }
    >
      <div className="save-scenario-dialog__fields">
        {loading && <Loading message="Loading tests..." />}
        {error && <Alert variant="error">{error}</Alert>}

        {!loading && tests.length === 0 && !error && (
          <div className="load-scenario__empty">
            <p>No CAS table tests found for this decision.</p>
            <p className="load-scenario__empty-hint">
              Tests are created with &ldquo;Save as Test&rdquo; on this tab, or on the decision&rsquo;s
              Tests tab in SAS Intelligent Decisioning.
            </p>
          </div>
        )}

        {!loading && tests.length > 0 && (
          <>
            <SearchInput
              aria-label="Search tests"
              placeholder="Search by name, table or author"
              value={query}
              onChange={setQuery}
              disabled={loadingDetail}
              className="load-scenario__search"
            />
            <p className="load-scenario__count" role="status" aria-live="polite">
              {query.trim()
                ? `${shown.length} of ${tests.length} tests match`
                : `${tests.length} test${tests.length === 1 ? '' : 's'}`}
              . Loading a test selects its table and replaces the column mapping.
            </p>
            {shown.length === 0 ? (
              <p className="load-scenario__empty">No tests match &ldquo;{query.trim()}&rdquo;.</p>
            ) : (
              <div className="load-scenario__list">
                {shown.map(test => {
                  const mapped = (test.mappings ?? []).filter(m => m.mappingType === 'datasource').length;
                  const lastRun = lastRuns[test.id];
                  return (
                    <button
                      key={test.id}
                      type="button"
                      className="load-scenario__item"
                      onClick={() => handleSelect(test)}
                      disabled={loadingDetail}
                    >
                      <div className="load-scenario__item-main">
                        <div className="load-scenario__item-name">{test.name}</div>
                        <div className="load-scenario__item-desc">
                          {tableOf(test)} · {mapped} mapped column{mapped === 1 ? '' : 's'}
                        </div>
                        {test.description && (
                          <div className="load-scenario__item-desc">{test.description}</div>
                        )}
                        {lastRun !== undefined && (
                          <div className="load-scenario__item-desc">
                            {lastRun ? `Last run started ${formatWhen(lastRun.creationTimeStamp)}` : 'No run found'}
                          </div>
                        )}
                      </div>
                      <div className="load-scenario__item-meta">
                        <Badge variant="info" size="small">Test</Badge>
                        <span className="load-scenario__item-author">{test.createdBy}</span>
                        {test.modifiedTimeStamp && (
                          <span className="load-scenario__item-date">
                            {new Date(test.modifiedTimeStamp).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {loadingDetail && (
          <div className="load-scenario__loading-overlay">
            <Loading message="Loading test..." />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default LoadTestDialog;
