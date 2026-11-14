// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The SCR endpoints the user added, kept in this browser (or this desktop
 * install) only. Nothing about them lives in SAS Viya: an SCR container has no
 * Viya-side registry, so the URL the user pasted is all there is.
 */

import type { ScrMode, ScrRuntime } from '../api/scr';

export interface SavedScrEndpoint {
  id: string;
  /** The score URL, normalised (see normalizeScoreUrl). */
  url: string;
  /** Optional display name; the URL's last segment otherwise. */
  label?: string;
  addedAt: string;
  /** What the last inspection found, so the list shows it without a request. */
  lastSeen?: { runtime: ScrRuntime; mode: ScrMode; title: string; at: string };
  /** Desktop: the local container this entry was opened from (removed with it). */
  localContainerId?: string;
}

const KEY = 'mas-scorer:scr-endpoints:v1';

export function listScrEndpoints(): SavedScrEndpoint[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedScrEndpoint[]) : [];
    return Array.isArray(list) ? list.filter((e) => e && typeof e.url === 'string' && typeof e.id === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: SavedScrEndpoint[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage blocked or full: the list just is not remembered.
  }
}

export function getScrEndpoint(id: string): SavedScrEndpoint | null {
  return listScrEndpoints().find((e) => e.id === id) ?? null;
}

/** Adds the URL, or returns the existing entry for it. */
export function addScrEndpoint(url: string, label?: string): SavedScrEndpoint {
  const list = listScrEndpoints();
  const existing = list.find((e) => e.url.toLowerCase() === url.toLowerCase());
  if (existing) return existing;
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const entry: SavedScrEndpoint = { id, url, label: label?.trim() || undefined, addedAt: new Date().toISOString() };
  write([entry, ...list]);
  return entry;
}

export function updateScrEndpoint(id: string, patch: Partial<Omit<SavedScrEndpoint, 'id'>>): void {
  write(listScrEndpoints().map((e) => (e.id === id ? { ...e, ...patch } : e)));
}

export function removeScrEndpoint(id: string): void {
  write(listScrEndpoints().filter((e) => e.id !== id));
}

/**
 * A deleted local container takes its saved endpoint with it: the entry opened
 * from it, or (saved before entries recorded their container) a "(local)"
 * entry on the container's own 127.0.0.1 port.
 */
export function removeLocalContainerEndpoints(managedId: string, hostPort: number | undefined): number {
  const list = listScrEndpoints();
  const origin = hostPort ? `http://127.0.0.1:${hostPort}/` : null;
  const kept = list.filter(
    (e) =>
      !(
        e.localContainerId === managedId ||
        (!e.localContainerId && origin !== null && e.url.startsWith(origin) && (e.label ?? '').endsWith(' (local)'))
      )
  );
  if (kept.length !== list.length) write(kept);
  return list.length - kept.length;
}
