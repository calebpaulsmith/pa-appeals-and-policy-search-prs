import type { AdminRunStatus, AdminStats, Corpus, SearchResponse, StatusResponse } from "./types";

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch("/api/status");
  return (await res.json()) as StatusResponse;
}

export async function fetchCorpora(): Promise<Corpus[]> {
  try {
    const res = await fetch("/api/corpora");
    if (!res.ok) return [];
    const data = (await res.json()) as { corpora?: Corpus[] };
    return Array.isArray(data.corpora) ? data.corpora : [];
  } catch {
    return [];
  }
}

export async function fetchSearch(query: string, corpusId?: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (corpusId && corpusId !== "all") params.set("corpus", corpusId);
  const res = await fetch(`/api/search?${params.toString()}`);
  return (await res.json()) as SearchResponse;
}

export async function fetchSemanticSearch(
  query: string,
  numResults = 10,
  corpusId?: string
): Promise<SearchResponse> {
  const res = await fetch("/api/semantic-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      numResults,
      ...(corpusId && corpusId !== "all" ? { corpus: corpusId } : {}),
    }),
  });
  return (await res.json()) as SearchResponse;
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const res = await fetch("/api/admin/stats");
  return readJson<AdminStats>(res);
}

export async function triggerRefresh(): Promise<{ runId: string; message: string }> {
  const res = await fetch("/api/admin/refresh", { method: "POST" });
  return readJson<{ runId: string; message: string }>(res);
}

export async function fetchRunStatus(runId: string): Promise<AdminRunStatus> {
  const res = await fetch(`/api/admin/status/${encodeURIComponent(runId)}`);
  return readJson<AdminRunStatus>(res);
}

export interface AdminCheck {
  admin: boolean;
  jobTriggerEnabled: boolean;
}

export async function fetchAdminCheck(): Promise<AdminCheck> {
  try {
    const res = await fetch("/api/admin/check");
    if (!res.ok) return { admin: false, jobTriggerEnabled: false };
    const data = (await res.json()) as Partial<AdminCheck>;
    return { admin: data.admin === true, jobTriggerEnabled: data.jobTriggerEnabled === true };
  } catch {
    return { admin: false, jobTriggerEnabled: false };
  }
}

export async function checkAdminAccess(): Promise<boolean> {
  return (await fetchAdminCheck()).admin;
}

export function pdfUrl(documentId: string): string {
  return `/pdf/${encodeURIComponent(documentId)}`;
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : "";
    const error = typeof data?.error === "string" ? data.error : "Request failed.";
    throw new Error(detail ? `${error} ${detail}` : error);
  }
  return data as T;
}
