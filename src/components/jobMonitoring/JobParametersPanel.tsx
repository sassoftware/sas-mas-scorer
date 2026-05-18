// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useMemo } from 'react';
import { DataTable, Column } from '../common/DataTable';
import { ExecutionJobParameter } from '../../types/jobExecution';

interface ParameterRow {
  key: string;
  name: string;
  label?: string;
  type: string;
  defaultValue: string;
  actualValue: string | null;
  required: boolean;
  overridden: boolean;
  extra: boolean;
}

interface JobParametersPanelProps {
  parameters: ExecutionJobParameter[] | undefined;
  parameterArguments: Record<string, string> | undefined;
}

export const JobParametersPanel: React.FC<JobParametersPanelProps> = ({
  parameters,
  parameterArguments,
}) => {
  const rows = useMemo<ParameterRow[]>(() => {
    const args = parameterArguments ?? {};
    const declared = parameters ?? [];
    const declaredNames = new Set(declared.map((p) => p.name));

    const fromDeclared: ParameterRow[] = declared.map((p) => {
      const hasArg = Object.prototype.hasOwnProperty.call(args, p.name);
      const actual = hasArg ? args[p.name] : null;
      const overridden = hasArg && actual !== (p.defaultValue ?? null) && actual !== undefined;
      return {
        key: p.name,
        name: p.name,
        label: p.label,
        type: p.type ?? '—',
        defaultValue: p.defaultValue ?? '—',
        actualValue: actual,
        required: !!p.required,
        overridden,
        extra: false,
      };
    });

    // Arguments not declared on the definition — show them so users notice.
    const extras: ParameterRow[] = Object.keys(args)
      .filter((name) => !declaredNames.has(name))
      .map((name) => ({
        key: `extra:${name}`,
        name,
        type: '—',
        defaultValue: '—',
        actualValue: args[name],
        required: false,
        overridden: true,
        extra: true,
      }));

    return [...fromDeclared, ...extras];
  }, [parameters, parameterArguments]);

  const columns: Column<ParameterRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <div className="job-monitoring__cell-name">
          <span className="job-monitoring__cell-name-main">{row.name}</span>
          {row.label && row.label !== row.name && (
            <span className="job-monitoring__cell-name-sub">{row.label}</span>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: '120px',
      render: (row) => row.type,
    },
    {
      key: 'required',
      header: 'Required',
      width: '100px',
      render: (row) => (row.required ? 'Yes' : 'No'),
    },
    {
      key: 'default',
      header: 'Default',
      render: (row) => <span className="job-monitoring__cell-mono">{row.defaultValue}</span>,
    },
    {
      key: 'actual',
      header: 'Argument',
      render: (row) => {
        if (row.actualValue === null) {
          return <span className="job-params__value-default">— (default)</span>;
        }
        return (
          <span>
            <span
              className={
                row.overridden
                  ? 'job-monitoring__cell-mono job-params__value-override'
                  : 'job-monitoring__cell-mono'
              }
            >
              {row.actualValue}
            </span>
            {row.extra && <span className="job-params__override-tag">extra</span>}
            {!row.extra && row.overridden && (
              <span className="job-params__override-tag">overridden</span>
            )}
          </span>
        );
      },
    },
  ];

  if (rows.length === 0) {
    return <p className="job-monitoring__empty">This job has no parameters.</p>;
  }

  return (
    <div className="job-params">
      <p className="job-params__note">
        Shows each parameter declared on the job definition alongside the value passed in at submission.
      </p>
      <DataTable<ParameterRow>
        columns={columns}
        data={rows}
        keyField="key"
        striped
        hoverable={false}
      />
    </div>
  );
};
