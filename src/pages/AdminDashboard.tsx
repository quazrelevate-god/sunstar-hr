import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { WorkEntry } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import AdminEmployees from "./AdminEmployees";

const PIE_COLORS = ["#FFC107", "#1a1a1a", "#F5A800", "#4b5563", "#facc15", "#9ca3af", "#f59e0b", "#374151"];

type Tab = "overview" | "entries" | "employees";

export default function AdminDashboard() {
  const { employee, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [rows, setRows] = useState<WorkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState<string>("ALL");
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("sunstar_work_entries")
      .select("*")
      .order("created_at", { ascending: false });
    setRows((data as WorkEntry[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const clients = useMemo(() => Array.from(new Set(rows.map((r) => r.client).filter(Boolean))), [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (clientFilter !== "ALL" && r.client !== clientFilter) return false;
      if (q) {
        const s = q.toLowerCase();
        if (
          !(`${r.villa}`.toLowerCase().includes(s) ||
            `${r.cluster}`.toLowerCase().includes(s) ||
            `${r.phase}`.toLowerCase().includes(s) ||
            `${r.employee_name ?? ""}`.toLowerCase().includes(s))
        ) return false;
      }
      return true;
    });
  }, [rows, clientFilter, q]);

  const metrics = useMemo(() => {
    const hours = filtered.reduce((s, r) => s + Number(r.hours || 0), 0);
    const revenue = filtered.reduce((s, r) => s + Number(r.total_price || 0), 0);
    const cost = filtered.reduce((s, r) => s + Number(r.cost || 0), 0);
    const profit = revenue - cost;
    const perHour = hours > 0 ? revenue / hours : 0;
    return { hours, revenue, cost, profit, perHour, count: filtered.length };
  }, [filtered]);

  const byClient = useMemo(() => {
    const map = new Map<string, { client: string; Revenue: number; Cost: number }>();
    for (const r of filtered) {
      const key = r.client || "—";
      const c = map.get(key) ?? { client: key, Revenue: 0, Cost: 0 };
      c.Revenue += Number(r.total_price || 0);
      c.Cost += Number(r.cost || 0);
      map.set(key, c);
    }
    return Array.from(map.values());
  }, [filtered]);

  const byCluster = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      const k = r.cluster || "—";
      map.set(k, (map.get(k) ?? 0) + Number(r.total_price || 0));
    }
    return Array.from(map.entries())
      .map(([cluster, revenue]) => ({ cluster, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [filtered]);

  function exportCSV() {
    const cols = [
      "S.No","Cluster","Phase","Villa","Bedroom","Description","Floor","Start","End","Status",
      "Hours","TotalPrice","Cost","PerHour","Power","GIBox","Data","Telephone","Lighting","FCU","DBConduit","Client","Employee"
    ];
    const lines = [cols.join(",")];
    filtered.forEach((r, i) => {
      lines.push([
        i + 1, r.cluster, r.phase, r.villa, r.bedroom_type, r.description, r.floor_type,
        r.start_date ?? "", r.end_date ?? "", r.status, r.hours, r.total_price, r.cost,
        r.per_hour_ratio ?? "", r.power_point, r.gi_box_nos, r.data_point, r.telephone_point,
        r.lighting_point, r.fcu_point, r.db_conduit, r.client ?? "", r.employee_name ?? ""
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sunstar_work_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand-ink text-white">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-yellow rounded-lg flex items-center justify-center text-brand-ink font-bold">S</div>
            <div>
              <div className="font-bold">Sunstar Admin</div>
              <div className="text-xs text-gray-400">{employee?.full_name}</div>
            </div>
          </div>
          <div className="flex gap-2">
            {tab !== "employees" && (
              <>
                <button onClick={load} className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg text-sm">Refresh</button>
                <button onClick={exportCSV} className="bg-brand-yellow text-brand-ink font-semibold px-4 py-2 rounded-lg text-sm">Export CSV</button>
              </>
            )}
            <button onClick={signOut} className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg text-sm">Sign out</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-1">
            {(["overview","entries","employees"] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition ${
                  tab === t
                    ? "border-brand-yellow text-brand-yellow"
                    : "border-transparent text-gray-400 hover:text-white"
                }`}>
                {t === "overview" ? "Overview" : t === "entries" ? "Work Entries" : "Employees"}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {tab === "employees" ? (
          <AdminEmployees />
        ) : (
          <>
            {/* Filters (shared by overview + entries) */}
            <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-wrap gap-3 items-center">
              <input
                placeholder="Search villa, cluster, phase, employee…"
                value={q} onChange={(e) => setQ(e.target.value)}
                className="flex-1 min-w-[240px] border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-brand-yellow"
              />
              <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="border rounded-lg px-4 py-2">
                <option value="ALL">All clients</option>
                {clients.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className="text-sm text-gray-500">{filtered.length} of {rows.length} rows</div>
            </div>

            {tab === "overview" && (
              <>
                {/* Metric cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <Metric label="Entries" value={metrics.count.toString()} />
                  <Metric label="Total Hours" value={metrics.hours.toFixed(0)} />
                  <Metric label="Revenue" value={`AED ${metrics.revenue.toLocaleString()}`} accent />
                  <Metric label="Cost" value={`AED ${metrics.cost.toLocaleString()}`} />
                  <Metric
                    label="Profit" value={`AED ${metrics.profit.toLocaleString()}`}
                    tone={metrics.profit >= 0 ? "good" : "bad"}
                  />
                  <Metric label="Avg AED/hr" value={metrics.perHour.toFixed(2)} accent />
                </div>

                {/* Charts */}
                <div className="grid lg:grid-cols-2 gap-6">
                  <div className="bg-white rounded-2xl p-5 shadow-sm">
                    <div className="font-bold mb-2">Revenue vs Cost by Client</div>
                    <div className="text-xs text-gray-500 mb-4">
                      Yellow bars are revenue billed; dark bars are internal cost.
                    </div>
                    <div style={{ width: "100%", height: 320 }}>
                      {byClient.length === 0 ? (
                        <EmptyChart />
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={byClient} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="client" tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 12 }} />
                            <Tooltip formatter={(v: any) => `AED ${Number(v).toLocaleString()}`} />
                            <Legend />
                            <Bar dataKey="Revenue" fill="#FFC107" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                            <Bar dataKey="Cost" fill="#1a1a1a" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl p-5 shadow-sm">
                    <div className="font-bold mb-2">Revenue Share — Top 8 Clusters</div>
                    <div className="text-xs text-gray-500 mb-4">
                      Which villa clusters brought in the most revenue.
                    </div>
                    <div style={{ width: "100%", height: 320 }}>
                      {byCluster.length === 0 ? (
                        <EmptyChart />
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={byCluster} dataKey="revenue" nameKey="cluster"
                              cx="50%" cy="50%" outerRadius={90} innerRadius={40}
                              paddingAngle={2}
                              label={(e: any) => e.cluster}
                              isAnimationActive={false}
                            >
                              {byCluster.map((_, i) => (
                                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: any) => `AED ${Number(v).toLocaleString()}`} />
                          </PieChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {tab === "entries" && (
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b flex items-center justify-between">
                  <div className="font-bold">Work Entries</div>
                  <div className="text-sm text-gray-500">Latest first</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 text-xs uppercase sticky top-0">
                      <tr>
                        {["#","Cluster","Phase","Villa","BR","Desc","Fl","Start","End","Status","Hrs","Price","Cost","AED/hr","P","GI","D","Tel","L","FCU","DB","Client","Employee"].map((h) => (
                          <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr><td className="p-6 text-center text-gray-500" colSpan={23}>Loading…</td></tr>
                      ) : filtered.length === 0 ? (
                        <tr><td className="p-6 text-center text-gray-500" colSpan={23}>No entries.</td></tr>
                      ) : (
                        filtered.map((r, i) => (
                          <tr key={r.id} className="border-t hover:bg-brand-yellowSoft">
                            <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                            <td className="px-3 py-2">{r.cluster}</td>
                            <td className="px-3 py-2">{r.phase}</td>
                            <td className="px-3 py-2 font-semibold">{r.villa}</td>
                            <td className="px-3 py-2">{r.bedroom_type}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{r.description}</td>
                            <td className="px-3 py-2">{r.floor_type}</td>
                            <td className="px-3 py-2 text-xs text-gray-500">{r.start_date ?? ""}</td>
                            <td className="px-3 py-2 text-xs text-gray-500">{r.end_date ?? ""}</td>
                            <td className="px-3 py-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                r.status === "DONE" ? "bg-green-100 text-green-800" :
                                r.status === "IN PROGRESS" ? "bg-amber-100 text-amber-800" :
                                "bg-gray-100 text-gray-700"
                              }`}>{r.status}</span>
                            </td>
                            <td className="px-3 py-2">{r.hours}</td>
                            <td className="px-3 py-2">{Number(r.total_price).toLocaleString()}</td>
                            <td className="px-3 py-2">{Number(r.cost).toLocaleString()}</td>
                            <td className="px-3 py-2 font-bold text-brand-yellowDark">{r.per_hour_ratio}</td>
                            <td className="px-3 py-2">{r.power_point}</td>
                            <td className="px-3 py-2">{r.gi_box_nos}</td>
                            <td className="px-3 py-2">{r.data_point}</td>
                            <td className="px-3 py-2">{r.telephone_point}</td>
                            <td className="px-3 py-2">{r.lighting_point}</td>
                            <td className="px-3 py-2">{r.fcu_point}</td>
                            <td className="px-3 py-2">{r.db_conduit}</td>
                            <td className="px-3 py-2">{r.client}</td>
                            <td className="px-3 py-2 text-xs text-gray-500">{r.employee_name}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Metric({
  label, value, accent, tone,
}: { label: string; value: string; accent?: boolean; tone?: "good" | "bad" }) {
  const cls = accent
    ? "bg-brand-yellow text-brand-ink"
    : tone === "good"
    ? "bg-green-50 text-green-800 border border-green-200"
    : tone === "bad"
    ? "bg-red-50 text-red-800 border border-red-200"
    : "bg-white border";
  return (
    <div className={`rounded-2xl p-4 shadow-sm ${cls}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-bold mt-1 truncate">{value}</div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-full flex items-center justify-center text-sm text-gray-400 border-2 border-dashed rounded-xl">
      No data for the current filter
    </div>
  );
}

// Legend imported but only referenced within JSX; keep for tree-shake
void Legend;
