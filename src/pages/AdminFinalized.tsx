import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type { WorkEntry, SavedFilter, Condition, FilterCol } from "../lib/supabase";
import { passesConditions, rateTone, rateToneClasses } from "../lib/rate";
import { fetchAll, todayDubai } from "../lib/data";
import { downloadWorkbook, buildCsv } from "../lib/exportSheet";
import { AddConditionPopover, FilterChip } from "../components/FilterBuilder";
import { ClientMetricsChart } from "../components/ClientMetricsChart";
import { CompanyRatioPanel } from "../components/CompanyRatioPanel";
import { Toast } from "../components/Toast";
import type { ToastKind } from "../components/Toast";
import { FullEditModal } from "../components/FullEditModal";
import { InvoiceModal } from "../components/InvoiceModal";

const PAGE_SIZE = 50;
const TEXT_COLS: FilterCol[] = [
  "cluster","phase","villa","bedroom_type","floor_type","description","client","status","apartment_number",
];

/* Column keys that are sortable and the kind of comparator they use. Keys
 * align with the WorkEntry field name; "number" uses numeric compare, "date"
 * compares the YYYY-MM-DD string (lexicographic == chronological), everything
 * else is a natural-order string compare (so "V-2" sorts before "V-10"). */
const SORT_KIND: Record<string, "text" | "number" | "date"> = {
  cluster: "text", phase: "text", villa: "text",
  apartment_number: "text", bedroom_type: "text", description: "text", floor_type: "text",
  start_date: "date", end_date: "date",
  hours: "number", total_price: "number", per_hour_ratio: "number",
  power_point: "number", gi_box_nos: "number", data_point: "number",
  telephone_point: "number", lighting_point: "number", fcu_point: "number", db_conduit: "number",
  client: "text", employee_name: "text",
};

/* Table columns, in render order. Row-number ("#") and the actions column
 * aren't sortable, so their col is null. */
const COLUMNS: { label: string; col: string | null }[] = [
  { label: "#",         col: null },
  { label: "Cluster",   col: "cluster" },
  { label: "Phase",     col: "phase" },
  { label: "Villa",     col: "villa" },
  { label: "Apt",       col: "apartment_number" },
  { label: "BR",        col: "bedroom_type" },
  { label: "Desc",      col: "description" },
  { label: "Fl",        col: "floor_type" },
  { label: "Start",     col: "start_date" },
  { label: "End",       col: "end_date" },
  { label: "Actual",    col: "hours" },
  { label: "Price",     col: "total_price" },
  { label: "AED/hr",    col: "per_hour_ratio" },
  { label: "PS",        col: "power_point" },
  { label: "GI",        col: "gi_box_nos" },
  { label: "20mm",      col: "data_point" },
  { label: "25mm",      col: "telephone_point" },
  { label: "32mm",      col: "lighting_point" },
  { label: "50mm",      col: "fcu_point" },
  { label: "DB",        col: "db_conduit" },
  { label: "Client",    col: "client" },
  { label: "Employee",  col: "employee_name" },
  { label: "",          col: null },
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
  const [invoiceOpen, setInvoiceOpen] = useState(false);

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

  // Insights column collapse — hides the whole middle column (Company Ratio
  // + Client Metrics chart) so the entries table claims the extra width.
  // Default = collapsed (table-first). Persisted per browser.
  const INSIGHTS_KEY = "sunstar-insights-collapsed";
  const [insightsCollapsed, setInsightsCollapsed] = useState<boolean>(() => {
    try { const v = localStorage.getItem(INSIGHTS_KEY); return v === null ? true : v === "1"; }
    catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(INSIGHTS_KEY, insightsCollapsed ? "1" : "0"); } catch {}
  }, [insightsCollapsed]);

  // Search is a BOOST, not a filter: whatever the admin types is matched
  // against the client name (case-insensitive, prefix match preferred) and
  // the matching rows are hoisted to the top of the list. Non-matching rows
  // keep their place below, so the full dataset stays visible and totals
  // don't change as the admin types.
  const [search, setSearch] = useState("");
  const filteredRows = useMemo(() => {
    if (conds.length === 0) return finalized;
    return finalized.filter((r) => passesConditions(r, conds));
  }, [finalized, conds]);

  // Click-to-sort state. Click cycles none → asc → desc → none. Click on a
  // different column snaps the direction back to asc. Metrics still read from
  // filteredRows so sort doesn't change totals.
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);
  function toggleSort(col: string) {
    if (sortCol !== col) { setSortCol(col); setSortDir("asc"); return; }
    if (sortDir === "asc")  { setSortDir("desc"); return; }
    if (sortDir === "desc") { setSortCol(null); setSortDir(null); return; }
    setSortDir("asc");
  }
  const sortedRows = useMemo(() => {
    if (!sortCol || !sortDir) return filteredRows;
    const kind = SORT_KIND[sortCol] ?? "text";
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const va = (a as any)[sortCol];
      const vb = (b as any)[sortCol];
      // null/undefined/empty always sort to the END regardless of direction,
      // so empty cells don't clog the top of the table on a fresh sort.
      const aMissing = va == null || va === "";
      const bMissing = vb == null || vb === "";
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      let cmp = 0;
      if (kind === "number") cmp = Number(va) - Number(vb);
      else if (kind === "date") cmp = String(va).localeCompare(String(vb));
      else cmp = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filteredRows, sortCol, sortDir]);

  /**
   * Final row order the table renders.
   * If search is empty: just the sorted rows.
   * Otherwise: client-name matches are hoisted to the top. Within the matched
   * group, "starts with" ranks higher than "contains anywhere", so typing
   * "GIN" surfaces GINCO rows first and anything that merely contains "gin"
   * right after. Rows that don't match the search stay underneath in their
   * current sort order — nothing is hidden.
   */
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedRows;
    const prefix: WorkEntry[] = [];
    const contains: WorkEntry[] = [];
    const rest: WorkEntry[] = [];
    for (const r of sortedRows) {
      const client = (r.client ?? "").toString().toLowerCase();
      if (!client) { rest.push(r); continue; }
      if (client.startsWith(q)) prefix.push(r);
      else if (client.includes(q)) contains.push(r);
      else rest.push(r);
    }
    return [...prefix, ...contains, ...rest];
  }, [sortedRows, search]);

  const metrics = useMemo(() => {
    const hours = filteredRows.reduce((s, r) => s + Number(r.hours || 0), 0);
    const revenue = filteredRows.reduce((s, r) => s + Number(r.total_price || 0), 0);
    const perHour = hours > 0 ? revenue / hours : 0;
    return { hours, revenue, perHour, count: filteredRows.length };
  }, [filteredRows]);

  // Pagination
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pages - 1);
  useEffect(() => { setPage(0); }, [conds, sortCol, sortDir, search]);
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

  function exportBaseName() {
    const view = active.kind === "saved"
      ? active.filter.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40)
      : "";
    return `sunstar_${view ? `${view}_` : ""}${todayDubai()}`;
  }
  function exportCSV() {
    downloadBlob(buildCsv(rows), "text/csv", `${exportBaseName()}.csv`);
  }
  function exportXLSX() {
    downloadWorkbook(rows, `${exportBaseName()}.xlsx`);
  }

  return (
    // Fixed-height split-screen only on wide desktops (≥1280px). On narrower
    // windows everything stacks and scrolls normally so nothing is cut off.
    <div className="xl:h-[calc(100vh-140px)] xl:overflow-hidden flex flex-col gap-4">
      {toast && <Toast msg={toast.msg} kind={toast.kind} />}

      {/* Metrics summary strip — full width across the top */}
      <MetricCards m={metrics} />

      {/* Grid below the metrics strip. When insights are collapsed the middle
          column disappears entirely so the table reclaims the full width. */}
      <div className={`grid gap-4 xl:flex-1 xl:min-h-0 grid-cols-1 ${
        insightsCollapsed
          ? "xl:grid-cols-[200px_minmax(0,1fr)]"
          : "xl:grid-cols-[200px_360px_minmax(0,1fr)]"
      }`}>
        {/* LEFT: Views sidebar (scrolls internally if long) */}
        <aside className="bg-white rounded-2xl shadow-sm p-3 overflow-y-auto">
          {/* Insights column toggle — sits above the Views label */}
          <button
            type="button"
            onClick={() => setInsightsCollapsed((v) => !v)}
            aria-expanded={!insightsCollapsed}
            className={`w-full flex items-center justify-between gap-2 px-3 py-2 mb-2 rounded-lg border text-xs font-semibold transition ${
              insightsCollapsed
                ? "bg-white border-slate-200 text-brand-ink hover:border-brand-blue hover:text-brand-blueDark"
                : "bg-brand-blueSoft border-brand-blue/40 text-brand-blueDark"
            }`}
            title={insightsCollapsed ? "Show the Company Ratio and Client Metrics panels" : "Hide the insights column to give the table more space"}
          >
            <span className="flex items-center gap-1.5">
              <span>📊</span>
              <span>{insightsCollapsed ? "Show insights" : "Hide insights"}</span>
            </span>
            <span className="text-[10px] text-gray-400">{insightsCollapsed ? "▸" : "▾"}</span>
          </button>
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

        {/* MIDDLE: Company ratio + client metrics chart, stacked. Independent scroll.
            Hidden entirely when insights are collapsed — the parent grid also drops
            its middle track so the table reclaims the width. */}
        {!insightsCollapsed && (
          <section className="overflow-y-auto min-h-0 space-y-4 pr-1">
            <CompanyRatioPanel rows={rows} />
            <ClientMetricsChart
              rows={rows}
              allClients={allClients}
              onCompareClients={applyClientComparison}
            />
          </section>
        )}

        {/* RIGHT: toolbar + full-width entries table (independent scroll) */}
        <section className="flex flex-col min-h-0 min-w-0 gap-4">
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
              {/* Free-text search — stacks after conditions + sort. Matches
                  villa, cluster, phase, client, description, employee, apt,
                  bedroom/floor type, and status. */}
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">⌕</span>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Type a client name — matches jump to top"
                  className="w-full border border-slate-200 rounded-lg pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/40 focus:border-brand-blue"
                />
                {search && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-brand-ink text-lg leading-none"
                  >
                    ×
                  </button>
                )}
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
                <button onClick={() => setInvoiceOpen(true)} disabled={rows.length === 0}
                  title="Preview, edit and download an invoice for the entries in this view"
                  className="border border-brand-blue text-brand-blueDark hover:bg-brand-blue hover:text-white font-semibold px-3 py-2 rounded-lg text-sm transition disabled:opacity-40 disabled:pointer-events-none">
                  Invoice
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
                    {COLUMNS.map((h, idx) => {
                      const active = h.col && h.col === sortCol;
                      const arrow = active ? (sortDir === "asc" ? " ↑" : sortDir === "desc" ? " ↓" : "") : "";
                      return (
                        <th key={`${h.label}-${idx}`} className="px-3 py-2 text-left whitespace-nowrap">
                          {h.col ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(h.col!)}
                              aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                              className={`inline-flex items-center gap-0.5 cursor-pointer select-none hover:text-brand-ink transition ${active ? "text-brand-blueDark" : ""}`}
                              title={active ? `Click to ${sortDir === "asc" ? "sort descending" : "clear sort"}` : "Click to sort ascending"}
                            >
                              <span>{h.label}</span>
                              <span className="text-[10px]">{arrow}</span>
                            </button>
                          ) : h.label}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td className="p-10 text-center text-gray-400" colSpan={23}>No matching entries.</td></tr>
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

      {invoiceOpen && (
        <InvoiceModal rows={rows} onClose={() => setInvoiceOpen(false)} flash={flash} />
      )}

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
/** Single thin strip — Entries · Total Hours · Revenue · Avg AED/hr — so the
 *  entries table below gets most of the vertical space. Numbers are the top
 *  typographic layer so they read at a glance from across the room. */
function MetricCards({ m }: { m: { hours: number; revenue: number; perHour: number; count: number } }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200/70 shadow-sm px-4 py-2.5 flex flex-wrap items-center gap-x-8 gap-y-2">
      <MetricInline label="Entries" value={m.count.toLocaleString()} />
      <MetricInline label="Total Hours" value={Math.round(m.hours).toLocaleString()} />
      <MetricInline label="Revenue" value={`AED ${m.revenue.toLocaleString()}`} accent />
      <MetricInline label="Avg AED/hr" value={m.perHour.toFixed(2)} accent />
    </div>
  );
}

function MetricInline({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-2.5 min-w-0">
      <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">{label}</span>
      <span className={`text-2xl font-extrabold tabular-nums leading-none truncate ${accent ? "text-brand-blueDark" : "text-brand-ink"}`}>
        {value}
      </span>
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

function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
