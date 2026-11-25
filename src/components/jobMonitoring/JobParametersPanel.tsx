// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useMemo, useState } from 'react';
import { ListColumn, ListTable, ListToolbar, useListSort } from '../common/ListTable';
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

type ParamChip = 'all' | 'changed';

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

  const [chip, setChip] = useState<ParamChip>('all');
  const [query, setQuery] = useState('');

  // The shared list layout (3.1): chips, search, sortable columns.
  const columns = useMemo<ListColumn<ParameterRow>[]>(() => [
    {
      key: 'name',
      label: 'Name',
      sortValue: (row) => row.name.toLowerCase(),
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
      label: 'Type',
      width: '130px',
      sortValue: (row) => row.type.toLowerCase(),
      render: (row) => row.type,
    },
    {
      key: 'required',
      label: 'Required',
      width: '110px',
      sortValue: (row) => (row.required ? 0 : 1),
      render: (row) => (row.required ? 'Yes' : 'No'),
    },
    {
      key: 'default',
      label: 'Default',
      sortValue: (row) => row.defaultValue,
      render: (row) => <span className="job-monitoring__cell-mono">{row.defaultValue}</span>,
    },
    {
      key: 'actual',
      label: 'Argument',
      sortValue: (row) => row.actualValue ?? '',
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
  ], []);

  const changedCount = rows.filter((r) => r.overridden || r.extra).length;
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () => rows.filter((r) =>
      (chip === 'all' || r.overridden || r.extra)
      && (!needle || r.name.toLowerCase().includes(needle) || (r.label ?? '').toLowerCase().includes(needle))),
    [rows, chip, needle],
  );
  const [sorted, sort, setSort] = useListSort(filtered, columns, null);

  if (rows.length === 0) {
    return <div className="job-output__none" role="status">This job has no parameters.</div>;
  }

  return (
    <div className="job-params">
      <p className="job-params__note">
        Each parameter declared on the job definition, with the value passed in at submission.
      </p>
      <ListToolbar<ParamChip>
        chips={[
          { value: 'all', label: 'All', count: rows.length },
          { value: 'changed', label: 'Changed from default', count: changedCount },
        ]}
        activeChip={chip}
        onChipChange={setChip}
        chipsLabel="Filter parameters"
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Search parameters',
          ariaLabel: 'Search parameters by name',
        }}
      />
      <ListTable<ParameterRow>
        columns={columns}
        rows={sorted}
        rowKey={(row) => row.key}
        label="Job parameters"
        storageKey="job-parameters"
        sort={sort}
        onSortChange={setSort}
        emptyMessage="No parameter matches."
      />
    </div>
  );
};
