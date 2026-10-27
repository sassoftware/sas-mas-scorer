// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react';
import type { TreeIndex } from '../../utils/segTree/treeIndex';
import { variableSummary } from '../../utils/segTree/findInTree';

interface SegTreeVariablesProps {
  index: TreeIndex;
  /** Find this variable in the tree. */
  onFind: (variable: string) => void;
}

const SHOWN_VALUES = 16;

function valuesText(values: Array<string | number>): string {
  if (values.length === 0) return '—';
  const shown = values.slice(0, SHOWN_VALUES).map((v) => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 10 }) : `'${v}'`));
  return values.length > SHOWN_VALUES ? `${shown.join(', ')} and ${values.length - SHOWN_VALUES} more` : shown.join(', ');
}

/** Each variable the tree splits on: how often, at which levels, and on which cut points or values. */
export default function SegTreeVariables({ index, onFind }: SegTreeVariablesProps) {
  const [open, setOpen] = useState(false);
  // Worked out only once the summary is opened; a large tree has thousands of branches.
  const rows = useMemo(() => (open ? variableSummary(index) : []), [index, open]);
  const count = useMemo(() => new Set([...index.splits.values()].map((s) => s.variable)).size, [index]);

  return (
    <details className="segtree-vars" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Variables ({count.toLocaleString()})</summary>
      {open && (
        <div className="segtree-vars__wrap">
          <table className="sas-table sas-table--compact segtree-vars__table">
            <caption className="sr-only">Variables the tree splits on</caption>
            <thead className="sas-table__head">
              <tr>
                <th className="sas-table__th" scope="col">Variable</th>
                <th className="sas-table__th" scope="col">Type</th>
                <th className="sas-table__th" scope="col">Splits</th>
                <th className="sas-table__th" scope="col">Levels</th>
                <th className="sas-table__th" scope="col">Cut points / values</th>
                <th className="sas-table__th" scope="col"><span className="sr-only">Find</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.variable} className="sas-table__row">
                  <th scope="row" className="sas-table__td segtree-vars__name">{r.variable}</th>
                  <td className="sas-table__td">{r.type === 'condition' ? 'expression' : r.type}</td>
                  <td className="sas-table__td">{r.splits.toLocaleString()}</td>
                  <td className="sas-table__td">{r.minDepth === r.maxDepth ? r.minDepth : `${r.minDepth}–${r.maxDepth}`}</td>
                  <td className="sas-table__td segtree-vars__values">
                    {valuesText(r.cutPoints.length ? r.cutPoints : r.values)}
                    {r.opaque > 0 && <span className="segtree-vars__opaque"> ({r.opaque.toLocaleString()} branch{r.opaque !== 1 ? 'es' : ''} not read)</span>}
                  </td>
                  <td className="sas-table__td">
                    <button type="button" className="segtree-vars__find" onClick={() => onFind(r.variable)} aria-label={`Find ${r.variable} in the tree`}>
                      Find
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
