// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { StepOutput, StepParameter } from '../../types';
import { Badge, StatusBadge, TypeBadge } from '../common/Badge';
import { Card, CardHeader, CardBody } from '../common/Card';
import { Button } from '../common/Button';

interface OutputDisplayProps {
  output: StepOutput;
  parameters: StepParameter[];
  executionTime?: number | null;
}

export const OutputDisplay: React.FC<OutputDisplayProps> = ({
  output,
  parameters,
  executionTime,
}) => {
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table');

  const getParameterType = (name: string): string => {
    // Try exact match first, then case-insensitive match
    let param = parameters.find((p) => p.name === name);
    if (!param) {
      const lowerName = name.toLowerCase();
      param = parameters.find((p) => p.name.toLowerCase() === lowerName);
    }
    return param?.type ?? 'unknown';
  };

  // Check if a value is a datagrid structure
  const isDatagrid = (value: unknown): boolean => {
    if (!Array.isArray(value)) return false;
    // Look for an object with 'data' property in the array
    return value.some(
      (item) => typeof item === 'object' && item !== null && 'data' in item
    );
  };

  // Extract datagrid parts from the value array
  const parseDatagrid = (value: unknown[]): { headers: string[] | null; rows: unknown[][] } => {
    let headers: string[] | null = null;
    let rows: unknown[][] = [];

    for (const item of value) {
      if (typeof item === 'object' && item !== null) {
        if ('metadata' in item && Array.isArray((item as { metadata: unknown }).metadata)) {
          // metadata is an array of objects like [{ "KEY": "string" }, { "VALUE": "int" }]
          const metadataArray = (item as { metadata: Array<Record<string, string>> }).metadata;
          headers = metadataArray.map((col) => Object.keys(col)[0]);
        }
        if ('data' in item && Array.isArray((item as { data: unknown }).data)) {
          rows = (item as { data: unknown[][] }).data;
        }
      }
    }

    return { headers, rows };
  };

  // Render a datagrid as a table
  const renderDatagrid = (value: unknown[]): React.ReactNode => {
    const { headers, rows } = parseDatagrid(value);

    return (
      <table className="output-display__datagrid">
        {headers && (
          <thead>
            <tr>
              {headers.map((header, idx) => (
                <th key={idx}>{header}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {Array.isArray(row) ? (
                row.map((cell, cellIdx) => (
                  <td key={cellIdx}>
                    {cell === null || cell === undefined
                      ? <span className="output-display__null">null</span>
                      : String(cell)}
                  </td>
                ))
              ) : (
                <td>{String(row)}</td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={headers?.length ?? 1} className="output-display__empty">
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  };

  const formatValue = (value: unknown): React.ReactNode => {
    if (value === null || value === undefined) {
      return <span className="output-display__null">null</span>;
    }
    if (Array.isArray(value)) {
      // Check if this is a datagrid structure
      if (isDatagrid(value)) {
        return renderDatagrid(value);
      }
      return (
        <span className="output-display__array">
          [{value.map((v, i) => (
            <span key={i}>
              {i > 0 && ', '}
              {formatValue(v)}
            </span>
          ))}]
        </span>
      );
    }
    if (typeof value === 'object') {
      return (
        <pre className="output-display__object">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
    }
    if (typeof value === 'number') {
      return <span className="output-display__number">{value}</span>;
    }
    if (typeof value === 'boolean') {
      return (
        <span className={`output-display__boolean output-display__boolean--${value}`}>
          {String(value)}
        </span>
      );
    }
    return <span className="output-display__string">"{String(value)}"</span>;
  };

  const copyToClipboard = () => {
    const outputData = (output.outputs ?? []).reduce((acc, variable) => {
      acc[variable.name] = variable.value;
      return acc;
    }, {} as Record<string, unknown>);

    navigator.clipboard.writeText(JSON.stringify(outputData, null, 2));
  };

  return (
    <div className="output-display">
      <Card>
        <CardHeader
          actions={
            <div className="output-display__header-actions">
              <div className="output-display__view-toggle">
                <Button
                  variant={viewMode === 'table' ? 'primary' : 'tertiary'}
                  size="small"
                  onClick={() => setViewMode('table')}
                >
                  Table
                </Button>
                <Button
                  variant={viewMode === 'json' ? 'primary' : 'tertiary'}
                  size="small"
                  onClick={() => setViewMode('json')}
                >
                  JSON
                </Button>
              </div>
              <Button variant="secondary" size="small" onClick={copyToClipboard}>
                Copy
              </Button>
            </div>
          }
        >
          <div className="output-display__header">
            <h3>Execution Results</h3>
            <div className="output-display__meta">
              <StatusBadge status={output.executionState} />
              {executionTime && (
                <Badge variant="default">{executionTime.toFixed(0)}ms</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardBody>
          {output.executionState === 'timedOut' ? (
            <div className="output-display__timeout">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <p>Execution timed out. Results may not be available.</p>
            </div>
          ) : output.executionState === 'submitted' ? (
            <div className="output-display__submitted">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <p>Execution submitted. Check back later for results.</p>
            </div>
          ) : viewMode === 'table' ? (
            <table className="output-display__table">
              <thead>
                <tr>
                  <th>Output Name</th>
                  <th>Type</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {(output.outputs ?? []).map((variable) => (
                  <tr key={variable.name}>
                    <td className="output-display__name">{variable.name}</td>
                    <td>
                      <TypeBadge type={getParameterType(variable.name)} />
                    </td>
                    <td className="output-display__value">
                      {formatValue(variable.value)}
                    </td>
                  </tr>
                ))}
                {(output.outputs?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={3} className="output-display__empty">
                      No output values returned
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <pre className="output-display__json">
              {JSON.stringify(
                {
                  moduleId: output.moduleId,
                  stepId: output.stepId,
                  executionState: output.executionState,
                  outputs: (output.outputs ?? []).reduce((acc, v) => {
                    acc[v.name] = v.value;
                    return acc;
                  }, {} as Record<string, unknown>),
                  metadata: output.metadata,
                },
                null,
                2
              )}
            </pre>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

export default OutputDisplay;
