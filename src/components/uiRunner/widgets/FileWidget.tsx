// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useId, useRef, useState } from 'react';
import { getEffectiveMaxLength } from '../../../utils/uiDefaults';
import { InputWidgetProps, controlAria } from './types';

const fmt = (n: number) => n.toLocaleString();

const sizeText = (bytes: number) =>
  bytes < 1024 ? `${bytes} bytes` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Pick or drop a file; the app sends it base64-encoded as the string input
 * (plain base64, or a data URL with the "data:…;base64," prefix, as the
 * author set). The encoded length is checked against the field's limit (its
 * Max length, else the size the step signature declares) before anything is
 * sent, and the message says by how much it is over. Everything happens in
 * the browser; the file is not uploaded anywhere but in the scoring request.
 */
export const FileInputWidget: React.FC<InputWidgetProps> = (props) => {
  const { field, value, onChange, disabled, parameter, id } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const noteId = useId();
  const [file, setFile] = useState<{ name: string; size: number; type: string; dataUrl: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const format = field.validation?.fileFormat ?? 'base64';
  const accept = field.validation?.fileAccept || undefined;
  const limit = getEffectiveMaxLength(field, parameter);
  const text = typeof value === 'string' ? value : '';

  const read = (f: File) => {
    setProblem(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const sent = format === 'dataUrl' ? dataUrl : dataUrl.slice(dataUrl.indexOf(',') + 1);
      setFile({ name: f.name, size: f.size, type: f.type, dataUrl });
      onChange(sent);
    };
    reader.onerror = () => setProblem(`Could not read ${f.name}.`);
    reader.readAsDataURL(f);
  };

  const clear = () => {
    setFile(null);
    setProblem(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const length = text.length;
  const tooLong = limit !== undefined && length > limit;
  const isImage = !!file && file.type.startsWith('image/');
  const describedBy = [props.describedBy, noteId].filter(Boolean).join(' ') || undefined;

  return (
    <div
      className={`ui-runner__file${over ? ' ui-runner__file--over' : ''}${tooLong ? ' ui-runner__file--invalid' : ''}`}
      onDragOver={(e) => {
        if (disabled || !Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (disabled) return;
        const f = e.dataTransfer.files?.[0];
        if (!f) return;
        e.preventDefault();
        setOver(false);
        read(f);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        className="ui-runner__file-input"
        accept={accept}
        {...controlAria(props)}
        id={id}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) read(f);
        }}
      />
      {isImage && file && (
        <img className="ui-runner__file-preview" src={file.dataUrl} alt={`Preview of ${file.name}`} />
      )}
      <div className="ui-runner__file-body">
        {file ? (
          <span className="ui-runner__file-name">{file.name} · {sizeText(file.size)}</span>
        ) : text ? (
          <span className="ui-runner__file-name">A file is loaded ({fmt(length)} characters)</span>
        ) : (
          <span className="ui-runner__file-hint">Choose a file, or drop one here</span>
        )}
        <span id={noteId} className={`ui-runner__field-constraint${tooLong ? ' ui-runner__file-over' : ''}`} role={tooLong ? 'alert' : undefined}>
          {problem
            ?? (tooLong
              ? `Too large to send: ${fmt(length)} characters encoded, ${fmt(length - (limit ?? 0))} over the limit of ${fmt(limit ?? 0)}.`
              : text
                ? `Sent as ${format === 'dataUrl' ? 'a data URL' : 'base64 text'}: ${fmt(length)}${limit !== undefined ? ` of ${fmt(limit)}` : ''} characters.`
                : `Sent as ${format === 'dataUrl' ? 'a data URL' : 'base64 text'}${limit !== undefined ? `, up to ${fmt(limit)} characters` : ''}.`)}
        </span>
      </div>
      {(file || text) && !disabled && (
        <button type="button" className="sas-button sas-button--tertiary sas-button--small" onClick={clear}>
          Remove{file ? ` ${file.name}` : ' file'}
        </button>
      )}
    </div>
  );
};
