// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * containers.json in the app's user-data folder: the install ID, the engine
 * choice and the containers this install created. Nothing in it is secret,
 * so it is plain JSON (no encryption key to pretend otherwise): of the
 * containers' environment variables it keeps the names only, never the values.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EngineChoice, ManagedContainer } from './types';

interface StoreData {
  schemaVersion: 1;
  installId: string;
  engineChoice: EngineChoice;
  owned: Record<string, ManagedContainer>;
}

const fresh = (): StoreData => ({ schemaVersion: 1, installId: randomUUID(), engineChoice: 'auto', owned: {} });

export class ContainerStore {
  private data: StoreData;

  constructor(private readonly file: string) {
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<StoreData>;
      if (raw.schemaVersion !== 1 || typeof raw.installId !== 'string' || !raw.owned || typeof raw.owned !== 'object') {
        return fresh();
      }
      const choice = raw.engineChoice === 'podman' || raw.engineChoice === 'docker' ? raw.engineChoice : 'auto';
      // Records from before variables and folders existed.
      for (const record of Object.values(raw.owned)) {
        record.options = { ...record.options, envNames: record.options?.envNames ?? [], mounts: record.options?.mounts ?? [] };
      }
      return { schemaVersion: 1, installId: raw.installId, engineChoice: choice, owned: raw.owned };
    } catch {
      return fresh();
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  get installId(): string {
    return this.data.installId;
  }

  get engineChoice(): EngineChoice {
    return this.data.engineChoice;
  }

  setEngineChoice(choice: EngineChoice): void {
    this.data.engineChoice = choice;
    this.save();
  }

  list(): ManagedContainer[] {
    return Object.values(this.data.owned).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(managedId: string): ManagedContainer | null {
    return this.data.owned[managedId] ?? null;
  }

  put(record: ManagedContainer): void {
    this.data.owned[record.managedId] = record;
    this.save();
  }

  remove(managedId: string): void {
    delete this.data.owned[managedId];
    this.save();
  }
}
