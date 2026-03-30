// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import type { DecisionFlow } from '../../types/sid';
import { generateMarkdownExport, type ExportProgress } from '../../flow/mermaidExport';

interface FlowExportButtonProps {
  flow: DecisionFlow;
  subDecisionCache?: Map<string, DecisionFlow>;
}

export default function FlowExportButton({ flow, subDecisionCache }: FlowExportButtonProps) {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);

  async function handleExport() {
    setExporting(true);
    setProgress(null);
    try {
      const md = await generateMarkdownExport(flow, setProgress, subDecisionCache);
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${flow.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      setExporting(false);
      setProgress(null);
    }
  }

  return (
    <button onClick={handleExport} disabled={exporting} className={`flow-export-btn ${exporting ? 'flow-export-btn--exporting' : ''}`}>
      {exporting ? (
        <>
          <span className="flow-export-btn__spinner" />
          {progress?.phase ? `${progress.phase}${progress.total > 0 ? ` ${progress.current}/${progress.total}` : ''}` : 'Preparing export...'}
        </>
      ) : (
        <>
          <svg className="flow-export-btn__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export Markdown
        </>
      )}
    </button>
  );
}
