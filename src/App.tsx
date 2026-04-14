// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Module, Step } from './types';
import { UIDefinition, UIDefinitionSummary } from './types/uiBuilder';
import { Layout, ViewType } from './components/layout';
import { ModuleList } from './components/modules/ModuleList';
import { ModuleDetails } from './components/modules/ModuleDetails';
import { ScorePanel } from './components/scoring/ScorePanel';
import { UIAppsList } from './components/uiApps/UIAppsList';
import { UIBuilder } from './components/uiBuilder/UIBuilder';
import { UIRunner } from './components/uiRunner/UIRunner';
import { CoverageAnalysis } from './components/coverage/CoverageAnalysis';
import FlowListPage from './components/flows/FlowListPage';
import FlowDetailPage from './components/flows/FlowDetailPage';
import { Loading } from './components/common/Loading';
import { useModules, useSteps, useSubmodules } from './hooks';
import { useSasAuth } from './auth';
import { deleteModule, getModule } from './api/modules';
import { getUIDefinition, listUIDefinitions } from './storage/uiStorage';
import { initViyaUrl } from './config';
import { ConnectionSettings } from './components/settings/ConnectionSettings';
import './styles/index.css';

const isElectron = !!window.electronAPI;

function App() {
  const { isAuthenticated, checkAuth } = useSasAuth();
  const prevAuthRef = useRef(isAuthenticated);

  // Electron: track whether an active connection is configured
  const [hasActiveConnection, setHasActiveConnection] = useState<boolean | null>(isElectron ? null : true);
  const [activeConnectionName, setActiveConnectionName] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const loadActiveConnection = useCallback(async () => {
    if (!isElectron || !window.electronAPI) return;
    const conn = await window.electronAPI.getActiveConnection();
    setHasActiveConnection(conn !== null && conn.viyaUrl !== '');
    setActiveConnectionName(conn?.name ?? null);
  }, []);

  useEffect(() => {
    loadActiveConnection();
  }, [loadActiveConnection]);

  const navigate = useNavigate();
  const location = useLocation();

  // Selected module/step state (kept in sync with URL)
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [selectedStep, setSelectedStep] = useState<Step | null>(null);
  const [recentModules, setRecentModules] = useState<Module[]>([]);
  const [moduleLoading, setModuleLoading] = useState(false);
  const [moduleError, setModuleError] = useState<string | null>(null);

  // UI Apps state
  const [recentUIApps, setRecentUIApps] = useState<UIDefinitionSummary[]>([]);
  const [activeUIDefinition, setActiveUIDefinition] = useState<UIDefinition | null>(null);
  const [uiLoading, setUILoading] = useState(false);

  // Parse route params from location
  const getRouteParams = () => {
    const hash = location.pathname; // In HashRouter, pathname contains the hash path
    const searchParams = new URLSearchParams(location.search);
    const moduleMatch = hash.match(/^\/modules\/([^/]+)/);
    const stepMatch = hash.match(/^\/modules\/[^/]+\/steps\/([^/]+)/);
    const uiAppRunMatch = hash.match(/^\/ui-apps\/([^/]+)$/);
    const uiAppEditMatch = hash.match(/^\/ui-apps\/([^/]+)\/edit$/);
    const uiAppNewMatch = hash.match(/^\/ui-apps\/new\/([^/]+)$/);
    const flowDetailMatch = hash.match(/^\/flows\/([^/]+)$/);
    return {
      moduleId: moduleMatch ? decodeURIComponent(moduleMatch[1]) : null,
      stepId: stepMatch ? decodeURIComponent(stepMatch[1]) : null,
      uiAppId: uiAppRunMatch ? decodeURIComponent(uiAppRunMatch[1]) : null,
      uiAppEditId: uiAppEditMatch ? decodeURIComponent(uiAppEditMatch[1]) : null,
      uiAppNewModuleId: uiAppNewMatch ? decodeURIComponent(uiAppNewMatch[1]) : null,
      isUIAppsListView: hash === '/ui-apps' || hash === '/ui-apps/',
      isCoverageView: hash === '/coverage' || hash === '/coverage/',
      isFlowsListView: hash === '/flows' || hash === '/flows/',
      flowDetailId: flowDetailMatch ? decodeURIComponent(flowDetailMatch[1]) : null,
      isStandalone: searchParams.get('standalone') === 'true',
    };
  };

  const { moduleId, stepId, uiAppId, uiAppEditId, uiAppNewModuleId, isUIAppsListView, isCoverageView, isFlowsListView, flowDetailId, isStandalone } = getRouteParams();

  // Data hooks - only fetch when authenticated
  const {
    loading: loadingModules,
    error: modulesError,
    refresh: refreshModules,
    totalCount,
    currentPage,
    pageSize,
    setPage,
    setFilter,
    setSortBy,
    setTypeFilter,
    reset: resetModules,
    sortBy,
    typeFilter,
    filteredCount,
    displayModules,
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

  // Load recent UI apps
  const loadRecentUIApps = useCallback(async () => {
    try {
      const list = await listUIDefinitions();
      setRecentUIApps(list.slice(0, 5));
    } catch {
      // Silent — not critical
    }
  }, []);

  useEffect(() => {
    loadRecentUIApps();
  }, [loadRecentUIApps]);

  // Use a ref to check selectedModule inside the effect without it being a dependency.
  const selectedModuleRef = useRef<Module | null>(null);
  selectedModuleRef.current = selectedModule;

  // Load module from URL when needed
  useEffect(() => {
    if (moduleId && isAuthenticated) {
      if (!selectedModuleRef.current || selectedModuleRef.current.id !== moduleId) {
        setModuleLoading(true);
        setModuleError(null);
        getModule(moduleId)
          .then((module) => {
            setSelectedModule(module);
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
    } else if (!moduleId && !uiAppId && !uiAppEditId && !uiAppNewModuleId && !isUIAppsListView && !isCoverageView && !isFlowsListView && !flowDetailId) {
      setSelectedModule(null);
      setSelectedStep(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId, isAuthenticated]);

  // Load UI definition from URL when needed
  useEffect(() => {
    const targetId = uiAppId || uiAppEditId;
    if (targetId) {
      setUILoading(true);
      getUIDefinition(targetId)
        .then(def => setActiveUIDefinition(def))
        .catch(() => setActiveUIDefinition(null))
        .finally(() => setUILoading(false));
    } else {
      setActiveUIDefinition(null);
    }
  }, [uiAppId, uiAppEditId]);

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
    if (flowDetailId) return 'flow-detail';
    if (isFlowsListView) return 'flows';
    if (isCoverageView) return 'coverage';
    if (isUIAppsListView) return 'ui-apps';
    if (uiAppNewModuleId) return 'ui-app-new';
    if (uiAppEditId) return 'ui-app-edit';
    if (uiAppId) return 'ui-app-run';
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
    } else if (view === 'ui-apps') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/ui-apps');
    } else if (view === 'flows') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/flows');
    } else if (view === 'coverage') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/coverage');
    }
  }, [resetModules, navigate]);

  const handleSelectModule = useCallback((module: Module) => {
    setSelectedModule(module);
    setSelectedStep(null);
    setRecentModules((prev) => {
      const filtered = prev.filter((m) => m.id !== module.id);
      return [module, ...filtered].slice(0, 5);
    });
    navigate(`/modules/${encodeURIComponent(module.id)}`);
  }, [navigate]);

  const handleSelectStep = useCallback((step: Step) => {
    setSelectedStep(step);
    if (selectedModule) {
      navigate(`/modules/${encodeURIComponent(selectedModule.id)}/steps/${encodeURIComponent(step.id)}`);
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
      navigate(`/modules/${encodeURIComponent(selectedModule.id)}`);
    }
  }, [selectedModule, navigate]);

  const handleDeleteModule = useCallback(async (moduleIdToDelete: string) => {
    await deleteModule(moduleIdToDelete);
    setSelectedModule(null);
    setSelectedStep(null);
    setRecentModules((prev) => prev.filter((m) => m.id !== moduleIdToDelete));
    refreshModules();
    navigate('/');
  }, [refreshModules, navigate]);

  const handleSearch = useCallback((searchTerm: string) => {
    setPage(0);
    if (searchTerm.trim()) {
      const escaped = searchTerm.trim().replace(/'/g, "''");
      setFilter(`contains(name,'${escaped}')`);
    } else {
      setFilter('');
    }
  }, [setFilter, setPage]);

  const handleSort = useCallback((field: string, direction: 'asc' | 'desc') => {
    setPage(0);
    setSortBy(`${field}:${direction === 'asc' ? 'ascending' : 'descending'}`);
  }, [setSortBy, setPage]);

  // UI App navigation handlers
  const handleRunUIApp = useCallback((id: string) => {
    navigate(`/ui-apps/${encodeURIComponent(id)}`);
  }, [navigate]);

  const handleEditUIApp = useCallback((id: string) => {
    navigate(`/ui-apps/${encodeURIComponent(id)}/edit`);
  }, [navigate]);

  const handleBackToUIApps = useCallback(() => {
    loadRecentUIApps();
    navigate('/ui-apps');
  }, [navigate, loadRecentUIApps]);

  const handleBuildUI = useCallback((modId: string) => {
    navigate(`/ui-apps/new/${encodeURIComponent(modId)}`);
  }, [navigate]);

  const handleViewFlow = useCallback((flowId: string) => {
    navigate(`/flows/${encodeURIComponent(flowId)}`);
  }, [navigate]);

  const handleUIAppSaved = useCallback((id: string) => {
    loadRecentUIApps();
    navigate(`/ui-apps/${encodeURIComponent(id)}`);
  }, [navigate, loadRecentUIApps]);

  const handleCreateNewUIApp = useCallback(() => {
    // Navigate to modules list so user can pick a module
    // For now, go to modules list with a note
    navigate('/');
  }, [navigate]);

  // Called when a connection is switched or deleted in settings
  const handleConnectionSwitch = useCallback(async () => {
    setSelectedModule(null);
    setSelectedStep(null);
    setRecentModules([]);
    navigate('/');
    await loadActiveConnection();
    await initViyaUrl();
    await checkAuth();
  }, [loadActiveConnection, checkAuth, navigate]);

  // Render content based on current view
  const renderContent = () => {
    const activeView = getActiveView();

    // Flow Views
    if (activeView === 'flows') {
      return <FlowListPage />;
    }
    if (activeView === 'flow-detail' && flowDetailId) {
      return <FlowDetailPage flowId={flowDetailId} />;
    }

    // Coverage Analysis View
    if (activeView === 'coverage') {
      return <CoverageAnalysis />;
    }

    // UI Apps List View
    if (activeView === 'ui-apps') {
      return (
        <UIAppsList
          onRun={handleRunUIApp}
          onEdit={handleEditUIApp}
          onCreateNew={handleCreateNewUIApp}
        />
      );
    }

    // UI App Runner View
    if (activeView === 'ui-app-run') {
      if (uiLoading) return <Loading message="Loading UI App..." />;
      if (!activeUIDefinition) {
        return (
          <div className="error-message">
            <p>UI App not found.</p>
            <button onClick={handleBackToUIApps}>Back to UI Apps</button>
          </div>
        );
      }
      return (
        <UIRunner
          definition={activeUIDefinition}
          onBack={handleBackToUIApps}
          onEdit={() => handleEditUIApp(activeUIDefinition.id)}
          standalone={isStandalone}
        />
      );
    }

    // UI App Edit View
    if (activeView === 'ui-app-edit') {
      if (uiLoading) return <Loading message="Loading UI App..." />;
      return (
        <UIBuilder
          definition={activeUIDefinition}
          onBack={handleBackToUIApps}
          onSaved={handleUIAppSaved}
        />
      );
    }

    // UI App New View
    if (activeView === 'ui-app-new' && uiAppNewModuleId) {
      return (
        <UIBuilder
          definition={null}
          moduleId={uiAppNewModuleId}
          onBack={handleBackToUIApps}
          onSaved={handleUIAppSaved}
        />
      );
    }

    // Module List View
    if (activeView === 'modules') {
      return (
        <ModuleList
          modules={displayModules}
          loading={loadingModules}
          error={modulesError}
          onSelectModule={handleSelectModule}
          onRefresh={refreshModules}
          totalCount={totalCount}
          filteredCount={filteredCount}
          currentPage={currentPage}
          pageSize={pageSize}
          onPageChange={setPage}
          onSearch={handleSearch}
          onSort={handleSort}
          onTypeFilter={setTypeFilter}
          sortBy={sortBy}
          typeFilter={typeFilter}
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
          onBuildUI={handleBuildUI}
          onViewFlow={handleViewFlow}
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
        const step = steps.find((s) => s.id === stepId);
        if (step) {
          return <Loading message="Loading step..." />;
        }
        navigate(`/modules/${encodeURIComponent(moduleId!)}`);
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

  // Electron: show loading while checking active connection
  if (isElectron && hasActiveConnection === null) {
    return <Loading message="Loading..." />;
  }

  // Electron: show connection settings if no active connection
  if (isElectron && hasActiveConnection === false) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px', background: 'var(--sas-gray-50)' }}>
        <div style={{ maxWidth: '560px', width: '100%' }}>
          <ConnectionSettings
            onSave={() => loadActiveConnection()}
            onConnectionSwitch={handleConnectionSwitch}
          />
        </div>
      </div>
    );
  }

  // Electron: settings modal overlay
  if (showSettings) {
    return (
      <>
        <Layout
          activeView={getActiveView()}
          onNavigate={handleNavigate}
          selectedModule={selectedModule}
          recentModules={recentModules}
          onSelectModule={handleSelectModule}
          onOpenSettings={() => setShowSettings(true)}
          activeConnectionName={activeConnectionName}
          recentUIApps={recentUIApps}
          onSelectUIApp={handleRunUIApp}
        >
          {renderContent()}
        </Layout>
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}
        >
          <div style={{ maxWidth: '600px', width: '100%', margin: '24px' }}>
            <ConnectionSettings
              onSave={() => { setShowSettings(false); loadActiveConnection(); }}
              onCancel={() => setShowSettings(false)}
              onConnectionSwitch={handleConnectionSwitch}
            />
          </div>
        </div>
      </>
    );
  }

  // Standalone mode: render content without Layout chrome
  if (isStandalone && uiAppId) {
    return (
      <div className="sas-standalone">
        {renderContent()}
      </div>
    );
  }

  return (
    <Layout
      activeView={getActiveView()}
      onNavigate={handleNavigate}
      selectedModule={selectedModule}
      recentModules={recentModules}
      onSelectModule={handleSelectModule}
      onOpenSettings={isElectron ? () => setShowSettings(true) : undefined}
      activeConnectionName={activeConnectionName}
      recentUIApps={recentUIApps}
      onSelectUIApp={handleRunUIApp}
    >
      {renderContent()}
    </Layout>
  );
}

export default App;
