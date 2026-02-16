// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Persistent storage for OAuth tokens and connection settings.
 * Supports multiple named connections with per-connection token storage.
 * Uses electron-store with basic encryption for token obfuscation.
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

// --- Connection CRUD ---

export function getAllConnections(): SavedConnection[] {
  return store.get('connections', []);
}

export function getActiveConnectionId(): string | null {
  return store.get('activeConnectionId', null);
}

/** Returns the active connection, or null if none is set. */
export function getConnection(): SavedConnection | null {
  const id = getActiveConnectionId();
  if (!id) return null;
  const connections = getAllConnections();
  return connections.find((c) => c.id === id) ?? null;
}

export function addConnection(conn: Omit<SavedConnection, 'id'>): SavedConnection {
  const id = randomUUID();
  const saved: SavedConnection = { ...conn, id };
  const connections = getAllConnections();
  connections.push(saved);
  store.set('connections', connections);
  return saved;
}

export function updateConnection(conn: SavedConnection): void {
  const connections = getAllConnections();
  const idx = connections.findIndex((c) => c.id === conn.id);
  if (idx === -1) return;
  connections[idx] = conn;
  store.set('connections', connections);
}

export function deleteConnection(id: string): void {
  const connections = getAllConnections().filter((c) => c.id !== id);
  store.set('connections', connections);

  // Clear tokens for this connection
  const tokensByConnection = store.get('tokensByConnection', {});
  delete tokensByConnection[id];
  store.set('tokensByConnection', tokensByConnection);

  // If this was the active connection, clear it
  if (getActiveConnectionId() === id) {
    store.set('activeConnectionId', null);
  }
}

export function setActiveConnection(id: string): void {
  const connections = getAllConnections();
  if (!connections.some((c) => c.id === id)) return;
  store.set('activeConnectionId', id);
}

// --- Token operations (scoped to active connection) ---

export function getTokens(): StoredTokens | null {
  const id = getActiveConnectionId();
  if (!id) return null;
  const tokensByConnection = store.get('tokensByConnection', {});
  return tokensByConnection[id] ?? null;
}

export function setTokens(tokens: StoredTokens): void {
  const id = getActiveConnectionId();
  if (!id) return;
  const tokensByConnection = store.get('tokensByConnection', {});
  tokensByConnection[id] = tokens;
  store.set('tokensByConnection', tokensByConnection);
}

export function clearTokens(): void {
  const id = getActiveConnectionId();
  if (!id) return;
  const tokensByConnection = store.get('tokensByConnection', {});
  delete tokensByConnection[id];
  store.set('tokensByConnection', tokensByConnection);
}
