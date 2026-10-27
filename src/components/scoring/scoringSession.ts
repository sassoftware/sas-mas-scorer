// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// What Single Execution keeps for the browser session, per server + module +
// step: the draft inputs (so leaving the score page and coming back, or a
// reload, restores the form) and the last runs (inputs, outputs, latency).
//
// Both live in sessionStorage, which the browser keeps for this tab only and
// drops when it closes; the history is also held in memory, so a store that
// is full or blocked (some embeds, private modes) still keeps it until a
// reload. Every storage access is guarded: a blocked store just remembers
// nothing. Nothing here is ever sent anywhere; logging out or switching
// connection clears it (registered with the view-cache registry).

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSasViyaUrl } from '../../config';
import { registerViewCache } from '../../utils/viewCaches';

const DRAFT_PREFIX = 'mas-scorer:score-draft:';
const HISTORY_PREFIX = 'mas-scorer:score-history:';

/** Runs kept per module + step. */
export const HISTORY_LIMIT = 20;

const DRAFT_WRITE_DELAY_MS = 300;

/** The session key of one step: the server, module and step it belongs to. */
export const scoringSessionKey = (moduleId: string, stepId: string): string =>
  `${getSasViyaUrl()}|${moduleId}|${stepId}`;

// --- Guarded storage ---

const storageGet = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const storageSet = (key: string, value: string): boolean => {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

const storageRemove = (key: string): void => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* blocked: nothing was stored either */
  }
};

const parse = <T>(text: string | null): T | null => {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

// --- Drafts ---

const isEmptyValue = (v: unknown): boolean => v === null || v === undefined || v === '';

/** The stored draft of a step, limited to the step's current inputs; null when there is none. */
export const readDraft = (key: string, inputNames: string[]): Record<string, unknown> | null => {
  const stored = parse<Record<string, unknown>>(storageGet(DRAFT_PREFIX + key));
  if (!stored || typeof stored !== 'object') return null;
  const values: Record<string, unknown> = {};
  let any = false;
  for (const name of inputNames) {
    if (name in stored && !isEmptyValue(stored[name])) {
      values[name] = stored[name];
      any = true;
    }
  }
  return any ? values : null;
};

const writeDraft = (key: string, values: Record<string, unknown>): void => {
  if (Object.values(values).every(isEmptyValue)) {
    storageRemove(DRAFT_PREFIX + key);
    return;
  }
  storageSet(DRAFT_PREFIX + key, JSON.stringify(values));
};

// --- Run history ---

export interface RunRecord {
  id: string;
  /** When the run was sent (ms since epoch) */
  at: number;
  /** The inputs as sent */
  inputs: Record<string, unknown>;
  /** The outputs MAS returned; null for a failed run */
  outputs: { name: string; value: unknown }[] | null;
  executionState?: string;
  /** Request time in ms, as measured in the browser */
  latencyMs: number;
  error?: string;
}

const historyMemory = new Map<string, RunRecord[]>();

export const readHistory = (key: string): RunRecord[] => {
  const inMemory = historyMemory.get(key);
  if (inMemory) return inMemory;
  const stored = parse<RunRecord[]>(storageGet(HISTORY_PREFIX + key));
  const runs = Array.isArray(stored) ? stored.slice(0, HISTORY_LIMIT) : [];
  historyMemory.set(key, runs);
  return runs;
};

const persistHistory = (key: string, runs: RunRecord[]): void => {
  if (runs.length === 0) {
    storageRemove(HISTORY_PREFIX + key);
    return;
  }
  // A full store keeps as many of the newest runs as fit; memory keeps all
  for (let n = runs.length; n > 0; n = Math.floor(n / 2)) {
    if (storageSet(HISTORY_PREFIX + key, JSON.stringify(runs.slice(0, n)))) return;
  }
  storageRemove(HISTORY_PREFIX + key);
};

const appendHistory = (key: string, run: RunRecord): RunRecord[] => {
  const runs = [run, ...readHistory(key)].slice(0, HISTORY_LIMIT);
  historyMemory.set(key, runs);
  persistHistory(key, runs);
  return runs;
};

const clearHistory = (key: string): void => {
  historyMemory.set(key, []);
  storageRemove(HISTORY_PREFIX + key);
};

/** Drop every draft and run history (log out, connection switch). */
export const clearScoringSession = (): void => {
  historyMemory.clear();
  try {
    const doomed: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith(DRAFT_PREFIX) || k.startsWith(HISTORY_PREFIX))) doomed.push(k);
    }
    doomed.forEach(storageRemove);
  } catch {
    /* blocked: nothing was stored */
  }
};

registerViewCache('scoringSession', clearScoringSession);

// --- Hooks ---

type ValuesUpdate =
  | Record<string, unknown>
  | ((prev: Record<string, unknown>) => Record<string, unknown>);

interface DraftState {
  key: string;
  values: Record<string, unknown>;
  restored: boolean;
}

const initialDraft = (key: string, inputNames: string[]): DraftState => {
  const draft = readDraft(key, inputNames);
  return { key, values: draft ?? {}, restored: draft !== null };
};

/**
 * The Single Execution form values of one step, kept as a draft for the
 * session. `restored` is true when the form was filled from a stored draft.
 * Switching to another step (a new key) loads that step's draft.
 */
export const useDraftInputs = (key: string, inputNames: string[]) => {
  const [state, setState] = useState<DraftState>(() => initialDraft(key, inputNames));
  // Derived-state reset: a new step reads its own draft during render, so the
  // previous step's values are never shown (or written) under the new key
  let current = state;
  if (state.key !== key) {
    current = initialDraft(key, inputNames);
    setState(current);
  }

  const setValues = useCallback((update: ValuesUpdate) => {
    setState(prev => ({
      ...prev,
      values: typeof update === 'function' ? update(prev.values) : update,
    }));
  }, []);

  const dismissRestored = useCallback(() => {
    setState(prev => (prev.restored ? { ...prev, restored: false } : prev));
  }, []);

  // Written shortly after typing stops, and at once when the step changes or
  // the panel unmounts
  const pendingRef = useRef<{ key: string; values: Record<string, unknown> } | null>(null);
  useEffect(() => {
    pendingRef.current = { key: state.key, values: state.values };
    const timer = setTimeout(() => {
      if (pendingRef.current) writeDraft(pendingRef.current.key, pendingRef.current.values);
      pendingRef.current = null;
    }, DRAFT_WRITE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      if (pendingRef.current) writeDraft(pendingRef.current.key, pendingRef.current.values);
      pendingRef.current = null;
    };
  }, [state.key, state.values]);

  return {
    values: current.values,
    setValues,
    restored: current.restored,
    dismissRestored,
  };
};

/** The run history of one step, newest first, with record and clear. */
export const useRunHistory = (key: string) => {
  const [state, setState] = useState(() => ({ key, runs: readHistory(key) }));
  let current = state;
  if (state.key !== key) {
    current = { key, runs: readHistory(key) };
    setState(current);
  }

  // The key is captured per call: a run that finishes after the user moved
  // to another step is still filed under the step it ran on.
  const record = useCallback((run: Omit<RunRecord, 'id'>, runKey: string = key) => {
    const runs = appendHistory(runKey, {
      ...run,
      id: `${run.at}-${Math.random().toString(36).slice(2, 8)}`,
    });
    setState(prev => (prev.key === runKey ? { key: runKey, runs } : prev));
  }, [key]);

  const clear = useCallback(() => {
    clearHistory(key);
    setState({ key, runs: [] });
  }, [key]);

  return { runs: current.runs, record, clear };
};
