import { useEffect, useMemo, useState } from "react";
import { fetchLedger } from "../api";
import type { Corpus, LedgerEntry, LedgerResponse } from "../types";
import { PdfReader } from "./PdfReader";

interface Props {
  corpora: Corpus[];
  selectedCorpus: string;
}

interface Selected {
  documentId: string;
  fileName: string;
}

export function LedgerPanel({ corpora, selectedCorpus }: Props) {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Selected | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetchLedger(selectedCorpus)
      .then((res) => {
        if (!active) return;
        if (res.ok) setData(res);
        else setError(res.error || "Could not load the document ledger.");
      })
      .catch(() => active && setError("Could not reach the ledger service."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [selectedCorpus]);

  const corpusName = useMemo(() => {
    if (corpora.length <= 1) return corpora[0]?.displayName ?? "";
    return corpora.find((c) => c.id === selectedCorpus)?.displayName ?? "All corpora";
  }, [corpora, selectedCorpus]);

  const entries = useMemo(() => {
    const list = data?.entries ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (e) => e.fileName.toLowerCase().includes(q) || e.relativePath.toLowerCase().includes(q)
    );
  }, [data, filter]);

  // Whether the volume is configured but unreadable (all sizes null) — a signal
  // that the app SP still lacks READ VOLUME.
  const volumeBlocked =
    !!data?.volumeConfigured &&
    (data?.entries.length ?? 0) > 0 &&
    (data?.entries ?? []).every((e) => e.fileSize === null);

  return (
    <div className={`ledger${selected ? " ledger--reading" : ""}`}>
      <section className="ledger-list-pane" aria-label="Document ledger">
        <div className="ledger-head">
          <div>
            <h2>Document Ledger{corpusName ? ` — ${corpusName}` : ""}</h2>
            <p className="muted">
              {loading
                ? "Loading documents…"
                : `${(data?.entries.length ?? 0).toLocaleString()} document${
                    (data?.entries.length ?? 0) === 1 ? "" : "s"
                  }${data?.truncated ? " (showing the first page of results)" : ""}`}
            </p>
          </div>
          <input
            className="ledger-filter"
            type="search"
            placeholder="Filter by name or folder…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter documents"
          />
        </div>

        {volumeBlocked && (
          <p className="ledger-note">
            File size and last-modified are unavailable because the app service
            principal cannot yet read the source volume. They will appear once{" "}
            <code>READ VOLUME</code> is granted.
          </p>
        )}

        {error ? (
          <div className="results-error" role="alert">
            <strong>Ledger unavailable</strong>
            <p>{error}</p>
          </div>
        ) : (
          <div className="ledger-table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Folder</th>
                  <th scope="col" className="num">
                    Pages
                  </th>
                  <th scope="col" className="num">
                    Size
                  </th>
                  <th scope="col">Modified</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <LedgerRow
                    key={entry.documentId}
                    entry={entry}
                    active={selected?.documentId === entry.documentId}
                    onOpen={() =>
                      setSelected({ documentId: entry.documentId, fileName: entry.fileName })
                    }
                  />
                ))}
                {!loading && entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="ledger-empty">
                      {filter ? "No documents match that filter." : "No documents in this corpus."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <section className="ledger-reader-pane" aria-label="Document reader">
          <div className="ledger-reader-head">
            <span className="ledger-reader-title" title={selected.fileName}>
              {selected.fileName}
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <PdfReader
            documentId={selected.documentId}
            fileName={selected.fileName}
            initialPage={1}
            highlightTerms={[]}
            onPageChange={() => undefined}
          />
        </section>
      )}
    </div>
  );
}

function LedgerRow({
  entry,
  active,
  onOpen,
}: {
  entry: LedgerEntry;
  active: boolean;
  onOpen: () => void;
}) {
  const folder = folderOf(entry.relativePath, entry.fileName);
  return (
    <tr className={active ? "active" : ""} onClick={onOpen} tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <td className="ledger-file" title={entry.fileName}>
        {entry.fileName}
      </td>
      <td className="ledger-folder" title={folder}>
        {folder || "—"}
      </td>
      <td className="num">{entry.pageCount ? entry.pageCount.toLocaleString() : "—"}</td>
      <td className="num">{entry.fileSize === null ? "—" : formatBytes(entry.fileSize)}</td>
      <td>{entry.modifiedAt ? formatDate(entry.modifiedAt) : "—"}</td>
    </tr>
  );
}

function folderOf(relativePath: string, fileName: string): string {
  if (!relativePath || relativePath === fileName) return "";
  const idx = relativePath.lastIndexOf("/");
  return idx > 0 ? relativePath.slice(0, idx) : "";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
