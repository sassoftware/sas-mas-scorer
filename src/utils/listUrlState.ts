// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * List view state (search, filters, sort, page) kept in the URL query, so
 * browser Back, a reload and a shared link all bring back the same view.
 *
 * The query sits after the route inside the hash (`#/flows?q=credit&page=2`),
 * which works the same under HashRouter in all three builds (web, jobdef,
 * Electron).
 *
 * Conventions shared by every list:
 * - values equal to the list's default are left out, so an untouched list
 *   keeps a clean URL;
 * - writes replace the current history entry: typing in a search box must not
 *   add an entry per keystroke, and Back should leave the list, not step back
 *   through its filters;
 * - `page` is 1-based, the number the pagination control shows.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { registerViewCache } from './viewCaches';

/** Location state that asks a list to start from its defaults. */
export const RESET_LIST_STATE = { resetList: true } as const;

const isResetRequested = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && (state as { resetList?: unknown }).resetList === true;

/** Parse a 1-based page number from a URL value; anything invalid is page 1. */
export const parsePageParam = (value: string | null | undefined): number => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

/**
 * Build the query string for `values`, leaving out every value that equals
 * its default. Returns '' or a string starting with '?'.
 */
export const buildListSearch = <K extends string>(
  values: Record<K, string>,
  defaults: Record<K, string>
): string => {
  const params = new URLSearchParams();
  (Object.keys(defaults) as K[]).forEach((key) => {
    const value = values[key];
    if (value !== undefined && value !== defaults[key]) params.set(key, value);
  });
  const search = params.toString();
  return search ? `?${search}` : '';
};

/** Read the list's own keys from a query, with defaults for missing ones. */
export const readListParams = <K extends string>(
  params: URLSearchParams,
  defaults: Record<K, string>
): Record<K, string> => {
  const values = { ...defaults };
  (Object.keys(defaults) as K[]).forEach((key) => {
    const value = params.get(key);
    if (value !== null) values[key] = value;
  });
  return values;
};

// The last view of each list in this session, so a detail page's own Back
// button (which links to the bare list route) returns to the same search and
// page. Dropped with the other view caches on logout and connection switch.
const rememberedSearch = new Map<string, string>();

registerViewCache('listUrlState', () => rememberedSearch.clear());

/**
 * The URL-backed state of one list view.
 *
 * `listKey` names the list for the session memory above; `defaults` must be a
 * module-level constant. Arriving on the bare list route brings back the
 * list's last view, unless the navigation carried RESET_LIST_STATE (the
 * sidebar entry for the list), which starts from the defaults.
 */
export function useListUrlParams<K extends string>(
  listKey: string,
  defaults: Record<K, string>
): [Record<K, string>, (patch: Partial<Record<K, string>>) => void] {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const keys = Object.keys(defaults) as K[];
  const hasOwnParams = keys.some((key) => searchParams.has(key));

  // Decided once, on mount: the remembered view to bring back, if any. It is
  // shown from the first render and written to the URL right after.
  const [pendingRestore, setPendingRestore] = useState<string | null>(() => {
    if (hasOwnParams || isResetRequested(location.state)) return null;
    const remembered = rememberedSearch.get(listKey);
    return remembered ? remembered : null;
  });

  const effectiveParams = pendingRestore !== null ? new URLSearchParams(pendingRestore) : searchParams;
  const serialized = buildListSearch(readListParams(effectiveParams, defaults), defaults);
  // Re-derived from the serialized form so the object only changes when a
  // value does.
  const values = useMemo(
    () => readListParams(new URLSearchParams(serialized), defaults),
    [serialized, defaults]
  );

  useEffect(() => {
    if (pendingRestore === null) return;
    setSearchParams(new URLSearchParams(pendingRestore), { replace: true });
    setPendingRestore(null);
  }, [pendingRestore, setSearchParams]);

  useEffect(() => {
    if (pendingRestore !== null) return;
    if (serialized) rememberedSearch.set(listKey, serialized);
    else rememberedSearch.delete(listKey);
  }, [listKey, serialized, pendingRestore]);

  const update = useCallback(
    (patch: Partial<Record<K, string>>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          (Object.keys(patch) as K[]).forEach((key) => {
            const value = patch[key];
            if (value === undefined || value === defaults[key]) next.delete(key);
            else next.set(key, value);
          });
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams, defaults]
  );

  return [values, update];
}

/**
 * A search box backed by a URL value. The text follows the user's typing at
 * once; `commit` receives it after `delayMs` of quiet (it should write the
 * URL). When the URL value changes from elsewhere (the sidebar resets the
 * list, Back/Forward between two entries of the same list), the box follows.
 */
export function useDebouncedUrlText(
  urlValue: string,
  commit: (value: string) => void,
  delayMs = 300
): [string, (value: string) => void] {
  const [text, setText] = useState(urlValue);
  // The value last written to (or read from) the URL.
  const committedRef = useRef(urlValue);

  useEffect(() => {
    if (urlValue !== committedRef.current) {
      committedRef.current = urlValue;
      setText(urlValue);
    }
  }, [urlValue]);

  useEffect(() => {
    if (text === committedRef.current) return;
    const timer = setTimeout(() => {
      committedRef.current = text;
      commit(text);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [text, commit, delayMs]);

  return [text, setText];
}
