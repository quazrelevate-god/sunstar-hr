import { useMemo, useState } from "react";
import type { WorkEntry } from "../lib/supabase";

type Sort = "ratio-asc" | "ratio-desc" | "revenue-desc";

type ClientRow = {
  client: string;
  entries: number;
  totalActual: number;
  totalTarget: number;
  revenue: number;
  hoursForAvg: number;    // = totalActual, kept explicit for readability
  ratio: number;          // actual / target — <1 profit, =1 onplan, >1 loss
  avgAedPerHr: number;
};

const ONPLAN_BAND = 0.03; // ±3% around 1.0 counts as "on plan"

function toneOfRatio(r: number, hasBoth: boolean): "profit" | "onplan" | "loss" | "neutral" {
  if (!hasBoth || !isFinite(r) || r <= 0) return "neutral";
  if (r < 1 - ONPLAN_BAND) return "profit";
  if (r > 1 + ONPLAN_BAND) return "loss";
  return "onplan";
}

const TONE_CLASSES: Record<string, { bg: string; text: string; ring: string; label: string; icon: string }> = {
  profit:  { bg: "bg-green-50",  text: "text-green-800",  ring: "ring-green-200",  label: "Profit",   icon: "↓" },
  onplan:  { bg: "bg-amber-50",  text: "text-amber-800",  ring: "ring-amber-200",  label: "On plan",  icon: "=" },
  loss:    { bg: "bg-red-50",    text: "text-red-800",    ring: "ring-red-200",    label: "Loss",     icon: "↑" },
  neutral: { bg: "bg-gray-50",   text: "text-gray-700",   ring: "ring-gray-200",   label: "No data",  icon: "—" },
};

export function CompanyRatioPanel({ rows }: { rows: WorkEntry[] }) {
  const [sort, setSort] = useState<Sort>("ratio-asc");

  const clientData = useMemo<ClientRow[]>(() => {
    const map = new Map<string, ClientRow>();
    for (const r of rows) {
      const key = (r.client || "—").trim() || "—";
      const c: ClientRow = map.get(key) ?? {
        client: key, entries: 0, totalActual: 0, totalTarget: 0,
        revenue: 0, hoursForAvg: 0, ratio: 0, avgAedPerHr: 0,
      };
      c.entries += 1;
      c.totalActual += Number(r.hours ?? 0);
      c.totalTarget += Number(r.target_hours ?? 0);
      c.revenue += Number(r.total_price ?? 0);
      map.set(key, c);
    }
    const arr = Array.from(map.values()).map((c) => ({
      ...c,
      hoursForAvg: c.totalActual,
      ratio: c.totalTarget > 0 ? +(c.totalActual / c.totalTarget).toFixed(3) : 0,
      avgAedPerHr: c.totalActual > 0 ? +(c.revenue / c.totalActual).toFixed(2) : 0,
    }));
    switch (sort) {
      case "ratio-asc":    arr.sort((a, b) => a.ratio - b.ratio); break;   // most profitable first
      case "ratio-desc":   arr.sort((a, b) => b.ratio - a.ratio); break;   // most loss first
      case "revenue-desc": arr.sort((a, b) => b.revenue - a.revenue); break;
    }
    return arr;
  }, [rows, sort]);

  const fleetHoursActual = clientData.reduce((s, c) => s + c.totalActual, 0);
  const fleetHoursTarget = clientData.reduce((s, c) => s + c.totalTarget, 0);
  const fleetRatio = fleetHoursTarget > 0 ? fleetHoursActual / fleetHoursTarget : 0;

  return (
    <div className="bg-white rounded-xl shadow-card border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-bold text-brand-ink text-sm">Company-wise ratio</div>
          <div className="text-xs text-gray-500">
            Actual ÷ Target hours per client. <b>Below 1</b> = profit · <b>≈ 1</b> = on plan · <b>Above 1</b> = loss.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500 mr-1">Fleet avg</span>
          <RatioPill value={fleetRatio} hasBoth={fleetHoursTarget > 0} big={false} />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1"
          >
            <option value="ratio-asc">Best profit first</option>
            <option value="ratio-desc">Worst loss first</option>
            <option value="revenue-desc">Highest revenue first</option>
          </select>
        </div>
      </div>

      <div className="p-3">
        {clientData.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400 border-2 border-dashed border-gray-100 rounded-lg">
            No finalized entries yet — company ratios appear here.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {clientData.map((c) => (
              <ClientCard key={c.client} c={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ClientCard({ c }: { c: ClientRow }) {
  const hasBoth = c.totalTarget > 0 && c.totalActual > 0;
  const tone = toneOfRatio(c.ratio, hasBoth);
  const t = TONE_CLASSES[tone];
  return (
    <div className={`rounded-lg border ${t.bg} ${t.ring} ring-1 p-3 hover:shadow-card transition`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-brand-ink truncate" title={c.client}>{c.client}</div>
          <div className="text-[11px] text-gray-500">
            {c.entries} entr{c.entries === 1 ? "y" : "ies"} · AED {c.revenue.toLocaleString()}
          </div>
        </div>
        <RatioPill value={c.ratio} hasBoth={hasBoth} big />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className={`font-semibold ${t.text}`}>{t.icon} {t.label}</span>
        <span className="text-gray-500">
          {c.totalActual.toFixed(0)}h / {c.totalTarget.toFixed(0)}h target
        </span>
      </div>
    </div>
  );
}

function RatioPill({ value, hasBoth, big }: { value: number; hasBoth: boolean; big: boolean }) {
  const tone = toneOfRatio(value, hasBoth);
  const t = TONE_CLASSES[tone];
  const display = hasBoth && isFinite(value) && value > 0 ? value.toFixed(2) : "—";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-bold border ${
        big ? "text-base px-2.5 py-1 min-w-[3rem]" : "text-xs px-2 py-0.5"
      } ${t.bg} ${t.text} border-current/30`}
    >
      {display}
    </span>
  );
}
