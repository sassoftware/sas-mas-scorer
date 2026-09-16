// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
// Prism line-numbers plugin: injects per-line markers next to each highlighted
// line. We pull in both the JS (it hangs off Prism's `complete` hook, so it
// fires for highlightElement too) and the CSS so the gutter renders. Line
// numbers are display-only — the Copy button reads from the raw `code`
// string, so they never end up on the clipboard.
import 'prismjs/plugins/line-numbers/prism-line-numbers';
import 'prismjs/plugins/line-numbers/prism-line-numbers.css';
import { Button } from '../common/Button';
import { EmptyState } from '../common/EmptyState';
import { downloadText } from './utils';

interface JobCodePanelProps {
  code: string | undefined;
  type: string | undefined;
  // Filename for the Download action (e.g. "MyJob.sas").
  downloadFilename: string;
}

// No SAS lexer is registered in this project (FlowCodeModal uses the same
// 'clike' fallback), so SAS code highlights only basic keywords/strings.
const TYPE_TO_PRISM_LANG: Record<string, string> = {
  Compute: 'clike',
  Python: 'python',
  SQL: 'sql',
};

export const JobCodePanel: React.FC<JobCodePanelProps> = ({
  code,
  type,
  downloadFilename,
}) => {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const lang = (type && TYPE_TO_PRISM_LANG[type]) || 'clike';

  // Highlight only this block. highlightAll() would re-scan the whole
  // document and re-highlight any other code panel that happens to be
  // mounted (and fight React over their DOM).
  useEffect(() => {
    if (code && codeRef.current) Prism.highlightElement(codeRef.current);
  }, [code, lang]);

  if (!code) {
    return <EmptyState title="No source code is attached to this job." />;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable in non-secure contexts; ignore.
    }
  };

  return (
    <div className="job-code">
      <div className="job-code__toolbar">
        <span>{type ? `${type} job` : 'Source'}</span>
        <div className="job-code__toolbar-actions">
          <Button variant="tertiary" size="small" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy code'}
          </Button>
          <Button
            variant="tertiary"
            size="small"
            onClick={() => downloadText(code, downloadFilename)}
          >
            Download
          </Button>
        </div>
      </div>
      <pre className={`job-code__pre line-numbers language-${lang}`}>
        <code ref={codeRef} className={`language-${lang}`}>{code}</code>
      </pre>
    </div>
  );
};
