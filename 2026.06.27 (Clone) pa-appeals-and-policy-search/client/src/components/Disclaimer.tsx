import { useEffect, useState } from "react";
import { fetchLastUpload } from "../api";
import type { LastUpload } from "../types";

const DISCLAIMER_TEXT =
  "FEMA Advanced Search helps locate language across appeal and policy PDFs. " +
  "It does not make eligibility determinations, provide legal or policy advice, " +
  "or replace official source records. Original documents remain the authoritative source.";

export function Disclaimer() {
  const [upload, setUpload] = useState<LastUpload | null>(null);

  useEffect(() => {
    fetchLastUpload()
      .then(setUpload)
      .catch(() => setUpload(null));
  }, []);

  return (
    <div className="disclaimer" role="note">
      <div className="disclaimer-title">
        <span className="lock" aria-hidden>
          ⚖
        </span>
        Disclaimer
      </div>
      <p>{DISCLAIMER_TEXT}</p>
      {upload?.name && (
        <div className="disclaimer-upload">
          Last document added: <strong>{upload.name}</strong>
          {upload.modifiedAt ? ` · ${formatDate(upload.modifiedAt)}` : ""}
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
