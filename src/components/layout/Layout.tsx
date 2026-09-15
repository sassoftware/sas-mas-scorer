// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Header } from './Header';
import { Sidebar, ViewType } from './Sidebar';
import { Module } from '../../types';
import { UIDefinitionSummary } from '../../types/uiBuilder';

interface LayoutProps {
  children: React.ReactNode;
  activeView: ViewType;
  onNavigate: (view: ViewType) => void;
  selectedModule?: Module | null;
  recentModules?: Module[];
  onSelectModule?: (module: Module) => void;
  onOpenSettings?: () => void;
  activeConnectionName?: string | null;
  recentUIApps?: UIDefinitionSummary[];
  onSelectUIApp?: (id: string) => void;
}

export const Layout: React.FC<LayoutProps> = ({
  children,
  activeView,
  onNavigate,
  selectedModule,
  recentModules,
  onSelectModule,
  onOpenSettings,
  activeConnectionName,
  recentUIApps,
  onSelectUIApp,
}) => {
  // Below the layout breakpoint (layout.css) the sidebar is an off-canvas
  // drawer behind the header's toggle; above it these have no visible effect.
  const [navOpen, setNavOpen] = useState(false);
  const sidebarId = useId();
  const sidebarRef = useRef<HTMLElement>(null);
  const navToggleRef = useRef<HTMLButtonElement>(null);

  const closeNav = useCallback(() => {
    // Give focus back to the toggle when it is about to leave the drawer, or
    // when nothing holds it (a scrim click leaves focus on <body>). Focus that
    // sits elsewhere (e.g. inside a Modal) is left alone. Above the breakpoint
    // the toggle is display:none, so focus() is a no-op.
    const active = document.activeElement;
    if (!active || active === document.body || sidebarRef.current?.contains(active)) {
      navToggleRef.current?.focus();
    }
    setNavOpen(false);
  }, []);

  const toggleNav = useCallback(() => {
    setNavOpen((open) => !open);
  }, []);

  // Move focus into the drawer when it opens; Escape closes it.
  useEffect(() => {
    if (!navOpen) return;
    sidebarRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // An open Modal owns Escape; leave the drawer alone until it is gone.
      if (document.querySelector('[aria-modal="true"]')) return;
      closeNav();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navOpen, closeNav]);

  // Any choice made in the drawer closes it.
  const handleNavigate = useCallback(
    (view: ViewType) => {
      closeNav();
      onNavigate(view);
    },
    [closeNav, onNavigate]
  );
  const handleSelectModule = useCallback(
    (module: Module) => {
      closeNav();
      onSelectModule?.(module);
    },
    [closeNav, onSelectModule]
  );
  const handleSelectUIApp = useCallback(
    (id: string) => {
      closeNav();
      onSelectUIApp?.(id);
    },
    [closeNav, onSelectUIApp]
  );

  return (
    <div className="sas-layout">
      <Header
        onOpenSettings={onOpenSettings}
        activeConnectionName={activeConnectionName}
        navOpen={navOpen}
        onToggleNav={toggleNav}
        navId={sidebarId}
        navToggleRef={navToggleRef}
      />
      <div className="sas-layout__container">
        <Sidebar
          ref={sidebarRef}
          id={sidebarId}
          open={navOpen}
          activeView={activeView}
          onNavigate={handleNavigate}
          selectedModule={selectedModule}
          recentModules={recentModules}
          onSelectModule={handleSelectModule}
          recentUIApps={recentUIApps}
          onSelectUIApp={handleSelectUIApp}
        />
        {navOpen && <div className="sas-layout__scrim" onClick={closeNav} aria-hidden="true" />}
        <main className="sas-layout__main">
          <div className="sas-layout__content">{children}</div>
        </main>
      </div>
    </div>
  );
};

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: { label: string; onClick?: () => void }[];
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  breadcrumbs,
  actions,
}) => {
  return (
    <div className="sas-page-header">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="sas-page-header__breadcrumbs" aria-label="Breadcrumb">
          <ol className="sas-breadcrumbs">
            {breadcrumbs.map((crumb, index) => (
              <li key={index} className="sas-breadcrumbs__item">
                {crumb.onClick ? (
                  <button
                    className="sas-breadcrumbs__link"
                    onClick={crumb.onClick}
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className="sas-breadcrumbs__current">{crumb.label}</span>
                )}
                {index < breadcrumbs.length - 1 && (
                  <span className="sas-breadcrumbs__separator">/</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="sas-page-header__main">
        <div className="sas-page-header__title-group">
          <h1 className="sas-page-header__title">{title}</h1>
          {subtitle && <p className="sas-page-header__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="sas-page-header__actions">{actions}</div>}
      </div>
    </div>
  );
};

export default Layout;
