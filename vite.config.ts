// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig, type Alias, type Plugin, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { gzipSync } from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Single source of truth for the app version shown in the UI
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')) as { version: string };

const isJobDefBuild = process.env.BUILD_MODE === 'jobdef';
const isElectronBuild = process.env.BUILD_MODE === 'electron';

/** gzip, then base64: the base64 alphabet has no braces, so `{{` cannot appear. */
const gzipBase64 = (text: string): string =>
  gzipSync(Buffer.from(text, 'utf-8'), { level: 9 }).toString('base64');

/**
 * The single-file build's boot loader. Kept free of `{{` (Go template action
 * delimiter), checked again on the finished HTML below. On DOMContentLoaded it
 * decodes each base64 payload, gunzips it with DecompressionStream (Chrome and
 * Edge 80+, Firefox 113+, Safari 16.4+), adds the stylesheet, then runs the
 * scripts in order. The bytes are decoded as UTF-8 explicitly: atob() alone
 * yields one char per byte, which would turn the "→" in "Schema → Code" into
 * mojibake. Scripts run through new Function() (needs 'unsafe-eval', present
 * on our target environment); where a CSP blocks eval, the code goes into an
 * inline <script> element instead, which only needs 'unsafe-inline' — already
 * required by this loader itself.
 */
const bootLoader = (css: string, scripts: string[]): string => `<script>(function (css, scripts) {
  var root = function () { return document.getElementById("root") || document.body; };
  var fail = function (message) {
    var box = document.createElement("p");
    box.setAttribute("role", "alert");
    box.style.cssText = "margin:24px;font:14px/1.5 Arial,sans-serif;color:#1A1A1A";
    box.textContent = message;
    root().appendChild(box);
  };
  var gunzip = function (b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer().then(function (buf) { return new TextDecoder("utf-8").decode(buf); });
  };
  var run = function (code) {
    var fn;
    try { fn = new Function(code); } catch (err) {
      if (!(err instanceof EvalError)) throw err;
      var el = document.createElement("script");
      el.text = code;
      document.head.appendChild(el);
      return;
    }
    fn();
  };
  var start = function () {
    if (typeof DecompressionStream === "undefined") {
      fail("MAS Module Scorer needs a current web browser (Chrome, Edge, Firefox or Safari). Update your browser, then reload this page.");
      return;
    }
    var chain = css ? gunzip(css).then(function (text) {
      var style = document.createElement("style");
      style.textContent = text;
      document.head.appendChild(style);
    }) : Promise.resolve();
    scripts.forEach(function (b64) {
      chain = chain.then(function () { return gunzip(b64); }).then(run);
    });
    chain.catch(function (err) {
      fail("MAS Module Scorer could not start. Reload the page; if this keeps happening, contact your SAS administrator.");
      if (window.console) console.error(err);
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(${JSON.stringify(css)}, ${JSON.stringify(scripts)});</script>`;

/**
 * Vite plugin that makes the single-file HTML safe for, and small enough for,
 * SAS Job Execution. Job Execution serves the HTML through a Go template engine
 * that interprets `{{` sequences, corrupting any JS that contains them (regex,
 * template literals, destructuring, etc.). Every inline <script> and <style> is
 * gzipped and base64-encoded, which removes those sequences and cuts the file
 * to about a third: neither Job Execution nor a typical ingress compresses the
 * response, so the size on disk is the size sent to every VA viewer.
 */
function goTemplateSafeScripts(): Plugin {
  return {
    name: 'go-template-safe-scripts',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.html')) {
          let html = typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
          // Prepend UTF-8 BOM so the browser detects encoding correctly even
          // when SAS Job Execution / Visual Analytics serves the HTML with a
          // wrong (e.g. Windows-1252) Content-Type header. BOM outranks the
          // HTTP charset per the HTML encoding sniffing algorithm.
          if (!html.startsWith('﻿')) html = '﻿' + html;

          // Inline stylesheets: concatenated in document order into one payload
          // that the loader adds before any script runs, so the app never
          // renders unstyled.
          const styles: string[] = [];
          html = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (match, _attrs: string, css: string) => {
            if (!css.trim()) return match;
            styles.push(css);
            return '';
          });

          // Inline scripts, in document order. Scripts with a src are left alone.
          const scripts: string[] = [];
          html = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs: string, code: string) => {
            if (!code.trim() || /\bsrc\s*=/i.test(attrs)) return match;
            // new Function() runs code in classic (non-module) context, where
            // import.meta is a SyntaxError. Substitute a safe equivalent — the
            // value is unused in singlefile mode (no real preload happens).
            scripts.push(code.replace(/\bimport\.meta\.url\b/g, 'document.baseURI'));
            return '';
          });

          const loader = bootLoader(styles.length ? gzipBase64(styles.join('\n')) : '', scripts.map(gzipBase64));
          // A replacer function, so no "$" in the payload is read as a pattern.
          html = html.includes('</head>') ? html.replace('</head>', () => `${loader}\n  </head>`) : html + loader;

          // The guarantee the Go template needs: no action delimiter anywhere.
          if (html.includes('{{')) {
            this.error(`${file.fileName} contains "{{", which SAS Job Execution's Go template would treat as an action.`);
          }
          file.source = html;
        }
      }
    },
  };
}

// Web/Electron vendor chunks, matched on the package directory. A function,
// not the object form: the object form only names entry modules, and Rollup
// then put the shared react/jsx-runtime into vendor-flow, which made the entry
// chunk import (and modulepreload) the whole flow-diagram stack on every start.
const VENDOR_FLOW_RE = /[\\/]node_modules[\\/](@xyflow|@dagrejs|zustand|classcat|d3-[^\\/]+)[\\/]/;
const VENDOR_REACT_RE =
  /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|use-sync-external-store|cookie|set-cookie-parser)[\\/]/;

function vendorChunk(id: string): string | undefined {
  if (VENDOR_FLOW_RE.test(id)) return 'vendor-flow';
  if (VENDOR_REACT_RE.test(id)) return 'vendor-react';
  return undefined;
}

/**
 * Fails a web/Electron build whose entry chunk statically imports vendor-flow:
 * the flow-diagram stack must load with the views that draw diagrams, never on
 * app start.
 */
function entryStaysLight(): Plugin {
  return {
    name: 'entry-stays-light',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry) continue;
        const flowImport = chunk.imports.find((name) => /vendor-flow/.test(name));
        if (flowImport) {
          this.error(`The entry chunk ${chunk.fileName} imports ${flowImport}; the flow-diagram code must stay lazy.`);
        }
      }
    },
  };
}

export default defineConfig(async () => {
  // Conditionally import vite-plugin-singlefile for jobdef builds
  const plugins: PluginOption[] = [react()];

  if (isJobDefBuild) {
    const { viteSingleFile } = await import('vite-plugin-singlefile');
    // Inline everything into single HTML file
    plugins.push(viteSingleFile());
    // Encode inline scripts to survive Go template processing in SAS Job Execution
    plugins.push(goTemplateSafeScripts());
  } else {
    plugins.push(entryStaysLight());
  }

  // Build alias configuration - use array syntax for more control
  const aliasConfig: Alias[] = [
    { find: '@', replacement: path.resolve(__dirname, './src') },
  ];

  // For jobdef builds, redirect auth imports to no-auth implementation
  if (isJobDefBuild) {
    // Match any import ending with /auth or /auth/index (relative paths like ./auth, ../../auth)
    aliasConfig.push({
      find: /^(\.\.?\/)+auth(\/index)?$/,
      replacement: path.resolve(__dirname, 'src/auth/noauth-index'),
    });
    // Job Execution's CSP blocks data: fonts; main.tsx registers them from
    // script instead (src/styles/jobdefFonts.ts).
    aliasConfig.push({
      find: /^\.\/styles\/fonts\.css$/,
      replacement: path.resolve(__dirname, 'src/styles/fonts.jobdef.css'),
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
    publicDir: isJobDefBuild ? (false as const) : 'public',
    resolve: {
      alias: aliasConfig,
    },
    define: {
      // Expose build mode to application code
      __BUILD_MODE__: JSON.stringify(buildMode),
      // Version from package.json, rendered in the sidebar
      __APP_VERSION__: JSON.stringify(pkg.version),
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
          // Web/Electron: keep the vendor libraries in their own content-hashed
          // chunks so an app-code release does not re-download React or the
          // flow-diagram stack. Never for jobdef — manualChunks is incompatible
          // with inlineDynamicImports and that target must stay one file.
          ...(!isJobDefBuild && {
            manualChunks: vendorChunk,
          }),
        },
      },
    },
    server: {
      port: 3000,
    },
  };
});
