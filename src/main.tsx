// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { SasAuthProvider } from './auth';
import { initViyaUrl } from './config';
import App from './App';
import './styles/fonts.css';

// Job Execution's CSP blocks data: fonts, so the jobdef build adds Open Sans
// from script (the fonts.css import is an empty file there).
if (__BUILD_MODE__ === 'jobdef') {
  void import('./styles/jobdefFonts').then((m) => m.registerJobdefFonts());
}

// Initialize cached Viya URL from Electron connection details (if applicable)
// before rendering so getSasViyaUrl() returns the correct URL for deeplinks.
initViyaUrl().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <HashRouter>
        <SasAuthProvider>
          <App />
        </SasAuthProvider>
      </HashRouter>
    </React.StrictMode>
  );
});
