// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Documented environment variables of SAS Container Runtime and the SAS model
 * runtimes, for the quick add in the run form and the container settings.
 *
 * Source: SAS Container Runtime: Programming and Administration Guide 2026.09.
 * Checked against SCR images (SCR 1.804.22, Python runtime 3.84.1 and
 * 3.69.17): every name below except SAS_SCR_REST_CONTENT_APPLICATION_JSON is
 * read by the SCR image, and the Python runtime 3.84.1 reads the
 * SAS_SCR_PYTHON_LOG_LEVEL_* names in upper case only. Left out on purpose:
 * SAS_SCR_REST_API_TYPE (the Mode field), SAS_SCR_APP_PATH (the score address,
 * reserved), the TLS variables (the app publishes port 8080 only), the Batch
 * Agent's variables (Kubernetes jobs) and names found in images but not
 * documented.
 */

import catalog from './scrEnvCatalog.json';
import type { ImageKind } from '../../types/localContainers';

export type EnvKind = 'level' | 'boolean' | 'number' | 'text';
export type EnvAppliesTo = 'scr' | 'python' | 'r';

export interface EnvGroup {
  id: string;
  label: string;
  appliesTo: EnvAppliesTo;
  note?: string;
}

export interface EnvCatalogEntry {
  name: string;
  group: string;
  kind: EnvKind;
  /** The documented default, as the container would read it; absent when the guide gives none. */
  default?: string;
  /** What the quick add fills in: the value people usually set the variable for. */
  suggested?: string;
  min?: number;
  description: string;
  note?: string;
}

export const LOG_LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
export const BOOLEAN_VALUES = ['true', 'false'] as const;

export const ENV_SOURCE: string = catalog.source;
export const ENV_GROUPS: EnvGroup[] = catalog.groups as EnvGroup[];
export const ENV_CATALOG: EnvCatalogEntry[] = catalog.entries as EnvCatalogEntry[];

const byName = new Map(ENV_CATALOG.map((e) => [e.name, e]));
const groupById = new Map(ENV_GROUPS.map((g) => [g.id, g]));

export const catalogEntry = (name: string): EnvCatalogEntry | undefined => byName.get(name.trim());
export const catalogGroup = (id: string): EnvGroup | undefined => groupById.get(id);

/** The fixed choices for a variable, or null when any value of its kind is allowed. */
export function choicesFor(entry: EnvCatalogEntry): readonly string[] | null {
  if (entry.kind === 'level') return LOG_LEVELS;
  if (entry.kind === 'boolean') return BOOLEAN_VALUES;
  return null;
}

/**
 * Groups that fit an image. SCR images take the SCR groups; Python and R
 * images ('other') the model-runtime groups. Before the image is known (the
 * run form), all of them.
 */
export function groupsFor(kind?: ImageKind): EnvGroup[] {
  if (kind === 'scr') return ENV_GROUPS.filter((g) => g.appliesTo === 'scr');
  if (kind === 'other') return ENV_GROUPS.filter((g) => g.appliesTo !== 'scr');
  return ENV_GROUPS;
}

export const entriesIn = (groupId: string): EnvCatalogEntry[] => ENV_CATALOG.filter((e) => e.group === groupId);

/** The value a quick-added row starts with. */
export const initialValue = (entry: EnvCatalogEntry): string => entry.suggested ?? entry.default ?? '';
