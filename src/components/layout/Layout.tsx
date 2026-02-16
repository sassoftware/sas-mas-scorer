// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Header } from './Header';
import { Sidebar, ViewType } from './Sidebar';
import { Module } from '../../types';

interface LayoutProps {
  children: React.ReactNode;
  activeView: ViewType;
  onNavigate: (view: ViewType) => void;
  selectedModule?: Module | null;
  recentModules?: Module[];
  onSelectModule?: (module: Module) => void;
  onOpenSettings?: () => void;
  activeConnectionName?: string | null;
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
}) => {
  return (
    <div className="sas-layout">
      <Header onOpenSettings={onOpenSettings} activeConnectionName={activeConnectionName} />
      <div className="sas-layout__container">
        <Sidebar
          activeView={activeView}
          onNavigate={onNavigate}
          selectedModule={selectedModule}
          recentModules={recentModules}
          onSelectModule={onSelectModule}
        />
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
