// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { apiClient, SAS_CONTENT_TYPES } from './client';
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
}

export const executeStep = async (
  moduleId: string,
  stepId: string,
  input: StepInput,
  options: ExecuteStepOptions = {}
): Promise<StepOutput> => {
  const response = await apiClient.post<StepOutput>(
    `/modules/${moduleId}/steps/${stepId}`,
    input,
    {
      params: options.waitTime !== undefined ? { waitTime: options.waitTime } : {},
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
  try {
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
  } catch (error) {
    // 200 means valid, 400 means validation errors
    throw error;
  }
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
