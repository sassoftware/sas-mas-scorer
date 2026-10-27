// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { SidNodeData } from '../../types/sid';
import { NODE_TYPE_LABELS } from '../../flow/constants';

/** One node the finder can jump to. */
export interface FinderEntry {
  id: string;
  label: string;
  data: SidNodeData;
  /** The type as the legend names it. */
  typeLabel: string;
  /** The sub-decisions / parallel groups around it, outermost first. */
  path: string[];
}

interface FlowNodeFinderProps {
  entries: FinderEntry[];
  onPick: (entry: FinderEntry) => void;
}

/** More than this many matches: show the first ones and ask for more text. */
const MAX_OPTIONS = 50;

function matches(entry: FinderEntry, query: string): boolean {
  if (!query) return true;
  const expression = typeof entry.data.expression === 'string' ? entry.data.expression : '';
  return [entry.label, entry.typeLabel, expression, ...entry.path]
    .some((text) => text.toLowerCase().includes(query));
}

/** Typed nodes the finder lists: not Start/End or a sub-decision's end marker. */
export function finderEntries(
  nodes: Array<{ id: string; data: SidNodeData }>,
  groups: Array<{ label: string; nodeIds: string[] }>,
): FinderEntry[] {
  // Groups are listed outermost first. A group's first node is the one that
  // opens it (the sub-decision or parallel step itself), which it does not
  // sit inside.
  const paths = new Map<string, string[]>();
  for (const g of groups) {
    g.nodeIds.forEach((id, i) => {
      if (i === 0) return;
      const path = paths.get(id) ?? [];
      path.push(g.label);
      paths.set(id, path);
    });
  }
  return nodes
    .filter((n) => n.data.nodeType !== 'start' && n.data.nodeType !== 'end' && n.data.step)
    .map((n) => {
      const path = paths.get(n.id) ?? [];
      return {
        id: n.id,
        label: n.data.label || '(unnamed)',
        data: n.data,
        typeLabel: NODE_TYPE_LABELS[n.data.nodeType] ?? n.data.nodeType,
        path,
      };
    });
}

/**
 * "Find node": an editable combobox with a list popup (ARIA 1.2 combobox
 * pattern). Typing filters by name, type, branch expression or containing
 * sub-decision; Up/Down move through the matches, Enter picks one, Escape
 * closes the list and then clears the text. Focus stays in the field; the
 * active option is announced through aria-activedescendant.
 */
export default function FlowNodeFinder({ entries, onPick }: FlowNodeFinderProps) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const normalized = query.trim().toLowerCase();
  const allMatches = useMemo(() => entries.filter((e) => matches(e, normalized)), [entries, normalized]);
  const shown = allMatches.slice(0, MAX_OPTIONS);
  const expanded = open && entries.length > 0;

  const pick = (entry: FinderEntry) => {
    setQuery(entry.label);
    setOpen(false);
    setActive(-1);
    onPick(entry);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        if (!expanded) { setOpen(true); setActive(e.altKey ? -1 : 0); return; }
        if (e.altKey) return;
        setActive((a) => (shown.length === 0 ? -1 : (a + 1) % shown.length));
        return;
      }
      case 'ArrowUp': {
        e.preventDefault();
        if (!expanded) { setOpen(true); setActive(shown.length - 1); return; }
        setActive((a) => (shown.length === 0 ? -1 : (a <= 0 ? shown.length - 1 : a - 1)));
        return;
      }
      case 'Enter': {
        if (expanded && active >= 0 && shown[active]) {
          e.preventDefault();
          pick(shown[active]);
        } else if (expanded && shown.length === 1) {
          e.preventDefault();
          pick(shown[0]);
        }
        return;
      }
      case 'Escape': {
        // Handled here, so the page's Escape (close panel, clear trace)
        // does not also fire.
        if (expanded) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setActive(-1);
        } else if (query) {
          e.preventDefault();
          e.stopPropagation();
          setQuery('');
        }
        return;
      }
      default:
    }
  };

  const status = !expanded
    ? ''
    : allMatches.length === 0
      ? 'No matching nodes'
      : allMatches.length > shown.length
        ? `${allMatches.length} matching nodes, showing the first ${shown.length}`
        : `${allMatches.length} matching node${allMatches.length === 1 ? '' : 's'}`;

  return (
    <div className="flow-finder">
      <label className="flow-finder__label" htmlFor={inputId}>Find node</label>
      <div className="flow-finder__field">
        <input
          id={inputId}
          type="text"
          className="sas-input flow-finder__input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          aria-describedby={`${baseId}-hint`}
          placeholder="Name, type or expression"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(-1); }}
          onClick={() => setOpen(true)}
          onBlur={() => { setOpen(false); setActive(-1); }}
          onKeyDown={handleKeyDown}
        />
        <span id={`${baseId}-hint`} className="sr-only">
          {entries.length} nodes. Type to filter, then use the arrow keys and Enter to show a node.
        </span>
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching nodes"
          className="flow-finder__list"
          hidden={!expanded}
        >
          {expanded && shown.map((entry, i) => (
            <li
              key={entry.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={`flow-finder__option${i === active ? ' flow-finder__option--active' : ''}`}
              // Keep focus in the field; the click picks.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(entry)}
            >
              <span className="flow-finder__option-label">{entry.label}</span>
              <span className="flow-finder__option-meta">
                {entry.typeLabel}
                {entry.path.length > 0 && <> · in {entry.path.join(' › ')}</>}
              </span>
            </li>
          ))}
          {expanded && shown.length === 0 && (
            <li role="option" aria-selected={false} aria-disabled="true" className="flow-finder__empty">
              No matching nodes
            </li>
          )}
        </ul>
      </div>
      <span className="sr-only" role="status" aria-live="polite">{status}</span>
    </div>
  );
}
