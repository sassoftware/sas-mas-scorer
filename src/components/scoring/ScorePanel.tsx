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
  const [apiCodeLanguage, setApiCodeLanguage] = useState<'python' | 'javascript' | 'sas'>('python');
  const [apiCodeMode, setApiCodeMode] = useState<'single' | 'parallel'>('single');

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
  const generateApiCode = useCallback((mode: 'single' | 'parallel') => {
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

    // Build proc json write statements for each input (used by SAS single)
    const procJsonInputs = sampleInputs.map(input => {
      const lines: string[] = [];
      lines.push('            write open object;');
      lines.push(`                write values 'name' '${input.name}';`);
      if (typeof input.value === 'string') {
        lines.push(`                write values 'value' '${input.value}';`);
      } else if (Array.isArray(input.value)) {
        lines.push("                write values 'value';");
        lines.push('                write open array;');
        for (const v of input.value) {
          lines.push(`                    write values ${typeof v === 'string' ? `'${v}'` : v};`);
        }
        lines.push('                write close;');
      } else {
        lines.push(`                write values 'value' ${input.value};`);
      }
      lines.push('            write close;');
      return lines.join('\n');
    }).join('\n');

    // --- SINGLE MODE ---
    if (mode === 'single') {
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

      const sasCode = `* Get the Viya Host URL;
%let viyaHost=%sysfunc(getoption(SERVICESBASEURL));
* Module Name and Step endpoint;
%let moduleAndStepEndpoint = ${endpoint};

* Creating the row to be scored;
filename modIn temp;

proc json out=modIn pretty;
    write open object;
        write values 'inputs';
        write open array;
${procJsonInputs}
        write close;
    write close;
quit;

* Capture the output;
filename modOut temp;

* https://developer.sas.com/rest-apis/microanalyticScore/createStepExecution;
proc http url = "&viyaHost.&moduleAndStepEndpoint."
    method = 'Post'
    in = modIn
    out = modOut
    ct = 'application/json'
    oauth_bearer = sas_services;
    headers 'Accept'='application/json';
run;

%if &SYS_PROCHTTP_STATUS_CODE. NE 201 %then %do;
    %put ERROR: The row could not be scored. The API responded with &SYS_PROCHTTP_STATUS_CODE.: &SYS_PROCHTTP_STATUS_PHRASE.;
%end;

libname modOut json;

title "Output from scoring &moduleAndStepEndpoint.";
proc print data=modOut.outputs(drop=ordinal_root ordinal_outputs);
quit;
title;`;

      return { pythonCode, javascriptCode, sasCode };
    }

    // --- Helper: Build input names/types for parallel ---
    const inputParamNames = (step.inputs ?? []).map(p => p.name);

    // --- PARALLEL MODE ---
    const pythonCode = `import requests
import csv
from concurrent.futures import ThreadPoolExecutor, as_completed

# API endpoint
url = "${baseUrl}${endpoint}"

# Request headers
headers = {
    "Authorization": "Bearer YOUR_ACCESS_TOKEN",
    "Content-Type": "application/vnd.sas.microanalytic.module.step.input+json",
    "Accept": "application/vnd.sas.microanalytic.module.step.output+json"
}

# Number of parallel threads
n_threads = 4

# Read input data from CSV
# Expected columns: ${inputParamNames.join(', ')}
input_rows = []
with open("input_data.csv", "r") as f:
    reader = csv.DictReader(f)
    for row in reader:
        input_rows.append(row)

print(f"Scoring {len(input_rows)} rows with {n_threads} parallel threads...")

def score_row(index, row):
    """Score a single row and return the result."""
    payload = {
        "inputs": [${sampleInputs.map(inp => {
          const param = (step.inputs ?? []).find(p => p.name === inp.name);
          const isNumeric = param && ['decimal', 'integer', 'bigint'].includes(param.type);
          return `{"name": "${inp.name}", "value": ${isNumeric ? `float(row["${inp.name}"])` : `row["${inp.name}"]`}}`;
        }).join(',\n                   ')}],
        "version": 1
    }

    response = requests.post(url, json=payload, headers=headers)

    if response.status_code == 200:
        result = response.json()
        outputs = {o["name"]: o["value"] for o in result.get("outputs", [])}
        return {"row": index + 1, "status": "success", **outputs}
    else:
        return {"row": index + 1, "status": "error", "error": response.text}

# Execute in parallel using ThreadPoolExecutor
results = [None] * len(input_rows)
completed = 0

with ThreadPoolExecutor(max_workers=n_threads) as executor:
    futures = {
        executor.submit(score_row, i, row): i
        for i, row in enumerate(input_rows)
    }

    for future in as_completed(futures):
        idx = futures[future]
        results[idx] = future.result()
        completed += 1
        if completed % 10 == 0:
            print(f"  Completed {completed}/{len(input_rows)}")

results = [r for r in results if r is not None]
print(f"Done. {sum(1 for r in results if r['status'] == 'success')}/{len(results)} succeeded.")

# Write results to CSV
if results:
    with open("output_results.csv", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=results[0].keys())
        writer.writeheader()
        writer.writerows(results)
    print("Results saved to output_results.csv")`;

    const javascriptCode = `import { readFileSync, writeFileSync } from "fs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

// API endpoint
const url = "${baseUrl}${endpoint}";

// Request headers
const headers = {
  "Authorization": "Bearer YOUR_ACCESS_TOKEN",
  "Content-Type": "application/vnd.sas.microanalytic.module.step.input+json",
  "Accept": "application/vnd.sas.microanalytic.module.step.output+json"
};

// Number of parallel requests
const nThreads = 4;

// Read input data from CSV
// Expected columns: ${inputParamNames.join(', ')}
const csvContent = readFileSync("input_data.csv", "utf-8");
const inputRows = parse(csvContent, { columns: true, skip_empty_lines: true });

console.log(\`Scoring \${inputRows.length} rows with \${nThreads} parallel workers...\`);

async function scoreRow(index, row) {
  const payload = {
    inputs: [${sampleInputs.map(inp => {
      const param = (step.inputs ?? []).find(p => p.name === inp.name);
      const isNumeric = param && ['decimal', 'integer', 'bigint'].includes(param.type);
      return `{ name: "${inp.name}", value: ${isNumeric ? `Number(row["${inp.name}"])` : `row["${inp.name}"]`} }`;
    }).join(',\n              ')}],
    version: 1
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  if (response.ok) {
    const result = await response.json();
    const outputs = Object.fromEntries(result.outputs.map(o => [o.name, o.value]));
    return { row: index + 1, status: "success", ...outputs };
  } else {
    return { row: index + 1, status: "error", error: await response.text() };
  }
}

// Parallel execution with concurrency limit
const results = new Array(inputRows.length);
let nextIndex = 0;
let completed = 0;

async function worker() {
  while (nextIndex < inputRows.length) {
    const i = nextIndex++;
    results[i] = await scoreRow(i, inputRows[i]);
    completed++;
    if (completed % 10 === 0) console.log(\`  Completed \${completed}/\${inputRows.length}\`);
  }
}

await Promise.all(Array.from({ length: Math.min(nThreads, inputRows.length) }, () => worker()));

console.log(\`Done. \${results.filter(r => r.status === "success").length}/\${results.length} succeeded.\`);

// Write results to CSV
writeFileSync("output_results.csv", stringify(results, { header: true }));
console.log("Results saved to output_results.csv");`;

    // SAS parallel: proc ds2 with threads and HTTP package

    // Build DS2 input column declarations
    const ds2InputDecls = (step.inputs ?? []).map(p => {
      const isNumeric = ['decimal', 'integer', 'bigint'].includes(p.type);
      return isNumeric ? `        dcl double ${p.name};` : `        dcl varchar(200) ${p.name};`;
    }).join('\n');

    // Build DS2 output column declarations from step outputs
    const ds2OutputDecls = (step.outputs ?? []).map(p => {
      const isNumeric = ['decimal', 'integer', 'bigint'].includes(p.type);
      return isNumeric ? `        dcl double out_${p.name};` : `        dcl varchar(2000) out_${p.name};`;
    }).join('\n');

    // Build sample data step lines for creating input data
    const sampleDataLines = (step.inputs ?? []).map(p => {
      const isNumeric = ['decimal', 'integer', 'bigint'].includes(p.type);
      if (isNumeric) {
        return `        ${p.name} = i;`;
      }
      return `        ${p.name} = cats('value_', i);`;
    }).join('\n');

    // Build input value assignments in thread (vary by row index i)
    const threadInputAssignments = (step.inputs ?? []).map(p => {
      const isNumeric = ['decimal', 'integer', 'bigint'].includes(p.type);
      if (isNumeric) {
        return `                ${p.name} = i;`;
      }
      return `                ${p.name} = cats('value_', i);`;
    }).join('\n');

    // Build JSON payload construction using cats()
    const jsonBuildLines = (step.inputs ?? []).map((p, idx) => {
      const isNumeric = ['decimal', 'integer', 'bigint'].includes(p.type);
      const comma = idx > 0 ? ',' : '';
      if (isNumeric) {
        return `                jsonPayload = cats(jsonPayload, '${comma}{"name":"${p.name}","value":', strip(put(${p.name}, best32.)), '}');`;
      }
      return `                jsonPayload = cats(jsonPayload, '${comma}{"name":"${p.name}","value":"', strip(${p.name}), '"}');`;
    }).join('\n');

    // Build JSON response parsing for output variables (use upcase for case-insensitive match)
    const ds2OutputParsing = (step.outputs ?? []).map((p, idx) => {
      const isNumeric = ['decimal', 'integer', 'bigint'].includes(p.type);
      const prefix = idx === 0 ? 'if' : 'else if';
      if (isNumeric) {
        return `                                    ${prefix} upcase(inName) = '${p.name.toUpperCase()}' then out_${p.name} = inputn(strip(token), 'best.');`;
      }
      return `                                    ${prefix} upcase(inName) = '${p.name.toUpperCase()}' then out_${p.name} = strip(token);`;
    }).join('\n');

    const sasCode = `* Macro variable containing the Viya Host name;
%let viyaHost = %sysfunc(getoption(SERVICESBASEURL));
* Module Name and Step endpoint;
%let moduleAndStepEndpoint = ${endpoint};
* Full scoring URL (resolved here so DS2 can use it as a string literal);
%let scoringUrl = &viyaHost.&moduleAndStepEndpoint.;

* Number of parallel threads;
%let n_threads = 4;

/*------------------------------------------------------------*/
/* Sample input data - replace with your own dataset          */
/*------------------------------------------------------------*/
data work.input_data;
    do i = 1 to 20;
${sampleDataLines}
        output;
    end;
    drop i;
run;

/* Count rows for the thread loop */
data _null_;
    set work.input_data nobs=n;
    call symputx('n_rows', n);
    stop;
run;

/*------------------------------------------------------------*/
/* Proc DS2: Parallel HTTP POST requests in Compute           */
/*                                                            */
/* NOTE: DS2 threads cannot read SAS work tables directly     */
/* when using nolibs + BASE driver. Instead, threads self-    */
/* assign rows via round-robin and compute input values.      */
/* Modify the input assignments below for your use case.      */
/*------------------------------------------------------------*/
proc ds2 nolibs
    conn="(driver=base; catalog=work;
           schema=(name=work; primarypath={%sysfunc(pathname(work))}))";

    /*--------------------------------------------------------*/
    /* THREAD: Each of the &n_threads threads self-assigns     */
    /* rows using round-robin on _threadid_.                   */
    /*--------------------------------------------------------*/
    thread work.score_thread / overwrite=yes;

        /* Input columns (echoed to output for traceability) */
${ds2InputDecls}

        /* Output columns */
${ds2OutputDecls}
        dcl double http_status;
        dcl double thread_id;
        dcl double row_id;

        /* Package declarations */
        dcl package http h();
        dcl package json j();

        /* Temp variables */
        dcl varchar(65000) response;
        dcl varchar(65000) jsonPayload;
        dcl int rc prc tokenType parseFlags;
        dcl nvarchar(32000) token;
        dcl varchar(512) url;
        dcl varchar(256) inName;
        dcl int i isInOutputs;

        drop response jsonPayload rc prc tokenType parseFlags token url inName i isInOutputs;

        method run();

            thread_id = _threadid_;
            url = %str(%')&scoringUrl.%str(%');

            /* Round-robin: this thread takes every &n_threads-th row */
            do i = _threadid_ to &n_rows by &n_threads;

                row_id = i;

                /*----------------------------------------------------*/
                /* Set input values for this row.                      */
                /* Replace these with your own per-row logic.          */
                /*----------------------------------------------------*/
${threadInputAssignments}

                /* Build JSON payload dynamically from input values */
                jsonPayload = '{"inputs":[';
${jsonBuildLines}
                jsonPayload = cats(jsonPayload, '],"version":1}');

                /* Make the POST request */
                h.createPostMethod(url);
                h.setRequestContentType('application/json');
                h.addSASoAuthToken();
                h.setRequestBodyAsString(jsonPayload);
                h.executeMethod();
                http_status = h.getStatusCode();
                h.getResponseBodyAsString(response, rc);

                if rc ne 0 then do;
                    put 'ERROR: getResponseBodyAsString failed for row ' i ' rc=' rc;
                end;
                else do;
                    /* Parse the JSON response to extract outputs */
                    prc = j.createParser(response);
                    if prc ne 0 then
                        put 'ERROR: createParser failed for row ' i ' prc=' prc;
                    else do;
                        isInOutputs = 0;
                        inName = '';
                        rc = 0;

                        do while (rc = 0);
                            j.getNextToken(rc, token, tokenType, parseFlags);
                            if rc ne 0 then leave;

                            if token = 'outputs' then isInOutputs = 1;

                            if isInOutputs then do;
                                if token = 'name' then do;
                                    j.getNextToken(rc, token, tokenType, parseFlags);
                                    if rc = 0 then inName = strip(token);
                                end;
                                else if token = 'value' then do;
                                    j.getNextToken(rc, token, tokenType, parseFlags);
                                    if rc = 0 then do;
${ds2OutputParsing || '                                        /* No output variables defined */'}
                                    end;
                                end;
                            end;
                        end;

                        j.destroyParser();
                    end;
                end;

                output;

            end; /* do i */

        end; /* method run */

    endthread;
    run;

    /*--------------------------------------------------------*/
    /* DATA: Launch threads and collect all results.           */
    /*--------------------------------------------------------*/
    data work.scored_results (overwrite=yes);

${ds2InputDecls}
${ds2OutputDecls}
        dcl double http_status;
        dcl double thread_id;
        dcl double row_id;

        dcl thread work.score_thread t;

        method run();
            set from t threads=&n_threads;
            output;
        end;

    enddata;
    run;

quit;

/* Sort and display results */
proc sort data=work.scored_results;
    by row_id;
run;

title "Parallel Scoring Results for &moduleAndStepEndpoint. (&n_threads threads)";
proc print data=work.scored_results noobs;
quit;
title;`;

    return { pythonCode, javascriptCode, sasCode };
  }, [module.id, step.id, step.inputs, step.outputs]);

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
                  <Button
                    variant={apiCodeLanguage === 'sas' ? 'primary' : 'tertiary'}
                    size="small"
                    onClick={() => setApiCodeLanguage('sas')}
                  >
                    SAS
                  </Button>
                </div>
                <Button
                  variant="tertiary"
                  size="small"
                  onClick={() => {
                    const codes = generateApiCode(apiCodeMode);
                    const code = apiCodeLanguage === 'python' ? codes.pythonCode
                      : apiCodeLanguage === 'sas' ? codes.sasCode
                      : codes.javascriptCode;
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
            <div className="score-panel__api-mode-toggle">
              <Button
                variant={apiCodeMode === 'single' ? 'primary' : 'tertiary'}
                size="small"
                onClick={() => setApiCodeMode('single')}
              >
                Single Row
              </Button>
              <Button
                variant={apiCodeMode === 'parallel' ? 'primary' : 'tertiary'}
                size="small"
                onClick={() => setApiCodeMode('parallel')}
              >
                Parallel
              </Button>
            </div>
            <pre className="score-panel__source-code">
              <code>
                {apiCodeLanguage === 'python'
                  ? generateApiCode(apiCodeMode).pythonCode
                  : apiCodeLanguage === 'sas'
                  ? generateApiCode(apiCodeMode).sasCode
                  : generateApiCode(apiCodeMode).javascriptCode}
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
          Parallel (CSV Upload)
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
