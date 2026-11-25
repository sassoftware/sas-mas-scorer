// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Module } from '../types';
import { getDecisionRevision } from './decisions';

/** Which of a module's parameters are SAS dates or datetimes, by lowercase name. */
export type DateKinds = Record<string, 'date' | 'datetime'>;

// One lookup per module; a failed one is not kept, so the next asks again.
const cache = new Map<string, Promise<DateKinds>>();

/**
 * MAS reports a decision's date and datetime variables as plain decimals, but
 * the module records the decision revision it was published from
 * (properties.sourceURI), and that revision's signature has the real types.
 * Modules that did not come from a decision (or a decision that can't be
 * read) give an empty answer: the app author then chooses the widget.
 */
export function getDecisionDateKinds(module: Module): Promise<DateKinds> {
  const key = module.id.toLowerCase();
  let pending = cache.get(key);
  if (pending) return pending;
  const source = module.properties?.find(p => p.name === 'sourceURI')?.value ?? '';
  if (!source.startsWith('/decisions/flows/')) return Promise.resolve({});
  pending = getDecisionRevision(source)
    .then(flow => {
      const kinds: DateKinds = {};
      for (const v of flow.signature ?? []) {
        const type = v.dataType?.toLowerCase();
        if (type !== 'date' && type !== 'datetime') continue;
        const name = v.name.toLowerCase();
        kinds[name] = type;
        // A module published from SAS Intelligent Decisioning's own UI names
        // its inputs with a trailing underscore (credit_score_).
        kinds[`${name}_`] = type;
      }
      return kinds;
    })
    .catch(() => {
      cache.delete(key);
      return {};
    });
  cache.set(key, pending);
  return pending;
}
