// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-python';
import 'prismjs/plugins/line-numbers/prism-line-numbers';
import 'prismjs/plugins/line-numbers/prism-line-numbers.css';
import { Button } from '../common/Button';
import { SaveToSidDialog } from './SaveToSidDialog';
import { saveTextFile } from '../../utils/download';

interface Props {
  code: string;
  signature?: unknown[];
  exampleInput?: string;
  /** Why saving is not possible right now (invalid variable names), or null. */
  saveBlockedReason?: string | null;
}

export const CodeOutput: React.FC<Props> = ({ code, signature, exampleInput, saveBlockedReason }) => {
  const [copied, setCopied] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  // Highlight this block only — highlightAll() would re-tokenize every Prism
  // block in the document. The line-numbers plugin hooks `complete`, which
  // highlightElement fires too.
  useEffect(() => {
    if (code && codeRef.current) Prism.highlightElement(codeRef.current);
  }, [code]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable in non-secure contexts; ignore.
    }
  };

  const handleDownload = () => {
    saveTextFile(code, 'sas_id_execute.py', 'text/x-python');
  };

  return (
    <div className="schema-builder__code-output">
      <div className="schema-builder__code-toolbar">
        <Button variant="tertiary" size="small" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy to clipboard'}
        </Button>
        <Button variant="tertiary" size="small" onClick={handleDownload}>
          Download .py
        </Button>
        <Button
          variant="primary"
          size="small"
          onClick={() => setSaveOpen(true)}
          disabled={!code || !!saveBlockedReason}
          aria-describedby={saveBlockedReason ? 'sb-save-blocked' : undefined}
        >
          Save to SAS Viya
        </Button>
      </div>
      {saveBlockedReason && (
        <p id="sb-save-blocked" className="schema-builder__blocked-reason" role="status">
          {saveBlockedReason}
        </p>
      )}
      <pre className="schema-builder__code-pre line-numbers language-python">
        <code ref={codeRef} className="language-python">{code}</code>
      </pre>
      <SaveToSidDialog code={code} signature={signature} exampleInput={exampleInput} open={saveOpen} onClose={() => setSaveOpen(false)} />
    </div>
  );
};

export default CodeOutput;
