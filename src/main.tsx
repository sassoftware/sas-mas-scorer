// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { SasAuthProvider } from './auth';
import { initViyaUrl } from './config';
import App from './App';

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
