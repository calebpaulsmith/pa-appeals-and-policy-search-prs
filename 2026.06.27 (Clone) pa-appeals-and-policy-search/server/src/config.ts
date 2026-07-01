// Runtime configuration + mode resolution.
//
// Precedence: environment variables > config.yaml > built-in defaults.
// When the source volume / index tables / warehouse are NOT configured, the
// app runs in clearly-labeled DEMO MODE with fabricated records only.

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import dotenv from "dotenv";

dotenv.config();

export type AppMode = "demo" | "pilot" | "production";

export interface Corpus {
  id: string;
  displayName: string;
  chunksTableFqn: string;
  vsIndexName: string;
}

export interface AppConfig {
  mode: AppMode;
  appealsVolumePath: string; // "" in demo mode
  indexCatalog: string;
  indexSchema: string;
  documentsTable: string; // unqualified name
  pagesTable: string; // unqualified name
  documentsTableFqn: string; // catalog.schema.table or "" in demo
  pagesTableFqn: string;
  // Chunks table behind the Vector Search index. Carries the real extracted
  // text (chunk_text) and is used for deterministic/keyword search when the
  // dedicated documents/pages page-index tables have not been built.
  chunksTableFqn: string;
  pilotMaxFiles: number;
  warehouseId: string;
  databricksHost: string;
  vsIndexName: string;
  vsEndpointName: string;
  processorNotebookPath: string;
  hasWarehouse: boolean;
  // Admin access control
  adminUsers: string[]; // Lowercase email addresses allowed to use admin routes
  // Whether the app may trigger/inspect Databricks Jobs. Off by default because
  // the forwarded user token usually lacks the `jobs` OAuth scope; ingestion is
  // expected to run via a scheduled processor pipeline instead.
  enableJobTrigger: boolean;
  // Searchable corpora (config-driven; currently one corpus derived from VS index)
  corpora: Corpus[];
  // Directory (governed Volume) where the usage counter JSON is persisted. Empty
  // when unconfigured — the counter then lives in memory only and resets on
  // restart. Persisting requires the app SP to have WRITE VOLUME on this path.
  usageCounterDir: string;
  // hard caps
  maxCandidatePages: number;
  maxResults: number;
  maxLedgerRows: number;
}

interface YamlConfig {
  appeals_volume_path?: string;
  index_catalog?: string;
  index_schema?: string;
  documents_table?: string;
  pages_table?: string;
  pilot_max_files?: number;
}

function loadYaml(): YamlConfig {
  const configPath = process.env.CONFIG_PATH || "config.yaml";
  const abs = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(abs)) return {};
  try {
    const raw = fs.readFileSync(abs, "utf8");
    const parsed = yaml.load(raw) as YamlConfig | undefined;
    return parsed ?? {};
  } catch (err) {
    console.warn(`[config] Could not parse ${abs}: ${(err as Error).message}`);
    return {};
  }
}

function isPlaceholder(v: string | undefined): boolean {
  return !v || v.includes("REPLACE_ME") || v.trim() === "";
}

function buildFqn(catalog: string, schema: string, table: string): string {
  if (isPlaceholder(catalog) || isPlaceholder(schema) || !table) return "";
  return `${catalog}.${schema}.${table}`;
}

/**
 * The Vector Search index name (e.g. `cat.schema.foo_chunks_vs_index`) is backed
 * by a Delta source table of the same name without the trailing `_index`
 * (`cat.schema.foo_chunks_vs`). We can therefore run keyword search against the
 * source table without any extra configuration. An explicit `CHUNKS_TABLE`
 * always wins.
 */
function deriveChunksTable(vsIndexName: string): string {
  const name = (vsIndexName || "").trim();
  if (!name) return "";
  return name.replace(/_index$/, "");
}

/**
 * Derive a stable corpus ID from a fully-qualified chunks table name.
 * `cat.schema.pa_appeals_chunks_vs` → `pa_appeals`
 */
function deriveCorpusId(chunksTableFqn: string): string {
  if (!chunksTableFqn) return "default";
  const table = chunksTableFqn.split(".").pop() ?? "default";
  return table.replace(/_chunks.*$/, "").replace(/_vs$/, "") || "default";
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const y = loadYaml();

  const appealsVolumePath = (process.env.APPEALS_VOLUME_PATH || y.appeals_volume_path || "").trim();
  const indexCatalog = (process.env.INDEX_CATALOG || y.index_catalog || "").trim();
  const indexSchema = (process.env.INDEX_SCHEMA || y.index_schema || "").trim();
  const documentsTable = (y.documents_table || "appeal_research_documents").trim();
  const pagesTable = (y.pages_table || "appeal_research_pages").trim();
  const pilotMaxFiles = Number(y.pilot_max_files ?? 25) || 25;
  const warehouseId = (process.env.DATABRICKS_WAREHOUSE_ID || "").trim();
  const databricksHost = (process.env.DATABRICKS_HOST || "").trim();
  const vsIndexName = (process.env.VS_INDEX_NAME || "").trim();
  const vsEndpointName = (process.env.VS_ENDPOINT_NAME || "").trim();
  const processorNotebookPath = (
    process.env.PROCESSOR_NOTEBOOK_PATH ||
    "/Users/0492734585@fema.dhs.gov/pa-appeals-and-policy-search/PA Appeals PDF Incremental Processor"
  ).trim();

  const adminUsers = (process.env.ADMIN_USERS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // Env-provided fully-qualified table names take precedence if present.
  const documentsTableFqn =
    (process.env.DOCUMENTS_TABLE || "").trim() ||
    buildFqn(indexCatalog, indexSchema, documentsTable);
  const pagesTableFqn =
    (process.env.PAGES_TABLE || "").trim() || buildFqn(indexCatalog, indexSchema, pagesTable);

  const chunksTableFqn = (process.env.CHUNKS_TABLE || "").trim() || deriveChunksTable(vsIndexName);

  const volumeConfigured = !isPlaceholder(appealsVolumePath) && appealsVolumePath.startsWith("/Volumes/");
  const tablesConfigured = !!documentsTableFqn && !!pagesTableFqn;
  const chunksConfigured = !!chunksTableFqn;
  const hasWarehouse = !!warehouseId;

  // Leave demo mode when there is a SQL warehouse plus a searchable backend:
  // either the dedicated page-index tables (+ volume), or the Vector Search
  // chunks table (volume optional — it only enables PDF preview).
  let mode: AppMode = "demo";
  const pilotOrProd: AppMode = process.env.APP_MODE === "production" ? "production" : "pilot";
  if (hasWarehouse && volumeConfigured && tablesConfigured) {
    mode = pilotOrProd;
  } else if (hasWarehouse && chunksConfigured) {
    mode = pilotOrProd;
  }

  // Build the corpus list from the primary configured index. Additional corpora
  // can be added later via a CORPORA env var (JSON array) without schema changes.
  const corpusDisplayName = (process.env.CORPUS_DISPLAY_NAME || "PA Appeals").trim();
  const primaryCorpus: Corpus | null =
    chunksTableFqn
      ? {
          id: deriveCorpusId(chunksTableFqn),
          displayName: corpusDisplayName,
          chunksTableFqn,
          vsIndexName,
        }
      : null;
  const corpora: Corpus[] = primaryCorpus ? [primaryCorpus] : [];

  // Where to persist the usage counter. Accepts an explicit dir, or derives one
  // from the advanced_search_data volume convention if only the catalog/schema
  // are known. Only used when it points at a /Volumes/ path the SP can write.
  const usageCounterDir = (process.env.USAGE_COUNTER_DIR || "").trim();

  cached = {
    mode,
    appealsVolumePath: volumeConfigured ? appealsVolumePath : "",
    indexCatalog,
    indexSchema,
    documentsTable,
    pagesTable,
    documentsTableFqn,
    pagesTableFqn,
    chunksTableFqn,
    pilotMaxFiles,
    warehouseId,
    databricksHost,
    vsIndexName,
    vsEndpointName,
    processorNotebookPath,
    hasWarehouse,
    adminUsers,
    enableJobTrigger: (process.env.ENABLE_JOB_TRIGGER || "").trim().toLowerCase() === "true",
    corpora,
    usageCounterDir,
    maxCandidatePages: Number(process.env.MAX_CANDIDATE_PAGES || 2000),
    maxResults: Number(process.env.MAX_RESULTS || 100),
    maxLedgerRows: Number(process.env.MAX_LEDGER_ROWS || 5000),
  };
  return cached;
}

/** The port to bind: Databricks injects DATABRICKS_APP_PORT. */
export function getPort(): number {
  return Number(process.env.DATABRICKS_APP_PORT || process.env.PORT || 8080);
}
