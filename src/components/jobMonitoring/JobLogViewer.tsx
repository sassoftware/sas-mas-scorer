// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { LogLine, LogLineType } from '../../types/jobExecution';
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

// The list is windowed: only the rows in (and just around) the viewport are
// in the DOM, with spacers standing in for the rest. That works because every
// .job-log__line is one non-wrapping row of the same height (white-space:
// pre, monospace, fixed line-height). OVERSCAN_ROWS are rendered above and
// below the viewport so fast scrolling doesn't flash blank space.
const OVERSCAN_ROWS = 12;

// Fallback until a rendered row has been measured (0.8125rem × 1.5 at the
// app's 14px root). The real height is read back from the first row.
const DEFAULT_ROW_HEIGHT = 17;

// Severity types get a visually-hidden text prefix so the type is not
// conveyed by colour alone. The prefix is skipped when the SAS payload
// already starts with the same word ("ERROR: …", "NOTE: …").
const LINE_TYPE_LABELS: Partial<Record<LogLineType, string>> = {
  error: 'Error',
  fatal: 'Fatal',
  warning: 'Warning',
  note: 'Note',
};

const lineStartsWithLabel = (text: string, label: string): boolean =>
  text.trimStart().toUpperCase().startsWith(label.toUpperCase());

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
  // First rendered row — measured to learn the real row height.
  const probeRef = useRef<HTMLSpanElement>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  // Window geometry. `firstRow` is the first row in the DOM (overscan
  // included); it only changes when the window actually moves, so a scroll
  // that stays inside the overscan costs no render.
  const [rowHeight, setRowHeight] = useState<number>(DEFAULT_ROW_HEIGHT);
  const [viewportHeight, setViewportHeight] = useState<number>(0);
  const [firstRow, setFirstRow] = useState<number>(0);
  const rowHeightRef = useRef(rowHeight);
  rowHeightRef.current = rowHeight;
  // Top padding of the scroller, which sits above row 0.
  const padTopRef = useRef(0);

  // Serialise ALL lines back to plain text (one line per row, just the
  // content — no type prefix). Used for both Copy and Download, so neither
  // is limited to the windowed slice.
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

  const updateWindow = useCallback((el: HTMLDivElement) => {
    const row = Math.floor((el.scrollTop - padTopRef.current) / rowHeightRef.current);
    const start = Math.max(0, row - OVERSCAN_ROWS);
    setFirstRow((prev) => (prev === start ? prev : start));
  }, []);

  // Measure the scroller once (padding, viewport) and track viewport resizes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    padTopRef.current = parseFloat(getComputedStyle(el).paddingTop) || 0;
    const measure = () => setViewportHeight(el.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Learn the real row height from a rendered row (font fallback / zoom can
  // move it off the default). Re-measured when rows first appear and when
  // the viewport changes (zoom); only sets state when the value differs.
  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    const measured = probe.getBoundingClientRect().height;
    if (measured > 0 && Math.abs(measured - rowHeight) > 0.01) setRowHeight(measured);
  }, [rowHeight, lines.length, viewportHeight]);

  // Each time the line count changes, scroll to bottom if the user hasn't
  // manually scrolled away, then move the window there in the same frame so
  // the tail never paints as an empty spacer. With windowing, scrollHeight is
  // a constant-cost read regardless of how long the log is.
  useLayoutEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    updateWindow(el);
  }, [lines.length, autoScroll, updateWindow]);

  // Detect when the user scrolls. If they leave the bottom, pause auto-scroll;
  // if they scroll back near the bottom, resume. Either way, move the window.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD);
    updateWindow(el);
  };

  const total = lines.length;
  const windowRows = Math.ceil(viewportHeight / rowHeight) + OVERSCAN_ROWS * 2;
  // Clamp in case the list shrank (Refresh clears it) since the window moved.
  const start = Math.min(firstRow, Math.max(0, total - 1));
  const end = Math.min(total, start + windowRows);
  const topSpacer = start * rowHeight;
  const bottomSpacer = (total - end) * rowHeight;

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
        <Alert variant="error">
          <div className="job-monitoring__alert-row">
            <span>{error}</span>
            <Button variant="tertiary" size="small" onClick={onRefresh}>
              Retry
            </Button>
          </div>
        </Alert>
      )}
      <div className="job-log__lines" ref={scrollRef} onScroll={handleScroll}>
        {total === 0 && !loading ? (
          <div className="job-log__empty">{emptyMessage}</div>
        ) : (
          <>
            <div style={{ height: topSpacer }} />
            {lines.slice(start, end).map((line, i) => {
              const idx = start + i;
              const type = line.type ?? 'normal';
              const label = LINE_TYPE_LABELS[type];
              const text = line.line ?? '';
              return (
                <span
                  // Absolute index so React reuses a row's element when the
                  // window shifts, instead of rewriting every visible row.
                  key={idx}
                  ref={i === 0 ? probeRef : undefined}
                  className={`job-log__line job-log__line--${type}`}
                >
                  {label && !lineStartsWithLabel(text, label) && (
                    <span className="sr-only">{label}: </span>
                  )}
                  {text || ' '}
                </span>
              );
            })}
            <div style={{ height: bottomSpacer }} />
          </>
        )}
      </div>
    </div>
  );
};
