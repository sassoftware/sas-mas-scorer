// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Module, Step } from './types';
import { Layout, ViewType } from './components/layout';
import { ModuleList } from './components/modules/ModuleList';
import { ModuleDetails } from './components/modules/ModuleDetails';
import { ScorePanel } from './components/scoring/ScorePanel';
import { Loading } from './components/common/Loading';
import { useModules, useSteps, useSubmodules } from './hooks';
import { useSasAuth } from './auth';
import { deleteModule, getModule } from './api/modules';
import './styles/index.css';

function App() {
  const { isAuthenticated } = useSasAuth();
  const prevAuthRef = useRef(isAuthenticated);
  const navigate = useNavigate();
  const location = useLocation();

  // Selected module/step state (kept in sync with URL)
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [selectedStep, setSelectedStep] = useState<Step | null>(null);
  const [recentModules, setRecentModules] = useState<Module[]>([]);
  const [moduleLoading, setModuleLoading] = useState(false);
  const [moduleError, setModuleError] = useState<string | null>(null);

  // Parse route params from location
  const getRouteParams = () => {
    const hash = location.pathname; // In HashRouter, pathname contains the hash path
    const moduleMatch = hash.match(/^\/modules\/([^/]+)/);
    const stepMatch = hash.match(/^\/modules\/[^/]+\/steps\/([^/]+)/);
    return {
      moduleId: moduleMatch ? moduleMatch[1] : null,
      stepId: stepMatch ? stepMatch[1] : null,
    };
  };

  const { moduleId, stepId } = getRouteParams();

  // Data hooks - only fetch when authenticated
  const {
    modules,
    loading: loadingModules,
    error: modulesError,
    refresh: refreshModules,
    totalCount,
    currentPage,
    pageSize,
    setPage,
    setFilter,
    setSortBy,
    reset: resetModules,
    sortBy,
  } = useModules({ enabled: isAuthenticated });

  const { steps, loading: loadingSteps } = useSteps(selectedModule?.id ?? null);
  const { submodules, loading: loadingSubmodules } = useSubmodules(
    selectedModule?.id ?? null
  );

  // Auto-refresh modules when user logs in
  useEffect(() => {
    if (isAuthenticated && !prevAuthRef.current) {
      refreshModules();
    }
    prevAuthRef.current = isAuthenticated;
  }, [isAuthenticated, refreshModules]);

  // Load module from URL when needed
  useEffect(() => {
    if (moduleId && isAuthenticated) {
      // If we don't have the module or it's a different one, fetch it
      if (!selectedModule || selectedModule.id !== moduleId) {
        setModuleLoading(true);
        setModuleError(null);
        getModule(moduleId)
          .then((module) => {
            setSelectedModule(module);
            // Add to recent modules
            setRecentModules((prev) => {
              const filtered = prev.filter((m) => m.id !== module.id);
              return [module, ...filtered].slice(0, 5);
            });
          })
          .catch((err) => {
            setModuleError(err instanceof Error ? err.message : 'Failed to load module');
          })
          .finally(() => {
            setModuleLoading(false);
          });
      }
    } else if (!moduleId) {
      // Clear selection when navigating to modules list
      setSelectedModule(null);
      setSelectedStep(null);
    }
  }, [moduleId, isAuthenticated, selectedModule]);

  // Set selected step from URL when steps are loaded
  useEffect(() => {
    if (stepId && steps.length > 0) {
      const step = steps.find((s) => s.id === stepId);
      if (step && (!selectedStep || selectedStep.id !== stepId)) {
        setSelectedStep(step);
      }
    } else if (!stepId) {
      setSelectedStep(null);
    }
  }, [stepId, steps, selectedStep]);

  // Determine active view from current route
  const getActiveView = (): ViewType => {
    if (stepId) return 'score';
    if (moduleId) return 'module-details';
    return 'modules';
  };

  // Navigation handlers
  const handleNavigate = useCallback((view: ViewType) => {
    if (view === 'modules') {
      setSelectedModule(null);
      setSelectedStep(null);
      resetModules();
      navigate('/');
    }
  }, [resetModules, navigate]);

  const handleSelectModule = useCallback((module: Module) => {
    setSelectedModule(module);
    setSelectedStep(null);

    // Add to recent modules
    setRecentModules((prev) => {
      const filtered = prev.filter((m) => m.id !== module.id);
      return [module, ...filtered].slice(0, 5);
    });

    navigate(`/modules/${module.id}`);
  }, [navigate]);

  const handleSelectStep = useCallback((step: Step) => {
    setSelectedStep(step);
    if (selectedModule) {
      navigate(`/modules/${selectedModule.id}/steps/${step.id}`);
    }
  }, [selectedModule, navigate]);

  const handleBackToModules = useCallback(() => {
    setSelectedModule(null);
    setSelectedStep(null);
    resetModules();
    navigate('/');
  }, [resetModules, navigate]);

  const handleBackToModuleDetails = useCallback(() => {
    setSelectedStep(null);
    if (selectedModule) {
      navigate(`/modules/${selectedModule.id}`);
    }
  }, [selectedModule, navigate]);

  const handleDeleteModule = useCallback(async (moduleIdToDelete: string) => {
    await deleteModule(moduleIdToDelete);
    // Clear selection and navigate back to modules list
    setSelectedModule(null);
    setSelectedStep(null);
    // Remove from recent modules
    setRecentModules((prev) => prev.filter((m) => m.id !== moduleIdToDelete));
    // Refresh the modules list
    refreshModules();
    navigate('/');
  }, [refreshModules, navigate]);

  const handleSearch = useCallback((searchTerm: string) => {
    // Reset to first page when searching
    setPage(0);
    // Build SAS API filter string
    if (searchTerm.trim()) {
      setFilter(`contains(name,'${searchTerm.trim()}')`);
    } else {
      setFilter('');
    }
  }, [setFilter, setPage]);

  const handleSort = useCallback((field: string, direction: 'asc' | 'desc') => {
    // Reset to first page when sorting
    setPage(0);
    // Build SAS API sortBy string (field:ascending or field:descending)
    setSortBy(`${field}:${direction === 'asc' ? 'ascending' : 'descending'}`);
  }, [setSortBy, setPage]);

  // Render content based on current view
  const renderContent = () => {
    const activeView = getActiveView();

    // Module List View
    if (activeView === 'modules') {
      return (
        <ModuleList
          modules={modules}
          loading={loadingModules}
          error={modulesError}
          onSelectModule={handleSelectModule}
          onRefresh={refreshModules}
          totalCount={totalCount}
          currentPage={currentPage}
          pageSize={pageSize}
          onPageChange={setPage}
          onSearch={handleSearch}
          onSort={handleSort}
          sortBy={sortBy}
        />
      );
    }

    // Loading state for module
    if (moduleLoading) {
      return <Loading message="Loading module..." />;
    }

    // Error state for module
    if (moduleError) {
      return (
        <div className="error-message">
          <p>Error: {moduleError}</p>
          <button onClick={handleBackToModules}>Back to Modules</button>
        </div>
      );
    }

    // Module Details View
    if (activeView === 'module-details') {
      if (!selectedModule) {
        return <Loading message="Loading module..." />;
      }
      return (
        <ModuleDetails
          module={selectedModule}
          steps={steps}
          submodules={submodules}
          loadingSteps={loadingSteps}
          loadingSubmodules={loadingSubmodules}
          onSelectStep={handleSelectStep}
          onBack={handleBackToModules}
          onDelete={handleDeleteModule}
        />
      );
    }

    // Score Panel View
    if (activeView === 'score') {
      if (!selectedModule) {
        return <Loading message="Loading module..." />;
      }
      if (loadingSteps) {
        return <Loading message="Loading steps..." />;
      }
      if (!selectedStep) {
        // Try to find the step
        const step = steps.find((s) => s.id === stepId);
        if (step) {
          // Will be set by useEffect
          return <Loading message="Loading step..." />;
        }
        // Step not found, go back to module details
        navigate(`/modules/${moduleId}`);
        return null;
      }
      return (
        <ScorePanel
          module={selectedModule}
          step={selectedStep}
          onBack={handleBackToModules}
          onSelectAnotherStep={handleBackToModuleDetails}
        />
      );
    }

    return null;
  };

  return (
    <Layout
      activeView={getActiveView()}
      onNavigate={handleNavigate}
      selectedModule={selectedModule}
      recentModules={recentModules}
      onSelectModule={handleSelectModule}
    >
      {renderContent()}
    </Layout>
  );
}

export default App;
