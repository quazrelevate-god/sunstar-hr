import { useMemo, useState } from "react";
import type { WorkEntry } from "../lib/supabase";

/*
 * Per-client AED/hr panel (client decision 2026-10-23).
 *
 * Target hours were removed from the product, so the old actual-vs-target
 * ratio has no data. The number that matters now is the earned rate:
 *   AED/hr = total amount ÷ actual hours, per client.
 * Tone compares each client against the FLEET average rate:
 *   below −5%  → low (rose), within ±5% → average (amber), above → strong.
 */

type Sort = "rate-asc" | "rate-desc" | "revenue-desc";

type ClientRow = {
  client: string;
  entries: number;
  totalHours: number;
  revenue: number;
  aedPerHr: number;     // revenue / hours (0 when no hours)
  percentOfTop: number; // bar width: this client's rate vs the best rate
};

const AVG_BAND = 0.05;

type Tone = "strong" | "avg" | "low" | "neutral";
function toneOfRate(rate: number, fleet: number): Tone {
  if (!isFinite(rate) || rate <= 0 || !isFinite(fleet) || fleet <= 0) return "neutral";
  if (rate < fleet * (1 - AVG_BAND)) return "low";
  if (rate > fleet * (1 + AVG_BAND)) return "strong";
  return "avg";
}

const TONE: Record<Tone, {
  ratioBg: string; ratioText: string;
  barBg: string; barFg: string;
  label: string;
}> = {
  strong:  { ratioBg: "bg-emerald-50", ratioText: "text-emerald-700",
             barBg: "bg-emerald-100",  barFg: "bg-emerald-500", label: "High" },
  avg:     { ratioBg: "bg-amber-50",   ratioText: "text-amber-700",
             barBg: "bg-amber-100",    barFg: "bg-amber-500",   label: "Avg" },
  low:     { ratioBg: "bg-rose-50",    ratioText: "text-rose-700",
             barBg: "bg-rose-100",     barFg: "bg-rose-500",    label: "Low" },
  neutral: { ratioBg: "bg-slate-50",   ratioText: "text-slate-600",
             barBg: "bg-slate-100",    barFg: "bg-slate-400",   label: "—" },
};

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function CompanyRatioPanel({ rows }: { rows: WorkEntry[] }) {
  // Default = lowest rate first, so the clients earning the least per hour
  // (the ones to renegotiate or investigate) surface at the top.
  const [sort, setSort] = useState<Sort>("rate-asc");

  const { data, fleetRate } = useMemo(() => {
    const map = new Map<string, ClientRow>();
    for (const r of rows) {
      const key = (r.client || "—").trim() || "—";
      const c = map.get(key) ?? {
        client: key, entries: 0, totalHours: 0, revenue: 0, aedPerHr: 0, percentOfTop: 0,
      };
      c.entries += 1;
      c.totalHours += Number(r.hours ?? 0);
      c.revenue += Number(r.total_price ?? 0);
      map.set(key, c);
    }
    const arr = Array.from(map.values()).map((c) => ({
      ...c,
      aedPerHr: c.totalHours > 0 ? +(c.revenue / c.totalHours).toFixed(2) : 0,
    }));
    const top = Math.max(0, ...arr.map((c) => c.aedPerHr));
    for (const c of arr) c.percentOfTop = top > 0 ? Math.round((c.aedPerHr / top) * 100) : 0;
    switch (sort) {
      case "rate-asc":     arr.sort((a, b) => a.aedPerHr - b.aedPerHr); break;
      case "rate-desc":    arr.sort((a, b) => b.aedPerHr - a.aedPerHr); break;
      case "revenue-desc": arr.sort((a, b) => b.revenue - a.revenue); break;
    }
    const hoursSum = arr.reduce((s, c) => s + c.totalHours, 0);
    const revSum = arr.reduce((s, c) => s + c.revenue, 0);
    return { data: arr, fleetRate: hoursSum > 0 ? revSum / hoursSum : 0 };
  }, [rows, sort]);

  const fleetTone = fleetRate > 0 ? "avg" : "neutral";

  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white/70 backdrop-blur-sm shadow-card overflow-hidden">
      {/* Compact header — one line title + fleet avg + sort selector */}
      <header className="px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-slate-500">
            Company AED/hr
          </span>
          <span className="text-[10px] text-slate-400 hidden md:inline">
            total amount ÷ actual hours
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Fleet</span>
          <span className={`inline-flex items-center justify-center h-6 min-w-[2.75rem] rounded-md px-2 text-xs font-bold ${TONE[fleetTone].ratioBg} ${TONE[fleetTone].ratioText}`}>
            {fleetRate > 0 ? fleetRate.toFixed(2) : "—"}
          </span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="text-[11px] bg-white border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
          >
            <option value="rate-asc">Lowest AED/hr first</option>
            <option value="rate-desc">Highest AED/hr first</option>
            <option value="revenue-desc">Revenue</option>
          </select>
        </div>
      </header>

      {/* Compact rows — several clients visible at once, scroll for the rest. */}
      <div className="p-2">
        {data.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
            No finalized entries in this view — client rates appear here.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.map((c) => <ClientRateRow key={c.client} c={c} fleetRate={fleetRate} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function ClientRateRow({ c, fleetRate }: { c: ClientRow; fleetRate: number }) {
  const tone = toneOfRate(c.aedPerHr, fleetRate);
  const t = TONE[tone];

  return (
    <article className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 px-2 py-2 hover:bg-slate-50/60 rounded-lg">
      {/* Left: AED/hr pill, coloured vs the fleet average */}
      <div className={`flex flex-col items-center justify-center rounded-md px-2 py-1 min-w-[3.6rem] ${t.ratioBg}`}>
        <span className={`text-base font-bold leading-none tabular-nums ${t.ratioText}`}>
          {c.aedPerHr > 0 ? c.aedPerHr.toFixed(2) : "—"}
        </span>
        <span className={`text-[9px] uppercase tracking-wider mt-0.5 font-semibold ${t.ratioText} opacity-80`}>
          {t.label}
        </span>
      </div>

      {/* Middle: client name + rate bar (relative to the best client) */}
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-brand-ink leading-tight truncate" title={c.client}>
          {c.client}
        </h4>
        <div className="mt-1 flex items-center gap-2">
          <div className={`flex-1 h-1 rounded-full ${t.barBg} overflow-hidden`}>
            <div
              className={`h-full ${t.barFg} transition-all`}
              style={{ width: `${Math.min(100, c.percentOfTop)}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500 tabular-nums flex-shrink-0">
            {fmt(c.totalHours)}h
          </span>
        </div>
      </div>

      {/* Right: revenue + entries */}
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-semibold text-brand-ink tabular-nums">AED {fmt(c.revenue)}</div>
        <div className="text-[10px] text-slate-500 tabular-nums">
          {c.entries} entr{c.entries === 1 ? "y" : "ies"}
        </div>
      </div>
    </article>
  );
}
