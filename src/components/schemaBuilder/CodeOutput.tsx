// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-python';
import 'prismjs/plugins/line-numbers/prism-line-numbers';
import 'prismjs/plugins/line-numbers/prism-line-numbers.css';
import { Button } from '../common/Button';
import { SaveToSidDialog } from './SaveToSidDialog';

interface Props {
  code: string;
  signature?: unknown[];
  exampleInput?: string;
}

export const CodeOutput: React.FC<Props> = ({ code, signature, exampleInput }) => {
  const [copied, setCopied] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  useEffect(() => {
    if (code) Prism.highlightAll();
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
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sas_id_execute.py';
    a.click();
    URL.revokeObjectURL(url);
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
        <Button variant="primary" size="small" onClick={() => setSaveOpen(true)} disabled={!code}>
          Save to SAS Viya
        </Button>
      </div>
      <pre className="schema-builder__code-pre line-numbers language-python">
        <code className="language-python">{code}</code>
      </pre>
      <SaveToSidDialog code={code} signature={signature} exampleInput={exampleInput} open={saveOpen} onClose={() => setSaveOpen(false)} />
    </div>
  );
};

export default CodeOutput;
