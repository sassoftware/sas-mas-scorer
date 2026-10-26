// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Module, ModuleType, Step } from './types';
import { UIDefinition, UIDefinitionSummary } from './types/uiBuilder';
import { Layout, ViewType } from './components/layout';
import { ModuleList } from './components/modules/ModuleList';
import { Loading } from './components/common/Loading';
import { Modal } from './components/common/Modal';
import { Button } from './components/common/Button';
import { EmptyState } from './components/common/EmptyState';
import { CopyFailureDetails } from './components/common/Alert';
import { ChunkErrorBoundary } from './components/common/ChunkErrorBoundary';
import { useModules, useSteps, useSubmodules } from './hooks';
import { useSasAuth } from './auth';
import { deleteModule, getModule } from './api/modules';
import { getUIDefinition, listUIDefinitions, importUIDefinition } from './storage/uiStorage';
import { decodeUIDefinition } from './utils/shareLink';
import { initViyaUrl } from './config';
import { applyEnvironmentColor } from './utils/envColor';
import { clearAllViewCaches } from './utils/viewCaches';
import { buildListSearch, parsePageParam, readListParams, RESET_LIST_STATE } from './utils/listUrlState';
import { clearCasCatalog } from './hooks/useCasCatalog';
import { OPEN_SETTINGS_EVENT } from './components/common/AuthErrorModal';
import { DownloadFallback } from './components/common/DownloadFallback';
import './styles/index.css';

// Every view except the module list (the start page) loads on first visit
// instead of riding in the entry chunk: the flow diagram (@xyflow/react +
// dagre), prismjs for the code panels, the scoring dialogs, the UI builder,
// the rules parsers. The jobdef build inlines these chunks back into its single
// HTML file (inlineDynamicImports in vite.config.ts).
const loadModuleDetails = () => import('./components/modules/ModuleDetails');
const loadScorePanel = () => import('./components/scoring/ScorePanel');
const ModuleDetails = lazy(() => loadModuleDetails().then((m) => ({ default: m.ModuleDetails })));
const ScorePanel = lazy(() => loadScorePanel().then((m) => ({ default: m.ScorePanel })));
const UIAppsList = lazy(() =>
  import('./components/uiApps/UIAppsList').then((m) => ({ default: m.UIAppsList }))
);
const UIBuilder = lazy(() =>
  import('./components/uiBuilder/UIBuilder').then((m) => ({ default: m.UIBuilder }))
);
const UIRunner = lazy(() =>
  import('./components/uiRunner/UIRunner').then((m) => ({ default: m.UIRunner }))
);
const CoverageAnalysis = lazy(() =>
  import('./components/coverage/CoverageAnalysis').then((m) => ({ default: m.CoverageAnalysis }))
);
const PublishingOverview = lazy(() =>
  import('./components/publishing/PublishingOverview').then((m) => ({ default: m.PublishingOverview }))
);
const RulesImportPage = lazy(() =>
  import('./components/rulesImport/RulesImportPage').then((m) => ({ default: m.RulesImportPage }))
);
// Electron only: the web and jobdef builds never render it.
const ConnectionSettings = lazy(() =>
  import('./components/settings/ConnectionSettings').then((m) => ({ default: m.ConnectionSettings }))
);
const FlowListPage = lazy(() => import('./components/flows/FlowListPage'));
const FlowDetailPage = lazy(() => import('./components/flows/FlowDetailPage'));
const SegTreeListPage = lazy(() => import('./components/segTrees/SegTreeListPage'));
const SegTreeExplorerPage = lazy(() => import('./components/segTrees/SegTreeExplorerPage'));
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

// The module list's query lives in the URL (#/?q=credit&type=Decision&
// sort=name:ascending&page=2), so Back, a reload or a shared link shows the
// same list. `page` is 1-based.
const MODULE_LIST_DEFAULTS = { q: '', type: 'All', sort: '', page: '1' };
type ModuleListParams = typeof MODULE_LIST_DEFAULTS;

const MODULE_TYPE_FILTERS: readonly (ModuleType | 'All')[] = ['All', 'Model', 'Decision', 'Data'];
const toModuleTypeFilter = (value: string): ModuleType | 'All' =>
  MODULE_TYPE_FILTERS.find((type) => type === value) ?? 'All';

const readModuleListSearch = (search: string): ModuleListParams =>
  readListParams(new URLSearchParams(search), MODULE_LIST_DEFAULTS);

// The page's own <title> (index.html / index-jobdef.html), suffixed to each
// view's title.
// The <title> of index.html and index-jobdef.html. A constant, not read from
// document.title, which by then may already carry a view label (after a
// hot reload in development).
const BASE_DOCUMENT_TITLE = 'MAS Module Scorer - SAS';

const VIEW_TITLES: Record<ViewType, string> = {
  modules: 'Modules',
  'module-details': 'Module',
  score: 'Score',
  'ui-apps': 'UI Apps',
  'ui-app-run': 'UI App',
  'ui-app-edit': 'Edit UI App',
  'ui-app-new': 'New UI App',
  flows: 'Decision Flows',
  'flow-detail': 'Decision Flow',
  segtrees: 'Segmentation Trees',
  'segtree-detail': 'Segmentation Tree',
  coverage: 'Test Coverage',
  'publishing-overview': 'Publishing Overview',
  'job-monitoring': 'Job Monitoring',
  'job-detail': 'Job',
  'schema-builder': 'Schema → Code',
  'rules-import': 'Rules Import',
};

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
    const segTreeDetailMatch = hash.match(/^\/segmentation-trees\/([^/]+)$/);
    return {
      moduleId: moduleMatch ? decodeURIComponent(moduleMatch[1]) : null,
      stepId: stepMatch ? decodeURIComponent(stepMatch[1]) : null,
      uiAppId: uiAppRunMatch ? decodeURIComponent(uiAppRunMatch[1]) : null,
      uiAppEditId: uiAppEditMatch ? decodeURIComponent(uiAppEditMatch[1]) : null,
      uiAppNewModuleId: uiAppNewMatch ? decodeURIComponent(uiAppNewMatch[1]) : null,
      isUIAppsListView: hash === '/ui-apps' || hash === '/ui-apps/',
      isCoverageView: hash === '/coverage' || hash === '/coverage/',
      isFlowsListView: hash === '/flows' || hash === '/flows/',
      isSegTreesListView: hash === '/segmentation-trees' || hash === '/segmentation-trees/',
      isPublishingView: hash === '/publishing' || hash === '/publishing/',
      isJobMonitoringView: hash === '/jobs' || hash === '/jobs/',
      isSchemaBuilderView: hash === '/schema-builder' || hash === '/schema-builder/',
      isRulesImportView: hash === '/rules-import' || hash === '/rules-import/',
      flowDetailId: flowDetailMatch ? decodeURIComponent(flowDetailMatch[1]) : null,
      jobDetailId: jobDetailMatch ? decodeURIComponent(jobDetailMatch[1]) : null,
      segTreeId: segTreeDetailMatch ? decodeURIComponent(segTreeDetailMatch[1]) : null,
      isStandalone: searchParams.get('standalone') === 'true',
      // Self-contained share token: the full UI definition encoded into the URL
      // so a shared link works without the definition existing in localStorage.
      uiAppDef: searchParams.get('def'),
    };
  };

  const { moduleId, stepId, uiAppId, uiAppEditId, uiAppNewModuleId, isUIAppsListView, isCoverageView, isFlowsListView, isSegTreesListView, isPublishingView, isJobMonitoringView, isSchemaBuilderView, isRulesImportView, flowDetailId, jobDetailId, segTreeId, isStandalone, uiAppDef } = getRouteParams();

  // Determine active view from current route
  const getActiveView = (): ViewType => {
    if (jobDetailId) return 'job-detail';
    if (isJobMonitoringView) return 'job-monitoring';
    if (isSchemaBuilderView) return 'schema-builder';
    if (isRulesImportView) return 'rules-import';
    if (flowDetailId) return 'flow-detail';
    if (isFlowsListView) return 'flows';
    if (segTreeId) return 'segtree-detail';
    if (isSegTreesListView) return 'segtrees';
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

  // The module list's query: read from the URL while the list is shown, and
  // kept while another view is open, so the loaded page survives a visit to a
  // module and the breadcrumb or Back button can return to the same list.
  const moduleListSearchRef = useRef('');
  // The module list is fetched from its first showing on, not at start-up: a
  // deep link to a flow, a job or a standalone UI App never shows it. Once
  // shown it stays enabled, so its page survives a visit to another view.
  const moduleListShownRef = useRef(false);
  if (getActiveView() === 'modules') {
    moduleListShownRef.current = true;
    moduleListSearchRef.current = buildListSearch(readModuleListSearch(location.search), MODULE_LIST_DEFAULTS);
  }
  const moduleListParams = readModuleListSearch(moduleListSearchRef.current);
  const moduleSearchTerm = moduleListParams.q;
  const escapedModuleSearch = moduleSearchTerm.trim().replace(/'/g, "''");

  // Data hooks - only fetch when authenticated
  const {
    loading: loadingModules,
    error: modulesError,
    refresh: refreshModules,
    totalCount,
    currentPage,
    pageSize,
    sortBy,
    typeFilter,
    filteredCount,
    displayModules,
  } = useModules({
    enabled: isAuthenticated && moduleListShownRef.current,
    filter: escapedModuleSearch ? `contains(name,'${escapedModuleSearch}')` : '',
    sortBy: moduleListParams.sort,
    typeFilter: toModuleTypeFilter(moduleListParams.type),
    page: parsePageParam(moduleListParams.page) - 1,
  });

  // Write a change to the module list's query. Replaces the history entry, so
  // Back leaves the list instead of stepping through its filters.
  const updateModuleList = useCallback((patch: Partial<ModuleListParams>) => {
    const next = buildListSearch(
      { ...readModuleListSearch(moduleListSearchRef.current), ...patch },
      MODULE_LIST_DEFAULTS
    );
    moduleListSearchRef.current = next;
    navigate({ pathname: '/', search: next }, { replace: true });
  }, [navigate]);

  // Keyed on the URL, not the fetched module, so a deep link or refresh starts
  // the steps/submodules requests alongside getModule instead of after it.
  const routedModuleId = isAuthenticated ? moduleId : null;
  const { steps, loading: loadingSteps, loadedModuleId: stepsModuleId } = useSteps(routedModuleId);
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

  // Once the first view is up and the browser is idle, fetch the code of the
  // next steps on the main path (module details, then scoring) so opening a
  // module does not wait on a chunk. Not the flow or tree views: their
  // diagram libraries load only when one is opened. A failed prefetch is
  // ignored; the view retries the import when it is opened.
  useEffect(() => {
    if (__BUILD_MODE__ === 'jobdef') return; // one file: everything is already loaded
    const prefetch = () => {
      loadModuleDetails().catch(() => undefined);
      loadScorePanel().catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(prefetch, { timeout: 5000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(prefetch, 2000);
    return () => window.clearTimeout(timer);
  }, []);

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
    } else if (!moduleId && !uiAppId && !uiAppEditId && !uiAppNewModuleId && !isUIAppsListView && !isCoverageView && !isFlowsListView && !isSegTreesListView && !isPublishingView && !isJobMonitoringView && !isSchemaBuilderView && !isRulesImportView && !flowDetailId && !jobDetailId && !segTreeId) {
      setSelectedModule(null);
      setSelectedStep(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId, isAuthenticated]);

  // Load UI definition from URL when needed.
  // A `def` token in the URL carries the full definition, so it takes priority
  // over localStorage — this is what makes shared links work for any recipient.
  // Only the runner honours it: the builder saves under the definition's id,
  // and a shared definition must never be saved under the sender's id (Save to
  // My UI Apps imports it under a fresh one instead).
  useEffect(() => {
    if (uiAppDef && uiAppId) {
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

  // The step last opened for scoring, per module, for this session. The
  // sidebar's Execute Score goes back to it from the module details, a flow
  // or the UI builder. Recorded only once the URL's step has resolved, so a
  // step id that does not exist is never remembered.
  const lastStepIdsRef = useRef(new Map<string, string>());
  useEffect(() => {
    if (moduleId && stepId && selectedStep?.id === stepId) {
      lastStepIdsRef.current.set(moduleId, stepId);
    }
  }, [moduleId, stepId, selectedStep]);

  // Navigation handlers
  const handleNavigate = useCallback((view: ViewType) => {
    if (view === 'modules') {
      // The sidebar entry is the one way to a fresh list: the bare route
      // carries no query, so search, filters, sort and page start over.
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/');
    } else if (view === 'ui-apps') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/ui-apps');
    } else if (view === 'flows') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/flows', { state: RESET_LIST_STATE });
    } else if (view === 'segtrees') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/segmentation-trees', { state: RESET_LIST_STATE });
    } else if (view === 'coverage') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/coverage', { state: RESET_LIST_STATE });
    } else if (view === 'publishing-overview') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/publishing');
    } else if (view === 'job-monitoring') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/jobs', { state: RESET_LIST_STATE });
    } else if (view === 'schema-builder') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/schema-builder');
    } else if (view === 'rules-import') {
      setSelectedModule(null);
      setSelectedStep(null);
      navigate('/rules-import');
    } else if (view === 'module-details' || view === 'score') {
      // The sidebar's Current Module section: Details opens the module,
      // Execute Score the step last scored in it. With no step yet, Execute
      // Score opens the module with focus on its Steps card to pick one.
      const current = selectedModuleRef.current;
      if (!current) return;
      const modulePath = `/modules/${encodeURIComponent(current.id)}`;
      const scoreStepId = view === 'score' ? lastStepIdsRef.current.get(current.id) : undefined;
      if (scoreStepId) {
        const stepPath = `${modulePath}/steps/${encodeURIComponent(scoreStepId)}`;
        navigate(stepPath, { replace: location.pathname === stepPath });
      } else {
        navigate(modulePath, {
          replace: location.pathname === modulePath,
          state: view === 'score' ? { focusSteps: true } : undefined,
        });
      }
    }
  }, [navigate, location.pathname]);

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

  // Breadcrumb and Back button: return to the list as it was left.
  const handleBackToModules = useCallback(() => {
    setSelectedModule(null);
    setSelectedStep(null);
    navigate({ pathname: '/', search: moduleListSearchRef.current });
  }, [navigate]);

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
    navigate({ pathname: '/', search: moduleListSearchRef.current });
  }, [refreshModules, navigate]);

  // A new search, sort or type filter starts from the first page.
  const handleSearch = useCallback((searchTerm: string) => {
    updateModuleList({ q: searchTerm, page: MODULE_LIST_DEFAULTS.page });
  }, [updateModuleList]);

  const handleSort = useCallback((field: string, direction: 'asc' | 'desc') => {
    updateModuleList({
      sort: `${field}:${direction === 'asc' ? 'ascending' : 'descending'}`,
      page: MODULE_LIST_DEFAULTS.page,
    });
  }, [updateModuleList]);

  const handleTypeFilter = useCallback((type: ModuleType | 'All') => {
    updateModuleList({ type, page: MODULE_LIST_DEFAULTS.page });
  }, [updateModuleList]);

  // ModuleList speaks 0-based pages; the URL holds the 1-based number.
  const handleModulePageChange = useCallback((page: number) => {
    updateModuleList({ page: String(page + 1) });
  }, [updateModuleList]);

  // A list that shrank (a module deleted elsewhere, a reload) or a hand-edited
  // URL can point past the last page; go to the last page instead.
  const moduleListTotalPages = Math.ceil((typeFilter !== 'All' ? filteredCount : totalCount) / pageSize);
  useEffect(() => {
    if (getActiveView() !== 'modules' || loadingModules || modulesError) return;
    if (moduleListTotalPages > 0 && currentPage + 1 > moduleListTotalPages) {
      updateModuleList({ page: String(moduleListTotalPages) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingModules, modulesError, moduleListTotalPages, currentPage, updateModuleList]);

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
    // Drop every module-scoped cache before the new connection loads: the CAS
    // catalogue is keyed by the Viya URL, which two connections to the same
    // host share, so the key alone does not isolate them. clearCasCatalog is
    // called by name as well because clearAllViewCaches only reaches caches
    // whose module has been loaded — this import guarantees the CAS one has.
    clearAllViewCaches();
    clearCasCatalog();
    setSelectedModule(null);
    setSelectedStep(null);
    setRecentModules([]);
    navigate('/');
    await loadActiveConnection();
    await initViyaUrl();
    await checkAuth();
  }, [loadActiveConnection, checkAuth, navigate]);

  // Each view gets its own document title (browser tab, history menu, the
  // first thing a screen reader announces after navigation).
  const activeViewForTitle = getActiveView();
  useEffect(() => {
    let label = VIEW_TITLES[activeViewForTitle];
    if (activeViewForTitle === 'module-details' && selectedModule) {
      label = selectedModule.name;
    } else if (activeViewForTitle === 'score' && selectedModule && selectedStep) {
      label = `${selectedStep.id} - ${selectedModule.name}`;
    } else if (
      (activeViewForTitle === 'ui-app-run' || activeViewForTitle === 'ui-app-edit') &&
      activeUIDefinition
    ) {
      label = activeUIDefinition.name;
    }
    document.title = `${label} - ${BASE_DOCUMENT_TITLE}`;
  }, [activeViewForTitle, selectedModule, selectedStep, activeUIDefinition]);

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

    // Segmentation Tree Views
    if (activeView === 'segtrees') {
      return <SegTreeListPage />;
    }
    if (activeView === 'segtree-detail' && segTreeId) {
      return <SegTreeExplorerPage treeId={segTreeId} />;
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
          <EmptyState
            title="UI App not found"
            hint="It may have been deleted, or it was saved in another browser."
            action={<Button variant="secondary" onClick={handleBackToUIApps}>Back to UI Apps</Button>}
          />
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
      // Not in this browser's library (e.g. an app someone shared): the
      // builder would start empty with "No module specified".
      if (!activeUIDefinition) {
        return (
          <EmptyState
            title="This UI App is not in your library"
            hint="To edit an app someone shared with you, open the shared link and choose Save to My UI Apps, then edit your copy."
            action={<Button variant="secondary" onClick={handleBackToUIApps}>Back to UI Apps</Button>}
          />
        );
      }
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
          onPageChange={handleModulePageChange}
          searchTerm={moduleSearchTerm}
          onSearch={handleSearch}
          onSort={handleSort}
          onTypeFilter={handleTypeFilter}
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
        <EmptyState
          title="This module could not be loaded"
          hint={moduleError}
          action={
            <>
              <Button variant="secondary" onClick={handleBackToModules}>Back to Modules</Button>
              <CopyFailureDetails message={moduleError} />
            </>
          }
        />
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
          focusStepsRequest={
            (location.state as { focusSteps?: boolean } | null)?.focusSteps ? location.key : undefined
          }
        />
      );
    }

    // Score Panel View
    if (activeView === 'score') {
      // A stale module from the previous route must not drive the redirect below.
      if (!selectedModule || selectedModule.id !== moduleId) {
        return <Loading message="Loading module..." />;
      }
      // Until this module's own steps have arrived (the list can still be the
      // previous module's, or empty, for a render), a missing step proves nothing.
      if (loadingSteps || stepsModuleId !== moduleId) {
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
  // other in-content loading states. ChunkErrorBoundary sits outside Suspense
  // so a chunk that fails to load (stale index after a redeploy, dropped
  // connection) turns into a recoverable alert instead of a blank app, and it
  // wraps the content only, so the header and sidebar survive.
  // Keyed on the active view so navigating away from a view whose chunk failed
  // remounts the boundary with a clean state; a same-view re-render keeps the
  // instance (getActiveView() returns one distinct string per view).
  const renderContent = () => (
    <ChunkErrorBoundary key={getActiveView()}>
      <Suspense fallback={<Loading message="Loading..." />}>{renderView()}</Suspense>
    </ChunkErrorBoundary>
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
          <ChunkErrorBoundary>
            <Suspense fallback={<Loading message="Loading..." />}>
              <ConnectionSettings
                onSave={() => loadActiveConnection()}
                onConnectionSwitch={handleConnectionSwitch}
              />
            </Suspense>
          </ChunkErrorBoundary>
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
      {/* Offers to copy a generated file when an embed blocks downloads. */}
      <DownloadFallback />
      {/* Electron: connection settings dialog. ConnectionSettings supplies the
          title/actions/footer for its current view; Modal owns the chrome. */}
      {showSettings && (
        // No visible fallback: the settings chunk is small and local, and a
        // spinner outside the dialog would flash in the corner of the page.
        <ChunkErrorBoundary title="Connection settings could not be loaded">
          <Suspense fallback={null}>
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
          </Suspense>
        </ChunkErrorBoundary>
      )}
    </>
  );
}

export default App;
