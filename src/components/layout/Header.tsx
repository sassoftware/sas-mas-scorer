// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { useSasAuth } from '../../auth';
import { Button } from '../common/Button';

// Check build mode at runtime
const isJobDefBuild = typeof __BUILD_MODE__ !== 'undefined' && __BUILD_MODE__ === 'jobdef';
const isElectron = !!window.electronAPI;

interface HeaderProps {
  onOpenSettings?: () => void;
  activeConnectionName?: string | null;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSettings, activeConnectionName }) => {
  const { isAuthenticated, isLoading, login, logout } = useSasAuth();

  const handleAuthClick = async () => {
    // No-op in jobdef build
    if (isJobDefBuild) return;

    try {
      if (isAuthenticated) {
        await logout();
      } else {
        await login();
      }
    } catch (err) {
      console.error('Auth action failed:', err);
    }
  };

  return (
    <header className="sas-header">
      <div className="sas-header__brand">
        <div className="sas-header__logo">
          <svg viewBox="0 0 40 40" className="sas-header__logo-icon">
            <rect x="4" y="4" width="32" height="32" rx="4" fill="#0066B2" />
            <path
              d="M12 20c0-4.4 3.6-8 8-8s8 3.6 8 8M12 20c0 4.4 3.6 8 8 8s8-3.6 8-8"
              stroke="white"
              strokeWidth="2.5"
              fill="none"
            />
            <circle cx="20" cy="20" r="3" fill="white" />
          </svg>
        </div>
        <div className="sas-header__title-group">
          <h1 className="sas-header__title">SAS Micro Analytic Score</h1>
          <span className="sas-header__subtitle">Module Scorer</span>
        </div>
      </div>

      <nav className="sas-header__nav">
        <a href="#modules" className="sas-header__nav-link sas-header__nav-link--active">
          Modules
        </a>
      </nav>

      <div className="sas-header__actions">
        {isElectron && onOpenSettings && (
          <button
            className="sas-header__help-link"
            title="Connection Settings"
            onClick={onOpenSettings}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
        <a
          href="https://developer.sas.com/rest-apis/microanalyticScore"
          target="_blank"
          rel="noopener noreferrer"
          className="sas-header__help-link"
          title="API Documentation"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </a>
        <div className="sas-header__auth">
          {isJobDefBuild ? (
            // Job definition build: Show SAS Viya session indicator only
            <div className="sas-header__auth-status">
              <span className="sas-header__auth-indicator sas-header__auth-indicator--connected" />
              <span className="sas-header__auth-text">SAS Viya Session</span>
            </div>
          ) : (
            // Standard build: Show full auth UI with login/logout
            <>
              {isAuthenticated ? (
                <div className="sas-header__auth-status">
                  <span className="sas-header__auth-indicator sas-header__auth-indicator--connected" />
                  <span className="sas-header__auth-text">
                    {activeConnectionName ? `${activeConnectionName} — Connected` : 'Connected'}
                  </span>
                </div>
              ) : (
                <div className="sas-header__auth-status">
                  <span className="sas-header__auth-indicator sas-header__auth-indicator--disconnected" />
                  <span className="sas-header__auth-text">
                    {activeConnectionName ? `${activeConnectionName} — Not connected` : 'Not connected'}
                  </span>
                </div>
              )}
              <Button
                variant={isAuthenticated ? 'tertiary' : 'primary'}
                size="small"
                onClick={handleAuthClick}
                loading={isLoading}
              >
                {isAuthenticated ? 'Logout' : 'Login'}
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
