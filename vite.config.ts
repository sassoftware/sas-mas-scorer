// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isJobDefBuild = process.env.BUILD_MODE === 'jobdef';
const isElectronBuild = process.env.BUILD_MODE === 'electron';

export default defineConfig(async () => {
  // Conditionally import vite-plugin-singlefile for jobdef builds
  const plugins = [react()];

  if (isJobDefBuild) {
    const { viteSingleFile } = await import('vite-plugin-singlefile');
    // Inline everything into single HTML file
    plugins.push(viteSingleFile());
  }

  // Build alias configuration - use array syntax for more control
  const aliasConfig = [
    { find: '@', replacement: path.resolve(__dirname, './src') },
  ];

  // For jobdef builds, redirect auth imports to no-auth implementation
  if (isJobDefBuild) {
    // Match any import ending with /auth or /auth/index (relative paths like ./auth, ../../auth)
    aliasConfig.push({
      find: /^(\.\.?\/)+auth(\/index)?$/,
      replacement: path.resolve(__dirname, 'src/auth/noauth-index'),
    });
  }

  // For electron builds, redirect auth imports to Electron IPC-based implementation
  if (isElectronBuild) {
    aliasConfig.push({
      find: /^(\.\.?\/)+auth(\/index)?$/,
      replacement: path.resolve(__dirname, 'src/auth/electron-index'),
    });
  }

  // Determine build mode string for runtime detection
  const buildMode = isElectronBuild ? 'electron' : isJobDefBuild ? 'jobdef' : 'standard';

  return {
    plugins,
    base: './',
    // Disable public directory for jobdef builds (no config.js needed)
    publicDir: isJobDefBuild ? false : 'public',
    resolve: {
      alias: aliasConfig,
    },
    define: {
      // Expose build mode to application code
      __BUILD_MODE__: JSON.stringify(buildMode),
    },
    build: {
      // Output to different directories based on build mode
      outDir: isJobDefBuild ? 'dist-jobdef' : 'dist',
      // High limit for jobdef to inline everything
      assetsInlineLimit: isJobDefBuild ? 100000000 : 4096,
      rollupOptions: {
        input: isJobDefBuild
          ? path.resolve(__dirname, 'index-jobdef.html')
          : path.resolve(__dirname, 'index.html'),
        output: {
          // For jobdef, use simpler output to help singlefile plugin
          ...(isJobDefBuild && {
            inlineDynamicImports: true,
          }),
        },
      },
    },
    server: {
      port: 3000,
    },
  };
});
