// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { StepOutput, StepParameter } from '../../types';
import { Card, CardHeader, CardBody } from '../common/Card';
import { Button } from '../common/Button';
import { Badge, StatusBadge } from '../common/Badge';

interface BatchResult {
  rowIndex: number;
  input: Record<string, unknown>;
  output: StepOutput | null;
  error: string | null;
  executionTime: number;
}

interface BatchStats {
  totalRuntime: number;
  avgRequestTime: number;
  successRate: number;
  fastestResponse: number;
  slowestResponse: number;
  medianResponse: number;
  totalRequests: number;
  successCount: number;
  errorCount: number;
}

interface BatchResultsProps {
  results: BatchResult[];
  parameters?: StepParameter[]; // Optional - used for type information if needed
  stats: BatchStats | null;
  onClear: () => void;
  onDownload: () => void;
}

// Format milliseconds to human-readable string
const formatTime = (ms: number): string => {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }
};

export const BatchResults: React.FC<BatchResultsProps> = ({
  results,
  parameters: _parameters,
  stats,
  onClear,
  onDownload,
}) => {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const successCount = results.filter(r => r.output && !r.error).length;
  const errorCount = results.filter(r => r.error).length;

  // Get output parameter names from first successful result
  const outputParams = results.find(r => r.output)?.output?.outputs?.map(o => o.name) ?? [];

  const toggleRow = (index: number) => {
    setExpandedRow(expandedRow === index ? null : index);
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  };

  return (
    <Card className="batch-results">
      <CardHeader
        actions={
          <div className="batch-results__actions">
            <Button variant="secondary" size="small" onClick={onDownload}>
              Download CSV
            </Button>
            <Button variant="tertiary" size="small" onClick={onClear}>
              Clear Results
            </Button>
          </div>
        }
      >
        <div className="batch-results__header">
          <h3>Batch Results</h3>
          <div className="batch-results__summary">
            <Badge variant="success">{successCount} succeeded</Badge>
            {errorCount > 0 && <Badge variant="error">{errorCount} failed</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardBody>
        {/* Stats Overview */}
        {stats && (
          <div className="batch-results__overview">
            <div className="batch-results__overview-grid">
              <div className="batch-results__stat-card">
                <span className="batch-results__stat-value">{formatTime(stats.totalRuntime)}</span>
                <span className="batch-results__stat-label">Total Runtime</span>
              </div>
              <div className="batch-results__stat-card">
                <span className="batch-results__stat-value">{formatTime(stats.avgRequestTime)}</span>
                <span className="batch-results__stat-label">Avg Request Time</span>
              </div>
              <div className="batch-results__stat-card">
                <span className={`batch-results__stat-value ${stats.successRate === 100 ? 'batch-results__stat-value--success' : stats.successRate < 50 ? 'batch-results__stat-value--error' : ''}`}>
                  {stats.successRate.toFixed(1)}%
                </span>
                <span className="batch-results__stat-label">Success Rate</span>
              </div>
              <div className="batch-results__stat-card">
                <span className="batch-results__stat-value batch-results__stat-value--success">{formatTime(stats.fastestResponse)}</span>
                <span className="batch-results__stat-label">Fastest Response</span>
              </div>
              <div className="batch-results__stat-card">
                <span className="batch-results__stat-value batch-results__stat-value--warning">{formatTime(stats.slowestResponse)}</span>
                <span className="batch-results__stat-label">Slowest Response</span>
              </div>
              <div className="batch-results__stat-card">
                <span className="batch-results__stat-value">{formatTime(stats.medianResponse)}</span>
                <span className="batch-results__stat-label">Median Response</span>
              </div>
              <div className="batch-results__stat-card">
                <span className="batch-results__stat-value">{stats.totalRequests}</span>
                <span className="batch-results__stat-label">Total Requests</span>
              </div>
              <div className="batch-results__stat-card">
                <span className="batch-results__stat-value batch-results__stat-value--success">{stats.successCount}</span>
                <span className="batch-results__stat-label">Succeeded</span>
              </div>
              <div className="batch-results__stat-card">
                <span className={`batch-results__stat-value ${stats.errorCount > 0 ? 'batch-results__stat-value--error' : ''}`}>
                  {stats.errorCount}
                </span>
                <span className="batch-results__stat-label">Failed</span>
              </div>
            </div>
          </div>
        )}

        <div className="batch-results__table-wrapper">
          <table className="batch-results__table">
            <thead>
              <tr>
                <th>Row</th>
                <th>Status</th>
                {outputParams.map(name => (
                  <th key={name}>{name}</th>
                ))}
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result, index) => (
                <React.Fragment key={index}>
                  <tr className={result.error ? 'batch-results__row--error' : ''}>
                    <td>{result.rowIndex + 1}</td>
                    <td>
                      {result.error ? (
                        <StatusBadge status="failed" />
                      ) : result.output ? (
                        <StatusBadge status={result.output.executionState} />
                      ) : (
                        <Badge variant="default">Pending</Badge>
                      )}
                    </td>
                    {outputParams.map(name => {
                      const outputVar = result.output?.outputs?.find(o => o.name === name);
                      return (
                        <td key={name} className="batch-results__value">
                          {outputVar ? formatValue(outputVar.value) : '-'}
                        </td>
                      );
                    })}
                    <td>
                      <Button
                        variant="tertiary"
                        size="small"
                        onClick={() => toggleRow(index)}
                      >
                        {expandedRow === index ? 'Hide' : 'Show'}
                      </Button>
                    </td>
                  </tr>
                  {expandedRow === index && (
                    <tr className="batch-results__expanded-row">
                      <td colSpan={outputParams.length + 3}>
                        <div className="batch-results__details">
                          <div className="batch-results__detail-section">
                            <h5>Input Values</h5>
                            <pre>{JSON.stringify(result.input, null, 2)}</pre>
                          </div>
                          {result.error ? (
                            <div className="batch-results__detail-section batch-results__detail-section--error">
                              <h5>Error</h5>
                              <pre>{result.error}</pre>
                            </div>
                          ) : result.output ? (
                            <div className="batch-results__detail-section">
                              <h5>Full Output</h5>
                              <pre>{JSON.stringify(result.output, null, 2)}</pre>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
};

export default BatchResults;
