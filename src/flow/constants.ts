// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { SidNodeType } from '../types/sid';

/**
 * Colors matching the SAS Intelligent Decisioning UI.
 * `bg`/`border` draw the node; `text` is the label on `bg`; `badge` is a
 * darker member of the same family for the type pill and the side-panel
 * header chip, chosen so white text on it clears 4.5:1 (the `border` tints
 * are too light for that — #5B9BD5 is 3:1, #FF9800 2.2:1).
 */
export const NODE_COLORS: Record<SidNodeType, { bg: string; border: string; text: string; badge: string }> = {
  start:              { bg: '#ffffff', border: '#999999', text: '#333333', badge: '#595959' },
  end:                { bg: '#ffffff', border: '#999999', text: '#333333', badge: '#595959' },
  decision:           { bg: '#FDEAEB', border: '#E06050', text: '#333333', badge: '#B23A2C' },
  custom:             { bg: '#E0F2F1', border: '#26A69A', text: '#333333', badge: '#00796B' },
  ruleset:            { bg: '#DDEAF6', border: '#5B9BD5', text: '#333333', badge: '#2E6DA4' },
  model:              { bg: '#E8DEF3', border: '#7B68AE', text: '#333333', badge: '#5A4A8C' },
  code_file:          { bg: '#DDEAF6', border: '#5B9BD5', text: '#333333', badge: '#2E6DA4' },
  condition:          { bg: '#FEF4D5', border: '#F4B942', text: '#333333', badge: '#8A5A00' },
  cond_expr:          { bg: '#FEF4D5', border: '#F4B942', text: '#333333', badge: '#8A5A00' },
  assignment:         { bg: '#E8F5E9', border: '#66BB6A', text: '#333333', badge: '#2E7031' },
  abtest:             { bg: '#FFF3E0', border: '#FF9800', text: '#333333', badge: '#8A4B00' },
  parallel:           { bg: '#E3F2FD', border: '#42A5F5', text: '#333333', badge: '#14579E' },
  record_contact:     { bg: '#FCE4EC', border: '#EC407A', text: '#333333', badge: '#AD1457' },
  treatment_group:    { bg: '#F3E5F5', border: '#AB47BC', text: '#333333', badge: '#6A1B9A' },
  segmentation_tree:  { bg: '#E0F2F1', border: '#009688', text: '#333333', badge: '#00695C' },
  rest_api:           { bg: '#E8EAF6', border: '#3F51B5', text: '#333333', badge: '#3F51B5' },
  unknown:            { bg: '#F0F0F0', border: '#999999', text: '#333333', badge: '#595959' },
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
  decisionRESTAPIDefinition: 'rest_api',
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
  rest_api:           { width: 240, height: 70 },
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
  rest_api: 'REST API',
  unknown: 'Unknown',
};

/** Code file type labels */
export const CODE_TYPE_LABELS: Record<string, string> = {
  decisionPythonFile: 'Python',
  decisionDS2CodeFile: 'DS2',
  decisionSQLCodeFile: 'SQL',
  decisionQueryFile: 'Query',
};
