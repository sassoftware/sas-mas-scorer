// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useId } from 'react';
import { getSasViyaUrl } from '../../config';
import { buildDeepLink } from '../../utils/deepLinks';
import { downloadTextFile } from '../../utils/csv';
import type { LogExcerpt } from '../../utils/segTree/runLog';
import { Button } from '../common';
import FlowDeepLink from '../flows/FlowDeepLink';
import type { RunFailure } from './runTreeTest';

const EXCERPT_TITLE: Record<LogExcerpt['kind'], string> = {
  errors: 'Errors in the run log',
  warnings: 'The run log has no errors; its warnings',
  tail: 'The run log has no errors or warnings; its last lines',
};

interface SegTreeRunFailureProps {
  failure: RunFailure;
  treeId: string;
  /** File name (without extension) for the log download. */
  logFileName: string;
}

/** What a failed test run's log says, with the full log, a download and links. */
export default function SegTreeRunFailure({ failure, treeId, logFileName }: SegTreeRunFailureProps) {
  const titleId = useId();
  // The test lives on the tree's Tests tab; SID has no verified test URL.
  const link = buildDeepLink('segmentationTree', treeId);
  return (
    <section className="segtree-test__failure" aria-labelledby={titleId}>
      <h3 className="segtree-test__failure-title" id={titleId}>
        {failure.excerpt ? EXCERPT_TITLE[failure.excerpt.kind] : 'Run log'}
      </h3>
      {failure.excerpt && failure.excerpt.lines.length > 0 && (
        <pre className="segtree-test__log" tabIndex={0} aria-labelledby={titleId}>
          {failure.excerpt.lines.join('\n')}
          {failure.excerpt.clipped ? '\n…' : ''}
        </pre>
      )}
      {failure.logError && <p className="segtree-test__failure-text">The run log could not be read: {failure.logError}</p>}
      {!failure.logUri && <p className="segtree-test__failure-text">The run left no log to show.</p>}
      <div className="segtree-test__failure-actions">
        {failure.log && (
          <Button
            variant="secondary"
            size="small"
            onClick={() => downloadTextFile(failure.log ?? '', `${logFileName}_run.log`, 'text/plain;charset=utf-8;')}
          >
            Download the log
          </Button>
        )}
        {failure.logUri && getSasViyaUrl() && (
          <a
            className="segtree-test__failure-link"
            href={`${getSasViyaUrl()}${failure.logUri.replace(/\/content\/?$/, '')}/content`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open the log in SAS Viya<span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        {link && <FlowDeepLink url={link.url} label="Open the tree's tests in SAS Intelligent Decisioning" showLabel />}
      </div>
      {failure.log && (
        <details className="segtree-test__full-log">
          <summary>Full log ({failure.log.split('\n').length.toLocaleString()} lines)</summary>
          <pre className="segtree-test__log segtree-test__log--full" tabIndex={0} aria-label="Full run log">{failure.log}</pre>
        </details>
      )}
    </section>
  );
}
