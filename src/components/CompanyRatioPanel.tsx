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
      {/* Compact header — one line title + fleet avg + sort selector */}
      <header className="px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-500">
            Company ratio
          </span>
          <span className="text-[10px] text-slate-400 hidden md:inline">
            &lt; 1 profit · ≈ 1 on plan · &gt; 1 loss
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Fleet</span>
          <span className={`inline-flex items-center justify-center h-6 min-w-[2.75rem] rounded-md px-2 text-xs font-bold ${TONE[fleetTone].ratioBg} ${TONE[fleetTone].ratioText}`}>
            {fleetTarget > 0 ? fleetRatio.toFixed(2) : "—"}
          </span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="text-[11px] bg-white border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
          >
            <option value="ratio-desc">Loss first</option>
            <option value="ratio-asc">Profit first</option>
            <option value="revenue-desc">Revenue</option>
          </select>
        </div>
      </header>

      {/* Compact rows — ~56 px each so several clients fit in the capped
          top area and the admin can scroll for the rest. */}
      <div className="p-2">
        {data.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
            No finalized entries in this view — company ratios appear here.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.map((c) => <ClientRow key={c.client} c={c} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function ClientRow({ c }: { c: ClientRow }) {
  const hasBoth = c.totalTarget > 0 && c.totalActual > 0;
  const tone = toneOfRatio(c.ratio, hasBoth);
  const t = TONE[tone];

  return (
    <article className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 px-2 py-2 hover:bg-slate-50/60 rounded-lg">
      {/* Left: ratio pill (double-duty: tone colour + number) */}
      <div className={`flex flex-col items-center justify-center rounded-md px-2 py-1 min-w-[3.25rem] ${t.ratioBg}`}>
        <span className={`text-base font-bold leading-none tabular-nums ${t.ratioText}`}>
          {hasBoth ? c.ratio.toFixed(2) : "—"}
        </span>
        <span className={`text-[9px] uppercase tracking-wider mt-0.5 font-semibold ${t.ratioText} opacity-80`}>
          {t.label}
        </span>
      </div>

      {/* Middle: client name + inline progress + variance in one tight block */}
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-brand-ink leading-tight truncate" title={c.client}>
          {c.client}
        </h4>
        <div className="mt-1 flex items-center gap-2">
          <div className={`flex-1 h-1 rounded-full ${t.barBg} overflow-hidden`}>
            <div
              className={`h-full ${t.barFg} transition-all`}
              style={{ width: `${Math.min(100, c.percentUsed)}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500 tabular-nums flex-shrink-0">
            {c.totalActual.toFixed(0)}/{c.totalTarget.toFixed(0)}h
          </span>
        </div>
      </div>

      {/* Right: compact revenue + entries */}
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-semibold text-brand-ink tabular-nums">AED {fmt(c.revenue)}</div>
        <div className="text-[10px] text-slate-500 tabular-nums">
          {c.entries} entr{c.entries === 1 ? "y" : "ies"} · {c.avgAedPerHr > 0 ? `${c.avgAedPerHr.toFixed(0)}/h` : "—"}
        </div>
      </div>
    </article>
  );
}
