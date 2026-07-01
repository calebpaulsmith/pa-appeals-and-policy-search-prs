// In-memory demo data source. No external services, no real content.

import { normalizePlain } from "../search/normalize";
import { DEMO_DOCUMENTS, demoStats } from "./demoData";
import type { DocumentRow, IndexSource, IndexStats, LedgerEntry, PageRow } from "./source";
import { renderDemoPdf } from "../pdf/demoPdf";

export class DemoSource implements IndexSource {
  readonly kind = "demo" as const;

  async stats(): Promise<IndexStats> {
    return demoStats();
  }

  async fetchCandidatePages(literals: string[], limit: number): Promise<PageRow[]> {
    const rows: PageRow[] = [];
    for (const doc of DEMO_DOCUMENTS) {
      for (const page of doc.pages) {
        const normalized = normalizePlain(page.text);
        // Coarse prefilter to mirror the SQL path; precise matching happens later.
        if (literals.length === 0 || literals.some((l) => normalized.includes(l))) {
          rows.push({
            documentId: doc.documentId,
            fileName: doc.fileName,
            pageNumber: page.pageNumber,
            pageText: page.text,
            normalizedText: normalized,
          });
        }
        if (rows.length >= limit) return rows;
      }
    }
    return rows;
  }

  async getDocument(documentId: string): Promise<DocumentRow | null> {
    const doc = DEMO_DOCUMENTS.find((d) => d.documentId === documentId);
    if (!doc) return null;
    return {
      documentId: doc.documentId,
      fileName: doc.fileName,
      relativePath: doc.relativePath,
      volumePath: "", // demo documents have no real volume path
      pageCount: doc.pages.length,
    };
  }

  async listDocuments(limit: number): Promise<LedgerEntry[]> {
    // Deterministic fabricated metadata so the demo ledger looks realistic
    // without touching a filesystem: size scales with text length, dates step
    // back a day per document from a fixed anchor.
    const anchor = Date.UTC(2026, 5, 20); // 2026-06-20
    return DEMO_DOCUMENTS.slice(0, limit).map((doc, i) => {
      const textBytes = doc.pages.reduce((n, p) => n + p.text.length, 0);
      return {
        documentId: doc.documentId,
        fileName: doc.fileName,
        relativePath: doc.relativePath,
        pageCount: doc.pages.length,
        chunkCount: doc.pages.length, // one chunk per page in the demo
        fileSize: 40_000 + textBytes * 12,
        modifiedAt: new Date(anchor - i * 86_400_000).toISOString(),
      };
    });
  }

  async getDemoPdf(documentId: string): Promise<Buffer | null> {
    const doc = DEMO_DOCUMENTS.find((d) => d.documentId === documentId);
    if (!doc) return null;
    return renderDemoPdf(doc);
  }
}
