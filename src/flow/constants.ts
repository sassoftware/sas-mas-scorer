// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { SidNodeType } from '../types/sid';

/** Colors matching the SAS Intelligent Decisioning UI */
export const NODE_COLORS: Record<SidNodeType, { bg: string; border: string; text: string }> = {
  start:              { bg: '#ffffff', border: '#999999', text: '#333333' },
  end:                { bg: '#ffffff', border: '#999999', text: '#333333' },
  decision:           { bg: '#FDEAEB', border: '#E06050', text: '#333333' },
  custom:             { bg: '#E0F2F1', border: '#26A69A', text: '#333333' },
  ruleset:            { bg: '#DDEAF6', border: '#5B9BD5', text: '#333333' },
  model:              { bg: '#E8DEF3', border: '#7B68AE', text: '#333333' },
  code_file:          { bg: '#DDEAF6', border: '#5B9BD5', text: '#333333' },
  condition:          { bg: '#FEF4D5', border: '#F4B942', text: '#333333' },
  cond_expr:          { bg: '#FEF4D5', border: '#F4B942', text: '#333333' },
  assignment:         { bg: '#E8F5E9', border: '#66BB6A', text: '#333333' },
  abtest:             { bg: '#FFF3E0', border: '#FF9800', text: '#333333' },
  parallel:           { bg: '#E3F2FD', border: '#42A5F5', text: '#333333' },
  record_contact:     { bg: '#FCE4EC', border: '#EC407A', text: '#333333' },
  treatment_group:    { bg: '#F3E5F5', border: '#AB47BC', text: '#333333' },
  segmentation_tree:  { bg: '#E0F2F1', border: '#009688', text: '#333333' },
  unknown:            { bg: '#F0F0F0', border: '#999999', text: '#333333' },
};

/** Map customObject.type values to our SidNodeType categories */
export const CUSTOM_TYPE_MAP: Record<string, SidNodeType> = {
  decision: 'decision',
  decisionDS2CodeFile: 'code_file',
  decisionPythonFile: 'code_file',
  decisionSQLCodeFile: 'code_file',
  decisionQueryFile: 'code_file',
  treatmentGroup: 'treatment_group',
  segmentationTree: 'segmentation_tree',
  dntStatic: 'custom',
};

/** Node dimensions for dagre layout */
export const NODE_DIMENSIONS: Record<SidNodeType, { width: number; height: number }> = {
  start:              { width: 120, height: 50 },
  end:                { width: 120, height: 50 },
  decision:           { width: 220, height: 60 },
  custom:             { width: 220, height: 60 },
  ruleset:            { width: 220, height: 60 },
  model:              { width: 220, height: 60 },
  code_file:          { width: 220, height: 60 },
  condition:          { width: 240, height: 80 },
  cond_expr:          { width: 240, height: 80 },
  assignment:         { width: 220, height: 60 },
  abtest:             { width: 240, height: 80 },
  parallel:           { width: 240, height: 60 },
  record_contact:     { width: 220, height: 60 },
  treatment_group:    { width: 220, height: 60 },
  segmentation_tree:  { width: 220, height: 60 },
  unknown:            { width: 180, height: 60 },
};

/** Labels for the legend */
export const NODE_TYPE_LABELS: Record<SidNodeType, string> = {
  start: 'Start',
  end: 'End',
  decision: 'Sub-Decision',
  custom: 'Custom Node',
  ruleset: 'Rule Set',
  model: 'Model',
  code_file: 'Code File',
  condition: 'Branch',
  cond_expr: 'Branch',
  assignment: 'Assignment',
  abtest: 'A/B Test',
  parallel: 'Parallel Process',
  record_contact: 'Record Contact',
  treatment_group: 'Treatment Group',
  segmentation_tree: 'Segmentation Tree',
  unknown: 'Unknown',
};

/** Code file type labels */
export const CODE_TYPE_LABELS: Record<string, string> = {
  decisionPythonFile: 'Python',
  decisionDS2CodeFile: 'DS2',
  decisionSQLCodeFile: 'SQL',
  decisionQueryFile: 'Query',
};
