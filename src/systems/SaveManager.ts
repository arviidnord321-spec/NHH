/**
 * SaveManager: one authoritative backend per environment (CrazyGames Data or
 * localStorage). Reads + validates before any defaults are written; a
 * malformed or newer save is preserved under a backup key and never silently
 * overwritten. Writes are serialized, size-checked and failures are surfaced.
 */
import { SAVE } from '../data/balance';
import { createDefaultSave, SaveData, validateSave } from '../core/state';
import type { StorageBackend } from './PlatformAdapter';

export type LoadOutcome =
  | { kind: 'fresh'; data: SaveData }
  | { kind: 'loaded'; data: SaveData; repaired: string[] }
  | { kind: 'problem'; reason: 'malformed' | 'newer' | 'unavailable'; detail: string; raw: string | null };

export class SaveManager {
  private writing: Promise<void> = Promise.resolve();
  private pending = false;
  lastError: string | null = null;
  lastSavedAt = 0;
  /** blocks writes when the stored save could not be understood */
  locked = false;

  constructor(public backend: StorageBackend) {}

  async load(): Promise<LoadOutcome> {
    let raw: string | null;
    try {
      raw = await this.backend.getItem(SAVE.key);
    } catch (e) {
      this.locked = true;
      return { kind: 'problem', reason: 'unavailable', detail: String(e), raw: null };
    }
    if (raw === null || raw === '') return { kind: 'fresh', data: createDefaultSave() };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.locked = true;
      return { kind: 'problem', reason: 'malformed', detail: 'Save data is not valid JSON.', raw };
    }
    const r = validateSave(parsed);
    if (!r.ok) {
      this.locked = true;
      return { kind: 'problem', reason: r.reason, detail: r.detail, raw };
    }
    return { kind: 'loaded', data: r.data, repaired: r.repaired };
  }

  /** Recovery path chosen by the player: back up the old data, then start fresh. */
  async backupAndReset(raw: string | null): Promise<SaveData> {
    if (raw) {
      try { await this.backend.setItem(`${SAVE.key}_backup_${Date.now()}`, raw); } catch { /* best effort */ }
    }
    this.locked = false;
    const d = createDefaultSave();
    await this.save(d);
    return d;
  }

  /** Continue without saving (e.g. newer-version save on an old build). */
  keepReadOnly() { this.locked = true; }

  save(data: SaveData): Promise<void> {
    if (this.locked) return Promise.resolve();
    if (this.pending) return this.writing;
    this.pending = true;
    this.writing = this.writing.then(async () => {
      this.pending = false;
      data.savedAt = Date.now();
      const json = JSON.stringify(data);
      if (json.length > 900_000) {
        this.lastError = 'Save too large';
        return;
      }
      try {
        await this.backend.setItem(SAVE.key, json);
        this.lastError = null;
        this.lastSavedAt = Date.now();
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
      }
    });
    return this.writing;
  }

  async wipe(): Promise<SaveData> {
    this.locked = false;
    await this.backend.removeItem(SAVE.key);
    const d = createDefaultSave();
    await this.save(d);
    return d;
  }
}
