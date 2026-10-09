import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase, POINT_FIELDS } from "../lib/supabase";
import type { WorkEntry, SavedFilter, Condition, FilterCol } from "../lib/supabase";
import { passesConditions, rateTone, rateToneClasses } from "../lib/rate";
import { fetchAll, todayDubai } from "../lib/data";
import { AddConditionPopover, FilterChip } from "../components/FilterBuilder";
import { ClientMetricsChart } from "../components/ClientMetricsChart";
import { CompanyRatioPanel } from "../components/CompanyRatioPanel";
import { Toast } from "../components/Toast";
import type { ToastKind } from "../components/Toast";
import { FullEditModal } from "../components/FullEditModal";

const PAGE_SIZE = 50;
const TEXT_COLS: FilterCol[] = [
  "cluster","phase","villa","bedroom_type","floor_type","description","client","status","apartment_number",
];

type ActiveView =
  | { kind: "all" }
  | { kind: "custom" }
  | { kind: "saved"; filter: SavedFilter };

export default function AdminFinalized({ finalized }: { finalized: WorkEntry[] }) {
  const [views, setViews] = useState<SavedFilter[]>([]);
  const [optionsByCol, setOptionsByCol] = useState<Partial<Record<FilterCol, string[]>>>({});
  const [active, setActive] = useState<ActiveView>({ kind: "all" });
  const [conds, setConds] = useState<Condition[]>([]);
  const [locked, setLocked] = useState(false);
  const [adding, setAdding] = useState(false);
  const [askEdit, setAskEdit] = useState(false);
  const [savingView, setSavingView] = useState(false);
  const [newName, setNewName] = useState("");
  const [askSave, setAskSave] = useState(false);
  const [page, setPage] = useState(0);
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);

  // Row-level actions on the finalized entries table
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<WorkEntry | null>(null);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<WorkEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Close row menu on outside click / escape
  const menuHost = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!openMenuId) return;
    const onDown = (e: MouseEvent) => {
      if (menuHost.current && !menuHost.current.contains(e.target as Node)) setOpenMenuId(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenMenuId(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [openMenuId]);

  async function deleteFinalized(r: WorkEntry) {
    if (!r.id) return;
    setDeleting(true);
    const { error } = await supabase.from("sunstar_work_entries").delete().eq("id", r.id);
    setDeleting(false);
    if (error) return flash(error.message, "error");
    setConfirmDeleteRow(null);
    setOpenMenuId(null);
    flash(`Deleted Villa ${r.villa}`, "success");
  }
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

  /** Add one row's text values to the filter dropdowns (no full refetch). */
  function mergeOptions(row: any) {
    if (!row) return;
    setOptionsByCol((prev) => {
      const next = { ...prev };
      TEXT_COLS.forEach((c) => {
        const v = row[c];
        if (v == null || String(v).trim() === "") return;
        const val = String(v).trim();
        const list = next[c] ?? [];
        if (!list.includes(val)) next[c] = [...list, val].sort((a, b) => a.localeCompare(b));
      });
      return next;
    });
  }

  async function loadOptions() {
    // Paged past the 1,000-row API cap so older values still appear.
    const { data, error } = await fetchAll<any>(() =>
      supabase
        .from("sunstar_work_entries")
        .select(`id,${TEXT_COLS.join(",")}`)
        .order("id"));
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
      .on("postgres_changes", { event: "*", schema: "public", table: "sunstar_work_entries" }, (p: any) => mergeOptions(p.new))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Pagination
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pages - 1);
  useEffect(() => { setPage(0); }, [conds]);
  const pageRows = rows.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const allClients = optionsByCol.client ?? [];

  // Selection helpers
  function selectAll() { setActive({ kind: "all" }); setConds([]); setLocked(false); }
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

  /** Called from the ClientMetricsChart "Compare clients" popover */
  function applyClientComparison(clientList: string[]) {
    // Replace any existing "client" condition
    const others = conds.filter((c) => c.col !== "client");
    if (locked) {
      flash("Unlock the filter first (Edit filter) to change conditions", "info");
      return;
    }
    if (clientList.length === 0) { setConds(others); return; }
    if (clientList.length === 1) {
      setConds([...others, { col: "client", op: "equals", value: clientList[0] }]);
    } else {
      setConds([...others, { col: "client", op: "in", values: clientList }]);
    }
    flash(`Filtering to ${clientList.length} client${clientList.length === 1 ? "" : "s"}`, "info");
  }

  function exportCSV() {
    const { headers, rows: outRows } = buildExportData(rows);
    const lines = [headers.join(",")];
    outRows.forEach((r) => lines.push(r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")));
    downloadBlob(lines.join("\n"), "text/csv", "sunstar_export.csv");
  }
  function exportXLSX() {
    const { headers, rows: outRows } = buildExportData(rows);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...outRows]);
    // Reasonable column widths
    ws["!cols"] = headers.map((h) => ({ wch: Math.min(24, Math.max(8, h.length + 2)) }));
    const wb = XLSX.utils.book_new();
    const sheetName =
      active.kind === "saved" ? active.filter.name.slice(0, 31) : "Sunstar";
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `sunstar_${todayDubai()}.xlsx`);
  }

  return (
    // Fixed-height split-screen only on wide desktops (≥1280px). On narrower
    // windows everything stacks and scrolls normally so nothing is cut off.
    <div className="xl:h-[calc(100vh-140px)] xl:overflow-hidden">
      {toast && <Toast msg={toast.msg} kind={toast.kind} />}

      {/* TWO-column grid: [ Views sidebar | Right pane ].
          The right pane itself splits top (ratios + chart side-by-side) and
          bottom (toolbar + full-width entries table ≈ 60-65% of the height). */}
      <div className="grid gap-4 xl:h-full grid-cols-1 xl:grid-cols-[200px_minmax(0,1fr)]">
        {/* LEFT: Views sidebar (scrolls internally if long) */}
        <aside className="bg-white rounded-2xl shadow-sm p-3 overflow-y-auto">
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
              className="w-full text-left text-sm text-brand-blueDark font-semibold px-3 py-2 rounded-lg hover:bg-brand-blueSoft"
            >
              + New view
            </button>
          </div>
        </aside>

        {/* RIGHT: top (metrics + ratios + chart) stacked above the entries table. */}
        <div className="flex flex-col min-h-0 min-w-0 gap-4">
          {/* Metrics summary strip */}
          <MetricCards m={metrics} />

          {/* Top row: Ratios (wider) and Client Metrics chart (narrower).
              Capped height on desktop so the table below gets ~60-65%. */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 xl:h-[36vh] xl:min-h-[260px]">
            <section className="lg:col-span-3 overflow-y-auto min-h-0">
              <CompanyRatioPanel rows={rows} />
            </section>
            <section className="lg:col-span-2 overflow-y-auto min-h-0">
              <ClientMetricsChart
                rows={rows}
                allClients={allClients}
                onCompareClients={applyClientComparison}
              />
            </section>
          </div>

          {/* Bottom: toolbar + full-width table (fills remaining height) */}
          <section className="flex flex-col min-h-0 min-w-0 gap-4 flex-1">
          <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3 flex-shrink-0">
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
              <div className="flex gap-2 flex-wrap">
                {!locked && (
                  <button onClick={() => setAdding(true)}
                    className="bg-brand-ink text-white font-bold px-3 py-2 rounded-lg text-sm">
                    + Add condition
                  </button>
                )}
                {locked && active.kind === "saved" && (
                  <button onClick={requestEdit}
                    className="bg-brand-blue text-white font-bold px-3 py-2 rounded-lg text-sm">
                    Edit filter
                  </button>
                )}
                {!locked && active.kind === "saved" && (
                  <button onClick={saveActive} disabled={savingView}
                    className="bg-green-600 text-white font-bold px-3 py-2 rounded-lg text-sm disabled:opacity-50">
                    {savingView ? "Saving…" : "Save changes"}
                  </button>
                )}
                {!locked && (active.kind === "custom" || (active.kind === "all" && conds.length > 0)) && (
                  <button onClick={() => setAskSave(true)}
                    className="bg-brand-blue text-white font-bold px-3 py-2 rounded-lg text-sm">
                    Save as view
                  </button>
                )}
                <button onClick={exportXLSX}
                  className="border border-green-600 text-green-700 hover:bg-green-600 hover:text-white font-semibold px-3 py-2 rounded-lg text-sm transition">
                  Export XLSX
                </button>
                <button onClick={exportCSV}
                  className="border border-gray-400 text-gray-600 hover:bg-gray-100 font-semibold px-3 py-2 rounded-lg text-sm transition">
                  CSV
                </button>
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
                  <button onClick={() => setConds([])}
                    className="text-xs text-gray-500 hover:underline">
                    Clear all
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-0 flex-1">
            <div className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0">
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
            <div className="overflow-auto flex-1 max-h-[75vh] xl:max-h-none">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase sticky top-0 z-10">
                  <tr>
                    {["#","Cluster","Phase","Villa","Apt","BR","Desc","Fl","Start","End","Target","Actual","Price","AED/hr","PS","GI","20mm","25mm","32mm","50mm","DB","Client","Employee",""].map((h) => (
                      <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td className="p-10 text-center text-gray-400" colSpan={24}>No matching entries.</td></tr>
                  ) : pageRows.map((r, i) => {
                    const tone = rateTone(r);
                    return (
                      <tr key={r.id} className="border-t hover:bg-brand-blueSoft">
                        <td className="px-3 py-2 text-gray-400">{clampedPage * PAGE_SIZE + i + 1}</td>
                        <td className="px-3 py-2">{r.cluster}</td>
                        <td className="px-3 py-2">{r.phase}</td>
                        <td className="px-3 py-2 font-semibold">{r.villa}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{r.apartment_number ?? ""}</td>
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
                        <td className="px-2 py-2 relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(openMenuId === r.id ? null : (r.id ?? null));
                            }}
                            aria-label={`Row actions for Villa ${r.villa}`}
                            aria-haspopup="menu"
                            aria-expanded={openMenuId === r.id}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-full text-gray-500 hover:bg-gray-100 hover:text-brand-ink"
                          >
                            ⋯
                          </button>
                          {openMenuId === r.id && (
                            <div
                              ref={menuHost}
                              role="menu"
                              className="absolute right-2 top-full mt-1 z-20 min-w-[10rem] bg-white border border-gray-200 rounded-lg shadow-lg py-1"
                            >
                              <button
                                role="menuitem"
                                onClick={() => { setOpenMenuId(null); setEditRow(r); }}
                                className="block w-full text-left px-3 py-2 text-sm hover:bg-brand-blueSoft text-brand-ink"
                              >
                                ✎ Edit entry
                              </button>
                              <button
                                role="menuitem"
                                onClick={() => { setOpenMenuId(null); setConfirmDeleteRow(r); }}
                                className="block w-full text-left px-3 py-2 text-sm hover:bg-red-50 text-red-700"
                              >
                                🗑 Delete entry
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
        </div>
      </div>

      <AddConditionPopover
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={(c) => setConds((cs) => [...cs, c])}
        optionsByCol={optionsByCol}
      />

      {askEdit && (
        <ConfirmModal
          title="Edit this saved view?"
          body="Once you click Confirm, the filter chips become editable. Any changes will only save when you click Save changes."
          onCancel={() => setAskEdit(false)}
          onConfirm={confirmEdit}
        />
      )}

      {askSave && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setAskSave(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
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
              <button onClick={() => setAskSave(false)} className="px-4 py-2 rounded-lg border">Cancel</button>
              <button onClick={saveAsNew} disabled={savingView}
                className="px-4 py-2 rounded-lg bg-brand-ink text-white font-bold disabled:opacity-50">
                {savingView ? "Saving…" : "Save view"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editRow && (
        <FullEditModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onDone={() => { setEditRow(null); flash("Entry updated", "success"); }}
          flash={flash}
        />
      )}

      {confirmDeleteRow && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setConfirmDeleteRow(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-bold text-brand-ink mb-2">Delete Villa {confirmDeleteRow.villa}?</div>
            <div className="text-sm text-gray-600 mb-1">
              {confirmDeleteRow.description} · {confirmDeleteRow.client}
              {confirmDeleteRow.start_date ? ` · ${confirmDeleteRow.start_date}` : ""}
            </div>
            <div className="text-sm text-gray-600 mb-5">
              This will remove the entry permanently — analytics, exports and saved views will no longer include it. This cannot be undone.
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDeleteRow(null)} className="px-4 py-2 rounded-lg border">Cancel</button>
              <button
                onClick={() => deleteFinalized(confirmDeleteRow)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================== */
function MetricCards({ m }: { m: { hours: number; revenue: number; perHour: number; count: number } }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Metric label="Entries" value={m.count.toString()} />
      <Metric label="Total Hours" value={m.hours.toFixed(0)} />
      <Metric label="Revenue" value={`AED ${m.revenue.toLocaleString()}`} accent />
      <Metric label="Avg AED/hr" value={m.perHour.toFixed(2)} accent />
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 shadow-sm ${accent ? "bg-brand-blue text-white" : "bg-white border"}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-70 font-semibold">{label}</div>
      <div className="text-lg font-bold mt-1 truncate">{value}</div>
    </div>
  );
}

function SidebarItem({
  label, active, badge, onClick, onDelete, onRename,
}: {
  label: string; active: boolean; badge?: string;
  onClick: () => void; onDelete?: () => void; onRename?: () => void;
}) {
  return (
    <div className={`group flex items-center rounded-lg transition ${active ? "bg-brand-blueSoft ring-1 ring-brand-blue" : "hover:bg-gray-50"}`}>
      <button
        onClick={onClick}
        className={`flex-1 text-left px-3 py-2 text-sm truncate ${active ? "font-bold text-brand-blueDark" : "text-gray-700"}`}
      >
        {label}
        {badge && <span className="ml-2 text-[10px] bg-brand-ink text-white rounded-full px-1.5 py-0.5">{badge}</span>}
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
          <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-brand-ink text-white font-bold">Confirm</button>
        </div>
      </div>
    </div>
  );
}

/* Export helpers */
/* Columns intentionally excluded from the export (per client request):
 *   - State (`state`)                      → removed as a column
 *   - Apartment (`apartment_number`)       → removed
 *   - Status (`status`)                    → removed
 *   - GI-Circular Box (`gi_circular_box`)  → removed
 *   - GI-Offset (`gi_offset`)              → removed
 *   - Final Fix Socket (`final_fix_socket`)→ removed
 * One rename:
 *   - Final Fix Switch                     → "Wiring Accessories"
 * Everything else stays in POINT_FIELDS order so the sheet keeps the same
 * left-to-right flow operators are used to.
 */
const EXPORT_EXCLUDE_POINT_KEYS = new Set(["gi_circular_box", "gi_offset", "final_fix_socket"]);
const EXPORT_LABEL_OVERRIDES: Record<string, string> = {
  final_fix_switch: "Wiring Accessories",
};

function buildExportData(rows: WorkEntry[]) {
  const exportPointFields = POINT_FIELDS.filter(
    (p) => !EXPORT_EXCLUDE_POINT_KEYS.has(p.key as string),
  );
  const headers = [
    "S.No","Cluster","Phase","Villa","Bedroom","Description","Floor",
    "Start Date","End Date","Client","Employee",
    "Total Manpower","Check-in","Check-out","Break Start","Break End",
    "Target Hours","Actual Hours","Total Price (AED)","AED per Hour",
    ...exportPointFields.map((p) => EXPORT_LABEL_OVERRIDES[p.key as string] ?? p.label),
  ];
  const out = rows.map((r, i) => {
    const base: (string | number)[] = [
      i + 1, r.cluster, r.phase, r.villa,
      r.bedroom_type, r.description, r.floor_type,
      r.start_date ?? "", r.end_date ?? "", r.client ?? "", r.employee_name ?? "",
      r.total_manpower ?? "",
      (r.check_in_time ?? "").toString().slice(0,5),
      (r.check_out_time ?? "").toString().slice(0,5),
      (r.break_start_time ?? "").toString().slice(0,5),
      (r.break_end_time ?? "").toString().slice(0,5),
      r.target_hours ?? "", r.hours ?? "",
      r.total_price != null ? Number(r.total_price) : "",
      r.per_hour_ratio != null ? Number(r.per_hour_ratio) : "",
    ];
    exportPointFields.forEach((p) => base.push(((r as any)[p.key] ?? 0) as number));
    return base;
  });
  return { headers, rows: out };
}

function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
