// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useMemo, useState } from 'react';
import { UIDefinition } from '../../types/uiBuilder';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { encodeUIDefinition } from '../../utils/shareLink';

interface Props {
  definition: UIDefinition;
  onClose: () => void;
}

type Mode = 'standalone' | 'embedded';

export const ShareDialog: React.FC<Props> = ({ definition, onClose }) => {
  const [mode, setMode] = useState<Mode>('standalone');
  const [copied, setCopied] = useState<'link' | 'suffix' | null>(null);

  const standalone = mode === 'standalone';
  // Encoding stringifies and base64-encodes the whole definition; do it once
  // per definition, not on every mode toggle / "Copied!" re-render. The two
  // strings below are composed exactly as buildShareHash / buildShareLink do.
  const token = useMemo(() => encodeUIDefinition(definition), [definition]);
  const suffix = `#/ui-apps/${encodeURIComponent(definition.id)}?def=${token}${standalone ? '&standalone=true' : ''}`;
  const fullLink = `${window.location.origin}${window.location.pathname}${suffix}`;

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
    <Modal title={`Share “${definition.name}”`} onClose={onClose} size="medium">
      <div className="share-dialog">
        <p className="share-dialog__hint">
          The link below contains the entire UI App, so it works for anyone — they don’t need it
          saved in their browser. It only requires that the same module exists in MAS on the
          server they open it against.
        </p>

        <div className="share-dialog__field">
          <span className="share-dialog__label" id="share-dialog-mode-label">
            Display mode
          </span>
          {/* Native radios keep their own roving focus; the wrapper only supplies
              the group name a screen reader announces before each option. */}
          <div
            className="share-dialog__modes"
            role="radiogroup"
            aria-labelledby="share-dialog-mode-label"
          >
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

        <div className="share-dialog__field">
          <label className="share-dialog__label" htmlFor="share-dialog-full-link">
            Full link (this server)
          </label>
          <div className="share-dialog__link-row">
            <input id="share-dialog-full-link" className="sas-input" readOnly value={fullLink} />
            <Button variant="secondary" size="small" onClick={() => copy(fullLink, 'link')}>
              {copied === 'link' ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <span className="share-dialog__hint">
            Ready to use as-is when the recipient opens this same deployment.
          </span>
        </div>

        <div className="share-dialog__field">
          <label className="share-dialog__label" htmlFor="share-dialog-suffix">
            Portable code (any target)
          </label>
          <div className="share-dialog__link-row">
            <input id="share-dialog-suffix" className="sas-input" readOnly value={suffix} />
            <Button variant="secondary" size="small" onClick={() => copy(suffix, 'suffix')}>
              {copied === 'suffix' ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <span className="share-dialog__hint">
            Append this to the end of any MAS Scorer URL — the JobDefinition HTML, the Webserver
            build, or another Electron instance — and it opens the same app.
          </span>
        </div>
      </div>
    </Modal>
  );
};
