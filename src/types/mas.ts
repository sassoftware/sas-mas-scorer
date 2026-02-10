// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// MAS API Types based on microanalyticScore-v8-openapi.yml

export interface Link {
  method?: string;
  rel: string;
  uri?: string;
  href?: string;
  title?: string;
  type?: string;
  itemType?: string;
  responseType?: string;
}

export interface Property {
  name: string;
  value: string;
}

export interface Module {
  id: string;
  name: string;
  revision: number;
  description?: string;
  scope: 'public' | 'private';
  language: 'ds2';
  createdBy?: string;
  modifiedBy?: string;
  creationTimeStamp: string;
  modifiedTimeStamp: string;
  stepsIds?: string[];
  stepIds?: string[];  // Alternative field name used by some API versions
  properties?: Property[];
  warnings?: ApiError[];
  links: Link[];
  version: number;
}

// Helper to get step count from a module (handles different API field names)
export const getModuleStepCount = (module: Module): number => {
  // Try stepsIds first (primary), then stepIds (alternative)
  if (module.stepsIds && module.stepsIds.length > 0) {
    return module.stepsIds.length;
  }
  if (module.stepIds && module.stepIds.length > 0) {
    return module.stepIds.length;
  }
  // Check links for steps relationship as fallback
  const stepsLink = module.links?.find(link => link.rel === 'steps');
  if (stepsLink) {
    // We know steps exist, but don't know count - return -1 to indicate unknown
    return -1;
  }
  return 0;
};

// Module type based on step IDs
export type ModuleType = 'Model' | 'Data' | 'Decision' | 'Unknown';

// Helper to determine module type based on stepsIds
export const getModuleType = (module: Module): ModuleType => {
  const stepIds = module.stepsIds ?? module.stepIds ?? [];

  for (const stepId of stepIds) {
    const lowerStepId = stepId.toLowerCase();

    // Check for Data type (find step)
    if (lowerStepId === 'find') {
      return 'Data';
    }

    // Check for Model type (score step)
    if (lowerStepId === 'score') {
      return 'Model';
    }

    // Check for Decision type (execute or execute_* step)
    if (lowerStepId === 'execute' || lowerStepId.startsWith('execute_')) {
      return 'Decision';
    }
  }

  return 'Unknown';
};

export interface Submodule {
  id: string;
  name: string;
  moduleId: string;
  language: 'ds2' | 'astore';
  description?: string;
  attributes?: {
    keyValue?: string;
  };
  creationTimeStamp: string;
  modifiedTimeStamp: string;
  links: Link[];
  version: number;
}

export interface ModuleDefinition {
  id?: string;
  description?: string;
  scope: 'public' | 'private';
  type?: 'text/vnd.sas.source.ds2';
  source: string;
  properties?: Property[];
  submodules?: SubmoduleDefinition[];
  version?: number;
}

export interface SubmoduleDefinition {
  name?: string;
  language: 'ds2' | 'astore';
  description?: string;
  source: string;
  attributes?: {
    keyValue?: string;
  };
}

export interface ModuleSource {
  version: number;
  moduleId: string;
  submoduleId?: string;
  source: string;
  links: Link[];
}

export type StepParameterType =
  | 'decimal'
  | 'bigint'
  | 'integer'
  | 'string'
  | 'binary'
  | 'decimalArray'
  | 'bigintArray'
  | 'integerArray'
  | 'stringArray'
  | 'binaryArray';

export interface StepParameter {
  name: string;
  type: StepParameterType;
  size?: number;
  dim?: number;
}

export interface Step {
  id: string;
  moduleId: string;
  description?: string;
  inputs: StepParameter[];
  outputs: StepParameter[];
  links: Link[];
  version: number;
}

export interface NumberVariable {
  name: string;
  value: number | null;
}

export interface StringVariable {
  name: string;
  value: string | null;
  encoding?: 'b64';
}

export interface BooleanVariable {
  name: string;
  value: boolean | null;
}

export interface ArrayVariable {
  name: string;
  value: (number | string | null)[];
}

export interface ObjectVariable {
  name: string;
  value: Record<string, unknown>;
}

export type Variable =
  | NumberVariable
  | StringVariable
  | BooleanVariable
  | ArrayVariable
  | ObjectVariable;

export interface StepInput {
  inputs: Variable[];
  version?: number;
  metadata?: Record<string, string>;
}

export type ExecutionState = 'completed' | 'submitted' | 'timedOut';

export interface StepOutput {
  moduleId: string;
  stepId: string;
  executionState: ExecutionState;
  outputs: Variable[];
  links: Link[];
  version: number;
  metadata?: Record<string, string>;
}

export type JobState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timedOut';
export type JobOperation = 'create' | 'update';

export interface Job {
  id: string;
  description?: string;
  moduleId: string;
  operation: JobOperation;
  state: JobState;
  errors?: ApiError[];
  links: Link[];
  version: number;
}

export interface ApiError {
  message?: string;
  id?: string;
  errorCode?: number;
  httpStatusCode: number;
  details?: string[];
  remediation?: string;
  errors?: ApiError[];
  links?: Link[];
  version: number;
}

export interface Collection<T> {
  items: T[];
  count: number;
  start: number;
  limit: number;
  links: Link[];
  version: number;
}

export type ModuleCollection = Collection<Module>;
export type SubmoduleCollection = Collection<Submodule>;
export type StepCollection = Collection<Step>;
export type JobCollection = Collection<Job>;

export interface ValidationViolation {
  type: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  violations?: {
    field: string;
    message: string;
  }[];
}
