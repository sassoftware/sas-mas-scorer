// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import type { DecisionFlow } from '../../types/sid';
import type { RestApiDefinitionDetail } from '../../api/restApiDefinitions';
import type { RuleSetBundle } from '../../api/rulesets';
import { generateMarkdownExport, type ExportProgress } from '../../flow/mermaidExport';
import { Alert, Button } from '../common';
import { saveTextFile } from '../../utils/download';

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
  const [error, setError] = useState('');
  // Parts of the last export that could not be loaded (they are listed in the file).
  const [incomplete, setIncomplete] = useState(0);

  async function handleExport() {
    setExporting(true);
    setProgress(null);
    setError('');
    setIncomplete(0);
    try {
      let missing = 0;
      const md = await generateMarkdownExport(
        flow, setProgress, subDecisionCache, restApiCache, ruleSetCache, (count) => { missing = count; },
      );
      saveTextFile(md, `${flow.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`, 'text/markdown');
      setIncomplete(missing);
    } catch (e) {
      console.error('Export failed:', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
      setProgress(null);
    }
  }

  const label = exporting
    ? (progress?.phase ? `${progress.phase}${progress.total > 0 ? ` ${progress.current}/${progress.total}` : ''}` : 'Preparing export...')
    : 'Export Markdown';

  return (
    <div className="flow-export">
      <Button variant="secondary" size="small" icon={EXPORT_ICON} loading={exporting} onClick={handleExport}>
        {label}
      </Button>
      {error && (
        <div className="flow-export__message">
          <Alert variant="error" title="The Markdown export failed" dismissible onClose={() => setError('')}>
            {error}
          </Alert>
        </div>
      )}
      <p className="flow-export__status" role="status">
        {incomplete > 0
          ? `Exported with ${incomplete} missing detail${incomplete === 1 ? '' : 's'}; see "Incomplete Sections" at the top of the file.`
          : ''}
      </p>
    </div>
  );
}
