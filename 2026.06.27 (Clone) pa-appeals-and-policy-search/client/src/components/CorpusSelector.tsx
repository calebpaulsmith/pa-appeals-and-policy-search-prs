import type { Corpus } from "../types";

interface Props {
  corpora: Corpus[];
  selected: string; // corpus id or "all"
  onChange: (id: string) => void;
}

export function CorpusSelector({ corpora, selected, onChange }: Props) {
  if (corpora.length === 0) return null;

  // With only one corpus, render a static label — no interaction needed yet.
  if (corpora.length === 1) {
    return (
      <div className="corpus-selector corpus-selector--single">
        <span className="corpus-label">Corpus</span>
        <span className="corpus-pill corpus-pill--active">{corpora[0].displayName}</span>
      </div>
    );
  }

  return (
    <div className="corpus-selector" role="group" aria-label="Select corpus">
      <span className="corpus-label">Corpus</span>
      <button
        type="button"
        className={`corpus-pill${selected === "all" ? " corpus-pill--active" : ""}`}
        aria-pressed={selected === "all"}
        onClick={() => onChange("all")}
      >
        All
      </button>
      {corpora.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`corpus-pill${selected === c.id ? " corpus-pill--active" : ""}`}
          aria-pressed={selected === c.id}
          onClick={() => onChange(c.id)}
        >
          {c.displayName}
        </button>
      ))}
    </div>
  );
}
