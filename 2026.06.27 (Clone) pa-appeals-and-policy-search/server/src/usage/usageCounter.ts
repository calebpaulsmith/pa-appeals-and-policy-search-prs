// Usage counter for searches (deterministic + semantic).
//
// The counter is authoritative in memory for the process lifetime and is
// debounce-flushed to a JSON file in a governed Volume so the totals survive
// restarts. Persistence is best-effort: if the Volume is unconfigured or the
// app service principal lacks WRITE VOLUME (the common case until grants land),
// the counter silently degrades to in-memory only — searches are still counted,
// the totals just reset on restart.

import fs from "node:fs";
import path from "node:path";

export type SearchKind = "deterministic" | "semantic";

export interface UsageCounts {
  deterministic: number;
  semantic: number;
}

export interface UsageSnapshot extends UsageCounts {
  total: number;
  persisted: boolean;
}

const FILE_NAME = "search_usage.json";
const FLUSH_DEBOUNCE_MS = 4000;

export function emptyCounts(): UsageCounts {
  return { deterministic: 0, semantic: 0 };
}

function sanitizeCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Parse persisted counter JSON defensively; any malformed input yields zeros. */
export function parseUsageCounts(raw: string): UsageCounts {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return {
      deterministic: sanitizeCount(obj?.deterministic),
      semantic: sanitizeCount(obj?.semantic),
    };
  } catch {
    return emptyCounts();
  }
}

/** Serialize counts for persistence. `total` is derived for human readability. */
export function serializeUsageCounts(counts: UsageCounts, updatedAt: string): string {
  return JSON.stringify(
    {
      deterministic: counts.deterministic,
      semantic: counts.semantic,
      total: counts.deterministic + counts.semantic,
      updatedAt,
    },
    null,
    2
  );
}

/** Per-field max merge — keeps the counter monotonic if the file changed under us. */
export function mergeCounts(a: UsageCounts, b: UsageCounts): UsageCounts {
  return {
    deterministic: Math.max(a.deterministic, b.deterministic),
    semantic: Math.max(a.semantic, b.semantic),
  };
}

export class UsageCounter {
  private counts: UsageCounts = emptyCounts();
  private readonly filePath: string | null;
  private persistEnabled: boolean;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dir: string) {
    const clean = (dir || "").trim();
    this.filePath = clean ? path.join(clean, FILE_NAME) : null;
    this.persistEnabled = !!this.filePath;
  }

  /** Load the persisted baseline (synchronous; called once at startup). */
  init(): void {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        this.counts = parseUsageCounts(fs.readFileSync(this.filePath, "utf8"));
      }
    } catch (err) {
      // Readable-but-broken or unreadable: start from zero, keep persistence on
      // so a later successful flush can re-establish the file.
      console.warn(`[usage] Could not read baseline: ${(err as Error).message}`);
    }
  }

  increment(kind: SearchKind): void {
    this.counts[kind] += 1;
    this.scheduleFlush();
  }

  snapshot(): UsageSnapshot {
    return {
      deterministic: this.counts.deterministic,
      semantic: this.counts.semantic,
      total: this.counts.deterministic + this.counts.semantic,
      persisted: this.persistEnabled,
    };
  }

  private scheduleFlush(): void {
    if (!this.persistEnabled) return;
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_DEBOUNCE_MS);
    // Don't keep the event loop alive solely for a pending flush.
    this.flushTimer.unref?.();
  }

  /** Write current counts to the Volume. Disables persistence on failure. */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.dirty || !this.filePath || !this.persistEnabled) return;
    this.dirty = false;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      let onDisk = emptyCounts();
      if (fs.existsSync(this.filePath)) {
        onDisk = parseUsageCounts(fs.readFileSync(this.filePath, "utf8"));
      }
      this.counts = mergeCounts(this.counts, onDisk);
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, serializeUsageCounts(this.counts, new Date().toISOString()));
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      // Most likely the SP can't write the Volume yet. Stop trying (avoids log
      // spam) and keep counting in memory; a restart after the grant re-enables.
      this.persistEnabled = false;
      console.warn(`[usage] Persistence disabled, counting in memory only: ${(err as Error).message}`);
    }
  }
}

let instance: UsageCounter | null = null;

export function getUsageCounter(dir: string): UsageCounter {
  if (!instance) {
    instance = new UsageCounter(dir);
    instance.init();
  }
  return instance;
}

/** Test-only: reset the module singleton. */
export function __resetUsageCounterForTests(): void {
  instance = null;
}
