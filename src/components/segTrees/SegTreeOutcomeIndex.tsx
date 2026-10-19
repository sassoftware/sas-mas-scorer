// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react';
import {
  constraintIsTrivial,
  describeConstraint,
  NO_OUTCOME,
  pathConstraints,
  pathNumber,
  type TreeIndex,
} from '../../utils/segTree/treeIndex';
import type { RowResult } from '../../utils/segTree/testRows';
import { Button, SearchInput } from '../common';

interface SegTreeOutcomeIndexProps {
  index: TreeIndex;
  focusId: string | null;
  results: Map<string, RowResult> | null;
  onNavigate: (branchId: string) => void;
  onTest: (title: string, leafIds: string[]) => void;
}

type Filter = 'all' | 'failed' | 'unreachable';

const CHUNK = 100;

interface OutcomeRow {
  key: string;
  name: string;
  outputs: string;
  /** Lower-cased name + outputs for the search. */
  haystack: string;
  group: string;
  leafIds: string[];
  failed: number;
  unreachable: number;
}

/** Conditions shared by every path, and what each path adds on top. */
function splitCommon(index: TreeIndex, leafIds: string[]) {
  const per = leafIds.map((id) =>
    pathConstraints(index, id).filter((c) => !constraintIsTrivial(c)).map(describeConstraint)
  );
  const common = per[0]?.filter((line) => per.every((lines) => lines.includes(line))) ?? [];
  return {
    common,
    differing: per.map((lines) => lines.filter((l) => !common.includes(l))),
  };
}

export default function SegTreeOutcomeIndex({ index, focusId, results, onNavigate, onTest }: SegTreeOutcomeIndexProps) {
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [shown, setShown] = useState(CHUNK);

  const focusOutcome = focusId ? index.branches.get(focusId)?.outcomeName ?? null : null;

  const rows = useMemo<OutcomeRow[]>(() => {
    const list: OutcomeRow[] = [];
    for (const [key, leafIds] of index.outcomeLeaves) {
      const outcome = key === NO_OUTCOME ? null : index.outcomes.get(key);
      const actions = outcome?.actions ?? [];
      const outputs = actions.map((a) => `${a.variableName}=${a.valueType === 'static' ? a.value : '…'}`).join(', ');
      const name = key === NO_OUTCOME ? '(no outcome)' : key;
      const groupAction = groupBy ? actions.find((a) => a.variableName === groupBy) : undefined;
      list.push({
        key,
        name,
        outputs,
        haystack: `${name} ${outputs}`.toLowerCase(),
        group: groupBy ? (groupAction ? String(groupAction.value) : '(not set)') : '',
        leafIds,
        failed: results ? leafIds.filter((id) => results.get(id)?.status === 'fail').length : 0,
        unreachable: leafIds.filter((id) => index.leafStatus.get(id) === 'shadowed').length,
      });
    }
    return list;
  }, [index, results, groupBy]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = rows.filter((r) => !term || r.haystack.includes(term));
    if (filter === 'failed') list = list.filter((r) => r.failed > 0);
    if (filter === 'unreachable') list = list.filter((r) => r.unreachable > 0);
    if (groupBy) {
      list = [...list].sort((a, b) => a.group.localeCompare(b.group, undefined, { numeric: true }));
    }
    return list;
  }, [rows, search, filter, groupBy]);

  const expandedRow = expanded ? rows.find((r) => r.key === expanded) : undefined;
  const detail = useMemo(
    () => (expandedRow && expandedRow.leafIds.length > 1 ? splitCommon(index, expandedRow.leafIds.slice(0, 200)) : null),
    [index, expandedRow]
  );

  const select = (row: OutcomeRow) => {
    if (row.leafIds.length === 1) {
      setExpanded(null);
      onNavigate(row.leafIds[0]);
    } else {
      setExpanded((prev) => (prev === row.key ? null : row.key));
    }
  };

  let lastGroup: string | null = null;

  return (
    <section className="segtree-outcomes" aria-labelledby="segtree-outcomes-title">
      <h2 id="segtree-outcomes-title" className="segtree-outcomes__title">
        Outcomes <span className="segtree-outcomes__count">{rows.length.toLocaleString()}</span>
      </h2>

      <SearchInput
        aria-label="Search outcomes"
        value={search}
        onChange={(v) => { setSearch(v); setShown(CHUNK); }}
        placeholder="Search name or value..."
        className="segtree-outcomes__search"
      />

      <div className="segtree-outcomes__filters">
        <label className="segtree-outcomes__filter">
          <span>Group by</span>
          <select className="sas-input segtree-input--compact" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="">None</option>
            {index.outputVariables.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="segtree-outcomes__filter">
          <span>Show</span>
          <select className="sas-input segtree-input--compact" value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setShown(CHUNK); }}>
            <option value="all">All</option>
            {results && <option value="failed">With failed paths</option>}
            {index.shadowedCount > 0 && <option value="unreachable">With unreachable paths</option>}
          </select>
        </label>
      </div>

      {visible.length === 0 && <p className="segtree-outcomes__empty">No outcomes match.</p>}

      <ul className="segtree-outcomes__list">
        {visible.slice(0, shown).map((row) => {
          const header = groupBy && row.group !== lastGroup ? row.group : null;
          lastGroup = row.group;
          const isOpen = expanded === row.key;
          const isFocus = focusOutcome !== null && focusOutcome === row.key;
          return (
            <li key={row.key} className="segtree-outcomes__entry">
              {header !== null && (
                <div className="segtree-outcomes__group" role="presentation">{groupBy} = {header}</div>
              )}
              <button
                type="button"
                className={`segtree-outcome${isFocus ? ' segtree-outcome--focus' : ''}`}
                aria-expanded={row.leafIds.length > 1 ? isOpen : undefined}
                onClick={() => select(row)}
              >
                <span className="segtree-outcome__name">{row.name}</span>
                <span className="segtree-outcome__paths">
                  {row.leafIds.length} path{row.leafIds.length !== 1 ? 's' : ''}
                </span>
                {row.outputs && <span className="segtree-outcome__outputs">{row.outputs}</span>}
                {(row.failed > 0 || row.unreachable > 0) && (
                  <span className="segtree-branch__chips">
                    {row.failed > 0 && <span className="segtree-chip segtree-chip--fail">{row.failed} failed</span>}
                    {row.unreachable > 0 && <span className="segtree-chip segtree-chip--warn">{row.unreachable} unreachable</span>}
                  </span>
                )}
              </button>

              {isOpen && (
                <div className="segtree-outcome__detail">
                  {detail && detail.common.length > 0 && (
                    <div className="segtree-outcome__common">
                      <span className="segtree-outcome__label">Every path:</span>
                      <ul>{detail.common.map((l) => <li key={l}>{l}</li>)}</ul>
                    </div>
                  )}
                  <ol className="segtree-outcome__paths-list">
                    {row.leafIds.map((id, i) => {
                      const diff = detail && i < 200 ? detail.differing[i] : null;
                      const res = results?.get(id);
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            className={`segtree-outcome__path${id === focusId ? ' segtree-outcome__path--focus' : ''}`}
                            aria-current={id === focusId ? 'true' : undefined}
                            onClick={() => onNavigate(id)}
                          >
                            <span className="segtree-outcome__path-name">
                              Path {pathNumber(index, id)}
                              {index.leafStatus.get(id) === 'shadowed' && <span className="segtree-chip segtree-chip--warn">Unreachable</span>}
                              {res?.status === 'fail' && <span className="segtree-chip segtree-chip--fail">Failed</span>}
                            </span>
                            {diff && diff.length > 0 && <span className="segtree-outcome__diff">{diff.join(' · ')}</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                  <Button variant="tertiary" size="small" onClick={() => onTest(`Outcome ${row.name}`, row.leafIds)}>
                    Test all {row.leafIds.length} paths…
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {visible.length > shown && (
        <Button variant="tertiary" size="small" onClick={() => setShown((n) => n + CHUNK)}>
          Show {Math.min(CHUNK, visible.length - shown)} more of {(visible.length - shown).toLocaleString()}
        </Button>
      )}
    </section>
  );
}
