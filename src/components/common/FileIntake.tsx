// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useId, useRef, useState } from 'react';

/**
 * The one way the app takes a file in (Figma 11/13 "File Intake"): a dashed
 * drop area with a Browse files button and the accepted types, optionally
 * beside an Upload file / Paste text switch. Used by Schema → Code, Rules
 * Import and the Execute page's file upload.
 *
 * The file input stays in the tab order (visually hidden, its label drawn as
 * the button), so keyboard and screen-reader users pick a file the usual way;
 * dropping a file is the pointer shortcut.
 */

export type FileIntakeMode = 'upload' | 'paste';

export interface FileIntakePaste {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the text box. */
  label: string;
  placeholder?: string;
  rows?: number;
}

export interface FileIntakeLoaded {
  name: string;
  /** Shown after the name: a format badge, a row count. */
  detail?: React.ReactNode;
  onClear?: () => void;
}

interface FileIntakeProps {
  /** Called with the picked or dropped file (the first one, when several are dropped). */
  onFile: (file: File) => void;
  /** The input's accept list (".csv", ".json,.xml,.txt"). */
  accept?: string;
  /** The accepted types in words, under the button ("Accepts .csv files only"). */
  acceptHint?: string;
  /** The line above the button (default "Drag and drop a file here, or"). */
  prompt?: string;
  disabled?: boolean;
  /** Offers Paste text beside Upload file; without it only the drop area shows. */
  paste?: FileIntakePaste;
  /** The mode shown first (default upload); the user's choice is kept after that. */
  defaultMode?: FileIntakeMode;
  /** Told when the user switches, e.g. to show an action that only pasted text needs. */
  onModeChange?: (mode: FileIntakeMode) => void;
  /** A loaded file: the area shrinks to one row with the name, Choose another and Clear. */
  loaded?: FileIntakeLoaded | null;
  className?: string;
}

const UploadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

const FileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);

export const FileIntake: React.FC<FileIntakeProps> = ({
  onFile,
  accept,
  acceptHint,
  prompt = 'Drag and drop a file here, or',
  disabled = false,
  paste,
  defaultMode = 'upload',
  onModeChange,
  loaded,
  className,
}) => {
  const id = useId();
  const inputId = `${id}-file`;
  const hintId = `${id}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setModeState] = useState<FileIntakeMode>(paste ? defaultMode : 'upload');
  const setMode = (next: FileIntakeMode) => {
    setModeState(next);
    onModeChange?.(next);
  };
  const [dragOver, setDragOver] = useState(false);

  const take = useCallback((file: File | undefined) => {
    if (!file || disabled) return;
    onFile(file);
    // A later pick of the same file must still fire the change event.
    if (inputRef.current) inputRef.current.value = '';
  }, [disabled, onFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    if (!disabled) setDragOver(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Moving onto a child fires dragleave on the area; only really leaving clears it.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    // preventDefault also stops the browser from opening the file and leaving the app.
    e.preventDefault();
    setDragOver(false);
    take(e.dataTransfer.files?.[0]);
  }, [take]);

  const fileInput = (
    <input
      ref={inputRef}
      id={inputId}
      type="file"
      accept={accept}
      disabled={disabled}
      aria-describedby={acceptHint && !loaded ? hintId : undefined}
      className="sr-only file-intake__input"
      onChange={(e) => take(e.target.files?.[0])}
    />
  );

  const dropHandlers = {
    onDragOver: handleDragOver,
    onDragEnter: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  };

  const showPaste = paste && mode === 'paste';

  return (
    <div className={`file-intake${className ? ` ${className}` : ''}`}>
      {paste && (
        <div className="file-intake__head">
          <span className="file-intake__caption" id={`${id}-method`}>Input method</span>
          <div className="file-intake__switch" role="group" aria-labelledby={`${id}-method`}>
            <button
              type="button"
              className="file-intake__switch-option"
              aria-pressed={mode === 'upload'}
              onClick={() => setMode('upload')}
            >
              Upload file
            </button>
            <button
              type="button"
              className="file-intake__switch-option"
              aria-pressed={mode === 'paste'}
              onClick={() => setMode('paste')}
            >
              Paste text
            </button>
          </div>
        </div>
      )}

      {showPaste ? (
        <textarea
          className="sas-textarea file-intake__paste"
          aria-label={paste.label}
          placeholder={paste.placeholder}
          rows={paste.rows ?? 10}
          value={paste.value}
          onChange={(e) => paste.onChange(e.target.value)}
          spellCheck={false}
          disabled={disabled}
        />
      ) : loaded ? (
        <div
          className={`file-intake__loaded${dragOver ? ' file-intake__loaded--drag' : ''}`}
          {...dropHandlers}
        >
          <span className="file-intake__file-icon"><FileIcon /></span>
          <span className="file-intake__file-name">{loaded.name}</span>
          {loaded.detail}
          <span className="file-intake__loaded-actions">
            {fileInput}
            <label htmlFor={inputId} className="sas-button sas-button--secondary sas-button--small file-intake__browse">
              {dragOver ? 'Drop to replace' : 'Choose another'}
            </label>
            {loaded.onClear && (
              <button
                type="button"
                className="sas-button sas-button--tertiary sas-button--small"
                onClick={loaded.onClear}
                disabled={disabled}
              >
                Clear
              </button>
            )}
          </span>
        </div>
      ) : (
        <div
          className={`file-intake__drop${dragOver ? ' file-intake__drop--active' : ''}${disabled ? ' file-intake__drop--disabled' : ''}`}
          {...dropHandlers}
        >
          <span className="file-intake__icon"><UploadIcon /></span>
          <span className="file-intake__prompt">{dragOver ? 'Drop the file to load it' : prompt}</span>
          {fileInput}
          <label htmlFor={inputId} className="sas-button sas-button--secondary sas-button--small file-intake__browse">
            Browse files
          </label>
          {acceptHint && <span className="file-intake__hint" id={hintId}>{acceptHint}</span>}
        </div>
      )}
    </div>
  );
};
