// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';
import 'prismjs/themes/prism-tomorrow.css';
import { getCodeFileDetail, getFileContent, stripLeadingJsonComment } from '../../api/codeFiles';

interface CodeModalProps {
  href: string;
  language: string;
  onClose: () => void;
}

const PRISM_LANG_MAP: Record<string, string> = {
  Python: 'python',
  DS2: 'clike',
  SQL: 'sql',
  Query: 'sql',
};

async function fetchCodeContent(href: string): Promise<string> {
  const detail = await getCodeFileDetail(href);
  const contentLink = detail.links?.find(
    (l) => l.rel === 'content' || (l.href ?? l.uri ?? '').includes('/files/files/'),
  );
  if (contentLink) {
    const contentUrl = contentLink.href ?? contentLink.uri;
    const raw = await getFileContent(contentUrl);
    const { code } = stripLeadingJsonComment(raw);
    return code;
  }
  const stepCodeLink = detail.links?.find((l) => l.rel === 'decisionStepCode');
  if (stepCodeLink) {
    const stepCodeUrl = stepCodeLink.href ?? stepCodeLink.uri;
    const raw = await getFileContent(stepCodeUrl);
    const { code } = stripLeadingJsonComment(raw);
    return code;
  }
  if (detail.code) return detail.code;
  return '// Could not retrieve code content';
}

export default function FlowCodeModal({ href, language, onClose }: CodeModalProps) {
  const [code, setCode] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetchCodeContent(href)
      .then(setCode)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [href]);

  useEffect(() => {
    if (code) Prism.highlightAll();
  }, [code]);

  const prismLang = PRISM_LANG_MAP[language] ?? 'clike';

  return (
    <div className="flow-code-modal__backdrop" onClick={onClose}>
      <div className="flow-code-modal__dialog" onClick={(e) => e.stopPropagation()}>
        <div className="flow-code-modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h3 className="flow-code-modal__title">Code Viewer</h3>
            <span className="flow-code-modal__lang-badge">{language}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => navigator.clipboard.writeText(code)} className="flow-code-modal__copy-btn">Copy</button>
            <button onClick={onClose} className="flow-code-modal__close-btn">&times;</button>
          </div>
        </div>
        <div className="flow-code-modal__body">
          {loading && <div style={{ color: '#9ca3af', fontSize: '14px' }}>Loading code...</div>}
          {error && <div style={{ color: '#f87171', fontSize: '14px' }}>Error: {error}</div>}
          {!loading && !error && (
            <pre style={{ background: 'transparent', padding: 0 }}>
              <code className={`language-${prismLang}`}>{code}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
