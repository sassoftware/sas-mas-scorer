// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { PageHeader } from '../layout/Layout';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Alert } from '../common/Alert';
import { VariableTable } from './VariableTable';
import { CodeOutput } from './CodeOutput';
import { DataGridOutputNotes } from './DataGridOutputNotes';
import { parseInput, defaultLength } from '../../utils/schemaParser';
import { generatePythonCode, buildCodeFileSignature } from '../../utils/schemaCodegen';
import type { VariableMapping, InputFormat, SasDataType } from '../../types/schemaBuilder';

type Step = 'input' | 'variables' | 'output';

interface SchemaBuilderProps {
  onBack?: () => void;
}

export const SchemaBuilder: React.FC<SchemaBuilderProps> = () => {
  const [inputText, setInputText] = useState('');
  const [inputVarName, setInputVarName] = useState('input_string');
  const [mappings, setMappings] = useState<VariableMapping[]>([]);
  const [format, setFormat] = useState<InputFormat>('unknown');
  const [pythonCode, setPythonCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<Step>('input');
  // When true, unset output variables default to missing values (None) instead
  // of 0/''. Off by default to preserve the original behavior.
  const [missingDefaults, setMissingDefaults] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const doParse = useCallback((text: string) => {
    try {
      setError(null);
      const result = parseInput(text);
      setFormat(result.format);
      setMappings(result.mappings);
      setPythonCode(generatePythonCode(result.mappings, result.format, inputVarName, missingDefaults));
      setActiveStep('variables');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse input');
    }
  }, [inputVarName, missingDefaults]);

  const handleParse = useCallback(() => doParse(inputText), [doParse, inputText]);

  const handleMappingChange = useCallback(
    (index: number, field: 'variableName' | 'dataType' | 'length', value: string) => {
      setMappings(prev => {
        const updated = [...prev];
        const current = updated[index];
        if (field === 'variableName') {
          updated[index] = { ...current, variableName: value };
        } else if (field === 'length') {
          const n = parseInt(value, 10);
          updated[index] = { ...current, length: Number.isFinite(n) && n > 0 ? n : undefined };
        } else {
          const dataType = value as SasDataType;
          // When switching to/among string-like types, seed a sensible default
          // length if one isn't set; clear it for numeric/boolean/datagrid.
          const nextLength = defaultLength(dataType, current.sampleValue);
          updated[index] = {
            ...current,
            dataType,
            length: nextLength === undefined ? undefined : (current.length ?? nextLength),
          };
        }
        return updated;
      });
    },
    [],
  );

  const handleDeleteMapping = useCallback((index: number) => {
    setMappings(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleGenerate = useCallback(() => {
    setPythonCode(generatePythonCode(mappings, format, inputVarName, missingDefaults));
    setActiveStep('output');
  }, [mappings, format, inputVarName, missingDefaults]);

  // Toggling the missing-default option regenerates the code in place so the
  // output screen reflects the choice immediately.
  const handleToggleMissingDefaults = useCallback((checked: boolean) => {
    setMissingDefaults(checked);
    setPythonCode(generatePythonCode(mappings, format, inputVarName, checked));
  }, [mappings, format, inputVarName]);

  // The code file signature (input + output terms, with lengths) sent on save.
  const signature = useMemo(
    () => buildCodeFileSignature(mappings, inputVarName),
    [mappings, inputVarName],
  );

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setInputText(reader.result);
        doParse(reader.result);
      }
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsText(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  }, [doParse]);

  return (
    <div className="schema-builder">
      <PageHeader
        title="Schema → Code"
        subtitle="Paste an XML or JSON sample to generate a Python execute() function that destructures a string input into SAS Intelligent Decisioning variables — then save it to SAS Viya."
      />

      <nav className="schema-builder__steps">
        <button
          className={`schema-builder__step${activeStep === 'input' ? ' schema-builder__step--active' : ''}`}
          onClick={() => setActiveStep('input')}
          type="button"
        >
          1. Input Schema
        </button>
        <button
          className={`schema-builder__step${activeStep === 'variables' ? ' schema-builder__step--active' : ''}`}
          onClick={() => setActiveStep('variables')}
          disabled={mappings.length === 0}
          type="button"
        >
          2. Variable Mapping ({mappings.length})
        </button>
        <button
          className={`schema-builder__step${activeStep === 'output' ? ' schema-builder__step--active' : ''}`}
          onClick={() => setActiveStep('output')}
          disabled={!pythonCode}
          type="button"
        >
          3. Python Output
        </button>
      </nav>

      {error && (
        <Alert variant="error" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {activeStep === 'input' && (
        <div className="schema-builder__panel">
          <div className="schema-builder__input-toolbar">
            <div className="schema-builder__field schema-builder__field--inline">
              <label htmlFor="sb-input-var">Input variable name</label>
              <input
                id="sb-input-var"
                type="text"
                value={inputVarName}
                onChange={e => setInputVarName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
                maxLength={32}
                className="schema-builder__input schema-builder__input--mono"
              />
              <span className="schema-builder__hint">The SAS ID Character variable holding the raw string</span>
            </div>
            <div className="schema-builder__sample-buttons">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.xml,.txt"
                onChange={handleFileUpload}
                hidden
              />
              <Button variant="secondary" size="small" onClick={() => fileInputRef.current?.click()}>
                Upload file
              </Button>
            </div>
          </div>
          <textarea
            className="schema-builder__schema-input"
            placeholder="Paste your XML or JSON sample here..."
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            spellCheck={false}
          />
          <div className="schema-builder__panel-actions">
            <Button variant="primary" onClick={handleParse} disabled={!inputText.trim()}>
              Parse &amp; extract variables
            </Button>
          </div>
        </div>
      )}

      {activeStep === 'variables' && (
        <div className="schema-builder__panel">
          <div className="schema-builder__panel-header">
            <div className="schema-builder__panel-header-left">
              <Badge>{format.toUpperCase()}</Badge>
              <span className="schema-builder__count">{mappings.length} variables detected</span>
            </div>
            <div className="schema-builder__panel-header-right">
              <Button variant="secondary" size="small" onClick={() => setActiveStep('input')}>
                Back to input
              </Button>
              <Button variant="primary" size="small" onClick={handleGenerate}>
                Generate Python code
              </Button>
            </div>
          </div>
          <VariableTable
            mappings={mappings}
            onChange={handleMappingChange}
            onDelete={handleDeleteMapping}
          />
        </div>
      )}

      {activeStep === 'output' && (
        <div className="schema-builder__panel">
          <div className="schema-builder__panel-header">
            <div className="schema-builder__panel-header-left">
              <span className="schema-builder__count">Generated Python code for SAS Intelligent Decisioning</span>
            </div>
            <div className="schema-builder__panel-header-right">
              <label className="schema-builder__missing-toggle" title="Initialize unset output variables to a SAS missing value (None) instead of 0 / empty string">
                <input
                  type="checkbox"
                  checked={missingDefaults}
                  onChange={e => handleToggleMissingDefaults(e.target.checked)}
                />
                Default unset variables to missing values
              </label>
              <Button variant="secondary" size="small" onClick={() => setActiveStep('variables')}>
                Back to variables
              </Button>
            </div>
          </div>
          <DataGridOutputNotes mappings={mappings} />
          <CodeOutput code={pythonCode} signature={signature} exampleInput={inputText} />
        </div>
      )}

      <div className="schema-builder__legend">
        <strong>SAS ID Types:</strong>
        <span className="schema-builder__type-chip schema-builder__type--character">Character</span>
        <span className="schema-builder__type-chip schema-builder__type--integer">Integer</span>
        <span className="schema-builder__type-chip schema-builder__type--decimal">Decimal</span>
        <span className="schema-builder__type-chip schema-builder__type--boolean">Boolean</span>
        <span className="schema-builder__type-chip schema-builder__type--date">Date</span>
        <span className="schema-builder__type-chip schema-builder__type--datetime">Datetime</span>
        <span className="schema-builder__type-chip schema-builder__type--datagrid">DataGrid</span>
      </div>
    </div>
  );
};

export default SchemaBuilder;
