import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { WorkEntry, SavedFilter, Condition, FilterCol } from "../lib/supabase";
import { passesConditions, rateTone, rateToneClasses } from "../lib/rate";
import { AddConditionPopover, FilterChip } from "../components/FilterBuilder";
import { Toast } from "../components/Toast";
import type { ToastKind } from "../components/Toast";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const PIE_COLORS = ["#FFC107", "#1a1a1a", "#F5A800", "#4b5563", "#facc15", "#9ca3af", "#f59e0b", "#374151"];
const PAGE_SIZE = 50;

type ActiveView =
  | { kind: "all" }
  | { kind: "custom" }              // user-built filter, not yet saved
  | { kind: "saved"; filter: SavedFilter };

const TEXT_COLS: FilterCol[] = [
  "cluster","phase","villa","bedroom_type","floor_type","description","client","status",
];

export default function AdminFinalized({ finalized }: { finalized: WorkEntry[] }) {
  const [views, setViews] = useState<SavedFilter[]>([]);
  const [optionsByCol, setOptionsByCol] = useState<Partial<Record<FilterCol, string[]>>>({});
  const [active, setActive] = useState<ActiveView>({ kind: "all" });
  const [conds, setConds] = useState<Condition[]>([]);   // editable working set
  const [locked, setLocked] = useState(false);           // true when viewing a saved view (until Edit)
  const [adding, setAdding] = useState(false);
  const [askEdit, setAskEdit] = useState(false);
  const [savingView, setSavingView] = useState(false);
  const [newName, setNewName] = useState("");
  const [askSave, setAskSave] = useState(false);
  const [page, setPage] = useState(0);
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const flash = (msg: string, kind: ToastKind = "info") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  async function loadViews() {
    const { data, error } = await supabase
      .from("sunstar_saved_filters")
      .select("*")
      .order("name", { ascending: true });
    if (error) return flash(error.message, "error");
    setViews((data as SavedFilter[]) ?? []);
  }

  // Distinct values from *all* work entries (any state) so dropdowns include
  // values recorded but not yet finalized.
  async function loadOptions() {
    const { data, error } = await supabase
      .from("sunstar_work_entries")
      .select(TEXT_COLS.join(","));
    if (error) return;
    const acc: Partial<Record<FilterCol, Set<string>>> = {};
    (data ?? []).forEach((row: any) => {
      TEXT_COLS.forEach((c) => {
        const v = row[c];
        if (v == null || String(v).trim() === "") return;
        if (!acc[c]) acc[c] = new Set<string>();
        acc[c]!.add(String(v).trim());
      });
    });
    const out: Partial<Record<FilterCol, string[]>> = {};
    TEXT_COLS.forEach((c) => {
      if (acc[c]) out[c] = Array.from(acc[c]!).sort((a, b) => a.localeCompare(b));
    });
    setOptionsByCol(out);
  }

  useEffect(() => {
    loadViews();
    loadOptions();
    const ch = supabase
      .channel("saved-filters-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sunstar_saved_filters" }, () => loadViews())
      .on("postgres_changes", { event: "*", schema: "public", table: "sunstar_work_entries" }, () => loadOptions())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtered rows drive both metrics + table
  const rows = useMemo(() => {
    if (conds.length === 0) return finalized;
    return finalized.filter((r) => passesConditions(r, conds));
  }, [finalized, conds]);

  const metrics = useMemo(() => {
    const hours = rows.reduce((s, r) => s + Number(r.hours || 0), 0);
    const revenue = rows.reduce((s, r) => s + Number(r.total_price || 0), 0);
    const perHour = hours > 0 ? revenue / hours : 0;
    return { hours, revenue, perHour, count: rows.length };
  }, [rows]);

  const byClient = useMemo(() => {
    const map = new Map<string, { client: string; Revenue: number }>();
    for (const r of rows) {
      const k = r.client || "—";
      const c = map.get(k) ?? { client: k, Revenue: 0 };
      c.Revenue += Number(r.total_price || 0);
      map.set(k, c);
    }
    return Array.from(map.values());
  }, [rows]);

  const byCluster = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = r.cluster || "—";
      map.set(k, (map.get(k) ?? 0) + Number(r.total_price || 0));
    }
    return Array.from(map.entries())
      .map(([cluster, revenue]) => ({ cluster, revenue }))
      .sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [rows]);

  // Pagination
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pages - 1);
  useEffect(() => { setPage(0); }, [conds]);
  const pageRows = rows.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  // View selection
  function selectAll() {
    setActive({ kind: "all" }); setConds([]); setLocked(false);
  }
  function selectSaved(v: SavedFilter) {
    setActive({ kind: "saved", filter: v });
    setConds([...v.conditions]);
    setLocked(true);
  }
  function requestEdit() { setAskEdit(true); }
  function confirmEdit() { setLocked(false); setAskEdit(false); flash("Filter unlocked for editing", "info"); }
  async function saveActive() {
    if (active.kind !== "saved") return;
    setSavingView(true);
    const { error } = await supabase
      .from("sunstar_saved_filters")
      .update({ conditions: conds })
      .eq("id", active.filter.id!);
    setSavingView(false);
    if (error) return flash(error.message, "error");
    flash("Saved changes to view", "success");
    setLocked(true);
    loadViews();
  }
  async function saveAsNew() {
    if (!newName.trim()) return flash("Give the view a name", "error");
    setSavingView(true);
    const { data, error } = await supabase
      .from("sunstar_saved_filters")
      .insert({ name: newName.trim(), conditions: conds })
      .select().single();
    setSavingView(false);
    if (error) return flash(error.message, "error");
    flash(`Saved view "${newName}"`, "success");
    setNewName(""); setAskSave(false);
    await loadViews();
    if (data) selectSaved(data as SavedFilter);
  }
  async function deleteView(v: SavedFilter) {
    if (!confirm(`Delete saved view "${v.name}"?`)) return;
    const { error } = await supabase.from("sunstar_saved_filters").delete().eq("id", v.id!);
    if (error) return flash(error.message, "error");
    flash("View deleted", "success");
    if (active.kind === "saved" && active.filter.id === v.id) selectAll();
    loadViews();
  }
  async function renameView(v: SavedFilter) {
    const name = prompt("New name", v.name);
    if (!name || name === v.name) return;
    const { error } = await supabase.from("sunstar_saved_filters").update({ name }).eq("id", v.id!);
    if (error) return flash(error.message, "error");
    flash("Renamed", "success");
    loadViews();
  }

  return (
    <div className="flex gap-6">
      {toast && <Toast msg={toast.msg} kind={toast.kind} />}

      {/* LEFT SIDEBAR */}
      <aside className="w-60 flex-shrink-0">
        <div className="bg-white rounded-2xl shadow-sm p-3 sticky top-4">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wide px-2 mb-2">Views</div>
          <SidebarItem
            label="All entries"
            active={active.kind === "all"}
            onClick={selectAll}
          />
          {views.map((v) => (
            <SidebarItem
              key={v.id}
              label={v.name}
              badge={v.conditions.length ? `${v.conditions.length}` : undefined}
              active={active.kind === "saved" && active.filter.id === v.id}
              onClick={() => selectSaved(v)}
              onDelete={() => deleteView(v)}
              onRename={() => renameView(v)}
            />
          ))}
          <div className="border-t mt-2 pt-2">
            <button
              onClick={() => { setActive({ kind: "custom" }); setConds([]); setLocked(false); }}
              className="w-full text-left text-sm text-brand-yellowDark font-semibold px-3 py-2 rounded-lg hover:bg-brand-yellowSoft"
            >
              + New view
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <section className="flex-1 min-w-0 space-y-6">
        {/* Toolbar */}
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-bold text-brand-ink text-lg">
                {active.kind === "all" ? "All finalized entries"
                 : active.kind === "saved" ? active.filter.name
                 : "New view"}
              </div>
              <div className="text-xs text-gray-500">
                {locked && active.kind === "saved"
                  ? "Filter is locked — click Edit filter to change it."
                  : "Compose conditions to narrow the results."}
              </div>
            </div>
            <div className="flex gap-2">
              {!locked && (
                <button
                  onClick={() => setAdding(true)}
                  className="bg-brand-ink text-brand-yellow font-bold px-3 py-2 rounded-lg text-sm"
                >
                  + Add condition
                </button>
              )}
              {locked && active.kind === "saved" && (
                <button onClick={requestEdit}
                  className="bg-brand-yellow text-brand-ink font-bold px-3 py-2 rounded-lg text-sm">
                  Edit filter
                </button>
              )}
              {!locked && active.kind === "saved" && (
                <button
                  onClick={saveActive}
                  disabled={savingView}
                  className="bg-green-600 text-white font-bold px-3 py-2 rounded-lg text-sm disabled:opacity-50"
                >
                  {savingView ? "Saving…" : "Save changes"}
                </button>
              )}
              {!locked && (active.kind === "custom" || (active.kind === "all" && conds.length > 0)) && (
                <button
                  onClick={() => setAskSave(true)}
                  className="bg-brand-yellow text-brand-ink font-bold px-3 py-2 rounded-lg text-sm"
                >
                  Save as view
                </button>
              )}
            </div>
          </div>

          {conds.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              {conds.map((c, i) => (
                <FilterChip
                  key={i} cond={c}
                  onRemove={locked ? undefined : () => setConds((cs) => cs.filter((_, j) => j !== i))}
                />
              ))}
              {!locked && (
                <button
                  onClick={() => setConds([])}
                  className="text-xs text-gray-500 hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>

        {/* Metrics + charts (respect active filter) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Metric label="Entries" value={metrics.count.toString()} />
          <Metric label="Total Hours" value={metrics.hours.toFixed(0)} />
          <Metric label="Revenue" value={`AED ${metrics.revenue.toLocaleString()}`} accent />
          <Metric label="Avg AED/hr" value={metrics.perHour.toFixed(2)} accent />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="font-bold text-sm mb-3">Revenue by Client</div>
            {byClient.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byClient} margin={{ top: 8, right: 12, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="client" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => `AED ${Number(v).toLocaleString()}`} />
                  <Bar dataKey="Revenue" fill="#FFC107" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="font-bold text-sm mb-3">Revenue share — top 8 clusters</div>
            {byCluster.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={byCluster} dataKey="revenue" nameKey="cluster"
                    cx="50%" cy="50%" outerRadius={80} innerRadius={40}
                    paddingAngle={2} label={(e: any) => e.cluster} isAnimationActive={false}>
                    {byCluster.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => `AED ${Number(v).toLocaleString()}`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b">
            <div className="font-bold text-brand-ink">
              {rows.length} row{rows.length === 1 ? "" : "s"}
              <span className="text-gray-400 font-normal">
                {rows.length > PAGE_SIZE && ` · page ${clampedPage + 1} of ${pages}`}
              </span>
            </div>
            {pages > 1 && (
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={clampedPage === 0}
                  className="px-3 py-1 text-sm border rounded-lg disabled:opacity-40">← Prev</button>
                <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={clampedPage >= pages - 1}
                  className="px-3 py-1 text-sm border rounded-lg disabled:opacity-40">Next →</button>
              </div>
            )}
          </div>
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
                {pageRows.length === 0 ? (
                  <tr><td className="p-10 text-center text-gray-400" colSpan={22}>No matching entries.</td></tr>
                ) : pageRows.map((r, i) => {
                  const tone = rateTone(r);
                  return (
                    <tr key={r.id} className="border-t hover:bg-brand-yellowSoft">
                      <td className="px-3 py-2 text-gray-400">{clampedPage * PAGE_SIZE + i + 1}</td>
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
                      <td className="px-3 py-2">
                        <span className={`inline-block font-bold px-2 py-0.5 rounded ${rateToneClasses(tone)}`}>
                          {r.per_hour_ratio ?? ""}
                        </span>
                      </td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <AddConditionPopover
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={(c) => setConds((cs) => [...cs, c])}
        optionsByCol={optionsByCol}
      />

      {/* Edit filter confirm */}
      {askEdit && (
        <ConfirmModal
          title="Edit this saved view?"
          body="Once you click Confirm, the filter chips become editable. Any changes will only save when you click Save changes."
          onCancel={() => setAskEdit(false)}
          onConfirm={confirmEdit}
        />
      )}

      {/* Save as new view */}
      {askSave && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
             onClick={() => setAskSave(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full"
               onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-bold mb-2">Save filter as view</div>
            <div className="text-sm text-gray-600 mb-4">Give it a name. Shared with all admins.</div>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. V-14 · 3BR · Ginco-DIP"
              className="w-full border rounded-lg px-3 py-2 mb-4"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setAskSave(false)}
                className="px-4 py-2 rounded-lg border">Cancel</button>
              <button onClick={saveAsNew} disabled={savingView}
                className="px-4 py-2 rounded-lg bg-brand-ink text-brand-yellow font-bold disabled:opacity-50">
                {savingView ? "Saving…" : "Save view"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================== */
function SidebarItem({
  label, active, badge, onClick, onDelete, onRename,
}: {
  label: string; active: boolean; badge?: string;
  onClick: () => void; onDelete?: () => void; onRename?: () => void;
}) {
  return (
    <div className={`group flex items-center rounded-lg transition ${
      active ? "bg-brand-yellow" : "hover:bg-gray-50"
    }`}>
      <button
        onClick={onClick}
        className={`flex-1 text-left px-3 py-2 text-sm truncate ${
          active ? "font-bold text-brand-ink" : "text-gray-700"
        }`}
      >
        {label}
        {badge && <span className="ml-2 text-[10px] bg-brand-ink text-brand-yellow rounded-full px-1.5 py-0.5">{badge}</span>}
      </button>
      {(onDelete || onRename) && (
        <div className="opacity-0 group-hover:opacity-100 flex gap-1 pr-2 text-xs">
          {onRename && <button onClick={onRename} className="text-gray-500 hover:text-brand-ink px-1" title="Rename">✎</button>}
          {onDelete && <button onClick={onDelete} className="text-red-500 hover:text-red-700 px-1" title="Delete">×</button>}
        </div>
      )}
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

function EmptyChart() {
  return (
    <div className="h-[200px] flex items-center justify-center text-sm text-gray-400 border-2 border-dashed rounded-xl">
      No finalized entries in this view
    </div>
  );
}

function ConfirmModal({
  title, body, onCancel, onConfirm,
}: { title: string; body: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="text-lg font-bold text-brand-ink mb-2">{title}</div>
        <div className="text-sm text-gray-600 mb-5">{body}</div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg border">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-brand-ink text-brand-yellow font-bold">Confirm</button>
        </div>
      </div>
    </div>
  );
}

void Legend;
