// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Persistent storage for OAuth tokens and connection settings.
 * Supports multiple named connections with per-connection token storage.
 *
 * Secrets (access/refresh tokens, client secrets) are sealed with Electron's
 * safeStorage before they are written: DPAPI on Windows, the Keychain on
 * macOS, libsecret/KWallet on Linux. Where the OS offers no real encryption
 * (Linux without a keyring: safeStorage's 'basic_text' backend) secrets are
 * kept for this session only and never written to disk. The rest of the file
 * (connection names, URLs, client ids) is only obfuscated by electron-store's
 * fixed key, which is public in this repository: it is not protection.
 *
 * safeStorage protects against other OS users and offline disk access. On
 * Windows and Linux it does not protect against other programs running as the
 * same user.
 *
 * The decrypted contents are kept in memory (see "In-memory copy" below), so
 * reads never touch the disk; only writes do.
 */

import { safeStorage } from 'electron';
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

/** How the file holds a connection: the client secret sealed (2.14+) or, before 2.14, in plain. */
interface DiskConnection extends SavedConnection {
  clientSecretSealed?: string;
}

/** How the file holds a connection's tokens: sealed (2.14+) or, before 2.14, in plain. */
type DiskTokens = StoredTokens | { sealed: string };

interface DiskSchema extends Omit<StoreSchema, 'connections' | 'tokensByConnection'> {
  connections: DiskConnection[];
  tokensByConnection: Record<string, DiskTokens>;
}

// --- Store instance ---

const store = new Store<DiskSchema>({
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

    const saved: DiskConnection = { ...legacy, id, name };
    store.set('connections', [saved]);
    store.set('activeConnectionId', id);

    // Migrate tokens
    const legacyTokens = store.get('tokens') as StoredTokens | null | undefined;
    if (legacyTokens) {
      store.set('tokensByConnection', { [id]: legacyTokens });
    }

    // Remove legacy keys
    store.delete('connection' as keyof DiskSchema);
    store.delete('tokens' as keyof DiskSchema);
  }
}

migrateIfNeeded();

// --- In-memory copy ---
//
// The file is read and unsealed once, by initTokenStore() after app 'ready'
// (conf decrypts the whole file on every get, ~15 ms, and safeStorage is
// asynchronous). Reads then come from memory. A write replaces the copy at
// once and is sealed and written to disk in the background, in order, so the
// file always ends up with the latest state; flushTokenStore() waits for that
// before the app quits. This process is the store's only reader and writer.
let memory: StoreSchema | null = null;
let sealing = false;
let writeQueue: Promise<void> = Promise.resolve();

// --- Sealing secrets (safeStorage) ---

/** True when safeStorage gives real OS-backed encryption (not Linux 'basic_text'). */
async function detectSealing(): Promise<boolean> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
  if (process.platform === 'linux') {
    const backend = safeStorage.getSelectedStorageBackend();
    if (backend === 'basic_text' || backend === 'unknown') return false;
  }
  return true;
}

const seal = async (text: string): Promise<string> => (await safeStorage.encryptStringAsync(text)).toString('base64');

/** The secret, and whether safeStorage asks for it to be sealed again (key rotated). */
const unseal = async (sealed: string): Promise<{ text: string; reseal: boolean }> => {
  const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(sealed, 'base64'));
  return { text: result, reseal: shouldReEncrypt };
};

const isSealedTokens = (t: DiskTokens): t is { sealed: string } => typeof (t as { sealed?: unknown }).sealed === 'string';

/**
 * Read the file into memory, unsealing secrets. A secret that cannot be
 * unsealed (file copied from another user or machine, keyring reset) is
 * dropped: the user signs in again. Reports whether the file must be written
 * again: it still held secrets in plain (written before 2.14), or safeStorage
 * asked for re-encryption.
 */
async function fromDisk(disk: DiskSchema): Promise<{ schema: StoreSchema; rewrite: boolean }> {
  let rewrite = false;
  const connections: SavedConnection[] = [];
  for (const c of disk.connections ?? []) {
    const { clientSecretSealed, ...rest } = c;
    let clientSecret = rest.clientSecret ?? '';
    if (clientSecret) rewrite = true;
    if (clientSecretSealed && sealing) {
      try {
        const { text, reseal } = await unseal(clientSecretSealed);
        clientSecret = text;
        rewrite ||= reseal;
      } catch {
        clientSecret = '';
      }
    }
    connections.push({ ...rest, clientSecret });
  }
  const tokensByConnection: Record<string, StoredTokens> = {};
  for (const [id, t] of Object.entries(disk.tokensByConnection ?? {})) {
    if (!t) continue;
    if (isSealedTokens(t)) {
      if (!sealing) continue;
      try {
        const { text, reseal } = await unseal(t.sealed);
        tokensByConnection[id] = JSON.parse(text) as StoredTokens;
        rewrite ||= reseal;
      } catch {
        // cannot be unsealed here: sign in again
      }
    } else {
      rewrite = true;
      tokensByConnection[id] = t;
    }
  }
  return {
    schema: { connections, activeConnectionId: disk.activeConnectionId ?? null, tokensByConnection },
    rewrite,
  };
}

/** What is written to the file: secrets sealed, or left out when they cannot be sealed. */
async function toDisk(schema: StoreSchema): Promise<DiskSchema> {
  const connections: DiskConnection[] = [];
  for (const c of schema.connections) {
    const out: DiskConnection = { ...c, clientSecret: '' };
    if (c.clientSecret && sealing) out.clientSecretSealed = await seal(c.clientSecret);
    connections.push(out);
  }
  const tokensByConnection: Record<string, DiskTokens> = {};
  if (sealing) {
    for (const [id, t] of Object.entries(schema.tokensByConnection ?? {})) {
      tokensByConnection[id] = { sealed: await seal(JSON.stringify(t)) };
    }
  }
  return { connections, activeConnectionId: schema.activeConnectionId, tokensByConnection };
}

function persist(schema: StoreSchema): void {
  writeQueue = writeQueue
    .then(async () => {
      store.store = await toDisk(schema);
    })
    .catch((err) => {
      console.error('Could not save the connection settings:', err);
    });
}

/**
 * Read and unseal the store. Call once after app 'ready', before anything
 * reads connections or tokens. Secrets an earlier version wrote in plain are
 * sealed now, or removed from the file when they cannot be sealed (they stay
 * in memory for this session).
 */
export async function initTokenStore(): Promise<void> {
  sealing = await detectSealing();
  const { schema, rewrite } = await fromDisk(store.store);
  memory = schema;
  if (rewrite) persist(schema);
  await writeQueue;
}

/** Resolves when every write so far is on disk. */
export function flushTokenStore(): Promise<void> {
  return writeQueue;
}

/** True when secrets are kept for this session only (no OS encryption available). */
export function secretsAreSessionOnly(): boolean {
  return !sealing;
}

function current(): StoreSchema {
  if (!memory) throw new Error('Token store used before initTokenStore().');
  return memory;
}

function write(patch: Partial<StoreSchema>): void {
  const next: StoreSchema = { ...current(), ...patch };
  memory = next;
  persist(next);
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
