// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Persistent storage for OAuth tokens and connection settings.
 * Supports multiple named connections with per-connection token storage.
 * Uses electron-store with basic encryption for token obfuscation.
 *
 * The decrypted contents are kept in memory (see "In-memory copy" below), so
 * reads never touch the disk; only writes do.
 */

import Store from 'electron-store';
import { randomUUID } from 'node:crypto';

// --- Types ---

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in ms
}

export interface ConnectionSettings {
  viyaUrl: string;
  clientId: string;
  clientSecret: string;
  insecureSsl: boolean;
}

export interface SavedConnection extends ConnectionSettings {
  id: string;
  name: string;
  /** Environment color (hex) applied to the app chrome while this connection is active */
  color?: string;
}

interface StoreSchema {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  tokensByConnection: Record<string, StoredTokens>;
  // Legacy keys (pre-migration)
  tokens?: StoredTokens | null;
  connection?: ConnectionSettings | null;
}

// --- Store instance ---

const store = new Store<StoreSchema>({
  name: 'mas-scorer-config',
  encryptionKey: 'mas-scorer-v1',
  defaults: {
    connections: [],
    activeConnectionId: null,
    tokensByConnection: {},
  },
});

// --- Migration from single-connection format ---

function migrateIfNeeded(): void {
  const legacy = store.get('connection') as ConnectionSettings | null | undefined;
  if (legacy && legacy.viyaUrl) {
    const id = randomUUID();
    let name: string;
    try {
      name = new URL(legacy.viyaUrl).hostname;
    } catch {
      name = legacy.viyaUrl;
    }

    const saved: SavedConnection = { ...legacy, id, name };
    store.set('connections', [saved]);
    store.set('activeConnectionId', id);

    // Migrate tokens
    const legacyTokens = store.get('tokens') as StoredTokens | null | undefined;
    if (legacyTokens) {
      store.set('tokensByConnection', { [id]: legacyTokens });
    }

    // Remove legacy keys
    store.delete('connection' as keyof StoreSchema);
    store.delete('tokens' as keyof StoreSchema);
  }
}

migrateIfNeeded();

// --- In-memory copy ---
//
// conf reads and decrypts the whole file on every get (readFileSync plus a
// 10 000-round PBKDF2, ~15 ms), and every API request asks for the active
// connection and its tokens, which cost ~60 ms of blocked main process per
// request. The decrypted contents are read once and kept here instead. Every
// write goes to disk first, in one encrypted write of the whole store, and
// only then replaces the copy, so the copy always matches the file: this
// process is the store's only reader and writer. The file stays encrypted.
let memory: StoreSchema | null = null;

function current(): StoreSchema {
  if (!memory) memory = store.store;
  return memory;
}

function write(patch: Partial<StoreSchema>): void {
  const next: StoreSchema = { ...current(), ...patch };
  store.store = next;
  memory = next;
}

// Callers get copies, so nothing outside this module can change the copy.
const copyConnection = (c: SavedConnection): SavedConnection => ({ ...c });

// --- Connection CRUD ---

export function getAllConnections(): SavedConnection[] {
  return (current().connections ?? []).map(copyConnection);
}

export function getActiveConnectionId(): string | null {
  return current().activeConnectionId ?? null;
}

/** Returns the active connection, or null if none is set. */
export function getConnection(): SavedConnection | null {
  const id = getActiveConnectionId();
  if (!id) return null;
  const found = (current().connections ?? []).find((c) => c.id === id);
  return found ? copyConnection(found) : null;
}

export function addConnection(conn: Omit<SavedConnection, 'id'>): SavedConnection {
  const id = randomUUID();
  const saved: SavedConnection = { ...conn, id };
  write({ connections: [...getAllConnections(), saved] });
  return copyConnection(saved);
}

export function updateConnection(conn: SavedConnection): void {
  const connections = getAllConnections();
  const idx = connections.findIndex((c) => c.id === conn.id);
  if (idx === -1) return;
  connections[idx] = { ...conn };
  write({ connections });
}

export function deleteConnection(id: string): void {
  // Drop the connection and its tokens, and clear it if it was the active one.
  const tokensByConnection = { ...(current().tokensByConnection ?? {}) };
  delete tokensByConnection[id];
  write({
    connections: getAllConnections().filter((c) => c.id !== id),
    tokensByConnection,
    activeConnectionId: getActiveConnectionId() === id ? null : getActiveConnectionId(),
  });
}

export function setActiveConnection(id: string): void {
  if (!(current().connections ?? []).some((c) => c.id === id)) return;
  write({ activeConnectionId: id });
}

// --- Token operations ---

/** Tokens of one connection, or null when it has none. */
export function getTokensFor(connectionId: string): StoredTokens | null {
  const tokens = current().tokensByConnection?.[connectionId];
  return tokens ? { ...tokens } : null;
}

/**
 * Store tokens for one connection. A token refresh that started before the
 * user switched connection writes to the connection it was started for, not
 * to whichever one is active when it returns.
 */
export function setTokensFor(connectionId: string, tokens: StoredTokens): void {
  write({ tokensByConnection: { ...(current().tokensByConnection ?? {}), [connectionId]: { ...tokens } } });
}

export function clearTokensFor(connectionId: string): void {
  const tokensByConnection = { ...(current().tokensByConnection ?? {}) };
  if (!(connectionId in tokensByConnection)) return;
  delete tokensByConnection[connectionId];
  write({ tokensByConnection });
}

// Scoped to the active connection.

export function getTokens(): StoredTokens | null {
  const id = getActiveConnectionId();
  return id ? getTokensFor(id) : null;
}

export function setTokens(tokens: StoredTokens): void {
  const id = getActiveConnectionId();
  if (id) setTokensFor(id, tokens);
}

export function clearTokens(): void {
  const id = getActiveConnectionId();
  if (id) clearTokensFor(id);
}
