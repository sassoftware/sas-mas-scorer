// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Header } from './Header';
import { isAnyModalOpen } from '../common/Modal';
import { Sidebar, ViewType } from './Sidebar';
import { Module } from '../../types';
import { UIDefinitionSummary } from '../../types/uiBuilder';

// v2: up to 2.9 the state was written on every load, so a stored value does
// not mean the user chose it; the new key starts everyone on the new default.
const NAV_COLLAPSED_KEY = 'mas-scorer:nav-collapsed:v2';

interface LayoutProps {
  children: React.ReactNode;
  activeView: ViewType;
  onNavigate: (view: ViewType) => void;
  /** The module open now, or the last one opened; unset until one is opened. */
  lastModule?: Module | null;
  /** Saved UI apps on that module (the "2 apps" tag). */
  lastModuleApps?: number;
  onOpenSettings?: () => void;
  activeConnectionName?: string | null;
  /** The saved UI app last run or edited; unset until one is. */
  lastUIApp?: UIDefinitionSummary | null;
  onRunUIApp?: (id: string) => void;
  onEditUIApp?: (id: string) => void;
  /**
   * Full-window work view (the UI app builder): no navigation sidebar and no
   * page padding, so the view can use the whole window under the header.
   */
  focus?: boolean;
}

export const Layout: React.FC<LayoutProps> = ({
  children,
  activeView,
  onNavigate,
  lastModule,
  lastModuleApps = 0,
  onOpenSettings,
  activeConnectionName,
  lastUIApp,
  onRunUIApp,
  onEditUIApp,
  focus = false,
}) => {
  // Below the layout breakpoint (layout.css) the sidebar is an off-canvas
  // drawer behind the header's toggle; above it these have no visible effect.
  const [navOpen, setNavOpen] = useState(false);

  // Above the breakpoint the user can fold the sidebar to an icon rail. Default
  // collapsed; only an explicit toggle is stored, so the default can change
  // later without overriding a choice nobody made.
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(NAV_COLLAPSED_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const toggleCollapsed = useCallback(() => {
    setNavCollapsed((collapsed) => {
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? '0' : '1');
      } catch {
        // Storage unavailable (private window, embed): the choice lasts the session.
      }
      return !collapsed;
    });
  }, []);
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
      // isAnyModalOpen also covers the dialogs that are still hand-rolled
      // overlays (ShareDialog) and never register with the Modal stack.
      if (isAnyModalOpen()) return;
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
  const handleRunUIApp = useCallback(
    (id: string) => {
      closeNav();
      onRunUIApp?.(id);
    },
    [closeNav, onRunUIApp]
  );
  const handleEditUIApp = useCallback(
    (id: string) => {
      closeNav();
      onEditUIApp?.(id);
    },
    [closeNav, onEditUIApp]
  );

  return (
    <div className={`sas-layout${navCollapsed ? ' sas-layout--nav-collapsed' : ''}${focus ? ' sas-layout--focus' : ''}`}>
      <Header
        onOpenSettings={onOpenSettings}
        activeConnectionName={activeConnectionName}
        navOpen={navOpen}
        onToggleNav={focus ? undefined : toggleNav}
        navId={sidebarId}
        navToggleRef={navToggleRef}
      />
      <div className="sas-layout__container">
        {!focus && <Sidebar
          ref={sidebarRef}
          id={sidebarId}
          open={navOpen}
          collapsed={navCollapsed}
          onToggleCollapsed={toggleCollapsed}
          activeView={activeView}
          onNavigate={handleNavigate}
          lastModule={lastModule}
          lastModuleApps={lastModuleApps}
          lastUIApp={lastUIApp}
          onRunUIApp={handleRunUIApp}
          onEditUIApp={handleEditUIApp}
        />}
        {navOpen && !focus && <div className="sas-layout__scrim" onClick={closeNav} aria-hidden="true" />}
        <main className="sas-layout__main">
          <div className="sas-layout__content">{children}</div>
        </main>
      </div>
    </div>
  );
};

interface PageHeaderProps {
  title: string;
  /** A muted count beside the title ("214 decisions"). */
  count?: string;
  subtitle?: string;
  breadcrumbs?: { label: string; onClick?: () => void }[];
  actions?: React.ReactNode;
  /** Beside the title, outside the heading: a state badge or chip (3.1). */
  titleAddon?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  count,
  subtitle,
  breadcrumbs,
  actions,
  titleAddon,
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
                    type="button"
                    className="sas-breadcrumbs__link"
                    onClick={crumb.onClick}
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className="sas-breadcrumbs__current">{crumb.label}</span>
                )}
                {index < breadcrumbs.length - 1 && (
                  <span className="sas-breadcrumbs__separator" aria-hidden="true">›</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="sas-page-header__main">
        <div className="sas-page-header__title-group">
          {(() => {
            const heading = (
              <h1 className="sas-page-header__title">
                {title}
                {count && <span className="sas-page-header__count">{count}</span>}
              </h1>
            );
            return titleAddon ? (
              <div className="sas-page-header__title-row">
                {heading}
                {titleAddon}
              </div>
            ) : heading;
          })()}
          {subtitle && <p className="sas-page-header__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="sas-page-header__actions">{actions}</div>}
      </div>
    </div>
  );
};

export default Layout;
