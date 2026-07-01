// Data-source abstraction. DEMO MODE uses an in-memory fabricated corpus;
// PILOT/PRODUCTION query the governed Delta index via a SQL warehouse.

export interface PageRow {
  documentId: string;
  fileName: string;
  pageNumber: number;
  pageText: string;
  normalizedText: string;
}

export interface DocumentRow {
  documentId: string;
  fileName: string;
  relativePath: string;
  /** Absolute path under the approved volume (empty in demo). */
  volumePath: string;
  pageCount: number;
}

export interface IndexStats {
  documentCount: number;
  pageCount: number;
  lastIndexedAt: string;
}

/** One file in the corpus ledger (a document, not a chunk/page). */
export interface LedgerEntry {
  documentId: string;
  fileName: string;
  /** Folder/relative path within the volume, or the filename when unknown. */
  relativePath: string;
  pageCount: number;
  chunkCount: number;
  /** Bytes; null when the volume is unconfigured or unreadable by the app SP. */
  fileSize: number | null;
  /** ISO timestamp; null when the volume is unconfigured or unreadable. */
  modifiedAt: string | null;
}

export interface IndexSource {
  readonly kind: "demo" | "sql";
  stats(): Promise<IndexStats>;
  /**
   * Fetch candidate pages for precise in-app evaluation. `literals` are the
   * validated positive literal strings (never raw user query text). An empty
   * list means "no coarse prefilter possible" — caller bounds with `limit`.
   */
  fetchCandidatePages(literals: string[], limit: number): Promise<PageRow[]>;
  getDocument(documentId: string): Promise<DocumentRow | null>;
  /** List every document in the corpus (for the ledger tab), capped at `limit`. */
  listDocuments(limit: number): Promise<LedgerEntry[]>;
  /** Demo-only: synthesize a PDF for a fabricated document. Returns null otherwise. */
  getDemoPdf?(documentId: string): Promise<Buffer | null>;
}
