import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { WorkEntry } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const PIE_COLORS = ["#FFC107", "#1a1a1a", "#F5A800", "#4b5563", "#facc15", "#6b7280"];

export default function AdminDashboard() {
  const { employee, signOut } = useAuth();
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
    const map = new Map<string, { client: string; revenue: number; hours: number; cost: number }>();
    for (const r of filtered) {
      const key = r.client || "—";
      const c = map.get(key) ?? { client: key, revenue: 0, hours: 0, cost: 0 };
      c.revenue += Number(r.total_price || 0);
      c.hours += Number(r.hours || 0);
      c.cost += Number(r.cost || 0);
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
    return Array.from(map.entries()).map(([cluster, revenue]) => ({ cluster, revenue }));
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
            <button onClick={load} className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg text-sm">Refresh</button>
            <button onClick={exportCSV} className="bg-brand-yellow text-brand-ink font-semibold px-4 py-2 rounded-lg text-sm">Export CSV</button>
            <button onClick={signOut} className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg text-sm">Sign out</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Filters */}
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
            <div className="font-bold mb-4">Revenue by Client</div>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={byClient}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="client" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="revenue" fill="#FFC107" />
                  <Bar dataKey="cost" fill="#1a1a1a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="font-bold mb-4">Revenue Share by Cluster</div>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={byCluster} dataKey="revenue" nameKey="cluster" outerRadius={100} label>
                    {byCluster.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b font-bold">All Entries</div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
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
                      <td className="px-3 py-2">{i + 1}</td>
                      <td className="px-3 py-2">{r.cluster}</td>
                      <td className="px-3 py-2">{r.phase}</td>
                      <td className="px-3 py-2 font-semibold">{r.villa}</td>
                      <td className="px-3 py-2">{r.bedroom_type}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.description}</td>
                      <td className="px-3 py-2">{r.floor_type}</td>
                      <td className="px-3 py-2">{r.start_date}</td>
                      <td className="px-3 py-2">{r.end_date}</td>
                      <td className="px-3 py-2">{r.status}</td>
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
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
