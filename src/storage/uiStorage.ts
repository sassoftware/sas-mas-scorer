// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { UIDefinition, UIDefinitionSummary } from '../types/uiBuilder';

const STORAGE_PREFIX = 'mas-ui-builder:';
const INDEX_KEY = `${STORAGE_PREFIX}index`;

// --- Browser localStorage implementation ---

function getIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setIndex(ids: string[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
}

function definitionKey(id: string): string {
  return `${STORAGE_PREFIX}def:${id}`;
}

function toSummary(def: UIDefinition): UIDefinitionSummary {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    moduleId: def.moduleId,
    stepId: def.stepId,
    createdAt: def.createdAt,
    updatedAt: def.updatedAt,
  };
}

// --- Public API ---

export async function listUIDefinitions(): Promise<UIDefinitionSummary[]> {
  const ids = getIndex();
  const summaries: UIDefinitionSummary[] = [];

  for (const id of ids) {
    const raw = localStorage.getItem(definitionKey(id));
    if (raw) {
      try {
        summaries.push(toSummary(JSON.parse(raw)));
      } catch {
        // Skip corrupt entries
      }
    }
  }

  // Sort by updatedAt descending
  summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return summaries;
}

export async function getUIDefinition(id: string): Promise<UIDefinition | null> {
  const raw = localStorage.getItem(definitionKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveUIDefinition(definition: UIDefinition): Promise<void> {
  definition.updatedAt = new Date().toISOString();
  localStorage.setItem(definitionKey(definition.id), JSON.stringify(definition));

  const ids = getIndex();
  if (!ids.includes(definition.id)) {
    ids.push(definition.id);
    setIndex(ids);
  }
}

export async function deleteUIDefinition(id: string): Promise<void> {
  localStorage.removeItem(definitionKey(id));
  const ids = getIndex().filter(i => i !== id);
  setIndex(ids);
}

export async function duplicateUIDefinition(id: string, newName: string): Promise<UIDefinition | null> {
  const original = await getUIDefinition(id);
  if (!original) return null;

  const now = new Date().toISOString();
  const copy: UIDefinition = {
    ...original,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: newName,
    createdAt: now,
    updatedAt: now,
  };

  await saveUIDefinition(copy);
  return copy;
}

export async function exportUIDefinition(id: string): Promise<string | null> {
  const def = await getUIDefinition(id);
  if (!def) return null;
  return JSON.stringify(def, null, 2);
}

export async function importUIDefinition(json: string): Promise<UIDefinition> {
  const parsed = JSON.parse(json) as UIDefinition;

  // Validate required fields
  if (!parsed.moduleId || !parsed.stepId || !parsed.layout) {
    throw new Error('Invalid UI definition: missing required fields (moduleId, stepId, layout)');
  }

  // Assign new ID and timestamps
  const now = new Date().toISOString();
  parsed.id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  parsed.createdAt = now;
  parsed.updatedAt = now;

  await saveUIDefinition(parsed);
  return parsed;
}
