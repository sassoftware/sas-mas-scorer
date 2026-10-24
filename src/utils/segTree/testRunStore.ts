// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Keeps the last table-test result of each segmentation tree for the browser
// session, so the overlay survives a reload or a trip to another page. The
// path ids it is keyed by are only stable within one tree revision, so a
// stored run is returned only for the revision it was made against.

import type { RowResult, TestRunResults } from './testRows';

/** What the explorer shows for a finished table test. */
export interface StoredTestRun {
  testName: string;
  ranAt: string;
  outputTable: string;
  results: TestRunResults;
}

interface StoredShape {
  v: 1;
  revision: string;
  run: Omit<StoredTestRun, 'results'> & {
    results: Omit<TestRunResults, 'byPath'> & { byPath: Array<[string, RowResult]> };
  };
}

const PREFIX = 'segtree-run:';
/** Skip storing a run this large (characters) rather than crowd out other session data. */
const MAX_STORED_CHARS = 2_000_000;

const key = (treeId: string) => `${PREFIX}${treeId}`;

/** The revision a run belongs to: the revision id, or the modified time as a fallback. */
export function treeRevisionKey(tree: { revisionId?: string; modifiedTimeStamp?: string }): string {
  return tree.revisionId ?? tree.modifiedTimeStamp ?? '';
}

/** Store the run; returns false when it could not be kept (too large, storage blocked). */
export function saveTestRun(treeId: string, revision: string, run: StoredTestRun): boolean {
  const shape: StoredShape = {
    v: 1,
    revision,
    run: { ...run, results: { ...run.results, byPath: [...run.results.byPath.entries()] } },
  };
  try {
    const text = JSON.stringify(shape);
    if (text.length > MAX_STORED_CHARS) {
      sessionStorage.removeItem(key(treeId));
      return false;
    }
    sessionStorage.setItem(key(treeId), text);
    return true;
  } catch {
    return false;
  }
}

/** The stored run for this tree revision, or null (none, another revision, unreadable). */
export function loadTestRun(treeId: string, revision: string): StoredTestRun | null {
  try {
    const text = sessionStorage.getItem(key(treeId));
    if (!text) return null;
    const shape = JSON.parse(text) as StoredShape;
    if (shape?.v !== 1 || shape.revision !== revision || !Array.isArray(shape.run?.results?.byPath)) {
      return null;
    }
    return { ...shape.run, results: { ...shape.run.results, byPath: new Map(shape.run.results.byPath) } };
  } catch {
    return null;
  }
}

export function clearTestRun(treeId: string): void {
  try {
    sessionStorage.removeItem(key(treeId));
  } catch {
    /* storage blocked */
  }
}
