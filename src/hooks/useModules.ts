// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Module, ModuleType, Submodule, getModuleType } from '../types';
import { getModules, getAllModules, getModule, getAllSubmodules } from '../api';

interface UseModulesState {
  modules: Module[];
  loading: boolean;
  error: string | null;
  totalCount: number;
}

interface UseModulesReturn extends UseModulesState {
  refresh: () => Promise<void>;
  currentPage: number;
  pageSize: number;
  filter: string;
  sortBy: string;
  typeFilter: ModuleType | 'All';
  filteredCount: number;
  displayModules: Module[];
}

/**
 * The list query is owned by the caller (App keeps it in the URL, so Back and
 * a reload restore it). Leaving the list does not change the query, so coming
 * back shows the loaded page without a refetch.
 */
interface UseModulesOptions {
  enabled?: boolean;
  /** MAS filter expression, e.g. contains(name,'credit'); '' for none. */
  filter?: string;
  /** e.g. name:ascending; '' for the server default. */
  sortBy?: string;
  typeFilter?: ModuleType | 'All';
  /** 0-based page. */
  page?: number;
  limit?: number;
}

export const useModules = (options: UseModulesOptions = {}): UseModulesReturn => {
  const {
    enabled = true,
    filter = '',
    sortBy = '',
    typeFilter = 'All',
    page = 0,
    limit: pageSize = 20,
  } = options;

  const [state, setState] = useState<UseModulesState>({
    modules: [],
    loading: enabled,
    error: null,
    totalCount: 0,
  });

  const isTypeFiltered = typeFilter !== 'All';

  // The server query is either one page, or — with a type filter, which the
  // MAS filter grammar cannot express — the whole collection filtered
  // client-side. Depending on these two derived values rather than on the raw
  // page means client-side paging does not refetch the collection.
  const serverStart = isTypeFiltered ? 0 : page * pageSize;
  const serverLimit = isTypeFiltered ? null : pageSize;

  // Bumped on every fetch; a response for an older request is dropped so a
  // slow page 1 cannot overwrite page 2 (the same idiom as useJobMonitoring).
  const requestIdRef = useRef(0);

  const fetchModules = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (!enabled) {
      setState((prev) => ({ ...prev, loading: false, modules: [], error: null }));
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const query = { filter: filter || undefined, sortBy: sortBy || undefined };
      const result =
        serverLimit === null
          ? await getAllModules(query).then((items) => ({ items, count: items.length }))
          : await getModules({ ...query, start: serverStart, limit: serverLimit });

      if (requestId !== requestIdRef.current) return;
      setState((prev) => ({
        ...prev,
        modules: result.items,
        totalCount: result.count,
        loading: false,
        error: null,
      }));
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to fetch modules',
        loading: false,
      }));
    }
  }, [serverStart, serverLimit, filter, sortBy, enabled]);

  useEffect(() => {
    fetchModules();
  }, [fetchModules]);

  // Client-side type filtering and pagination
  const typeFilteredModules = useMemo(() => {
    if (!isTypeFiltered) return state.modules;
    return state.modules.filter((m) => getModuleType(m) === typeFilter);
  }, [state.modules, typeFilter, isTypeFiltered]);

  const filteredCount = typeFilteredModules.length;

  // When type filter is active, paginate the filtered results client-side
  const displayModules = useMemo(() => {
    if (!isTypeFiltered) return state.modules;
    const start = page * pageSize;
    return typeFilteredModules.slice(start, start + pageSize);
  }, [typeFilteredModules, page, pageSize, isTypeFiltered, state.modules]);

  return {
    ...state,
    refresh: fetchModules,
    currentPage: page,
    pageSize,
    filter,
    sortBy,
    typeFilter,
    filteredCount,
    displayModules,
  };
};

interface UseModuleReturn {
  module: Module | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useModule = (moduleId: string | null): UseModuleReturn => {
  const [module, setModule] = useState<Module | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchModule = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (!moduleId) {
      setModule(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getModule(moduleId);
      if (requestId !== requestIdRef.current) return;
      setModule(result);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch module');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    fetchModule();
  }, [fetchModule]);

  return { module, loading, error, refresh: fetchModule };
};

interface UseSubmodulesReturn {
  submodules: Submodule[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useSubmodules = (moduleId: string | null): UseSubmodulesReturn => {
  const [submodules, setSubmodules] = useState<Submodule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchSubmodules = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (!moduleId) {
      setSubmodules([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getAllSubmodules(moduleId);
      if (requestId !== requestIdRef.current) return;
      setSubmodules(result);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch submodules');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    fetchSubmodules();
  }, [fetchSubmodules]);

  return { submodules, loading, error, refresh: fetchSubmodules };
};
