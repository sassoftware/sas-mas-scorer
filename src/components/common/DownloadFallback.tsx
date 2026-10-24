// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useRef, useState } from 'react';
import { Alert } from './Alert';
import { Button } from './Button';
import { DOWNLOAD_FALLBACK_EVENT, DownloadFallbackDetail } from '../../utils/download';

/**
 * Mounted once by the app shell. Shows the last file that saveTextFile()
 * could not (or may not) download, with a way to copy its contents instead.
 */
export const DownloadFallback: React.FC = () => {
  const [detail, setDetail] = useState<DownloadFallbackDetail | null>(null);
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onFallback = (e: Event) => {
      setDetail((e as CustomEvent<DownloadFallbackDetail>).detail);
      setStatus('idle');
    };
    window.addEventListener(DOWNLOAD_FALLBACK_EVENT, onFallback);
    return () => window.removeEventListener(DOWNLOAD_FALLBACK_EVENT, onFallback);
  }, []);

  useEffect(() => {
    if (status === 'manual') textRef.current?.select();
  }, [status]);

  if (!detail) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detail.content);
      setStatus('copied');
    } catch {
      // Clipboard access is blocked too: show the text so it can be copied by hand.
      setStatus('manual');
    }
  };

  return (
    <div className="sas-download-fallback">
      <Alert
        variant={detail.blocked ? 'warning' : 'info'}
        title={detail.blocked ? 'Download blocked' : 'Did the download start?'}
        dismissible
        onClose={() => setDetail(null)}
        actions={
          status !== 'manual' && (
            <Button variant="secondary" size="small" onClick={copy}>
              {status === 'copied' ? 'Copied' : 'Copy contents'}
            </Button>
          )
        }
      >
        {detail.blocked
          ? <>This embedded view does not allow downloads, so <strong>{detail.filename}</strong> was not saved. Copy its contents and paste them into a file instead.</>
          : <>If <strong>{detail.filename}</strong> did not download, this embedded view may block downloads. You can copy its contents instead.</>}
        {status === 'copied' && <p className="sas-download-fallback__note" role="status">Copied to the clipboard.</p>}
        {status === 'manual' && (
          <>
            <p className="sas-download-fallback__note">The clipboard is blocked as well. Select the text below and copy it with Ctrl+C (⌘C on a Mac).</p>
            <textarea
              ref={textRef}
              className="sas-download-fallback__text"
              readOnly
              value={detail.content}
              aria-label={`Contents of ${detail.filename}`}
            />
          </>
        )}
      </Alert>
    </div>
  );
};

export default DownloadFallback;
