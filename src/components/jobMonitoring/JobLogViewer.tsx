// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { SearchInput } from '../common/SearchInput';
import { LogLine, LogLineType } from '../../types/jobExecution';
import { downloadText } from './utils';
import {
  firstAfter,
  lastBefore,
  matchLineIndices,
  rowOfLine,
  splitMatches,
  summarizeProblems,
} from './logSearch';

interface JobLogViewerProps {
  lines: LogLine[];
  loading: boolean;
  error: string | null;
  isLive: boolean;
  onRefresh: () => void;
  emptyMessage?: string;
  // Filename used for the Download action (e.g. "MyJob-abc12345.log").
  downloadFilename: string;
  // What the lines are, for labels ("log", "listing").
  outputName?: string;
  // Error/warning counts, the severity filter and error stepping. Off for
  // the listing, which carries no SAS messages.
  showProblems?: boolean;
  // Open at the first ERROR line instead of the tail (a failed job). Read
  // when the viewer mounts; a job that fails while watched keeps its tail.
  startAtFirstError?: boolean;
}

type SeverityFilter = 'all' | 'problems' | 'errors';

// Threshold (in px) for distinguishing "user scrolled up to read older lines"
// from "user is parked at the bottom watching the tail". We re-enable
// auto-scroll automatically when they scroll back to within this distance of
// the bottom — feels natural without needing an explicit "follow" toggle.
const STICK_TO_BOTTOM_THRESHOLD = 60;

// The list is windowed: only the rows in (and just around) the viewport are
// in the DOM, with spacers standing in for the rest. That works because every
// .job-log__line is one non-wrapping row of the same height (white-space:
// pre, monospace, fixed line-height). OVERSCAN_ROWS are rendered above and
// below the viewport so fast scrolling doesn't flash blank space. Because the
// browser's find-in-page only sees the rendered rows, the viewer has its own
// search.
const OVERSCAN_ROWS = 12;

// Fallback until a rendered row has been measured (0.8125rem × 1.5 at the
// app's 14px root). The real height is read back from the first row.
const DEFAULT_ROW_HEIGHT = 17;

// Longest line text read out when stepping to a line.
const ANNOUNCE_TEXT_MAX = 160;

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

// "match" takes "es"; the other nouns here (error, warning) a plain "s".
const plural = (n: number, word: string): string =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : /(s|sh|ch|x|z)$/.test(word) ? 'es' : 's'}`;

const clip = (text: string): string =>
  text.length > ANNOUNCE_TEXT_MAX ? `${text.slice(0, ANNOUNCE_TEXT_MAX)}…` : text;

export const JobLogViewer: React.FC<JobLogViewerProps> = ({
  lines,
  loading,
  error,
  isLive,
  onRefresh,
  emptyMessage = 'No output yet.',
  downloadFilename,
  outputName = 'log',
  showProblems = true,
  startAtFirstError = false,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  // First rendered row — measured to learn the real row height.
  const probeRef = useRef<HTMLSpanElement>(null);
  // A failed job opens at its first error, so it starts without following
  // the tail; with no error in the log it falls back to the tail.
  const [autoScroll, setAutoScroll] = useState<boolean>(!startAtFirstError);
  const [copied, setCopied] = useState<boolean>(false);

  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [query, setQuery] = useState<string>('');
  // The line (absolute index into `lines`) the user last stepped to.
  const [currentLine, setCurrentLine] = useState<number | null>(null);
  // Bumped with every jump so the scroll effect runs even for the same line.
  const [jumpNonce, setJumpNonce] = useState<number>(0);
  const [announcement, setAnnouncement] = useState<string>('');
  const startPendingRef = useRef<boolean>(startAtFirstError);
  const severityId = useId();

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

  // --- Derived: problems, filter, search ---------------------------------

  // One pass over the log; the counts and the line lists for stepping.
  const problems = useMemo(() => summarizeProblems(lines), [lines]);

  // The rows on screen, as indices into `lines`; null = every line.
  const visibleLines = useMemo<number[] | null>(() => {
    if (!showProblems || severity === 'all') return null;
    return severity === 'errors' ? problems.errorLines : problems.problemLines;
  }, [showProblems, severity, problems]);

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? matchLineIndices(lines, needle, visibleLines) : []),
    [lines, needle, visibleLines]
  );

  // What Previous / Next step through: search matches while searching,
  // otherwise errors, or warnings when the log has no errors.
  const targetKind: 'match' | 'error' | 'warning' | null = needle
    ? 'match'
    : !showProblems
      ? null
      : problems.errorLines.length > 0
        ? 'error'
        : severity !== 'errors' && problems.warningLines.length > 0
          ? 'warning'
          : null;
  const targets =
    targetKind === 'match'
      ? matches
      : targetKind === 'error'
        ? problems.errorLines
        : targetKind === 'warning'
          ? problems.warningLines
          : [];
  const targetNoun = targetKind ?? 'error';
  const targetPos = currentLine === null ? -1 : targets.indexOf(currentLine);

  // --- Copy / download -----------------------------------------------------

  // Serialise ALL lines back to plain text (one line per row, just the
  // content — no type prefix). Used for both Copy and Download, so neither
  // is limited to the windowed slice or the filter.
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

  // --- Windowing -----------------------------------------------------------

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
  }, [rowHeight, lines.length, viewportHeight, severity]);

  const total = visibleLines ? visibleLines.length : lines.length;

  // Each time the row count changes, scroll to bottom if the user hasn't
  // manually scrolled away, then move the window there in the same frame so
  // the tail never paints as an empty spacer. With windowing, scrollHeight is
  // a constant-cost read regardless of how long the log is.
  useLayoutEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    updateWindow(el);
  }, [total, autoScroll, updateWindow]);

  // Centre the stepped-to line. Re-applied when the row height is learnt
  // (the first jump can happen before a row was measured) and when the
  // filter changes which rows exist.
  const visibleLinesRef = useRef(visibleLines);
  visibleLinesRef.current = visibleLines;
  useLayoutEffect(() => {
    if (currentLine === null) return;
    const el = scrollRef.current;
    if (!el) return;
    const row = rowOfLine(currentLine, visibleLinesRef.current);
    if (row < 0) return;
    el.scrollTop = Math.max(
      0,
      padTopRef.current + row * rowHeight - (el.clientHeight - rowHeight) / 2
    );
    updateWindow(el);
    // currentLine and the row list are read, not tracked: a live log
    // appending lines must not pull the view back to the line. jumpNonce
    // marks each explicit jump, severity each change of filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpNonce, rowHeight, severity, updateWindow]);

  const jumpTo = useCallback(
    (line: number, message: string) => {
      setAutoScroll(false);
      setCurrentLine(line);
      setJumpNonce((n) => n + 1);
      setAnnouncement(message);
    },
    []
  );

  const describeLine = (line: number): string =>
    `line ${(line + 1).toLocaleString()}: ${clip(lines[line]?.line ?? '')}`;

  const step = (direction: 1 | -1) => {
    if (targets.length === 0 || targetKind === null) return;
    const from = currentLine ?? (direction === 1 ? -1 : Number.MAX_SAFE_INTEGER);
    let pos = direction === 1 ? firstAfter(targets, from) : lastBefore(targets, from);
    if (pos < 0) pos = direction === 1 ? 0 : targets.length - 1; // wrap around
    const line = targets[pos];
    const noun = targetKind === 'match' ? 'Match' : targetKind === 'error' ? 'Error' : 'Warning';
    jumpTo(line, `${noun} ${pos + 1} of ${targets.length}, ${describeLine(line)}`);
  };

  // A failed job opens at its first error once the saved log has arrived.
  useLayoutEffect(() => {
    if (!startPendingRef.current || loading || lines.length === 0) return;
    startPendingRef.current = false;
    const first = problems.errorLines[0];
    if (first === undefined) {
      setAutoScroll(true);
      return;
    }
    jumpTo(first, `Opened at the first error, ${describeLine(first)}`);
    // Runs once, when the log first has lines.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, lines.length]);

  // Typing a search moves to its first match, like find-in-page.
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  useEffect(() => {
    if (!needle) {
      setAnnouncement('');
      return;
    }
    const found = matchesRef.current;
    if (found.length === 0) {
      setAnnouncement(`No matches for “${query.trim()}”`);
      return;
    }
    jumpTo(found[0], `${plural(found.length, 'match')}. Match 1, ${describeLine(found[0])}`);
    // Only a new search term jumps; lines arriving while searching do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle]);

  // Detect when the user scrolls. If they leave the bottom, pause auto-scroll;
  // if they scroll back near the bottom, resume. Either way, move the window.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD);
    updateWindow(el);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    step(e.shiftKey ? -1 : 1);
  };

  const windowRows = Math.ceil(viewportHeight / rowHeight) + OVERSCAN_ROWS * 2;
  // Clamp in case the list shrank (Refresh, a filter) since the window moved.
  const start = Math.min(firstRow, Math.max(0, total - 1));
  const end = Math.min(total, start + windowRows);
  const topSpacer = start * rowHeight;
  const bottomSpacer = (total - end) * rowHeight;
  // Gutter width for the line numbers shown while filtering.
  const gutterCh = String(lines.length).length;

  const filteredEmpty =
    severity === 'errors'
      ? `No errors in this ${outputName}.`
      : `No errors or warnings in this ${outputName}.`;

  const positionText =
    targetKind === null
      ? ''
      : targetPos >= 0
        ? `${targetKind === 'match' ? 'Match' : targetKind === 'error' ? 'Error' : 'Warning'} ${(targetPos + 1).toLocaleString()} of ${targets.length.toLocaleString()}`
        : plural(targets.length, targetNoun === 'match' ? 'match' : targetNoun);

  return (
    <div className="job-log">
      <div className="job-log__toolbar">
        <div className="job-log__toolbar-info">
          {loading && lines.length === 0
            ? 'Loading…'
            : `${lines.length.toLocaleString()} line${lines.length === 1 ? '' : 's'}${isLive ? ' · live' : ''}`}
          {showProblems && hasContent && (
            <span className="job-log__problem-counts">
              {' · '}
              <span className={problems.errorCount > 0 ? 'job-log__count--error' : undefined}>
                {plural(problems.errorCount, 'error')}
              </span>
              {' · '}
              <span className={problems.warningCount > 0 ? 'job-log__count--warning' : undefined}>
                {plural(problems.warningCount, 'warning')}
              </span>
            </span>
          )}
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

      {hasContent && (
        <div className="job-log__findbar">
          {showProblems && (
            <div className="job-log__filter">
              <label className="job-log__filter-label" htmlFor={severityId}>
                Show
              </label>
              <select
                id={severityId}
                className="job-log__select"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as SeverityFilter)}
              >
                <option value="all">All lines</option>
                <option value="problems">Errors and warnings</option>
                <option value="errors">Errors only</option>
              </select>
            </div>
          )}
          <div className="job-log__search" onKeyDown={handleSearchKeyDown}>
            <SearchInput
              aria-label={`Search the ${outputName}`}
              placeholder={`Search the ${outputName}…`}
              value={query}
              onChange={setQuery}
            />
          </div>
          <div className="job-log__stepper">
            <span className="job-log__position">{positionText}</span>
            <Button
              variant="secondary"
              size="small"
              onClick={() => step(-1)}
              disabled={targets.length === 0}
              aria-label={`Previous ${targetNoun}`}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="small"
              onClick={() => step(1)}
              disabled={targets.length === 0}
              aria-label={`Next ${targetNoun}`}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Where Previous / Next / a search landed; the rows themselves are not
          focusable, so the line is read out from here. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {error && (
        <Alert
          variant="error"
          actions={
            <Button variant="tertiary" size="small" onClick={onRefresh}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      <div className="job-log__lines" ref={scrollRef} onScroll={handleScroll}>
        {total === 0 && !loading ? (
          <div className="job-log__empty">{visibleLines ? filteredEmpty : emptyMessage}</div>
        ) : (
          <>
            <div style={{ height: topSpacer }} />
            {Array.from({ length: Math.max(0, end - start) }, (_, i) => {
              const row = start + i;
              const idx = visibleLines ? visibleLines[row] : row;
              const line = lines[idx];
              const type = line?.type ?? 'normal';
              const label = LINE_TYPE_LABELS[type];
              const text = line?.line ?? '';
              const isCurrent = idx === currentLine;
              return (
                <span
                  // Absolute index so React reuses a row's element when the
                  // window shifts, instead of rewriting every visible row.
                  key={idx}
                  ref={i === 0 ? probeRef : undefined}
                  className={`job-log__line job-log__line--${type}${isCurrent ? ' job-log__line--current' : ''}`}
                >
                  {visibleLines && (
                    <span className="job-log__lineno">
                      {String(idx + 1).padStart(gutterCh, ' ')}
                      <span className="sr-only">:</span>{' '}
                    </span>
                  )}
                  {label && !lineStartsWithLabel(text, label) && (
                    <span className="sr-only">{label}: </span>
                  )}
                  {needle && text
                    ? splitMatches(text, needle).map((part, p) =>
                        part.match ? (
                          <mark key={p} className="job-log__match">
                            {part.text}
                          </mark>
                        ) : (
                          <React.Fragment key={p}>{part.text}</React.Fragment>
                        )
                      )
                    : text || ' '}
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
