import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { WorkEntry, EntryState } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import AdminEmployees from "./AdminEmployees";
import { StateBadge, relativeAgo } from "../components/StateBadge";
import { Toast } from "../components/Toast";
import type { ToastKind } from "../components/Toast";

const PIE_COLORS = ["#FFC107", "#1a1a1a", "#F5A800", "#4b5563", "#facc15", "#9ca3af", "#f59e0b", "#374151"];

type Tab = "overview" | "entries" | "employees";
type QFilter = "ALL" | EntryState;

export default function AdminDashboard() {
  const { employee, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [rows, setRows] = useState<WorkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const flash = (msg: string, kind: ToastKind = "info") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("sunstar_work_entries")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) flash(error.message, "error");
    setRows((data as WorkEntry[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const finalized = useMemo(() => rows.filter((r) => r.state === "FINALIZED"), [rows]);
  const queue = useMemo(() => rows.filter((r) => r.state !== "FINALIZED"), [rows]);

  function exportCSV() {
    const cols = [
      "S.No","State","Cluster","Phase","Villa","Bedroom","Description","Floor","Start","End","Status",
      "TargetHrs","ActualHrs","TotalPrice","PerHour","Power","GIBox","Data","Telephone","Lighting","FCU","DBConduit","Client","Employee"
    ];
    const lines = [cols.join(",")];
    finalized.forEach((r, i) => {
      lines.push([
        i + 1, r.state, r.cluster, r.phase, r.villa, r.bedroom_type, r.description, r.floor_type,
        r.start_date ?? "", r.end_date ?? "", r.status, r.target_hours ?? "", r.hours ?? "",
        r.total_price ?? "", r.per_hour_ratio ?? "", r.power_point, r.gi_box_nos,
        r.data_point, r.telephone_point, r.lighting_point, r.fcu_point, r.db_conduit,
        r.client ?? "", r.employee_name ?? ""
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sunstar_finalized_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand-ink text-white">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-yellow rounded-lg flex items-center justify-center text-brand-ink font-bold">S</div>
            <div>
              <div className="font-bold font-serif tracking-wide">SUNSTAR Admin</div>
              <div className="text-xs text-gray-400">{employee?.full_name}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg text-sm">Refresh</button>
            {tab !== "employees" && (
              <button onClick={exportCSV} className="bg-brand-yellow text-brand-ink font-semibold px-4 py-2 rounded-lg text-sm">Export CSV</button>
            )}
            <button onClick={signOut} className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg text-sm">Sign out</button>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-6">
          <nav className="flex gap-1">
            {(["overview", "entries", "employees"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition ${
                  tab === t
                    ? "border-brand-yellow text-brand-yellow"
                    : "border-transparent text-gray-400 hover:text-white"
                }`}
              >
                {t === "overview" ? "Overview & Queue" : t === "entries" ? "Finalized Entries" : "Employees"}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {toast && <Toast msg={toast.msg} kind={toast.kind} />}

      <main className="max-w-[1400px] mx-auto p-6">
        {tab === "employees" && <AdminEmployees />}
        {tab === "overview" && (
          <OverviewAndQueue
            finalized={finalized}
            queue={queue}
            loading={loading}
            reload={load}
            flash={flash}
          />
        )}
        {tab === "entries" && <FinalizedEntries rows={finalized} loading={loading} />}
      </main>
    </div>
  );
}

/* ==============================
   OVERVIEW + QUEUE side-by-side
   ============================== */
function OverviewAndQueue({
  finalized, queue, loading, reload, flash,
}: {
  finalized: WorkEntry[]; queue: WorkEntry[]; loading: boolean; reload: () => void;
  flash: (m: string, k?: ToastKind) => void;
}) {
  const metrics = useMemo(() => {
    const hours = finalized.reduce((s, r) => s + Number(r.hours || 0), 0);
    const revenue = finalized.reduce((s, r) => s + Number(r.total_price || 0), 0);
    const perHour = hours > 0 ? revenue / hours : 0;
    return { hours, revenue, perHour, count: finalized.length };
  }, [finalized]);

  const byClient = useMemo(() => {
    const map = new Map<string, { client: string; Revenue: number }>();
    for (const r of finalized) {
      const key = r.client || "—";
      const c = map.get(key) ?? { client: key, Revenue: 0 };
      c.Revenue += Number(r.total_price || 0);
      map.set(key, c);
    }
    return Array.from(map.values());
  }, [finalized]);

  const byCluster = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of finalized) {
      const k = r.cluster || "—";
      map.set(k, (map.get(k) ?? 0) + Number(r.total_price || 0));
    }
    return Array.from(map.entries())
      .map(([cluster, revenue]) => ({ cluster, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [finalized]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
      {/* LEFT: Queue */}
      <section className="xl:col-span-3 space-y-4">
        <QueuePanel rows={queue} loading={loading} reload={reload} flash={flash} />
      </section>

      {/* RIGHT: Metrics */}
      <section className="xl:col-span-2 space-y-4">
        <MetricCards metrics={metrics} />
        <ChartCard title="Revenue by Client">
          {byClient.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byClient} margin={{ top: 10, right: 12, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="client" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => `AED ${Number(v).toLocaleString()}`} />
                <Bar dataKey="Revenue" fill="#FFC107" radius={[6, 6, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="Revenue share — top 8 clusters">
          {byCluster.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={byCluster} dataKey="revenue" nameKey="cluster"
                  cx="50%" cy="50%" outerRadius={80} innerRadius={40}
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
        </ChartCard>
      </section>
    </div>
  );
}

/* ==============================
   METRICS CARDS
   ============================== */
function MetricCards({ metrics }: { metrics: { hours: number; revenue: number; perHour: number; count: number } }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Metric label="Finalized" value={metrics.count.toString()} />
      <Metric label="Total Hours" value={metrics.hours.toFixed(0)} />
      <Metric label="Revenue" value={`AED ${metrics.revenue.toLocaleString()}`} accent />
      <Metric label="Avg AED/hr" value={metrics.perHour.toFixed(2)} accent />
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 shadow-sm ${accent ? "bg-brand-yellow text-brand-ink" : "bg-white border"}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-70 font-semibold">{label}</div>
      <div className="text-xl font-bold mt-1 truncate">{value}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <div className="font-bold text-sm text-brand-ink mb-3">{title}</div>
      {children}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-[200px] flex items-center justify-center text-sm text-gray-400 border-2 border-dashed rounded-xl">
      No finalized entries yet
    </div>
  );
}

/* ==============================
   QUEUE PANEL (admin side)
   ============================== */
function QueuePanel({
  rows, loading, reload, flash,
}: {
  rows: WorkEntry[]; loading: boolean; reload: () => void;
  flash: (m: string, k?: ToastKind) => void;
}) {
  const [filter, setFilter] = useState<QFilter>("ALL");
  const [priceRow, setPriceRow] = useState<WorkEntry | null>(null);
  const [editRow, setEditRow] = useState<WorkEntry | null>(null);
  const [q, setQ] = useState("");

  const shown = rows.filter((r) => {
    if (filter !== "ALL" && r.state !== filter) return false;
    if (q) {
      const s = q.toLowerCase();
      if (
        !(`${r.villa}`.toLowerCase().includes(s) ||
          `${r.cluster}`.toLowerCase().includes(s) ||
          `${r.phase}`.toLowerCase().includes(s) ||
          `${r.client ?? ""}`.toLowerCase().includes(s) ||
          `${r.employee_name ?? ""}`.toLowerCase().includes(s))
      ) return false;
    }
    return true;
  });

  const counts = useMemo(() => ({
    ALL: rows.length,
    AWAITING_ACTUAL: rows.filter((r) => r.state === "AWAITING_ACTUAL").length,
    AWAITING_PRICE: rows.filter((r) => r.state === "AWAITING_PRICE").length,
    FINALIZED: 0,
  }), [rows]);

  async function del(id: string) {
    if (!confirm("Delete this entry? It will vanish from all portals.")) return;
    const { error } = await supabase.from("sunstar_work_entries").delete().eq("id", id);
    if (error) return flash(error.message, "error");
    flash("Deleted", "success");
    reload();
  }

  return (
    <>
      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold text-brand-ink text-lg">Live Queue</div>
            <div className="text-xs text-gray-500">Everything not yet finalized</div>
          </div>
          <div className="text-xs text-gray-400">{shown.length} of {rows.length}</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterChip active={filter === "ALL"} onClick={() => setFilter("ALL")} label={`All ${counts.ALL}`} />
          <FilterChip active={filter === "AWAITING_ACTUAL"} onClick={() => setFilter("AWAITING_ACTUAL")} label={`🟡 Awaiting actual ${counts.AWAITING_ACTUAL}`} />
          <FilterChip active={filter === "AWAITING_PRICE"} onClick={() => setFilter("AWAITING_PRICE")} label={`🟠 Awaiting price ${counts.AWAITING_PRICE}`} />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search villa, cluster, client…"
            className="ml-auto text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-yellow"
          />
        </div>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="p-6 text-center text-gray-500 bg-white rounded-2xl">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="p-10 text-center text-gray-500 bg-white rounded-2xl">
            <div className="text-4xl mb-2">🎉</div>
            <div className="font-semibold text-brand-ink">Queue is empty</div>
            <div className="text-sm">All entries have been finalized.</div>
          </div>
        ) : (
          shown.map((r) => (
            <div key={r.id} className="bg-white rounded-2xl shadow-sm p-4 hover:shadow transition">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-bold text-brand-ink">Villa {r.villa}</div>
                    <div className="text-gray-500 text-sm">
                      · {r.cluster}{r.phase ? ` · ${r.phase}` : ""} · {r.bedroom_type} · {r.floor_type}
                    </div>
                    <StateBadge state={r.state} />
                  </div>
                  <div className="text-sm text-gray-600 mt-0.5 truncate">
                    {r.description} · Client: {r.client || "—"}
                  </div>
                  <div className="text-xs text-gray-400 mt-1 flex gap-3 flex-wrap">
                    <span>Target {r.target_hours ?? "—"}h</span>
                    {r.hours != null && <span>Actual <b>{r.hours}h</b></span>}
                    {r.total_price != null && <span>Price <b>AED {r.total_price}</b></span>}
                    <span>Queued {r.created_at ? relativeAgo(r.created_at) : ""}</span>
                    {r.employee_name && <span>by {r.employee_name}</span>}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {r.state === "AWAITING_PRICE" && (
                    <button
                      onClick={() => setPriceRow(r)}
                      className="bg-brand-yellow hover:bg-brand-yellowDark text-brand-ink font-bold px-3 py-1.5 rounded-lg text-sm"
                    >
                      Set price →
                    </button>
                  )}
                  <button
                    onClick={() => setEditRow(r)}
                    className="text-brand-ink text-xs hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => del(r.id!)}
                    className="text-red-600 text-xs hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {priceRow && (
        <PriceModal
          row={priceRow}
          onClose={() => setPriceRow(null)}
          onDone={() => { setPriceRow(null); reload(); flash("Finalized ✓", "success"); }}
          flash={flash}
        />
      )}
      {editRow && (
        <EditTargetModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onDone={() => { setEditRow(null); reload(); flash("Updated", "success"); }}
          flash={flash}
        />
      )}
    </>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition ${
        active
          ? "bg-brand-ink text-brand-yellow border-brand-ink"
          : "bg-white text-gray-700 border-gray-200 hover:border-brand-yellow"
      }`}
    >
      {label}
    </button>
  );
}

/* ==============================
   PRICE MODAL
   ============================== */
function PriceModal({
  row, onClose, onDone, flash,
}: {
  row: WorkEntry; onClose: () => void; onDone: () => void;
  flash: (m: string, k?: ToastKind) => void;
}) {
  const { employee } = useAuth();
  const [price, setPrice] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const perHour = price && row.hours ? (+price / row.hours).toFixed(2) : "—";

  async function submit() {
    if (!price || +price <= 0) return flash("Enter a valid price", "error");
    setSaving(true);
    const { error } = await supabase
      .from("sunstar_work_entries")
      .update({ total_price: +price, state: "FINALIZED", priced_by_id: employee?.id ?? null })
      .eq("id", row.id!);
    setSaving(false);
    if (error) return flash(error.message, "error");
    onDone();
  }

  return (
    <Modal onClose={onClose}>
      <div className="text-lg font-bold text-brand-ink mb-1">Set Price — Villa {row.villa}</div>
      <div className="text-xs text-gray-500 mb-4">
        {row.description} · {row.client} · Actual {row.hours}h (target {row.target_hours}h)
      </div>
      <label className="block mb-4">
        <div className="text-xs font-semibold text-gray-500 mb-1">Total Price (AED) *</div>
        <input
          type="number" min={0} step="0.01" autoFocus
          value={price}
          onChange={(e) => setPrice(e.target.value ? +e.target.value : "")}
          className="w-full border rounded-xl px-4 py-3 font-semibold focus:outline-none focus:ring-4 focus:ring-brand-yellow/30 focus:border-brand-yellow"
        />
      </label>
      <div className="bg-brand-yellowSoft rounded-xl p-3 mb-4 text-sm text-brand-ink flex justify-between">
        <span>Live per-hour rate</span>
        <b>AED {perHour}/hr</b>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border">Cancel</button>
        <button onClick={submit} disabled={saving}
          className="px-4 py-2 rounded-lg bg-brand-ink text-brand-yellow font-bold disabled:opacity-50">
          {saving ? "Saving…" : "Finalize"}
        </button>
      </div>
    </Modal>
  );
}

/* ==============================
   EDIT TARGET HOURS MODAL
   ============================== */
function EditTargetModal({
  row, onClose, onDone, flash,
}: {
  row: WorkEntry; onClose: () => void; onDone: () => void;
  flash: (m: string, k?: ToastKind) => void;
}) {
  const [target, setTarget] = useState<number | "">(row.target_hours ?? "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!target || +target <= 0) return flash("Target hours must be > 0", "error");
    setSaving(true);
    const { error } = await supabase
      .from("sunstar_work_entries")
      .update({ target_hours: +target })
      .eq("id", row.id!);
    setSaving(false);
    if (error) return flash(error.message, "error");
    onDone();
  }

  return (
    <Modal onClose={onClose}>
      <div className="text-lg font-bold text-brand-ink mb-1">Edit target hours — Villa {row.villa}</div>
      <div className="text-xs text-gray-500 mb-4">
        Only admin can change this after the morning entry is queued.
      </div>
      <label className="block mb-4">
        <div className="text-xs font-semibold text-gray-500 mb-1">Target Hours *</div>
        <input
          type="number" min={0} step="0.5" autoFocus
          value={target}
          onChange={(e) => setTarget(e.target.value ? +e.target.value : "")}
          className="w-full border rounded-xl px-4 py-3 font-semibold focus:outline-none focus:ring-4 focus:ring-brand-yellow/30 focus:border-brand-yellow"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border">Cancel</button>
        <button onClick={submit} disabled={saving}
          className="px-4 py-2 rounded-lg bg-brand-ink text-brand-yellow font-bold disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/* ==============================
   FINALIZED ENTRIES TABLE
   ============================== */
function FinalizedEntries({ rows, loading }: { rows: WorkEntry[]; loading: boolean }) {
  const [q, setQ] = useState("");
  const shown = rows.filter((r) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return `${r.villa}${r.cluster}${r.phase}${r.client}${r.employee_name}`.toLowerCase().includes(s);
  });
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search villa, cluster, client…"
          className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-brand-yellow"
        />
      </div>
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                {["#","Cluster","Phase","Villa","BR","Desc","Fl","Start","End","Target","Actual","Price","AED/hr","P","GI","D","Tel","L","FCU","DB","Client","Employee"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-6 text-center text-gray-500" colSpan={22}>Loading…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td className="p-10 text-center text-gray-400" colSpan={22}>No finalized entries yet.</td></tr>
              ) : (
                shown.map((r, i) => (
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
                    <td className="px-3 py-2">{r.target_hours ?? ""}</td>
                    <td className="px-3 py-2">{r.hours ?? ""}</td>
                    <td className="px-3 py-2">{r.total_price != null ? Number(r.total_price).toLocaleString() : ""}</td>
                    <td className="px-3 py-2 font-bold text-brand-yellowDark">{r.per_hour_ratio ?? ""}</td>
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
    </div>
  );
}

void Legend;
