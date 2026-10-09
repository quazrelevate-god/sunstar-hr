import { useMemo, useState } from "react";
import type { WorkEntry } from "../lib/supabase";

type Sort = "ratio-asc" | "ratio-desc" | "revenue-desc";

type ClientRow = {
  client: string;
  entries: number;
  totalActual: number;
  totalTarget: number;
  revenue: number;
  ratio: number;              // actual / target
  variance: number;           // actual - target (positive = overrun)
  percentUsed: number;        // (actual/target)*100 clamped for bar
  avgAedPerHr: number;
};

const ONPLAN_BAND = 0.03;

type Tone = "profit" | "onplan" | "loss" | "neutral";
function toneOfRatio(r: number, hasBoth: boolean): Tone {
  if (!hasBoth || !isFinite(r) || r <= 0) return "neutral";
  if (r < 1 - ONPLAN_BAND) return "profit";
  if (r > 1 + ONPLAN_BAND) return "loss";
  return "onplan";
}

const TONE: Record<Tone, {
  chipBg: string; chipText: string;
  ratioBg: string; ratioText: string;
  barBg: string; barFg: string;
  label: string; icon: string;
}> = {
  profit:  { chipBg: "bg-emerald-100", chipText: "text-emerald-700",
             ratioBg: "bg-emerald-50",  ratioText: "text-emerald-700",
             barBg: "bg-emerald-100",   barFg: "bg-emerald-500",
             label: "Profit",  icon: "↓" },
  onplan:  { chipBg: "bg-amber-100",   chipText: "text-amber-800",
             ratioBg: "bg-amber-50",   ratioText: "text-amber-700",
             barBg: "bg-amber-100",    barFg: "bg-amber-500",
             label: "On plan", icon: "=" },
  loss:    { chipBg: "bg-rose-100",    chipText: "text-rose-700",
             ratioBg: "bg-rose-50",    ratioText: "text-rose-700",
             barBg: "bg-rose-100",     barFg: "bg-rose-500",
             label: "Loss",    icon: "↑" },
  neutral: { chipBg: "bg-slate-100",   chipText: "text-slate-600",
             ratioBg: "bg-slate-50",   ratioText: "text-slate-600",
             barBg: "bg-slate-100",    barFg: "bg-slate-400",
             label: "No data", icon: "—" },
};

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function CompanyRatioPanel({ rows }: { rows: WorkEntry[] }) {
  // Default = worst loss first → neutral → best profit last.
  // That way the clients that need attention surface at the top.
  const [sort, setSort] = useState<Sort>("ratio-desc");

  const data = useMemo<ClientRow[]>(() => {
    const map = new Map<string, ClientRow>();
    for (const r of rows) {
      const key = (r.client || "—").trim() || "—";
      const c = map.get(key) ?? {
        client: key, entries: 0, totalActual: 0, totalTarget: 0,
        revenue: 0, ratio: 0, variance: 0, percentUsed: 0, avgAedPerHr: 0,
      };
      c.entries += 1;
      c.totalActual += Number(r.hours ?? 0);
      c.totalTarget += Number(r.target_hours ?? 0);
      c.revenue += Number(r.total_price ?? 0);
      map.set(key, c);
    }
    const arr = Array.from(map.values()).map((c) => ({
      ...c,
      ratio: c.totalTarget > 0 ? +(c.totalActual / c.totalTarget).toFixed(3) : 0,
      variance: +(c.totalActual - c.totalTarget).toFixed(1),
      percentUsed: c.totalTarget > 0
        ? Math.min(140, Math.round((c.totalActual / c.totalTarget) * 100))
        : 0,
      avgAedPerHr: c.totalActual > 0 ? +(c.revenue / c.totalActual).toFixed(2) : 0,
    }));
    switch (sort) {
      case "ratio-asc":    arr.sort((a, b) => a.ratio - b.ratio); break;
      case "ratio-desc":   arr.sort((a, b) => b.ratio - a.ratio); break;
      case "revenue-desc": arr.sort((a, b) => b.revenue - a.revenue); break;
    }
    return arr;
  }, [rows, sort]);

  const fleetActual = data.reduce((s, c) => s + c.totalActual, 0);
  const fleetTarget = data.reduce((s, c) => s + c.totalTarget, 0);
  const fleetRatio  = fleetTarget > 0 ? fleetActual / fleetTarget : 0;
  const fleetTone   = toneOfRatio(fleetRatio, fleetTarget > 0);

  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white/70 backdrop-blur-sm shadow-card overflow-hidden">
      {/* Header */}
      <header className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-500">
            Company-wise ratio
          </div>
          <h3 className="mt-1 text-lg font-serif text-brand-ink leading-tight">
            Which clients are profitable?
          </h3>
          <p className="mt-1 text-xs text-slate-500 max-w-md leading-relaxed">
            Actual ÷ target hours per client. <b className="text-emerald-700">&lt; 1</b> profit ·
            {" "}<b className="text-amber-700">≈ 1</b> on plan ·
            {" "}<b className="text-rose-700">&gt; 1</b> loss.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">Fleet avg</span>
            <span className={`inline-flex items-center justify-center h-8 min-w-[3.25rem] rounded-md px-2 text-sm font-bold ${TONE[fleetTone].ratioBg} ${TONE[fleetTone].ratioText}`}>
              {fleetTarget > 0 ? fleetRatio.toFixed(2) : "—"}
            </span>
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
          >
            <option value="ratio-desc">Worst loss first</option>
            <option value="ratio-asc">Best profit first</option>
            <option value="revenue-desc">Highest revenue first</option>
          </select>
        </div>
      </header>

      {/* Cards */}
      <div className="p-4">
        {data.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
            No finalized entries in this view — company ratios appear here.
          </div>
        ) : (
          <div className="space-y-2.5">
            {data.map((c) => <ClientCard key={c.client} c={c} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function ClientCard({ c }: { c: ClientRow }) {
  const hasBoth = c.totalTarget > 0 && c.totalActual > 0;
  const tone = toneOfRatio(c.ratio, hasBoth);
  const t = TONE[tone];

  return (
    <article className="group relative rounded-xl border border-slate-200/80 bg-white hover:border-brand-blue/40 hover:shadow-card transition-all p-4">
      {/* Top row: tone chip + ratio pill */}
      <div className="flex items-start justify-between gap-3">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${t.chipBg} ${t.chipText}`}>
          <span className="text-xs leading-none">{t.icon}</span>
          {t.label}
        </span>
        <div className={`text-right ${t.ratioText}`}>
          <div className="text-2xl font-bold leading-none tabular-nums">
            {hasBoth ? c.ratio.toFixed(2) : "—"}
          </div>
          <div className="text-[10px] uppercase tracking-wider mt-0.5 opacity-70">ratio</div>
        </div>
      </div>

      {/* Client name — full, no truncation on hover */}
      <h4
        className="mt-3 text-base font-semibold text-brand-ink leading-snug break-words"
        title={c.client}
      >
        {c.client}
      </h4>

      {/* Progress bar: actual vs target */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
          <span>{c.totalActual.toFixed(0)}h actual</span>
          <span>{c.totalTarget.toFixed(0)}h target</span>
        </div>
        <div className={`h-1.5 rounded-full ${t.barBg} overflow-hidden`}>
          <div
            className={`h-full ${t.barFg} transition-all`}
            style={{ width: `${Math.min(100, c.percentUsed)}%` }}
          />
        </div>
        {hasBoth && (
          <div className={`text-[10px] font-medium mt-1 ${t.ratioText}`}>
            {c.variance === 0
              ? "Exactly on target"
              : c.variance > 0
                ? `+${c.variance}h over target`
                : `${c.variance}h under target`}
          </div>
        )}
      </div>

      {/* Bottom stats — 3 mini fields */}
      <dl className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Entries</dt>
          <dd className="mt-0.5 text-sm font-semibold text-brand-ink tabular-nums">{c.entries}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Revenue</dt>
          <dd className="mt-0.5 text-sm font-semibold text-brand-ink tabular-nums">AED {fmt(c.revenue)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">AED / hr</dt>
          <dd className="mt-0.5 text-sm font-semibold text-brand-ink tabular-nums">
            {c.avgAedPerHr > 0 ? c.avgAedPerHr.toFixed(2) : "—"}
          </dd>
        </div>
      </dl>
    </article>
  );
}
