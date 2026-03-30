// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Module, ModuleType, ModuleCollection, Submodule, SubmoduleCollection, getModuleType } from '../types';
import { getModules, getModule, getSubmodules, GetModulesParams } from '../api';

interface UseModulesState {
  modules: Module[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  currentPage: number;
  pageSize: number;
}

interface UseModulesReturn extends UseModulesState {
  refresh: () => Promise<void>;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setFilter: (filter: string) => void;
  setSortBy: (sortBy: string) => void;
  setTypeFilter: (type: ModuleType | 'All') => void;
  reset: () => void;
  filter: string;
  sortBy: string;
  typeFilter: ModuleType | 'All';
  filteredCount: number;
  displayModules: Module[];
}

interface UseModulesOptions extends GetModulesParams {
  enabled?: boolean;
}

export const useModules = (options: UseModulesOptions = {}): UseModulesReturn => {
  const { enabled = true, ...initialParams } = options;

  const [state, setState] = useState<UseModulesState>({
    modules: [],
    loading: enabled,
    error: null,
    totalCount: 0,
    currentPage: 0,
    pageSize: initialParams.limit ?? 20,
  });

  const [filter, setFilter] = useState(initialParams.filter ?? '');
  const [sortBy, setSortBy] = useState(initialParams.sortBy ?? '');
  const [typeFilter, setTypeFilter] = useState<ModuleType | 'All'>('All');

  const isTypeFiltered = typeFilter !== 'All';

  const fetchModules = useCallback(async () => {
    if (!enabled) {
      setState((prev) => ({ ...prev, loading: false, modules: [], error: null }));
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      // When type filter is active, fetch all modules so we can filter client-side
      const limit = isTypeFiltered ? 10000 : state.pageSize;
      const start = isTypeFiltered ? 0 : state.currentPage * state.pageSize;

      const result: ModuleCollection = await getModules({
        start,
        limit,
        filter: filter || undefined,
        sortBy: sortBy || undefined,
      });

      setState((prev) => ({
        ...prev,
        modules: result.items,
        totalCount: result.count,
        loading: false,
        error: null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to fetch modules',
        loading: false,
      }));
    }
  }, [state.currentPage, state.pageSize, filter, sortBy, enabled, isTypeFiltered]);

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
    const start = state.currentPage * state.pageSize;
    return typeFilteredModules.slice(start, start + state.pageSize);
  }, [typeFilteredModules, state.currentPage, state.pageSize, isTypeFiltered, state.modules]);

  const setPage = useCallback((page: number) => {
    setState((prev) => ({ ...prev, currentPage: page }));
  }, []);

  const setPageSize = useCallback((size: number) => {
    setState((prev) => ({ ...prev, pageSize: size, currentPage: 0 }));
  }, []);

  const handleSetTypeFilter = useCallback((type: ModuleType | 'All') => {
    setTypeFilter(type);
    setState((prev) => ({ ...prev, currentPage: 0 }));
  }, []);

  const reset = useCallback(() => {
    setState((prev) => ({ ...prev, currentPage: 0 }));
    setFilter('');
    setSortBy('');
    setTypeFilter('All');
  }, []);

  return {
    ...state,
    refresh: fetchModules,
    setPage,
    setPageSize,
    setFilter,
    setSortBy,
    setTypeFilter: handleSetTypeFilter,
    reset,
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

  const fetchModule = useCallback(async () => {
    if (!moduleId) {
      setModule(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getModule(moduleId);
      setModule(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch module');
    } finally {
      setLoading(false);
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

  const fetchSubmodules = useCallback(async () => {
    if (!moduleId) {
      setSubmodules([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result: SubmoduleCollection = await getSubmodules(moduleId);
      setSubmodules(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch submodules');
    } finally {
      setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    fetchSubmodules();
  }, [fetchSubmodules]);

  return { submodules, loading, error, refresh: fetchSubmodules };
};
