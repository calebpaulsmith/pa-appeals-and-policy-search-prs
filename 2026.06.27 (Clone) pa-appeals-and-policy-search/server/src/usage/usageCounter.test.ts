// Unit tests for the usage counter. Run: npm run test:usage

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  emptyCounts,
  mergeCounts,
  parseUsageCounts,
  serializeUsageCounts,
  UsageCounter,
} from "./usageCounter";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ FAIL: ${name}`);
  }
}

// --- parseUsageCounts ------------------------------------------------------
check("parses valid counts", (() => {
  const c = parseUsageCounts('{"deterministic": 5, "semantic": 3}');
  return c.deterministic === 5 && c.semantic === 3;
})());
check("malformed JSON -> zeros", (() => {
  const c = parseUsageCounts("not json");
  return c.deterministic === 0 && c.semantic === 0;
})());
check("missing fields -> zeros", (() => {
  const c = parseUsageCounts("{}");
  return c.deterministic === 0 && c.semantic === 0;
})());
check("negative values sanitized to 0", (() => {
  const c = parseUsageCounts('{"deterministic": -4, "semantic": 2}');
  return c.deterministic === 0 && c.semantic === 2;
})());
check("non-numeric values sanitized to 0", (() => {
  const c = parseUsageCounts('{"deterministic": "abc", "semantic": 7}');
  return c.deterministic === 0 && c.semantic === 7;
})());
check("floats floored", (() => {
  const c = parseUsageCounts('{"deterministic": 5.9, "semantic": 3.2}');
  return c.deterministic === 5 && c.semantic === 3;
})());

// --- serializeUsageCounts --------------------------------------------------
check("serialize includes derived total", (() => {
  const json = serializeUsageCounts({ deterministic: 4, semantic: 6 }, "2026-06-30T00:00:00.000Z");
  const obj = JSON.parse(json);
  return obj.total === 10 && obj.deterministic === 4 && obj.semantic === 6;
})());
check("serialize round-trips through parse", (() => {
  const original = { deterministic: 11, semantic: 22 };
  const c = parseUsageCounts(serializeUsageCounts(original, "x"));
  return c.deterministic === 11 && c.semantic === 22;
})());

// --- mergeCounts -----------------------------------------------------------
check("merge takes per-field max", (() => {
  const m = mergeCounts({ deterministic: 5, semantic: 2 }, { deterministic: 3, semantic: 9 });
  return m.deterministic === 5 && m.semantic === 9;
})());
check("emptyCounts is zeroed", emptyCounts().deterministic === 0 && emptyCounts().semantic === 0);

// --- UsageCounter: in-memory (no dir) --------------------------------------
check("in-memory counter increments", (() => {
  const counter = new UsageCounter("");
  counter.init();
  counter.increment("deterministic");
  counter.increment("deterministic");
  counter.increment("semantic");
  const s = counter.snapshot();
  return s.deterministic === 2 && s.semantic === 1 && s.total === 3;
})());
check("in-memory counter reports not persisted", (() => {
  const counter = new UsageCounter("");
  return counter.snapshot().persisted === false;
})());

// --- UsageCounter: persistence (temp dir) ----------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-test-"));
try {
  check("persists and flushes to disk", (() => {
    const counter = new UsageCounter(tmpDir);
    counter.init();
    counter.increment("deterministic");
    counter.increment("semantic");
    counter.increment("semantic");
    counter.flush();
    const file = path.join(tmpDir, "search_usage.json");
    if (!fs.existsSync(file)) return false;
    const persisted = parseUsageCounts(fs.readFileSync(file, "utf8"));
    return persisted.deterministic === 1 && persisted.semantic === 2;
  })());

  check("reloads baseline on init", (() => {
    // A fresh counter over the same dir should pick up the prior totals.
    const counter = new UsageCounter(tmpDir);
    counter.init();
    const s = counter.snapshot();
    return s.deterministic === 1 && s.semantic === 2 && s.total === 3;
  })());

  check("increments accumulate on top of baseline", (() => {
    const counter = new UsageCounter(tmpDir);
    counter.init();
    counter.increment("deterministic");
    counter.flush();
    const persisted = parseUsageCounts(
      fs.readFileSync(path.join(tmpDir, "search_usage.json"), "utf8")
    );
    return persisted.deterministic === 2 && persisted.semantic === 2;
  })());

  check("persisted counter reports persisted=true", (() => {
    const counter = new UsageCounter(tmpDir);
    counter.init();
    return counter.snapshot().persisted === true;
  })());
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
