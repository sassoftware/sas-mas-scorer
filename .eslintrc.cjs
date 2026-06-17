/* Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved. */
/* SPDX-License-Identifier: Apache-2.0 */

module.exports = {
  root: true,
  env: { browser: true, es2020: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: [
    'dist',
    'dist-jobdef',
    'release',
    'electron/dist',
    'node_modules',
    '.eslintrc.cjs',
    'vite.config.ts',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-refresh'],
  rules: {
    // Fast-Refresh-only lint. Several modules deliberately co-locate a context
    // provider with its hook (e.g. SasAuthContext + useSasAuth), which trips
    // this rule for no correctness benefit — off project-wide.
    'react-refresh/only-export-components': 'off',
    // Prefer the TypeScript-aware unused-vars rule; allow intentional _-prefixed
    // throwaways (matches the existing `_e`, `_arr`, etc. conventions in code).
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
  },
};
