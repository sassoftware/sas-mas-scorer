// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback } from 'react';
import { Module, ModuleCollection, Submodule, SubmoduleCollection } from '../types';
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
  reset: () => void;
  filter: string;
  sortBy: string;
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

  const fetchModules = useCallback(async () => {
    if (!enabled) {
      setState((prev) => ({ ...prev, loading: false, modules: [], error: null }));
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result: ModuleCollection = await getModules({
        start: state.currentPage * state.pageSize,
        limit: state.pageSize,
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
  }, [state.currentPage, state.pageSize, filter, sortBy, enabled]);

  useEffect(() => {
    fetchModules();
  }, [fetchModules]);

  const setPage = useCallback((page: number) => {
    setState((prev) => ({ ...prev, currentPage: page }));
  }, []);

  const setPageSize = useCallback((size: number) => {
    setState((prev) => ({ ...prev, pageSize: size, currentPage: 0 }));
  }, []);

  const reset = useCallback(() => {
    setState((prev) => ({ ...prev, currentPage: 0 }));
    setFilter('');
    setSortBy('');
  }, []);

  return {
    ...state,
    refresh: fetchModules,
    setPage,
    setPageSize,
    setFilter,
    setSortBy,
    reset,
    filter,
    sortBy,
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
