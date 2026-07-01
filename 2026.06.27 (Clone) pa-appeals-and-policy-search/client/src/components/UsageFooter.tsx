import type { UsageSnapshot } from "../types";

interface Props {
  usage: UsageSnapshot | null;
}

const fmt = (n: number) => n.toLocaleString();

export function UsageFooter({ usage }: Props) {
  if (!usage) return null;
  return (
    <footer className="usage-footer" aria-label="Usage statistics">
      <span className="usage-total">{fmt(usage.total)} searches conducted</span>
      <span className="usage-breakdown">
        {fmt(usage.deterministic)} deterministic · {fmt(usage.semantic)} semantic
      </span>
    </footer>
  );
}
