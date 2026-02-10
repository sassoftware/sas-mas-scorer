// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useCallback } from 'react';
import { Module, Step, ModuleSource, StepOutput } from '../../types';
import { Card, CardHeader, CardBody, CardFooter } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { TypeBadge } from '../common/Badge';
import { Loading } from '../common/Loading';
import { PageHeader } from '../layout/Layout';
import { InputForm } from './InputForm';
import { OutputDisplay } from './OutputDisplay';
import { CsvUpload } from './CsvUpload';
import { BatchResults } from './BatchResults';
import { useStepExecution } from '../../hooks';
import { getModuleSource, executeStep, buildStepInput, getSasViyaUrl } from '../../api';

interface ScorePanelProps {
  module: Module;
  step: Step;
  onBack: () => void;
  onSelectAnotherStep: () => void;
}

type ExecutionMode = 'single' | 'batch';

interface BatchResult {
  rowIndex: number;
  input: Record<string, unknown>;
  output: StepOutput | null;
  error: string | null;
  executionTime: number; // in milliseconds
}

interface BatchStats {
  totalRuntime: number;
  avgRequestTime: number;
  successRate: number;
  fastestResponse: number;
  slowestResponse: number;
  medianResponse: number;
  totalRequests: number;
  successCount: number;
  errorCount: number;
}

export const ScorePanel: React.FC<ScorePanelProps> = ({
  module,
  step,
  onBack,
  onSelectAnotherStep,
}) => {
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [showSource, setShowSource] = useState(false);
  const [sourceData, setSourceData] = useState<ModuleSource | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [showApiCall, setShowApiCall] = useState(false);
  const [apiCodeLanguage, setApiCodeLanguage] = useState<'python' | 'javascript'>('python');

  // Batch execution state
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('single');
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [batchExecuting, setBatchExecuting] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchStats, setBatchStats] = useState<BatchStats | null>(null);

  const { output, executing, error, executionTime, executeWithValues, reset } =
    useStepExecution(module.id, step.id);

  const handleExecute = useCallback(async () => {
    try {
      await executeWithValues(step, inputValues);
    } catch (err) {
      // Error is handled by the hook
    }
  }, [step, inputValues, executeWithValues]);

  const handleReset = useCallback(() => {
    setInputValues({});
    reset();
  }, [reset]);

  const handleClearOutputs = useCallback(() => {
    reset();
  }, [reset]);

  // Toggle source code view
  const handleToggleSource = useCallback(async () => {
    if (showSource) {
      setShowSource(false);
      return;
    }

    // Fetch source if not already loaded
    if (!sourceData) {
      setLoadingSource(true);
      setSourceError(null);
      try {
        const source = await getModuleSource(module.id);
        setSourceData(source);
      } catch (err) {
        setSourceError(err instanceof Error ? err.message : 'Failed to load source code');
      } finally {
        setLoadingSource(false);
      }
    }
    setShowSource(true);
  }, [showSource, sourceData, module.id]);

  // Pre-fill with sample values based on type
  const handleAutoFill = useCallback(() => {
    const sampleValues: Record<string, unknown> = {};

    (step.inputs ?? []).forEach((param) => {
      switch (param.type) {
        case 'decimal':
          sampleValues[param.name] = 0.0;
          break;
        case 'integer':
        case 'bigint':
          sampleValues[param.name] = 0;
          break;
        case 'string':
          sampleValues[param.name] = '';
          break;
        case 'decimalArray':
          sampleValues[param.name] = param.dim ? Array(param.dim).fill(0.0) : [0.0];
          break;
        case 'integerArray':
        case 'bigintArray':
          sampleValues[param.name] = param.dim ? Array(param.dim).fill(0) : [0];
          break;
        case 'stringArray':
          sampleValues[param.name] = param.dim ? Array(param.dim).fill('') : [''];
          break;
        default:
          sampleValues[param.name] = null;
      }
    });

    setInputValues(sampleValues);
  }, [step.inputs]);

  // Execute a single row and return the result
  const executeRow = useCallback(async (
    rowIndex: number,
    input: Record<string, unknown>
  ): Promise<BatchResult> => {
    const requestStartTime = performance.now();

    try {
      const stepInput = buildStepInput(step, input);
      const output = await executeStep(module.id, step.id, stepInput);
      const requestEndTime = performance.now();
      return {
        rowIndex,
        input,
        output,
        error: null,
        executionTime: requestEndTime - requestStartTime,
      };
    } catch (err) {
      const requestEndTime = performance.now();
      return {
        rowIndex,
        input,
        output: null,
        error: err instanceof Error ? err.message : 'Unknown error',
        executionTime: requestEndTime - requestStartTime,
      };
    }
  }, [module.id, step]);

  // Batch execution handler with configurable concurrency
  const handleBatchExecute = useCallback(async (rows: Record<string, unknown>[], concurrency: number) => {
    setBatchExecuting(true);
    setBatchProgress({ current: 0, total: rows.length });
    setBatchResults([]);
    setBatchStats(null);

    const results: BatchResult[] = new Array(rows.length);
    let completedCount = 0;
    const batchStartTime = performance.now();

    // Process rows with concurrency limit
    const processWithConcurrency = async () => {
      let currentIndex = 0;

      const processNext = async (): Promise<void> => {
        while (currentIndex < rows.length) {
          const index = currentIndex++;
          const input = rows[index];

          const result = await executeRow(index, input);
          results[index] = result;
          completedCount++;

          // Update progress
          setBatchProgress({ current: completedCount, total: rows.length });

          // Update results (sorted by rowIndex for consistent display)
          const currentResults = results.filter(r => r !== undefined);
          setBatchResults([...currentResults].sort((a, b) => a.rowIndex - b.rowIndex));
        }
      };

      // Start concurrent workers
      const workers = Array(Math.min(concurrency, rows.length))
        .fill(null)
        .map(() => processNext());

      await Promise.all(workers);
    };

    await processWithConcurrency();

    const batchEndTime = performance.now();
    const totalRuntime = batchEndTime - batchStartTime;

    // Sort final results by row index
    const sortedResults = [...results].sort((a, b) => a.rowIndex - b.rowIndex);
    setBatchResults(sortedResults);

    // Calculate statistics
    const executionTimes = sortedResults.map(r => r.executionTime);
    const sortedTimes = [...executionTimes].sort((a, b) => a - b);
    const successCount = sortedResults.filter(r => r.output && !r.error).length;
    const errorCount = sortedResults.filter(r => r.error).length;

    const stats: BatchStats = {
      totalRuntime,
      avgRequestTime: executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length,
      successRate: (successCount / sortedResults.length) * 100,
      fastestResponse: Math.min(...executionTimes),
      slowestResponse: Math.max(...executionTimes),
      medianResponse: sortedTimes.length % 2 === 0
        ? (sortedTimes[sortedTimes.length / 2 - 1] + sortedTimes[sortedTimes.length / 2]) / 2
        : sortedTimes[Math.floor(sortedTimes.length / 2)],
      totalRequests: sortedResults.length,
      successCount,
      errorCount,
    };

    setBatchStats(stats);
    setBatchExecuting(false);
  }, [executeRow]);

  // Clear batch results
  const handleClearBatchResults = useCallback(() => {
    setBatchResults([]);
    setBatchStats(null);
  }, []);

  // Generate API call code examples
  const generateApiCode = useCallback(() => {
    const baseUrl = getSasViyaUrl();
    const endpoint = `/microanalyticScore/modules/${module.id}/steps/${step.id}`;

    // Build sample input body
    const sampleInputs = (step.inputs ?? []).map(param => {
      let sampleValue: unknown;
      switch (param.type) {
        case 'decimal':
          sampleValue = 0.0;
          break;
        case 'integer':
        case 'bigint':
          sampleValue = 0;
          break;
        case 'string':
          sampleValue = '';
          break;
        case 'decimalArray':
        case 'integerArray':
        case 'bigintArray':
          sampleValue = param.dim ? Array(param.dim).fill(0) : [0];
          break;
        case 'stringArray':
          sampleValue = param.dim ? Array(param.dim).fill('') : [''];
          break;
        default:
          sampleValue = null;
      }
      return { name: param.name, value: sampleValue };
    });

    const requestBody = {
      inputs: sampleInputs,
      version: 1
    };

    const pythonCode = `import requests

# API endpoint
url = "${baseUrl}${endpoint}"

# Request headers
headers = {
    "Authorization": "Bearer YOUR_ACCESS_TOKEN",
    "Content-Type": "application/vnd.sas.microanalytic.module.step.input+json",
    "Accept": "application/vnd.sas.microanalytic.module.step.output+json"
}

# Request body
payload = ${JSON.stringify(requestBody, null, 4).replace(/"/g, '"').split('\n').map((line, i) => i === 0 ? line : '    ' + line.trim()).join('\n')}

# Make the request
response = requests.post(url, json=payload, headers=headers)

# Parse response
if response.status_code == 200:
    result = response.json()
    print("Outputs:", result.get("outputs", []))
else:
    print(f"Error: {response.status_code}")
    print(response.text)`;

    const javascriptCode = `// API endpoint
const url = "${baseUrl}${endpoint}";

// Request body
const payload = ${JSON.stringify(requestBody, null, 2)};

// Make the request
fetch(url, {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_ACCESS_TOKEN",
    "Content-Type": "application/vnd.sas.microanalytic.module.step.input+json",
    "Accept": "application/vnd.sas.microanalytic.module.step.output+json"
  },
  body: JSON.stringify(payload)
})
  .then(response => {
    if (!response.ok) {
      throw new Error(\`HTTP error! status: \${response.status}\`);
    }
    return response.json();
  })
  .then(result => {
    console.log("Outputs:", result.outputs);
  })
  .catch(error => {
    console.error("Error:", error);
  });`;

    return { pythonCode, javascriptCode };
  }, [module.id, step.id, step.inputs]);

  // Download batch results as CSV
  const handleDownloadResults = useCallback(() => {
    if (batchResults.length === 0) return;

    // Get all output parameter names
    const outputParams = batchResults.find(r => r.output)?.output?.outputs?.map(o => o.name) ?? [];
    const inputParams = Object.keys(batchResults[0]?.input ?? {});

    // Build CSV header
    const headers = ['Row', 'Status', ...inputParams.map(p => `Input_${p}`), ...outputParams.map(p => `Output_${p}`), 'Error'];

    // Build CSV rows
    const csvRows = batchResults.map(result => {
      const row: string[] = [
        String(result.rowIndex + 1),
        result.error ? 'Failed' : (result.output?.executionState ?? 'Unknown'),
      ];

      // Add input values
      inputParams.forEach(param => {
        const value = result.input[param];
        row.push(value === null || value === undefined ? '' : String(value));
      });

      // Add output values
      outputParams.forEach(param => {
        const outputVar = result.output?.outputs?.find(o => o.name === param);
        const value = outputVar?.value;
        row.push(value === null || value === undefined ? '' : String(value));
      });

      // Add error
      row.push(result.error ?? '');

      return row;
    });

    // Create CSV content
    const csvContent = [
      headers.join(','),
      ...csvRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${module.name}_${step.id}_results.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [batchResults, module.name, step.id]);

  return (
    <div className="score-panel">
      <PageHeader
        title={`Execute: ${step.id}`}
        subtitle={`Module: ${module.name}`}
        breadcrumbs={[
          { label: 'Modules', onClick: onBack },
          { label: module.name, onClick: onSelectAnotherStep },
          { label: step.id },
        ]}
        actions={
          <div className="score-panel__header-actions">
            <Button
              variant="secondary"
              onClick={handleToggleSource}
              loading={loadingSource}
            >
              {showSource ? 'Hide Source' : 'View Source'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShowApiCall(!showApiCall)}
            >
              {showApiCall ? 'Hide API Call' : 'View API Call'}
            </Button>
            <Button variant="tertiary" onClick={onSelectAnotherStep}>
              Select Different Step
            </Button>
          </div>
        }
      />

      {/* Source Code Section */}
      {showSource && (
        <Card className="score-panel__source-card">
          <CardHeader
            actions={
              <Button variant="tertiary" size="small" onClick={() => setShowSource(false)}>
                Close
              </Button>
            }
          >
            <h3>Module Source Code</h3>
          </CardHeader>
          <CardBody>
            {loadingSource ? (
              <Loading message="Loading source code..." />
            ) : sourceError ? (
              <Alert variant="error" title="Error loading source">
                {sourceError}
              </Alert>
            ) : sourceData ? (
              <pre className="score-panel__source-code">
                <code>{sourceData.source}</code>
              </pre>
            ) : null}
          </CardBody>
        </Card>
      )}

      {/* API Call Code Section */}
      {showApiCall && (
        <Card className="score-panel__api-card">
          <CardHeader
            actions={
              <div className="score-panel__api-actions">
                <div className="score-panel__language-toggle">
                  <Button
                    variant={apiCodeLanguage === 'python' ? 'primary' : 'tertiary'}
                    size="small"
                    onClick={() => setApiCodeLanguage('python')}
                  >
                    Python
                  </Button>
                  <Button
                    variant={apiCodeLanguage === 'javascript' ? 'primary' : 'tertiary'}
                    size="small"
                    onClick={() => setApiCodeLanguage('javascript')}
                  >
                    JavaScript
                  </Button>
                </div>
                <Button
                  variant="tertiary"
                  size="small"
                  onClick={() => {
                    const { pythonCode, javascriptCode } = generateApiCode();
                    const code = apiCodeLanguage === 'python' ? pythonCode : javascriptCode;
                    navigator.clipboard.writeText(code);
                  }}
                >
                  Copy Code
                </Button>
                <Button variant="tertiary" size="small" onClick={() => setShowApiCall(false)}>
                  Close
                </Button>
              </div>
            }
          >
            <h3>API Call Example</h3>
          </CardHeader>
          <CardBody>
            <pre className="score-panel__source-code">
              <code>
                {apiCodeLanguage === 'python'
                  ? generateApiCode().pythonCode
                  : generateApiCode().javascriptCode}
              </code>
            </pre>
          </CardBody>
        </Card>
      )}

      {/* Mode Toggle */}
      <div className="score-panel__mode-toggle">
        <Button
          variant={executionMode === 'single' ? 'primary' : 'tertiary'}
          onClick={() => setExecutionMode('single')}
        >
          Single Execution
        </Button>
        <Button
          variant={executionMode === 'batch' ? 'primary' : 'tertiary'}
          onClick={() => setExecutionMode('batch')}
        >
          Batch (CSV Upload)
        </Button>
      </div>

      <div className="score-panel__content">
        <div className="score-panel__grid">
          {/* Step Info */}
          <Card className="score-panel__info-card">
            <CardHeader>
              <h3>Step Information</h3>
            </CardHeader>
            <CardBody>
              <div className="score-panel__step-info">
                <div className="score-panel__step-stats">
                  <div className="score-panel__stat">
                    <span className="score-panel__stat-value">{step.inputs?.length ?? 0}</span>
                    <span className="score-panel__stat-label">Inputs</span>
                  </div>
                  <div className="score-panel__stat">
                    <span className="score-panel__stat-value">{step.outputs?.length ?? 0}</span>
                    <span className="score-panel__stat-label">Outputs</span>
                  </div>
                </div>
                {step.description && (
                  <p className="score-panel__step-description">{step.description}</p>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Output Signature */}
          <Card className="score-panel__signature-card">
            <CardHeader>
              <h3>Output Signature</h3>
            </CardHeader>
            <CardBody>
              {(step.outputs?.length ?? 0) === 0 ? (
                <p className="score-panel__no-outputs">This step produces no outputs.</p>
              ) : (
                <ul className="score-panel__output-list">
                  {(step.outputs ?? []).map((param) => (
                    <li key={param.name} className="score-panel__output-item">
                      <span className="score-panel__output-name">{param.name}</span>
                      <TypeBadge type={param.type} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Single Execution Mode */}
        {executionMode === 'single' && (
          <>
            <Card className="score-panel__input-card">
              <CardHeader
                actions={
                  <div className="score-panel__input-actions">
                    <Button variant="tertiary" size="small" onClick={handleAutoFill}>
                      Auto-fill Defaults
                    </Button>
                    <Button variant="tertiary" size="small" onClick={handleReset}>
                      Clear All
                    </Button>
                  </div>
                }
              >
                <h3>Input Parameters ({step.inputs?.length ?? 0})</h3>
              </CardHeader>
              <CardBody>
                <InputForm
                  parameters={step.inputs ?? []}
                  values={inputValues}
                  onChange={setInputValues}
                  disabled={executing}
                />
              </CardBody>
              <CardFooter>
                <Button
                  variant="primary"
                  size="large"
                  onClick={handleExecute}
                  loading={executing}
                  disabled={executing}
                >
                  {executing ? 'Executing...' : 'Execute Score'}
                </Button>
              </CardFooter>
            </Card>
          </>
        )}

        {/* Batch Execution Mode */}
        {executionMode === 'batch' && (
          <>
            <CsvUpload
              parameters={step.inputs ?? []}
              onExecuteBatch={handleBatchExecute}
              executing={batchExecuting}
            />

            {/* Batch Progress */}
            {batchExecuting && (
              <Card className="score-panel__progress-card">
                <CardBody>
                  <div className="score-panel__progress">
                    <Loading message={`Processing row ${batchProgress.current} of ${batchProgress.total}...`} />
                    <div className="score-panel__progress-bar">
                      <div
                        className="score-panel__progress-fill"
                        style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                </CardBody>
              </Card>
            )}

            {/* Batch Results */}
            {batchResults.length > 0 && !batchExecuting && (
              <BatchResults
                results={batchResults}
                parameters={step.outputs ?? []}
                stats={batchStats}
                onClear={handleClearBatchResults}
                onDownload={handleDownloadResults}
              />
            )}
          </>
        )}

        {/* Error Display */}
        {error && (
          <Alert variant="error" title="Execution Error" dismissible onClose={reset}>
            {error}
          </Alert>
        )}

        {/* Output Display */}
        {output && (
          <div className="score-panel__output-section">
            <div className="score-panel__output-header">
              <h3>Results</h3>
              <Button variant="tertiary" size="small" onClick={handleClearOutputs}>
                Clear Results
              </Button>
            </div>
            <OutputDisplay
              output={output}
              parameters={step.outputs ?? []}
              executionTime={executionTime}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default ScorePanel;
