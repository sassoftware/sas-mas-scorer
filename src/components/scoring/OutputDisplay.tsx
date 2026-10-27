// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useMemo, useState } from 'react';
import { StepOutput, StepParameter } from '../../types';
import { Badge, StatusBadge, TypeBadge } from '../common/Badge';
import { Card, CardHeader, CardBody } from '../common/Card';
import { Button } from '../common/Button';
import { DatagridTable } from './DatagridTable';
import { coerceDatagridValue, isDatagrid } from '../../utils/datagrid';
import { checkOutputs, hasExpectation, unwrapValue } from '../../utils/expectedValues';
import { CheckBadge } from './CheckBadge';
import { ComparisonRule } from './ComparisonRule';

// A stored expectation as it is shown: unwrapped, and a datagrid saved as
// JSON text drawn as the grid it holds
const expectedForDisplay = (value: unknown): unknown => {
  const v = unwrapValue(value);
  return coerceDatagridValue(v) ?? v;
};

interface OutputDisplayProps {
  output: StepOutput;
  parameters: StepParameter[];
  executionTime?: number | null;
  /**
   * Expected values by output name (a loaded scenario's). When given, the
   * table gains Expected and Check columns; null values are not checked.
   */
  expected?: Record<string, unknown> | null;
  /** Where the expected values come from, e.g. the scenario name */
  expectedSource?: string;
}

export const OutputDisplay: React.FC<OutputDisplayProps> = ({
  output,
  parameters,
  executionTime,
  expected,
  expectedSource,
}) => {
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table');

  // Compared once per run (or per loaded scenario), not per render
  const checks = useMemo(
    () => (expected ? checkOutputs(output.outputs, expected) : null),
    [output.outputs, expected]
  );
  const overall = checks
    ? checks.failed > 0 ? 'fail' : checks.passed > 0 ? 'pass' : 'none'
    : null;

  const getParameterType = (name: string): string => {
    // Try exact match first, then case-insensitive match
    let param = parameters.find((p) => p.name === name);
    if (!param) {
      const lowerName = name.toLowerCase();
      param = parameters.find((p) => p.name.toLowerCase() === lowerName);
    }
    return param?.type ?? 'unknown';
  };

  const formatValue = (value: unknown): React.ReactNode => {
    if (value === null || value === undefined) {
      return <span className="output-display__null">null</span>;
    }
    if (Array.isArray(value)) {
      // Check if this is a datagrid structure
      if (isDatagrid(value)) {
        return <DatagridTable value={value} />;
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
          {checks && overall && (
            <div className="output-display__check-summary" role="status" aria-live="polite">
              <CheckBadge
                status={overall}
                size="medium"
                label={overall === 'fail' ? 'Differs from expected' : overall === 'pass' ? 'Matches expected' : 'Nothing to check'}
              />
              <span>
                {expectedSource ? <>Scenario <strong>{expectedSource}</strong>: </> : 'Expected values: '}
                {checks.passed} match, {checks.failed} differ
                {checks.unchecked > 0 ? `, ${checks.unchecked} not checked (no expected value)` : ''}
              </span>
              <ComparisonRule />
            </div>
          )}
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
            <div className="sas-table__wrapper">
              <table className="sas-table">
                <thead className="sas-table__head">
                  <tr>
                    <th className="sas-table__th">Output Name</th>
                    <th className="sas-table__th">Type</th>
                    <th className="sas-table__th">Value</th>
                    {checks && <th className="sas-table__th">Expected</th>}
                    {checks && <th className="sas-table__th">Check</th>}
                  </tr>
                </thead>
                <tbody>
                  {(output.outputs ?? []).map((variable) => {
                    const check = checks?.byName.get(variable.name.toLowerCase());
                    return (
                      <tr
                        className={`sas-table__row${check?.status === 'fail' ? ' output-display__row--fail' : ''}`}
                        key={variable.name}
                      >
                        <td className="sas-table__td output-display__name">{variable.name}</td>
                        <td className="sas-table__td">
                          <TypeBadge type={getParameterType(variable.name)} />
                        </td>
                        <td className="sas-table__td output-display__value">
                          {formatValue(variable.value)}
                        </td>
                        {checks && (
                          <td className="sas-table__td output-display__value">
                            {check && hasExpectation(check.expected)
                              ? formatValue(expectedForDisplay(check.expected))
                              : <span className="output-display__null">n/a</span>}
                          </td>
                        )}
                        {checks && (
                          <td className="sas-table__td">
                            <CheckBadge status={check?.status ?? 'none'} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {checks?.notReturned.map((check) => (
                    <tr className="sas-table__row output-display__row--fail" key={`missing-${check.name}`}>
                      <td className="sas-table__td output-display__name">{check.name}</td>
                      <td className="sas-table__td">
                        <TypeBadge type={getParameterType(check.name)} />
                      </td>
                      <td className="sas-table__td output-display__value">
                        <span className="output-display__null">not returned</span>
                      </td>
                      <td className="sas-table__td output-display__value">
                        {formatValue(expectedForDisplay(check.expected))}
                      </td>
                      <td className="sas-table__td">
                        <CheckBadge status="fail" />
                      </td>
                    </tr>
                  ))}
                  {(output.outputs?.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={checks ? 5 : 3} className="sas-table__td output-display__empty">
                        No output values returned
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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
