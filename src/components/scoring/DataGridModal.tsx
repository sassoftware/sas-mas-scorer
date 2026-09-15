// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
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

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(value, null, 2));
  };

  return (
    <Modal
      size="wide"
      onClose={onClose}
      title={
        <span className="datagrid__modal-title">
          <span>{title}</span>
          <Badge variant="info">
            {shape.rows.toLocaleString()} rows × {shape.cols} columns
          </Badge>
        </span>
      }
      footer={
        <>
          <Button variant="secondary" size="small" onClick={copyJson}>
            Copy JSON
          </Button>
          <Button variant="tertiary" size="small" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <DatagridTable value={value} wrapperClassName="datagrid__wrapper--modal" />
    </Modal>
  );
};

export default DataGridModal;
