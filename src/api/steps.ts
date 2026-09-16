// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { apiClient, SAS_CONTENT_TYPES } from './client';
import { fetchAllPaginated } from './paginate';
import {
  Step,
  StepCollection,
  StepInput,
  StepOutput,
  ValidationViolation,
  Variable,
} from '../types';

export const getSteps = async (
  moduleId: string,
  start = 0,
  limit = 20
): Promise<StepCollection> => {
  const response = await apiClient.get<StepCollection>(
    `/modules/${moduleId}/steps`,
    {
      params: { start, limit },
      headers: {
        Accept: SAS_CONTENT_TYPES.COLLECTION,
      },
    }
  );
  return response.data;
};

/**
 * All steps of a module. `getSteps` returns one page (default 20), which a
 * Python module registered with one step per function can exceed; this walks
 * the whole collection so step lists and deep links see every step.
 */
export const getAllSteps = async (moduleId: string): Promise<Step[]> => {
  return fetchAllPaginated<Step>(`/modules/${moduleId}/steps`, {
    client: apiClient,
    headers: { Accept: SAS_CONTENT_TYPES.COLLECTION },
  });
};

export const getStep = async (moduleId: string, stepId: string): Promise<Step> => {
  const response = await apiClient.get<Step>(
    `/modules/${moduleId}/steps/${stepId}`,
    {
      headers: {
        Accept: SAS_CONTENT_TYPES.STEP,
      },
    }
  );
  return response.data;
};

export interface ExecuteStepOptions {
  waitTime?: number;
  timeout?: number;
  /**
   * Aborts the request when the caller's controller fires (e.g. a batch run
   * unmounting). The call then rejects with an axios `CanceledError`, which is
   * NOT a scoring failure: callers must test `axios.isCancel(err)` first and
   * drop the row instead of recording an error for it.
   */
  signal?: AbortSignal;
}

/**
 * Execute one step. Rejects with an axios `CanceledError` when
 * `options.signal` aborts — guard with `axios.isCancel(err)` before treating a
 * rejection as a scoring error.
 */
export const executeStep = async (
  moduleId: string,
  stepId: string,
  input: StepInput,
  options: ExecuteStepOptions = {}
): Promise<StepOutput> => {
  // Default to 120s for scoring requests; decisions can take well beyond the
  // standard 30s client timeout, which causes 499 (client closed) errors.
  const timeout = options.timeout ?? 120000;

  const response = await apiClient.post<StepOutput>(
    `/modules/${moduleId}/steps/${stepId}`,
    input,
    {
      params: options.waitTime !== undefined ? { waitTime: options.waitTime } : {},
      timeout,
      signal: options.signal,
      headers: {
        'Content-Type': SAS_CONTENT_TYPES.STEP_INPUT,
        Accept: SAS_CONTENT_TYPES.STEP_OUTPUT,
      },
    }
  );
  return response.data;
};

export const validateStepInput = async (
  moduleId: string,
  stepId: string,
  input: StepInput
): Promise<ValidationViolation | null> => {
  // 200 means valid; a 400 surfaces validation errors as a thrown error that
  // the caller inspects.
  const response = await apiClient.post<ValidationViolation>(
    `/commons/validations/modules/${moduleId}/steps/${stepId}`,
    input,
    {
      headers: {
        'Content-Type': SAS_CONTENT_TYPES.STEP_INPUT,
      },
    }
  );
  return response.data;
};

// Helper function to build step input from form values
export const buildStepInput = (
  step: Step,
  values: Record<string, unknown>,
  metadata?: Record<string, string>
): StepInput => {
  const inputs: Variable[] = (step.inputs ?? []).map((param) => {
    const value = values[param.name];
    return {
      name: param.name,
      value: value ?? null,
    } as Variable;
  });

  return {
    inputs,
    version: 1,
    metadata,
  };
};

// Helper to extract output values as a key-value map
export const extractOutputValues = (output: StepOutput): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const variable of output.outputs) {
    result[variable.name] = variable.value;
  }
  return result;
};
