// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Types for the SAS Viya Job Execution service (/jobExecution/jobs) and the
// related Compute log/listing endpoints. Distinct from the MAS `Job` type in
// `mas.ts`, which models module create/update jobs in the microanalyticScore
// service — hence the `Execution` prefix throughout.

import { Collection, Link } from './mas';

export type ExecutionJobState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'timedOut'
  | 'paused';

export const TERMINAL_JOB_STATES: ExecutionJobState[] = [
  'completed',
  'failed',
  'canceled',
  'timedOut',
];

export const isTerminalState = (state: ExecutionJobState): boolean =>
  TERMINAL_JOB_STATES.includes(state);

export interface ExecutionJobParameter {
  version?: number;
  name: string;
  defaultValue?: string;
  type?: string;
  label?: string;
  required?: boolean;
}

export interface ExecutionJobDefinitionProperty {
  name: string;
  value: string;
}

export interface ExecutionJobDefinition {
  id: string;
  name: string;
  description?: string;
  type?: string;
  code?: string;
  parameters?: ExecutionJobParameter[];
  properties?: ExecutionJobDefinitionProperty[];
  createdBy?: string;
  modifiedBy?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  links?: Link[];
  version?: number;
}

export interface ExecutionJobRequest {
  version?: number;
  name?: string;
  description?: string;
  jobDefinitionUri?: string;
  jobDefinition?: ExecutionJobDefinition;
  arguments?: Record<string, string>;
  properties?: ExecutionJobDefinitionProperty[];
  createdByApplication?: string;
}

export interface ExecutionJob {
  id: string;
  state: ExecutionJobState;
  createdBy?: string;
  modifiedBy?: string;
  creationTimeStamp: string;
  modifiedTimeStamp?: string;
  endTimeStamp?: string;
  elapsedTime?: number;
  heartbeatInterval?: number;
  heartbeatTimeStamp?: string;
  jobRequest: ExecutionJobRequest;
  results?: Record<string, string>;
  logLocation?: string;
  submittedByApplication?: string;
  links: Link[];
  version: number;
}

export type ExecutionJobCollection = Collection<ExecutionJob>;

export type LogLineType =
  | 'normal'
  | 'note'
  | 'warning'
  | 'error'
  | 'source'
  | 'title'
  | 'message'
  | 'byline'
  | 'footnote'
  | 'fatal'
  // Listing-only types: 'highlighted' is the Compute listing emphasis class
  // (procedure column headers, summary rows, etc.).
  | 'highlighted';

export interface LogLine {
  line: string;
  type: LogLineType;
  version?: number;
}

export type LogLineCollection = Collection<LogLine>;
