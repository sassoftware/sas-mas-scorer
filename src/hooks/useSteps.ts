// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useRef } from 'react';
import { Step, StepInput, StepOutput } from '../types';
import { getAllSteps, getStep, executeStep, buildStepInput, ExecuteStepOptions } from '../api';

interface UseStepsReturn {
  steps: Step[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useSteps = (moduleId: string | null): UseStepsReturn => {
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every fetch; a response for an older module is dropped so a
  // slow earlier request cannot overwrite the current module's steps.
  const requestIdRef = useRef(0);

  const fetchSteps = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (!moduleId) {
      setSteps([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getAllSteps(moduleId);
      if (requestId !== requestIdRef.current) return;
      setSteps(result);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch steps');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    fetchSteps();
  }, [fetchSteps]);

  return { steps, loading, error, refresh: fetchSteps };
};

interface UseStepReturn {
  step: Step | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useStep = (moduleId: string | null, stepId: string | null): UseStepReturn => {
  const [step, setStep] = useState<Step | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchStep = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (!moduleId || !stepId) {
      setStep(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getStep(moduleId, stepId);
      if (requestId !== requestIdRef.current) return;
      setStep(result);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch step');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [moduleId, stepId]);

  useEffect(() => {
    fetchStep();
  }, [fetchStep]);

  return { step, loading, error, refresh: fetchStep };
};

interface UseStepExecutionState {
  output: StepOutput | null;
  executing: boolean;
  error: string | null;
  executionTime: number | null;
}

interface UseStepExecutionReturn extends UseStepExecutionState {
  execute: (input: StepInput, options?: ExecuteStepOptions) => Promise<StepOutput>;
  executeWithValues: (
    step: Step,
    values: Record<string, unknown>,
    options?: ExecuteStepOptions
  ) => Promise<StepOutput>;
  reset: () => void;
}

export const useStepExecution = (
  moduleId: string | null,
  stepId: string | null
): UseStepExecutionReturn => {
  const [state, setState] = useState<UseStepExecutionState>({
    output: null,
    executing: false,
    error: null,
    executionTime: null,
  });

  const execute = useCallback(
    async (input: StepInput, options?: ExecuteStepOptions): Promise<StepOutput> => {
      if (!moduleId || !stepId) {
        throw new Error('Module ID and Step ID are required');
      }

      setState((prev) => ({ ...prev, executing: true, error: null }));
      const startTime = performance.now();

      try {
        const result = await executeStep(moduleId, stepId, input, options);
        const endTime = performance.now();

        setState({
          output: result,
          executing: false,
          error: null,
          executionTime: endTime - startTime,
        });

        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Execution failed';
        setState((prev) => ({
          ...prev,
          executing: false,
          error: errorMessage,
        }));
        throw err;
      }
    },
    [moduleId, stepId]
  );

  const executeWithValues = useCallback(
    async (
      step: Step,
      values: Record<string, unknown>,
      options?: ExecuteStepOptions
    ): Promise<StepOutput> => {
      const input = buildStepInput(step, values);
      return execute(input, options);
    },
    [execute]
  );

  const reset = useCallback(() => {
    setState({
      output: null,
      executing: false,
      error: null,
      executionTime: null,
    });
  }, []);

  return {
    ...state,
    execute,
    executeWithValues,
    reset,
  };
};
