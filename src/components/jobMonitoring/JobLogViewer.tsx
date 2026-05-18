// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../common/Button';
import { LogLine } from '../../types/jobExecution';
import { downloadText } from './utils';

interface JobLogViewerProps {
  lines: LogLine[];
  loading: boolean;
  error: string | null;
  isLive: boolean;
  onRefresh: () => void;
  emptyMessage?: string;
  // Filename used for the Download action (e.g. "MyJob-abc12345.log").
  downloadFilename: string;
}

// Threshold (in px) for distinguishing "user scrolled up to read older lines"
// from "user is parked at the bottom watching the tail". We re-enable
// auto-scroll automatically when they scroll back to within this distance of
// the bottom — feels natural without needing an explicit "follow" toggle.
const STICK_TO_BOTTOM_THRESHOLD = 60;

export const JobLogViewer: React.FC<JobLogViewerProps> = ({
  lines,
  loading,
  error,
  isLive,
  onRefresh,
  emptyMessage = 'No output yet.',
  downloadFilename,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  // Serialise the visible lines back to plain text (one line per row, just
  // the content — no type prefix, matching what's on screen). Used for both
  // the Copy and Download actions.
  const asText = (): string => lines.map((l) => l.line ?? '').join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (non-secure context) — silently ignore.
    }
  };

  const handleDownload = () => {
    downloadText(asText(), downloadFilename);
  };

  const hasContent = lines.length > 0;

  // Each time the line count changes, scroll to bottom if the user hasn't
  // manually scrolled away. The auto-scroll toggle gates everything.
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length, autoScroll]);

  // Detect when the user scrolls. If they leave the bottom, pause auto-scroll;
  // if they scroll back near the bottom, resume.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD);
  };

  return (
    <div className="job-log">
      <div className="job-log__toolbar">
        <div className="job-log__toolbar-info">
          {loading && lines.length === 0
            ? 'Loading…'
            : `${lines.length.toLocaleString()} line${lines.length === 1 ? '' : 's'}${isLive ? ' · live' : ''}`}
        </div>
        <div className="job-log__toolbar-actions">
          <Button
            variant="tertiary"
            size="small"
            onClick={() => setAutoScroll((prev) => !prev)}
          >
            {autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
          </Button>
          <Button
            variant="tertiary"
            size="small"
            onClick={handleCopy}
            disabled={!hasContent}
          >
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Button
            variant="tertiary"
            size="small"
            onClick={handleDownload}
            disabled={!hasContent}
          >
            Download
          </Button>
          <Button variant="tertiary" size="small" onClick={onRefresh}>
            Refresh now
          </Button>
        </div>
      </div>
      {error && (
        <div className="job-monitoring__error">
          <span>{error}</span>
          <Button variant="tertiary" size="small" onClick={onRefresh}>
            Retry
          </Button>
        </div>
      )}
      <div className="job-log__lines" ref={scrollRef} onScroll={handleScroll}>
        {lines.length === 0 && !loading ? (
          <div className="job-log__empty">{emptyMessage}</div>
        ) : (
          lines.map((line, idx) => (
            <span
              key={idx}
              className={`job-log__line job-log__line--${line.type ?? 'normal'}`}
            >
              {line.line || ' '}
            </span>
          ))
        )}
      </div>
    </div>
  );
};
