import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkAdminAccess,
  fetchCorpora,
  fetchSearch,
  fetchSemanticSearch,
  fetchStatus,
  fetchUsage,
} from "./api";
import type {
  Corpus,
  SearchMode,
  SearchResponse,
  SearchResult,
  StatusResponse,
  UsageSnapshot,
} from "./types";
import { SearchPanel } from "./components/SearchPanel";
import { ResultsList } from "./components/ResultsList";
import { PdfReader } from "./components/PdfReader";
import { StatusBar } from "./components/StatusBar";
import { AdminPanel } from "./components/AdminPanel";
import { LedgerPanel } from "./components/LedgerPanel";
import { UsageFooter } from "./components/UsageFooter";

type AppTab = "search" | "ledger" | "admin";

interface Selection {
  documentId: string;
  fileName: string;
  pageNumber: number;
  highlightTerms: string[];
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get("q") ?? "",
    doc: params.get("doc") ?? "",
    fileName: params.get("fn") ?? "",
    page: parseInt(params.get("page") ?? "", 10) || 1,
  };
}

function writeUrlState(q: string, sel: Selection | null) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (sel?.documentId) {
    params.set("doc", sel.documentId);
    params.set("fn", sel.fileName);
    params.set("page", String(sel.pageNumber));
  }
  const qs = params.toString();
  const url = qs ? `?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

export function App() {
  const initial = useRef(readUrlState());
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("search");
  const [isAdmin, setIsAdmin] = useState(false);
  const [mode, setMode] = useState<SearchMode>("deterministic");
  const [query, setQuery] = useState(initial.current.q);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [corpora, setCorpora] = useState<Corpus[]>([]);
  const [selectedCorpus, setSelectedCorpus] = useState<string>("all");
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [selection, setSelection] = useState<Selection | null>(
    initial.current.doc
      ? {
          documentId: initial.current.doc,
          fileName: initial.current.fileName,
          pageNumber: initial.current.page,
          highlightTerms: [],
        }
      : null
  );

  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
    checkAdminAccess()
      .then(setIsAdmin)
      .catch(() => setIsAdmin(false));
    fetchCorpora()
      .then((list) => {
        setCorpora(list);
        if (list.length === 1) setSelectedCorpus(list[0].id);
      })
      .catch(() => setCorpora([]));
    fetchUsage().then(setUsage).catch(() => setUsage(null));
  }, []);

  useEffect(() => {
    if (!isAdmin && activeTab === "admin") setActiveTab("search");
  }, [isAdmin, activeTab]);

  const runSearch = useCallback(
    async (q: string, selectedMode: SearchMode, corpusId: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      setSearching(true);
      setSelection(null);
      try {
        const res =
          selectedMode === "semantic"
            ? await fetchSemanticSearch(trimmed, 10, corpusId)
            : await fetchSearch(trimmed, corpusId);
        setResponse(res);
      } catch {
        setResponse({
          ok: false,
          error: "Could not reach the search service.",
          query: trimmed,
          results: [],
          candidatesScanned: 0,
          truncated: false,
        });
      } finally {
        setSearching(false);
        // Reflect the just-counted search in the footer.
        fetchUsage().then(setUsage).catch(() => undefined);
      }
    },
    []
  );

  useEffect(() => {
    if (initial.current.q) void runSearch(initial.current.q, "deterministic", selectedCorpus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeUrlState(query, selection);
  }, [query, selection]);

  const handleSubmit = useCallback(
    (q: string, selectedMode: SearchMode) => {
      setQuery(q);
      setMode(selectedMode);
      void runSearch(q, selectedMode, selectedCorpus);
    },
    [runSearch, selectedCorpus]
  );

  const handleCorpusChange = useCallback(
    (id: string) => {
      setSelectedCorpus(id);
      if (query.trim()) {
        void runSearch(query, mode, id);
      }
    },
    [query, mode, runSearch]
  );

  const handleClear = useCallback(() => {
    setQuery("");
    setResponse(null);
    setSelection(null);
  }, []);

  const handleSelect = useCallback((r: SearchResult) => {
    setSelection({
      documentId: r.matchType === "semantic" ? "" : r.documentId,
      fileName: r.fileName,
      pageNumber: r.pageNumber,
      highlightTerms: r.highlightTerms,
    });
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
          </span>
          <div>
            <h1>FEMA Advanced Search</h1>
            <p className="subtitle">Search appeal and policy documents across governed FEMA corpora</p>
          </div>
        </div>
        <StatusBar status={status} />
      </header>

      <nav className="app-tabs" aria-label="Application tabs">
        <button
          type="button"
          className={activeTab === "search" ? "active" : ""}
          onClick={() => setActiveTab("search")}
        >
          Search
        </button>
        <button
          type="button"
          className={activeTab === "ledger" ? "active" : ""}
          onClick={() => setActiveTab("ledger")}
        >
          Ledger
        </button>
        {isAdmin && (
          <button
            type="button"
            className={activeTab === "admin" ? "active" : ""}
            onClick={() => setActiveTab("admin")}
          >
            Admin
          </button>
        )}
      </nav>

      {activeTab === "search" && (
        <main className="panels">
          <section className="panel panel-left" aria-label="Search controls">
            <SearchPanel
              query={query}
              searching={searching}
              mode={mode}
              corpora={corpora}
              selectedCorpus={selectedCorpus}
              onCorpusChange={handleCorpusChange}
              onModeChange={setMode}
              onSubmit={handleSubmit}
              onClear={handleClear}
            />
          </section>

          <section className="panel panel-middle" aria-label="Search results">
            <ResultsList
              response={response}
              searching={searching}
              selectedDocId={selection?.documentId}
              selectedPage={selection?.pageNumber}
              onSelect={handleSelect}
            />
          </section>

          <section className="panel panel-right" aria-label="Document reader">
            <PdfReader
              documentId={selection?.documentId || null}
              fileName={selection?.fileName ?? ""}
              initialPage={selection?.pageNumber ?? 1}
              highlightTerms={selection?.highlightTerms ?? []}
              onPageChange={(page) =>
                setSelection((prev) => (prev ? { ...prev, pageNumber: page } : prev))
              }
            />
          </section>
        </main>
      )}

      {activeTab === "ledger" && (
        <main className="ledger-main">
          <LedgerPanel corpora={corpora} selectedCorpus={selectedCorpus} />
        </main>
      )}

      {activeTab === "admin" && (
        <main className="admin-main">
          <AdminPanel />
        </main>
      )}

      <UsageFooter usage={usage} />
    </div>
  );
}
