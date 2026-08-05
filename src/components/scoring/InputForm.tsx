// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { StepParameter, StepParameterType } from '../../types';
import { TypeBadge } from '../common/Badge';
import { Button } from '../common/Button';
import { DecimalInput } from '../common/DecimalInput';
import { DataGridInputModal, DataGridParamInfo } from './DataGridInputModal';
import { coerceDatagridValue, datagridShape } from '../../utils/datagrid';

interface InputFormProps {
  parameters: StepParameter[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
  /** MAS parameter name → datagrid schema info, for decision datagrid inputs */
  datagridParams?: Record<string, DataGridParamInfo>;
}

export const InputForm: React.FC<InputFormProps> = ({
  parameters,
  values,
  onChange,
  disabled = false,
  datagridParams,
}) => {
  const [editingGridParam, setEditingGridParam] = useState<string | null>(null);
  const handleChange = (name: string, value: unknown) => {
    onChange({ ...values, [name]: value });
  };

  const parseArrayValue = (
    rawValue: string,
    type: StepParameterType
  ): (number | string | null)[] => {
    const items = rawValue.split(',').map((item) => item.trim());

    if (type === 'decimalArray' || type === 'integerArray' || type === 'bigintArray') {
      return items.map((item) => {
        if (item === '' || item.toLowerCase() === 'null') return null;
        const num = Number(item);
        return isNaN(num) ? null : num;
      });
    }

    return items.map((item) => (item === '' ? null : item));
  };

  const formatArrayValue = (value: unknown): string => {
    if (Array.isArray(value)) {
      return value.map((v) => (v === null ? '' : String(v))).join(', ');
    }
    return '';
  };

  // Summary line for a datagrid value ("3 rows × 2 columns"), or null when unset
  const datagridSummary = (value: unknown): string | null => {
    const grid = coerceDatagridValue(value);
    if (grid) {
      const shape = datagridShape(grid);
      return `${shape.rows} row${shape.rows === 1 ? '' : 's'} × ${shape.cols} column${shape.cols === 1 ? '' : 's'}`;
    }
    if (typeof value === 'string' && value.trim()) return 'Unrecognized value';
    return null;
  };

  const renderDatagridField = (param: StepParameter) => {
    const value = values[param.name];
    const summary = datagridSummary(value);

    return (
      <div className="datagrid-input-field">
        <span className={`datagrid-input-field__summary ${summary ? '' : 'datagrid-input-field__summary--empty'}`}>
          {summary ?? 'No grid defined'}
        </span>
        <div className="datagrid-input-field__buttons">
          <Button
            variant="secondary"
            size="small"
            onClick={() => setEditingGridParam(param.name)}
            disabled={disabled}
          >
            {summary ? 'Edit grid…' : 'Create grid…'}
          </Button>
          {summary && (
            <Button
              variant="tertiary"
              size="small"
              onClick={() => handleChange(param.name, null)}
              disabled={disabled}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderInput = (param: StepParameter) => {
    const { name, type, size, dim } = param;
    const value = values[name];
    const inputId = `input-${name}`;

    if (datagridParams?.[name]) {
      return renderDatagridField(param);
    }

    switch (type) {
      case 'decimal':
        return (
          <DecimalInput
            id={inputId}
            value={value}
            onChange={(num) => handleChange(name, num)}
            disabled={disabled}
            placeholder="Enter decimal value"
          />
        );

      case 'integer':
      case 'bigint':
        return (
          <input
            id={inputId}
            type="number"
            step="1"
            className="sas-input"
            value={value !== null && value !== undefined ? String(value) : ''}
            onChange={(e) => {
              const val = e.target.value;
              handleChange(name, val === '' ? null : parseInt(val, 10));
            }}
            disabled={disabled}
            placeholder="Enter integer value"
          />
        );

      case 'string':
        return (
          <input
            id={inputId}
            type="text"
            className="sas-input"
            value={value !== null && value !== undefined ? String(value) : ''}
            onChange={(e) => handleChange(name, e.target.value || null)}
            maxLength={size}
            disabled={disabled}
            placeholder={`Enter text${size ? ` (max ${size} chars)` : ''}`}
          />
        );

      case 'binary':
        return (
          <textarea
            id={inputId}
            className="sas-textarea"
            value={value !== null && value !== undefined ? String(value) : ''}
            onChange={(e) => handleChange(name, e.target.value || null)}
            disabled={disabled}
            placeholder="Enter base64 encoded binary data"
            rows={3}
          />
        );

      case 'decimalArray':
      case 'integerArray':
      case 'bigintArray':
      case 'stringArray':
      case 'binaryArray':
        return (
          <textarea
            id={inputId}
            className="sas-textarea"
            value={formatArrayValue(value)}
            onChange={(e) => {
              const rawValue = e.target.value;
              if (rawValue.trim() === '') {
                handleChange(name, []);
              } else {
                handleChange(name, parseArrayValue(rawValue, type));
              }
            }}
            disabled={disabled}
            placeholder={`Enter ${dim || 'multiple'} comma-separated values`}
            rows={3}
          />
        );

      default:
        return (
          <input
            id={inputId}
            type="text"
            className="sas-input"
            value={value !== null && value !== undefined ? String(value) : ''}
            onChange={(e) => handleChange(name, e.target.value || null)}
            disabled={disabled}
          />
        );
    }
  };

  const isArrayType = (type: StepParameterType): boolean => {
    return type.endsWith('Array');
  };

  return (
    <form className="input-form" onSubmit={(e) => e.preventDefault()}>
      {parameters.length === 0 ? (
        <p className="input-form__empty">This step has no input parameters.</p>
      ) : (
        <div className="input-form__grid">
          {parameters.map((param) => (
            <div
              key={param.name}
              className={`input-form__group ${
                isArrayType(param.type) ? 'input-form__group--full' : ''
              }`}
            >
              <label htmlFor={`input-${param.name}`} className="input-form__label">
                <span className="input-form__label-text">{param.name}</span>
                <TypeBadge type={datagridParams?.[param.name] ? 'dataGrid' : param.type} />
              </label>
              {renderInput(param)}
              {datagridParams?.[param.name] ? (
                datagridParams[param.name].maxRows !== null && (
                  <span className="input-form__hint">
                    Max rows: {datagridParams[param.name].maxRows}
                  </span>
                )
              ) : (
                param.type === 'string' && param.size && (
                  <span className="input-form__hint">Max length: {param.size}</span>
                )
              )}
            </div>
          ))}
        </div>
      )}
      {editingGridParam && datagridParams?.[editingGridParam] && (
        <DataGridInputModal
          paramName={editingGridParam}
          schema={datagridParams[editingGridParam]}
          value={values[editingGridParam]}
          onApply={(gridValue) => {
            handleChange(editingGridParam, gridValue);
            setEditingGridParam(null);
          }}
          onClose={() => setEditingGridParam(null)}
        />
      )}
    </form>
  );
};

export default InputForm;
