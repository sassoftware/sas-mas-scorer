// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export type ContentType = 'decision' | 'businessRule' | 'codeFile' | 'treatment' | 'segmentationTree' | 'model';

/**
 * The latest score execution found for a test, as SAS recorded it
 * (/scoreExecution/executions, newest first). `state` is the execution's own
 * state: 'completed' says the run finished, not that expected values matched.
 */
export interface TestLastRun {
  /** Execution state: completed, failed, canceled, running, pending, … */
  state: string;
  executionId: string;
  /** When the execution was created (started). */
  timestamp: string;
}

/**
 * Why a test may no longer describe the asset as it is now. Only what the
 * metadata shows; it says nothing about whether the test would still pass.
 */
export type TestChangeReason =
  | {
      /** The test targets one revision, the asset's current revision is another. */
      kind: 'revision';
      testedRevisionId: string;
      currentRevisionId: string;
    }
  | {
      /** The asset was modified after the test was created. */
      kind: 'modifiedAfter';
      assetModified: string;
      testCreated: string;
    };

/**
 * Where the latest-run lookup stands for one test:
 * - found     an execution was found (see `lastRun`)
 * - none      the whole execution history was read and holds no run of it
 * - notInScan the scan stopped at its cap before finding a run
 * - unread    the execution history could not be read
 */
export type LastRunLookup = 'found' | 'none' | 'notInScan' | 'unread';

export interface TestScenarioInfo {
  scoreDefinitionId: string;
  name: string;
  scenarioType: string;
  description: string | null;
  createdBy: string;
  inputDataType: string | null;
  /** Score definition creationTimeStamp ('' when not sent). */
  creationTimestamp: string;
  /** The asset URI the test targets (objectDescriptor.uri). */
  targetUri: string | null;
  /** The revision in that URI (…/revisions/{id}), when it names one. */
  testedRevisionId: string | null;
  lastRunLookup: LastRunLookup;
  lastRun: TestLastRun | null;
  /** Empty when the metadata shows no change after the test. */
  changes: TestChangeReason[];
}

/**
 * Roll-up of an asset's tests by their latest runs:
 * - healthy  no latest run failed, and at least one completed
 * - failing  at least one test's latest run failed
 * - noRun    no test has a completed or failed run in the whole history read
 * - unknown  no completed or failed run found, but the history was cut off
 *            by the scan cap or could not be read
 * Null for an asset without tests.
 */
export type AssetTestHealth = 'healthy' | 'failing' | 'noRun' | 'unknown';

export interface ContentItem {
  id: string;
  contentType: ContentType;
  name: string;
  description: string | null;
  createdBy: string;
  creationTimestamp: string;
  modifiedBy: string;
  modifiedTimestamp: string;
  version: number;
  uri: string;
  hasTestScenario: boolean;
  testScenarioCount: number;
  testScenarios: TestScenarioInfo[];
  /** The asset's current revision id, when its collection item names one. */
  currentRevisionId: string | null;
  /** Null for an asset without tests. */
  testHealth: AssetTestHealth | null;
  /** True when every test shows a change after it (see TestChangeReason). */
  changedSinceTests: boolean;
}

export interface CoverageByType {
  total: number;
  withTests: number;
  withoutTests: number;
  coveragePercentage: number;
}

export interface CoverageStats {
  overall: {
    totalItems: number;
    itemsWithTests: number;
    itemsWithoutTests: number;
    coveragePercentage: number;
  };
  byType: Record<ContentType, CoverageByType>;
}

export interface CollectionProgress {
  phase: string;
  currentStep: number;
  totalSteps: number;
  message: string;
  itemsCollected: number;
}

export interface CoverageResult {
  stats: CoverageStats;
  items: ContentItem[];
  collectionDate: string;
}
