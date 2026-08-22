import type { EntryState } from "../lib/supabase";

const CFG: Record<EntryState, { label: string; cls: string; dot: string }> = {
  AWAITING_ACTUAL: {
    label: "Awaiting actual",
    cls: "bg-amber-50 text-amber-900 border-amber-200",
    dot: "bg-amber-400",
  },
  AWAITING_PRICE: {
    label: "Awaiting price",
    cls: "bg-orange-50 text-orange-900 border-orange-200",
    dot: "bg-orange-500",
  },
  FINALIZED: {
    label: "Finalized",
    cls: "bg-green-50 text-green-900 border-green-200",
    dot: "bg-green-500",
  },
};

export function StateBadge({ state }: { state: EntryState }) {
  const c = CFG[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full border ${c.cls}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

export function relativeAgo(ts: string): string {
  const then = new Date(ts).getTime();
  const now = Date.now();
  const s = Math.max(1, Math.floor((now - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
