// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Module } from '../../types';
import { UIDefinitionSummary } from '../../types/uiBuilder';

export type ViewType = 'modules' | 'module-details' | 'score' | 'ui-apps' | 'ui-app-run' | 'ui-app-edit' | 'ui-app-new' | 'flows' | 'flow-detail' | 'coverage';

interface SidebarProps {
  activeView: ViewType;
  onNavigate: (view: ViewType) => void;
  selectedModule?: Module | null;
  recentModules?: Module[];
  onSelectModule?: (module: Module) => void;
  recentUIApps?: UIDefinitionSummary[];
  onSelectUIApp?: (id: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  onNavigate,
  selectedModule,
  recentModules = [],
  onSelectModule,
  recentUIApps = [],
  onSelectUIApp,
}) => {
  const isUIView = activeView.startsWith('ui-app');

  return (
    <aside className="sas-sidebar">
      <nav className="sas-sidebar__nav">
        <div className="sas-sidebar__section">
          <h3 className="sas-sidebar__section-title">Navigation</h3>
          <ul className="sas-sidebar__menu">
            <li>
              <button
                className={`sas-sidebar__menu-item ${
                  activeView === 'modules' ? 'sas-sidebar__menu-item--active' : ''
                }`}
                onClick={() => onNavigate('modules')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                <span>All Modules</span>
              </button>
            </li>
            <li>
              <button
                className={`sas-sidebar__menu-item ${
                  isUIView || activeView === 'ui-apps' ? 'sas-sidebar__menu-item--active' : ''
                }`}
                onClick={() => onNavigate('ui-apps')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                <span>UI Apps</span>
              </button>
            </li>
            <li>
              <button
                className={`sas-sidebar__menu-item ${
                  activeView === 'flows' || activeView === 'flow-detail' ? 'sas-sidebar__menu-item--active' : ''
                }`}
                onClick={() => onNavigate('flows')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="6" cy="19" r="2" />
                  <circle cx="18" cy="19" r="2" />
                  <path d="M12 7v4M12 11l-6 6M12 11l6 6" />
                </svg>
                <span>View Flows</span>
              </button>
            </li>
            <li>
              <button
                className={`sas-sidebar__menu-item ${
                  activeView === 'coverage' ? 'sas-sidebar__menu-item--active' : ''
                }`}
                onClick={() => onNavigate('coverage')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>Test Coverage</span>
              </button>
            </li>
          </ul>
        </div>

        {selectedModule && (
          <div className="sas-sidebar__section">
            <h3 className="sas-sidebar__section-title">Current Module</h3>
            <div className="sas-sidebar__current-module">
              <div className="sas-sidebar__module-name">{selectedModule.name}</div>
              <div className="sas-sidebar__module-id">{selectedModule.id}</div>
              <ul className="sas-sidebar__menu">
                <li>
                  <button
                    className={`sas-sidebar__menu-item ${
                      activeView === 'module-details' ? 'sas-sidebar__menu-item--active' : ''
                    }`}
                    onClick={() => onNavigate('module-details')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Details</span>
                  </button>
                </li>
                <li>
                  <button
                    className={`sas-sidebar__menu-item ${
                      activeView === 'score' ? 'sas-sidebar__menu-item--active' : ''
                    }`}
                    onClick={() => onNavigate('score')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Execute Score</span>
                  </button>
                </li>
              </ul>
            </div>
          </div>
        )}

        {recentUIApps.length > 0 && (
          <div className="sas-sidebar__section">
            <h3 className="sas-sidebar__section-title">Recent UI Apps</h3>
            <ul className="sas-sidebar__recent-list">
              {recentUIApps.slice(0, 5).map((app) => (
                <li key={app.id}>
                  <button
                    className="sas-sidebar__recent-item"
                    onClick={() => onSelectUIApp?.(app.id)}
                  >
                    <span className="sas-sidebar__recent-name">{app.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {recentModules.length > 0 && (
          <div className="sas-sidebar__section">
            <h3 className="sas-sidebar__section-title">Recent Modules</h3>
            <ul className="sas-sidebar__recent-list">
              {recentModules.slice(0, 5).map((module) => (
                <li key={module.id}>
                  <button
                    className="sas-sidebar__recent-item"
                    onClick={() => onSelectModule?.(module)}
                  >
                    <span className="sas-sidebar__recent-name">{module.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      <div className="sas-sidebar__footer">
        <div className="sas-sidebar__version">MAS Scorer v2.0.0</div>
      </div>
    </aside>
  );
};

export default Sidebar;
