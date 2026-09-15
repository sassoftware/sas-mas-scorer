// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
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
import { PublishingOverview } from './components/publishing';
import { RulesImportPage } from './components/rulesImport/RulesImportPage';
import { Loading } from './components/common/Loading';
import { Modal } from './components/common/Modal';
import { useModules, useSteps, useSubmodules } from './hooks';
import { useSasAuth } from './auth';
import { deleteModule, getModule } from './api/modules';
import { getUIDefinition, listUIDefinitions, importUIDefinition } from './storage/uiStorage';
import { decodeUIDefinition } from './utils/shareLink';
import { initViyaUrl } from './config';
import { ConnectionSettings } from './components/settings/ConnectionSettings';
import { applyEnvironmentColor } from './utils/envColor';
import { OPEN_SETTINGS_EVENT } from './components/common/AuthErrorModal';
import './styles/index.css';

// The views that carry the heavy vendor code (@xyflow/react + dagre for the
// flow diagram, prismjs for the code panels) load on first visit instead of
// riding in the entry chunk. The jobdef build inlines these chunks back into
// its single HTML file (inlineDynamicImports in vite.config.ts).
const FlowListPage = lazy(() => import('./components/flows/FlowListPage'));
const FlowDetailPage = lazy(() => import('./components/flows/FlowDetailPage'));
const JobMonitoringPage = lazy(() =>
  import('./components/jobMonitoring').then((m) => ({ default: m.JobMonitoringPage }))
);
const JobDetailPage = lazy(() =>
  import('./components/jobMonitoring').then((m) => ({ default: m.JobDetailPage }))
);
const SchemaBuilder = lazy(() =>
  import('./components/schemaBuilder/SchemaBuilder').then((m) => ({ default: m.SchemaBuilder }))
);

const isElectron = !!window.electronAPI;

function App() {
  const { isAuthenticated, checkAuth } = useSasAuth();

  // Electron: track whether an active connection is configured
  const [hasActiveConnection, setHasActiveConnection] = useState<boolean | null>(isElectron ? null : true);
  const [activeConnectionName, setActiveConnectionName] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const loadActiveConnection = useCallback(async () => {
    if (!isElectron || !window.electronAPI) return;
    const conn = await window.electronAPI.getActiveConnection();
    setHasActiveConnection(conn !== null && conn.viyaUrl !== '');
    setActiveConnectionName(conn?.name ?? null);
    applyEnvironmentColor(conn?.color ?? null);
  }, []);

  useEffect(() => {
    loadActiveConnection();
  }, [loadActiveConnection]);

  // The auth-error modal's "Open Connection Settings" button (Electron)
  useEffect(() => {
    if (!isElectron) return;
    const openSettings = () => setShowSettings(true);
    window.addEventListener(OPEN_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, openSettings);
  }, []);

  // Closing the settings dialog (Escape, X, scrim, Save, Close) re-reads the
  // active connection so a renamed/recoloured connection shows immediately.
  const closeSettings = useCallback(() => {
    setShowSettings(false);
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
    const jobDetailMatch = hash.match(/^\/jobs\/([^/]+)$/);
    return {
      moduleId: moduleMatch ? decodeURIComponent(moduleMatch[1]) : null,
      stepId: stepMatch ? decodeURIComponent(stepMatch[1]) : null,
      uiAppId: uiAppRunMatch ? decodeURIComponent(uiAppRunMatch[1]) : null,
      uiAppEditId: uiAppEditMatch ? decodeURIComponent(uiAppEditMatch[1]) : null,
      uiAppNewModuleId: uiAppNewMatch ? decodeURIComponent(uiAppNewMatch[1]) : null,
      isUIAppsListView: hash === '/ui-apps' || hash === '/ui-apps/',
      isCoverageView: hash === '/coverage' || hash === '/coverage/',
      isFlowsListView: hash === '/flows' || hash === '/flows/',
      isPublishingView: hash === '/publishing' || hash === '/publishing/',
      isJobMonitoringView: hash === '/jobs' || hash === '/jobs/',
      isSchemaBuilderView: hash === '/schema-builder' || hash === '/schema-builder/',
      isRulesImportView: hash === '/rules-import' || hash === '/rules-import/',
      flowDetailId: flowDetailMatch ? decodeURIComponent(flowDetailMatch[1]) : null,
      jobDetailId: jobDetailMatch ? decodeURIComponent(jobDetailMatch[1]) : null,
      isStandalone: searchParams.get('standalone') === 'true',
      // Self-contained share token: the full UI definition encoded into the URL
      // so a shared link works without the definition existing in localStorage.
      uiAppDef: searchParams.get('def'),
    };
  };

  const { moduleId, stepId, uiAppId, uiAppEditId, uiAppNewModuleId, isUIAppsListView, isCoverageView, isFlowsListView, isPublishingView, isJobMonitoringView, isSchemaBuilderView, isRulesImportView, flowDetailId, jobDetailId, isStandalone, uiAppDef } = getRouteParams();

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

  // Keyed on the URL, not the fetched module, so a deep link or refresh starts
  // the steps/submodules requests alongside getModule instead of after it.
  const routedModuleId = isAuthenticated ? moduleId : null;
  const { steps, loading: loadingSteps } = useSteps(routedModuleId);
  const { submodules, loading: loadingSubmodules } = useSubmodules(routedModuleId);

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
    } else if (!moduleId && !uiAppId && !uiAppEditId && !uiAppNewModuleId && !isUIAppsListView && !isCoverageView && !isFlowsListView && !isPublishingView && !isJobMonitoringView && !isSchemaBuilderView && !isRulesImportView && !flowDetailId && !jobDetailId) {
      setSelectedModule(null);
      setSelectedStep(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId, isAuthenticated]);

  // Load UI definition from URL when needed.
  // A `def` token in the URL carries the full definition, so it takes priority
  // over localStorage — this is what makes shared links work for any recipient.
  useEffect(() => {
    if (uiAppDef) {
      setActiveUIDefinition(decodeUIDefinition(uiAppDef));
      setUILoading(false);
      return;
    }
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
  }, [uiAppId, uiAppEditId, uiAppDef]);

  // Set selected step from URL when steps are loaded
  useEffect(() => {
    if (stepId && steps.length > 0) {
      const step = steps.find((s) => s.id === stepId);
      // Compare by identity, not id: two modules can share a step id, and the
      // steps array is replaced whenever the module changes.
      if (step && selectedStep !== step) {
        setSelectedStep(step);
      }
    } else if (!stepId) {
      setSelectedStep(null);
    }
  }, [stepId, steps, selectedStep]);

  // Determine active view from current route
  const getActiveView = (): ViewType => {
    if (jobDetailId) return 'job-detail';
    if (isJobMonitoringView) return 'job-monitoring';
    if (isSchemaBuilderView) return 'schema-builder';
    if (isRulesImportView) return 'rules-import';
    if (flowDetailId) return 'flow-detail';
    if (isFlowsListView) return 'flows';
    if (isCoverageView) return 'coverage';
    if (isPublishingView) return 'publishing-overview';
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
    } else if (view === 'publishing-overview') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/publishing');
    } else if (view === 'job-monitoring') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/jobs');
    } else if (view === 'schema-builder') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/schema-builder');
    } else if (view === 'rules-import') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/rules-import');
    }
  }, [resetModules, navigate]);

  const handleOpenJob = useCallback((id: string) => {
    navigate(`/jobs/${encodeURIComponent(id)}`);
  }, [navigate]);

  const handleBackToJobMonitoring = useCallback(() => {
    navigate('/jobs');
  }, [navigate]);

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

  // Save a shared (URL-embedded) UI App into the local library so the recipient
  // can keep and edit it. importUIDefinition assigns a fresh id and timestamps.
  const handleSaveSharedUIApp = useCallback(async (def: UIDefinition) => {
    const saved = await importUIDefinition(JSON.stringify(def));
    loadRecentUIApps();
    navigate(`/ui-apps/${encodeURIComponent(saved.id)}`);
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
  const renderView = () => {
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

    // Schema → Code View
    if (activeView === 'schema-builder') {
      return <SchemaBuilder onBack={handleBackToModules} />;
    }

    // Business Rules Import View
    if (activeView === 'rules-import') {
      return <RulesImportPage />;
    }

    // Job Monitoring views
    if (activeView === 'job-monitoring') {
      return <JobMonitoringPage onOpenJob={handleOpenJob} />;
    }
    if (activeView === 'job-detail' && jobDetailId) {
      return <JobDetailPage jobId={jobDetailId} onBack={handleBackToJobMonitoring} />;
    }

    // Publishing Overview View
    if (activeView === 'publishing-overview') {
      return (
        <PublishingOverview
          onNavigateToModule={(id) => {
            setSelectedModule(null);
            setSelectedStep(null);
            navigate(`/modules/${encodeURIComponent(id)}`);
          }}
          onNavigateToFlow={handleViewFlow}
        />
      );
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
          shareToken={uiAppDef ?? undefined}
          onSaveCopy={uiAppDef ? () => handleSaveSharedUIApp(activeUIDefinition) : undefined}
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
      // A stale module from the previous route must not drive the redirect below.
      if (!selectedModule || selectedModule.id !== moduleId) {
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
        // Declarative redirect: navigate() must not be called during render.
        return <Navigate to={`/modules/${encodeURIComponent(moduleId!)}`} replace />;
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

  // Lazily loaded views resolve inside this boundary; the fallback matches the
  // other in-content loading states.
  const renderContent = () => (
    <Suspense fallback={<Loading message="Loading..." />}>{renderView()}</Suspense>
  );

  // Electron: show loading while checking active connection
  if (isElectron && hasActiveConnection === null) {
    return <Loading message="Loading..." />;
  }

  // Electron: show connection settings if no active connection
  if (isElectron && hasActiveConnection === false) {
    return (
      <div className="sas-connection-page">
        <div className="sas-connection-page__inner">
          <ConnectionSettings
            onSave={() => loadActiveConnection()}
            onConnectionSwitch={handleConnectionSwitch}
          />
        </div>
      </div>
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
    <>
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
      {/* Electron: connection settings dialog. ConnectionSettings supplies the
          title/actions/footer for its current view; Modal owns the chrome. */}
      {showSettings && (
        <ConnectionSettings
          onSave={closeSettings}
          onCancel={closeSettings}
          onConnectionSwitch={handleConnectionSwitch}
          frame={({ title, actions, children, footer }) => (
            <Modal title={title} onClose={closeSettings} footer={footer}>
              {actions && <div className="connection-settings__toolbar">{actions}</div>}
              {children}
            </Modal>
          )}
        />
      )}
    </>
  );
}

export default App;
