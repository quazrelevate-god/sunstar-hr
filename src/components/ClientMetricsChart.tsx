import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { WorkEntry } from "../lib/supabase";

const COLLAPSE_KEY = "sunstar-client-metrics-collapsed";
function readCollapsed(): boolean {
  try {
    const v = localStorage.getItem(COLLAPSE_KEY);
    // Default to COLLAPSED so the entries list owns the screen until the
    // admin explicitly asks to see the chart.
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

type Metric = "price" | "hours" | "aed_per_hr";

const METRIC_META: Record<Metric, { label: string; color: string; fmt: (v: number) => string }> = {
  price:      { label: "Total price", color: "#2563EB", fmt: (v) => `AED ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
  hours:      { label: "Actual hours", color: "#0F172A", fmt: (v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} h` },
  aed_per_hr: { label: "AED / hr",     color: "#10B981", fmt: (v) => `AED ${v.toFixed(2)}` },
};

export function ClientMetricsChart({
  rows, allClients, onCompareClients,
}: {
  rows: WorkEntry[];
  allClients: string[];
  /** Called when the user picks 2+ clients to compare. Empty = clear the filter. */
  onCompareClients: (clientNames: string[]) => void;
}) {
  const [metric, setMetric] = useState<Metric>("price");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed());
  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

  // Aggregate per client
  const data = useMemo(() => {
    const map = new Map<string, { client: string; price: number; hours: number }>();
    for (const r of rows) {
      const key = (r.client || "—").trim();
      const c = map.get(key) ?? { client: key, price: 0, hours: 0 };
      c.price += Number(r.total_price || 0);
      c.hours += Number(r.hours || 0);
      map.set(key, c);
    }
    return Array.from(map.values())
      .map((c) => ({
        ...c,
        aed_per_hr: c.hours > 0 ? +(c.price / c.hours).toFixed(2) : 0,
      }))
      .sort((a, b) => (b[metric] as number) - (a[metric] as number));
  }, [rows, metric]);

  const meta = METRIC_META[metric];

  return (
    <div className={`bg-white rounded-2xl shadow-sm flex flex-col min-h-0 ${collapsed ? "" : "h-full p-3"}`}>
      {/* Header is also the collapse/expand toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className={`flex items-center justify-between gap-2 flex-wrap text-left ${collapsed ? "px-3 py-2" : "mb-2"} hover:bg-slate-50/60 transition rounded-xl`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-brand-blueDark text-xs font-bold">{collapsed ? "▸" : "▾"}</span>
          <div className="font-bold text-brand-ink text-xs">Client metrics</div>
          <span className="text-[10px] text-gray-500">· {data.length} client{data.length === 1 ? "" : "s"}</span>
        </div>
        <span className="text-[10px] text-gray-500">
          {collapsed ? "Click to expand" : "Click to collapse"}
        </span>
      </button>

      {!collapsed && (
        <>
          <div className="flex items-center justify-between gap-2 mb-2">
            {/* Segmented metric toggle */}
            <div className="inline-flex rounded-full border border-gray-200 bg-gray-50 p-0.5">
              {(Object.keys(METRIC_META) as Metric[]).map((m) => {
                const active = metric === m;
                return (
                  <button
                    key={m}
                    onClick={() => setMetric(m)}
                    className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full transition ${
                      active ? "text-white shadow-sm" : "text-gray-600 hover:text-brand-ink"
                    }`}
                    style={active ? { background: METRIC_META[m].color } : undefined}
                  >
                    {METRIC_META[m].label}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setPickerOpen(true)}
              className="text-[10px] bg-brand-blueSoft border border-brand-blue text-brand-ink font-semibold px-2 py-0.5 rounded-full"
            >
              Compare →
            </button>
          </div>

          <div className="flex-1 min-h-0" style={{ width: "100%", minHeight: 140 }}>
            {data.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-400 border-2 border-dashed rounded-xl">
                No finalized entries in this view
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="client" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => meta.fmt(Number(v))} />
                  <Bar dataKey={metric} name={meta.label} fill={meta.color} radius={[6, 6, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}

      {pickerOpen && (
        <ClientPicker
          allClients={allClients}
          initial={picked}
          onClose={() => setPickerOpen(false)}
          onApply={(list) => { setPicked(list); onCompareClients(list); setPickerOpen(false); }}
        />
      )}
    </div>
  );
}

function ClientPicker({
  allClients, initial, onClose, onApply,
}: {
  allClients: string[];
  initial: string[];
  onClose: () => void;
  onApply: (list: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [q, setQ] = useState("");
  const shown = allClients.filter((c) => c.toLowerCase().includes(q.toLowerCase()));
  const toggle = (c: string) =>
    setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold text-brand-ink text-lg mb-1">Compare clients</div>
        <div className="text-xs text-gray-500 mb-3">
          Pick 2 or more clients. Everything on this page — chart, cards and table — will be filtered to just these clients.
        </div>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Filter list…"
          className="w-full border rounded-lg px-3 py-2 mb-2 text-sm"
        />
        <div className="max-h-56 overflow-y-auto border rounded-lg p-2 space-y-1 mb-3">
          {shown.length === 0 ? (
            <div className="text-xs text-gray-400 px-2 py-4 text-center">No clients recorded yet</div>
          ) : shown.map((c) => (
            <label key={c} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer text-sm">
              <input type="checkbox" checked={picked.includes(c)} onChange={() => toggle(c)} />
              <span>{c}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-between gap-2">
          <button
            onClick={() => { setPicked([]); onApply([]); }}
            className="text-sm text-gray-500 hover:text-brand-ink"
          >
            Clear
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border">Cancel</button>
            <button
              onClick={() => onApply(picked)}
              disabled={picked.length === 0}
              className="px-4 py-2 rounded-lg bg-brand-ink text-white font-bold disabled:opacity-40"
            >
              Apply {picked.length > 0 && `(${picked.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
