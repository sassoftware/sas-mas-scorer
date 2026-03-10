// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Module, Step, getModuleType } from '../types';

/**
 * Auto-detect the scoreable step from a module.
 * - Model → "score" step
 * - Decision → "execute" step (or first "execute_*" step)
 */
export function getScoreableStep(module: Module, steps: Step[]): Step | null {
  const moduleType = getModuleType(module);

  if (moduleType === 'Model') {
    return steps.find(s => s.id.toLowerCase() === 'score') ?? null;
  }

  if (moduleType === 'Decision') {
    const exact = steps.find(s => s.id.toLowerCase() === 'execute');
    if (exact) return exact;
    return steps.find(s => s.id.toLowerCase().startsWith('execute_')) ?? null;
  }

  return null;
}

/**
 * Check if a module is scoreable (has a score or execute step).
 */
export function isScoreableModule(module: Module): boolean {
  const moduleType = getModuleType(module);
  return moduleType === 'Model' || moduleType === 'Decision';
}
