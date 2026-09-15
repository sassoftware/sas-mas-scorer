// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';
import 'prismjs/themes/prism-tomorrow.css';
import { getCodeFileDetail, getFileContent, stripLeadingJsonComment } from '../../api/codeFiles';
import { Alert, Button, Loading, Modal } from '../common';

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
    <Modal
      title={
        <span className="flow-code-modal__title">
          Code Viewer
          <span className="flow-code-modal__lang-badge">{language}</span>
        </span>
      }
      onClose={onClose}
      size="wide"
      footer={
        <>
          <Button
            variant="secondary"
            size="small"
            disabled={!code}
            onClick={() => navigator.clipboard.writeText(code)}
          >
            Copy
          </Button>
          <Button variant="tertiary" size="small" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {loading && <Loading size="small" message="Loading code..." />}
      {error && <Alert variant="error">Could not load the code: {error}</Alert>}
      {!loading && !error && (
        <pre className="flow-code-modal__code">
          <code className={`language-${prismLang}`}>{code}</code>
        </pre>
      )}
    </Modal>
  );
}
