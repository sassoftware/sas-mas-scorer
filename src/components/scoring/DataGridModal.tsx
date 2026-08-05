// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect } from 'react';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { DatagridTable } from './DatagridTable';
import { datagridShape } from '../../utils/datagrid';

interface DataGridModalProps {
  title: string;
  value: unknown[];
  onClose: () => void;
}

// Modal viewer for a datagrid output value from a batch result cell
export const DataGridModal: React.FC<DataGridModalProps> = ({ title, value, onClose }) => {
  const shape = datagridShape(value);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(value, null, 2));
  };

  return (
    <div className="cas-upload-overlay" onClick={onClose}>
      <div className="datagrid-modal" onClick={e => e.stopPropagation()}>
        <div className="datagrid-modal__header">
          <div className="datagrid-modal__title">
            <h3>{title}</h3>
            <Badge variant="info">
              {shape.rows.toLocaleString()} rows × {shape.cols} columns
            </Badge>
          </div>
          <div className="datagrid-modal__actions">
            <Button variant="secondary" size="small" onClick={copyJson}>
              Copy JSON
            </Button>
            <button className="cas-upload-dialog__close" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="datagrid-modal__body">
          <DatagridTable value={value} />
        </div>
      </div>
    </div>
  );
};

export default DataGridModal;
