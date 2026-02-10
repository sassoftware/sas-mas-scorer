// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { StepParameter, StepParameterType } from '../../types';
import { TypeBadge } from '../common/Badge';

interface InputFormProps {
  parameters: StepParameter[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}

export const InputForm: React.FC<InputFormProps> = ({
  parameters,
  values,
  onChange,
  disabled = false,
}) => {
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

  const renderInput = (param: StepParameter) => {
    const { name, type, size, dim } = param;
    const value = values[name];
    const inputId = `input-${name}`;

    switch (type) {
      case 'decimal':
        return (
          <input
            id={inputId}
            type="number"
            step="any"
            className="sas-input"
            value={value !== null && value !== undefined ? String(value) : ''}
            onChange={(e) => {
              const val = e.target.value;
              handleChange(name, val === '' ? null : parseFloat(val));
            }}
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
                <TypeBadge type={param.type} />
              </label>
              {renderInput(param)}
              {param.type === 'string' && param.size && (
                <span className="input-form__hint">Max length: {param.size}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </form>
  );
};

export default InputForm;
