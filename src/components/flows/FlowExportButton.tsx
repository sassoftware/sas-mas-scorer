// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import type { DecisionFlow } from '../../types/sid';
import type { RestApiDefinitionDetail } from '../../api/restApiDefinitions';
import type { RuleSetBundle } from '../../api/rulesets';
import { generateMarkdownExport, type ExportProgress } from '../../flow/mermaidExport';
import { Button } from '../common';

interface FlowExportButtonProps {
  flow: DecisionFlow;
  /** The page's caches, so the export does not refetch what is already loaded. */
  subDecisionCache?: Map<string, DecisionFlow>;
  restApiCache?: Map<string, RestApiDefinitionDetail>;
  ruleSetCache?: Map<string, RuleSetBundle>;
}

const EXPORT_ICON = (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

export default function FlowExportButton({ flow, subDecisionCache, restApiCache, ruleSetCache }: FlowExportButtonProps) {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);

  async function handleExport() {
    setExporting(true);
    setProgress(null);
    try {
      const md = await generateMarkdownExport(flow, setProgress, subDecisionCache, restApiCache, ruleSetCache);
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

  const label = exporting
    ? (progress?.phase ? `${progress.phase}${progress.total > 0 ? ` ${progress.current}/${progress.total}` : ''}` : 'Preparing export...')
    : 'Export Markdown';

  return (
    <Button variant="secondary" size="small" icon={EXPORT_ICON} loading={exporting} onClick={handleExport}>
      {label}
    </Button>
  );
}
