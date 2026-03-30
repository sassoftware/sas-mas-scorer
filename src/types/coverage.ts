// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export type ContentType = 'decision' | 'businessRule' | 'codeFile' | 'treatment' | 'segmentationTree' | 'model';

export interface TestScenarioInfo {
  scoreDefinitionId: string;
  name: string;
  scenarioType: string;
  description: string | null;
  createdBy: string;
  inputDataType: string | null;
}

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
