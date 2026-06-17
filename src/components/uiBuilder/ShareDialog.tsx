// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { UIDefinition } from '../../types/uiBuilder';
import { Button } from '../common/Button';
import { buildShareHash, buildShareLink } from '../../utils/shareLink';

interface Props {
  definition: UIDefinition;
  onClose: () => void;
}

type Mode = 'standalone' | 'embedded';

export const ShareDialog: React.FC<Props> = ({ definition, onClose }) => {
  const [mode, setMode] = useState<Mode>('standalone');
  const [copied, setCopied] = useState<'link' | 'suffix' | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const standalone = mode === 'standalone';
  const fullLink = buildShareLink(definition, standalone);
  const suffix = buildShareHash(definition, standalone);

  const copy = async (text: string, which: 'link' | 'suffix') => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt('Copy this value:', text);
    }
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="save-scenario-overlay" onClick={onClose} role="presentation">
      <div
        className="save-scenario-dialog share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="save-scenario-dialog__header">
          <h3 id="share-dialog-title">Share “{definition.name}”</h3>
          <button className="save-scenario-dialog__close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="save-scenario-dialog__body">
          <p className="save-scenario-dialog__hint">
            The link below contains the entire UI App, so it works for anyone — they don’t need it
            saved in their browser. It only requires that the same module exists in MAS on the
            server they open it against.
          </p>

          <div className="save-scenario-dialog__field">
            <span className="save-scenario-dialog__label">Display mode</span>
            <div className="share-dialog__modes">
              <label className="share-dialog__mode">
                <input
                  type="radio"
                  name="share-mode"
                  checked={mode === 'standalone'}
                  onChange={() => setMode('standalone')}
                />
                <span>
                  <strong>Standalone</strong> — just the app, no MAS Scorer navigation
                </span>
              </label>
              <label className="share-dialog__mode">
                <input
                  type="radio"
                  name="share-mode"
                  checked={mode === 'embedded'}
                  onChange={() => setMode('embedded')}
                />
                <span>
                  <strong>Within MAS Scorer</strong> — opens inside the full app chrome
                </span>
              </label>
            </div>
          </div>

          <div className="save-scenario-dialog__field">
            <span className="save-scenario-dialog__label">Full link (this server)</span>
            <div className="share-dialog__link-row">
              <input className="save-scenario-dialog__input" readOnly value={fullLink} />
              <Button variant="secondary" size="small" onClick={() => copy(fullLink, 'link')}>
                {copied === 'link' ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <span className="save-scenario-dialog__hint">
              Ready to use as-is when the recipient opens this same deployment.
            </span>
          </div>

          <div className="save-scenario-dialog__field">
            <span className="save-scenario-dialog__label">Portable code (any target)</span>
            <div className="share-dialog__link-row">
              <input className="save-scenario-dialog__input" readOnly value={suffix} />
              <Button variant="secondary" size="small" onClick={() => copy(suffix, 'suffix')}>
                {copied === 'suffix' ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <span className="save-scenario-dialog__hint">
              Append this to the end of any MAS Scorer URL — the JobDefinition HTML, the Webserver
              build, or another Electron instance — and it opens the same app.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
