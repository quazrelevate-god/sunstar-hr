import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { supabase, LIGHT_FIELDS } from "../lib/supabase";
import type { WorkEntry, SavedFilter, Condition, FilterCol } from "../lib/supabase";
import { passesConditions, rateTone, rateToneClasses } from "../lib/rate";
import { todayDubai } from "../lib/data";
import { AddConditionPopover, FilterChip } from "../components/FilterBuilder";
// Lazy: recharts (~150 kB) only downloads when the insights column is shown.
const ClientMetricsChart = lazy(() =>
  import("../components/ClientMetricsChart").then((m) => ({ default: m.ClientMetricsChart })),
);
import { CompanyRatioPanel } from "../components/CompanyRatioPanel";
import { Toast } from "../components/Toast";
import type { ToastKind } from "../components/Toast";
import { FullEditModal } from "../components/FullEditModal";
import { InvoiceModal } from "../components/InvoiceModal";

/** Feature flag: invoicing is finished but HIDDEN until the client settles
 *  payment (owner request, 2026-10-23). Flip to true to restore the Invoice
 *  button and modal — no other change needed. */
const INVOICING_ENABLED = false as boolean;

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
  ...Object.fromEntries(LIGHT_FIELDS.map((f) => [f.key as string, "number" as const])),
};

/* Collapsible column groups (Excel-style). Both start collapsed to a single
 * thin ⇔ column; the admin expands them from the header. */
type GroupId = "conduit" | "lights";
const GROUPS: Record<GroupId, { title: string; tint: string; edge: string; bar: string }> = {
  conduit: { title: "Conduit sizes", tint: "bg-amber-50/70", edge: "border-amber-300", bar: "bg-amber-100 text-amber-900" },
  lights:  { title: "Light types",   tint: "bg-sky-50/70",   edge: "border-sky-300",   bar: "bg-sky-100 text-sky-900" },
};
const GROUPS_KEY = "sunstar-finalized-groups";

/* Table columns, in render order. id is the WorkEntry field (sortable when it
 * has a SORT_KIND entry); "#" and the actions column use synthetic ids. */
type Column = { id: string; label: string; group?: GroupId };
const COLUMNS: Column[] = [
  { id: "rownum",           label: "#" },
  { id: "cluster",          label: "Cluster" },
  { id: "phase",            label: "Phase" },
  { id: "villa",            label: "Villa" },
  { id: "apartment_number", label: "Apt" },
  { id: "bedroom_type",     label: "BR" },
  { id: "description",      label: "Desc" },
  { id: "floor_type",       label: "Fl" },
  { id: "start_date",       label: "Start" },
  { id: "end_date",         label: "End" },
  { id: "hours",            label: "Actual" },
  { id: "total_price",      label: "Price" },
  { id: "per_hour_ratio",   label: "AED/hr" },
  { id: "power_point",      label: "PS" },
  { id: "gi_box_nos",       label: "GI" },
  { id: "data_point",       label: "20mm", group: "conduit" },
  { id: "telephone_point",  label: "25mm", group: "conduit" },
  { id: "lighting_point",   label: "32mm", group: "conduit" },
  { id: "fcu_point",        label: "50mm", group: "conduit" },
  { id: "db_conduit",       label: "DB",   group: "conduit" },
  // D1 stays always visible; D2 NRM … Chandelier collapse together.
  ...LIGHT_FIELDS.map((f): Column => ({
    id: f.key as string, label: f.label,
    group: f.key === "lt_d1" ? undefined : "lights",
  })),
  { id: "client",           label: "Client" },
  { id: "employee_name",    label: "Employee" },
  { id: "actions",          label: "" },
];

/* Runs of consecutive columns sharing a group (or ungrouped), so a collapsed
 * group can be swapped for one marker column in header and body alike. */
type Segment = { group?: GroupId; cols: Column[] };
const SEGMENTS: Segment[] = COLUMNS.reduce<Segment[]>((acc, c) => {
  const last = acc[acc.length - 1];
  if (last && last.group === c.group) last.cols.push(c);
  else acc.push({ group: c.group, cols: [c] });
  return acc;
}, []);

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
/** Today's year and month (1–12) in Dubai. */
function currentPeriod(): { y: number; m: number } {
  const t = todayDubai();
  return { y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) };
}
/** Year and month (1–12) an entry belongs to: End date, else Start date. */
function periodDate(r: WorkEntry): { y: number; m: number } | null {
  const s = (r.end_date || r.start_date || "").toString();
  const m = s.match(/^(\d{4})-(\d{2})/);
  return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
}

/** How closely a name (client or saved view) matches the search text; lower is closer, null
 *  is no match. exact → starts with → a word starts with → contains → letters
 *  in order (so "gnc" still finds "GINCO"). */
function nameRank(name: string, q: string): number | null {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 2;
  if (n.includes(q)) return 3;
  const letters = q.replace(/\s+/g, "");
  let j = 0;
  for (const ch of n) if (ch === letters[j]) j++;
  return letters && j === letters.length ? 4 : null;
}

type ActiveView =
  | { kind: "all" }
  | { kind: "custom" }
  | { kind: "saved"; filter: SavedFilter };

export default function AdminFinalized({ finalized, allRows }: { finalized: WorkEntry[]; allRows: WorkEntry[] }) {
  const [views, setViews] = useState<SavedFilter[]>([]);
  const [viewQuery, setViewQuery] = useState("");
  const shownViews = useMemo(() => {
    const q = viewQuery.trim().toLowerCase();
    if (!q) return views;
    return views
      .map((v) => ({ v, rank: nameRank(v.name, q) }))
      .filter((x) => x.rank != null)
      .sort((a, b) => a.rank! - b.rank! || a.v.name.localeCompare(b.v.name))
      .map((x) => x.v);
  }, [views, viewQuery]);
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
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flash = (msg: string, kind: ToastKind = "info") => {
    setToast({ msg, kind });
    clearTimeout(toastTimer.current); // an older toast's timer must not dismiss a newer one
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  async function loadViews() {
    const { data, error } = await supabase
      .from("sunstar_saved_filters")
      .select("*")
      .order("name", { ascending: true });
    if (error) return flash(error.message, "error");
    setViews((data as SavedFilter[]) ?? []);
  }

  /** Filter-dropdown values, derived from the rows the dashboard already
   *  holds in memory — this used to re-scan the whole table on every tab
   *  switch (and again in a realtime handler). AdminDashboard keeps allRows
   *  live via its own realtime subscription, so this stays current for free. */
  const optionsByCol = useMemo(() => {
    const acc: Partial<Record<FilterCol, Set<string>>> = {};
    allRows.forEach((row: any) => {
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
    return out;
  }, [allRows]);

  useEffect(() => {
    loadViews();
    const ch = supabase
      .channel("saved-filters-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sunstar_saved_filters" }, () => loadViews())
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

  // Collapsed/expanded state of the column groups, remembered per browser.
  const [openGroups, setOpenGroups] = useState<Record<GroupId, boolean>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? "{}");
      return { conduit: v.conduit === true, lights: v.lights === true };
    } catch { return { conduit: false, lights: false }; }
  });
  useEffect(() => {
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify(openGroups)); } catch {}
  }, [openGroups]);
  const toggleGroup = (g: GroupId) => setOpenGroups((s) => ({ ...s, [g]: !s[g] }));
  const anyGroupOpen = openGroups.conduit || openGroups.lights;
  const visibleColCount = SEGMENTS.reduce(
    (n, s) => n + (s.group && !openGroups[s.group] ? 1 : s.cols.length), 0,
  );

  // Search is a BOOST, not a filter: the client name the admin picks (or
  // types and confirms with Enter / the search button) is matched against
  // each row's client and the matching rows are hoisted to the top of the
  // list. Non-matching rows keep their place below, so the full dataset
  // stays visible and totals don't change.
  const [query, setQuery] = useState("");     // what's typed in the box
  const [search, setSearch] = useState("");   // what's applied to the table
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestHi, setSuggestHi] = useState(-1);

  // Universal Month / Year filter. Applied before everything else, so the
  // metrics, insights, table, search and exports all see only that period;
  // conditions and saved views stack on top. Not saved with views — it opens
  // on the current Dubai month every time, and follows the calendar into the
  // next month if the page is left open, until the admin picks a period
  // themselves. The entry's End date decides the month (Start date if End
  // is missing).
  const [month, setMonth] = useState<number | null>(() => currentPeriod().m);   // 1–12
  const [year, setYear] = useState<number | null>(() => currentPeriod().y);
  const periodPicked = useRef(false);
  useEffect(() => {
    const id = setInterval(() => {
      if (periodPicked.current) return;
      const cur = currentPeriod();
      setMonth(cur.m);
      setYear(cur.y);
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  const now = currentPeriod();
  const onCurrentPeriod = month === now.m && year === now.y;
  const periodRows = useMemo(() => {
    if (month == null && year == null) return finalized;
    return finalized.filter((r) => {
      const d = periodDate(r);
      if (!d) return false;
      return (year == null || d.y === year) && (month == null || d.m === month);
    });
  }, [finalized, month, year]);
  const yearOptions = useMemo(() => {
    const ys = new Set<number>([currentPeriod().y]);
    for (const r of finalized) { const d = periodDate(r); if (d) ys.add(d.y); }
    if (year != null) ys.add(year);
    return [...ys].sort((a, b) => b - a);
  }, [finalized, year]);
  const periodLabel = month == null && year == null ? ""
    : [month != null ? MONTHS[month - 1] : "", year ?? ""].filter(Boolean).join(" ");

  const filteredRows = useMemo(() => {
    if (conds.length === 0) return periodRows;
    return periodRows.filter((r) => passesConditions(r, conds));
  }, [periodRows, conds]);

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

  /** Clients in the current view with their row counts — the search box
   *  suggests from these, closest match first; all of them when empty. */
  const clientCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filteredRows) {
      const c = (r.client ?? "").toString().trim();
      if (c) m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  }, [filteredRows]);
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...clientCounts.entries()].map(([name, count]) => ({
      name, count, rank: q ? nameRank(name, q) : 0,
    }));
    return list
      .filter((s) => s.rank != null)
      .sort((a, b) => a.rank! - b.rank! || a.name.localeCompare(b.name));
  }, [clientCounts, query]);
  useEffect(() => { setSuggestHi(-1); }, [query]);

  /**
   * Which rows the applied search covers — the same set is hoisted to the
   * top of the table and counted in the metrics strip:
   *  - search equals a client name (picked from the list) → that client only
   *  - otherwise → every client whose name contains the text
   * The letters-in-order fuzzy match only drives suggestions, never totals.
   */
  const searchMatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const exact = [...clientCounts.keys()].some((c) => c.toLowerCase() === q);
    return (r: WorkEntry) => {
      const c = (r.client ?? "").toString().trim().toLowerCase();
      return exact ? c === q : c.includes(q);
    };
  }, [search, clientCounts]);

  /**
   * Final row order the table renders.
   * If search is empty: just the sorted rows.
   * Otherwise: the matched rows (see searchMatch) are hoisted to the top,
   * closest names first (see nameRank). Rows that don't match stay
   * underneath in their current sort order — nothing is hidden.
   */
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !searchMatch) return sortedRows;
    const buckets: WorkEntry[][] = [[], [], [], []];
    const rest: WorkEntry[] = [];
    for (const r of sortedRows) {
      if (!searchMatch(r)) { rest.push(r); continue; }
      buckets[Math.min(3, nameRank((r.client ?? "").toString(), q) ?? 3)].push(r);
    }
    return [...buckets.flat(), ...rest];
  }, [sortedRows, search, searchMatch]);

  function applySearch(text: string) {
    setQuery(text);
    setSearch(text.trim());
    setSuggestOpen(false);
  }
  /** Typed text confirmed with Enter / the search button. If no client name
   *  contains it but a suggestion is close (e.g. "nkhl" → Nakheel), use that. */
  function applyTyped() {
    const q = query.trim().toLowerCase();
    if (q && ![...clientCounts.keys()].some((c) => c.toLowerCase().includes(q)) && suggestions[0]) {
      applySearch(suggestions[0].name);
    } else {
      applySearch(query);
    }
  }
  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggestOpen(true);
      setSuggestHi((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggestHi((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (suggestOpen && suggestHi >= 0 && suggestions[suggestHi]) applySearch(suggestions[suggestHi].name);
      else applyTyped();
    } else if (e.key === "Escape") {
      setSuggestOpen(false);
    }
  }

  // Metrics strip: the period + conditions, narrowed to the searched client
  // when a search is applied. Insights and exports stay on the full view.
  const metrics = useMemo(() => {
    const base = searchMatch ? filteredRows.filter(searchMatch) : filteredRows;
    const hours = base.reduce((s, r) => s + Number(r.hours || 0), 0);
    const revenue = base.reduce((s, r) => s + Number(r.total_price || 0), 0);
    const perHour = hours > 0 ? revenue / hours : 0;
    return { hours, revenue, perHour, count: base.length };
  }, [filteredRows, searchMatch]);

  // Pagination
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pages - 1);
  useEffect(() => { setPage(0); }, [conds, sortCol, sortDir, search, month, year]);
  // If the row count shrinks (realtime deletes), snap the RAW page state back
  // too — otherwise Prev decrements an invisible out-of-range value and the
  // button looks dead for several clicks.
  useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [page, pages]);
  const pageRows = rows.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const allClients = optionsByCol.client ?? [];

  /* ---- table cells ---- */

  /** Thin ⇔ header cell standing in for a collapsed group; click to expand. */
  function groupMarker(s: Segment, key: number, rowSpan: number) {
    const g = GROUPS[s.group!];
    const names = s.cols.map((c) => c.label).join(", ");
    return (
      <th key={key} rowSpan={rowSpan} className="px-0.5 py-1 bg-slate-100 border-x border-slate-200 align-middle">
        <button
          type="button"
          onClick={() => toggleGroup(s.group!)}
          title={`Show ${g.title}: ${names}`}
          aria-label={`Show ${g.title} (${s.cols.length} columns)`}
          className="flex flex-col items-center w-7 mx-auto py-0.5 rounded text-slate-500 hover:bg-white hover:text-brand-blueDark transition"
        >
          <span className="text-base leading-none">⇔</span>
          <span className="text-[10px] leading-none mt-0.5 tabular-nums">{s.cols.length}</span>
        </button>
      </th>
    );
  }

  /** Tint + outer border for cells of an expanded group. */
  function groupCellCls(s: Segment, ci: number) {
    if (!s.group) return "";
    const g = GROUPS[s.group];
    return [
      g.tint,
      ci === 0 ? `border-l-2 ${g.edge}` : "",
      ci === s.cols.length - 1 ? `border-r-2 ${g.edge}` : "",
    ].join(" ");
  }

  function renderCell(c: Column, r: WorkEntry, i: number, extra: string) {
    const td = (content: React.ReactNode, cls = "") => (
      <td key={c.id} className={`px-3 py-2 ${cls} ${extra}`}>{content}</td>
    );
    switch (c.id) {
      case "rownum":           return td(clampedPage * PAGE_SIZE + i + 1, "text-gray-400");
      case "villa":            return td(r.villa, "font-semibold");
      case "apartment_number": return td(r.apartment_number ?? "", "text-xs text-gray-500");
      case "description":      return td(r.description, "whitespace-nowrap");
      case "start_date":       return td(r.start_date ?? "", "text-xs text-gray-500");
      case "end_date":         return td(r.end_date ?? "", "text-xs text-gray-500");
      case "hours":            return td(r.hours ?? "");
      case "total_price":      return td(r.total_price != null ? Number(r.total_price).toLocaleString() : "");
      case "per_hour_ratio":
        return td(
          <span className={`inline-block font-bold px-2 py-0.5 rounded ${rateToneClasses(rateTone(r))}`}>
            {r.per_hour_ratio ?? ""}
          </span>,
        );
      case "employee_name":    return td(r.employee_name, "text-xs text-gray-500");
      case "actions":
        return (
          <td key={c.id} className="px-2 py-2 relative">
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
        );
      default: {
        // Light-type counts show 0 when unset; everything else shows as stored.
        const v = (r as any)[c.id];
        return td(c.id.startsWith("lt_") ? (v ?? 0) : v);
      }
    }
  }

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
    const period = periodLabel.replace(/\s+/g, "-");
    return `sunstar_${period ? `${period}_` : ""}${view ? `${view}_` : ""}${todayDubai()}`;
  }
  async function exportCSV() {
    // BOM so Excel decodes UTF-8 (Arabic client names) correctly.
    const { buildCsv } = await import("../lib/exportSheet");
    downloadBlob("﻿" + buildCsv(rows), "text/csv;charset=utf-8", `${exportBaseName()}.csv`);
  }
  async function exportXLSX() {
    // Lazy: the xlsx library (~400 kB) only downloads when someone exports.
    const { downloadWorkbook } = await import("../lib/exportSheet");
    downloadWorkbook(rows, `${exportBaseName()}.xlsx`);
  }

  return (
    // Fixed-height split-screen only on wide desktops (≥1280px). On narrower
    // windows everything stacks and scrolls normally so nothing is cut off.
    <div className="xl:h-[calc(100vh-140px)] xl:overflow-hidden flex flex-col gap-4">
      {toast && <Toast msg={toast.msg} kind={toast.kind} />}

      {/* Metrics summary strip — full width across the top, with the
          universal Month / Year filter on its right. */}
      <MetricCards
        m={metrics}
        scope={search ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-blueSoft border border-brand-blue/40 text-brand-blueDark text-xs font-semibold pl-3 pr-1 py-1">
            <span className="text-slate-500 font-normal">Showing:</span>
            <span className="max-w-[16rem] truncate">{search}</span>
            <button
              type="button"
              aria-label="Clear client search"
              title="Back to the whole period"
              onClick={() => { setQuery(""); setSearch(""); }}
              className="w-5 h-5 inline-flex items-center justify-center rounded-full hover:bg-white text-base leading-none"
            >
              ×
            </button>
          </span>
        ) : null}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Period</span>
          <select
            aria-label="Month"
            value={month ?? ""}
            onChange={(e) => { periodPicked.current = true; setMonth(e.target.value ? Number(e.target.value) : null); }}
            className={`border rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue/40 ${month != null ? "border-brand-blue text-brand-blueDark font-semibold" : "border-slate-200"}`}
          >
            <option value="">All months</option>
            {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
          </select>
          <select
            aria-label="Year"
            value={year ?? ""}
            onChange={(e) => { periodPicked.current = true; setYear(e.target.value ? Number(e.target.value) : null); }}
            className={`border rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue/40 ${year != null ? "border-brand-blue text-brand-blueDark font-semibold" : "border-slate-200"}`}
          >
            <option value="">All years</option>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          {!onCurrentPeriod && (
            <button
              type="button"
              onClick={() => { periodPicked.current = false; setMonth(now.m); setYear(now.y); }}
              className="text-xs text-gray-500 hover:text-brand-ink hover:underline"
            >
              This month
            </button>
          )}
        </div>
      </MetricCards>

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
          {/* Saved-view search: narrows the list below by view name, closest first. */}
          <div className="relative mb-2">
            <input
              type="text"
              value={viewQuery}
              onChange={(e) => setViewQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setViewQuery(""); }}
              placeholder="Search views…"
              aria-label="Search saved views"
              className="w-full border border-slate-200 rounded-lg pl-2.5 pr-7 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/40 focus:border-brand-blue"
            />
            {viewQuery && (
              <button
                type="button"
                aria-label="Clear view search"
                onClick={() => setViewQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center text-gray-400 hover:text-brand-ink text-lg leading-none"
              >
                ×
              </button>
            )}
          </div>
          <SidebarItem
            label="All entries"
            active={active.kind === "all"}
            onClick={selectAll}
          />
          {viewQuery.trim() && shownViews.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">No saved view matches “{viewQuery.trim()}”.</div>
          )}
          {shownViews.map((v) => (
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
            <Suspense fallback={<div className="bg-white rounded-2xl p-4 shadow-sm text-xs text-gray-400">Loading chart…</div>}>
              <ClientMetricsChart
                rows={rows}
                allClients={allClients}
                onCompareClients={applyClientComparison}
              />
            </Suspense>
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
              {/* Client search — suggests client names as you type; picking
                  one (or Enter / the search button) moves that client's rows
                  to the top. type="text" so the browser adds no second ×. */}
              <div className="relative flex-1 min-w-[220px] max-w-sm">
                <div className="flex rounded-lg border border-slate-200 focus-within:ring-2 focus-within:ring-brand-blue/40 focus-within:border-brand-blue">
                  <div className="relative flex-1 min-w-0">
                    <input
                      type="text"
                      role="combobox"
                      aria-expanded={suggestOpen}
                      aria-controls="client-suggest"
                      aria-autocomplete="list"
                      autoComplete="off"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setSuggestOpen(true);
                        if (!e.target.value.trim()) setSearch("");
                      }}
                      onFocus={() => setSuggestOpen(true)}
                      onClick={() => setSuggestOpen(true)}
                      onBlur={() => setSuggestOpen(false)}
                      onKeyDown={onSearchKey}
                      placeholder="Search client…"
                      className="w-full bg-transparent rounded-l-lg pl-3 pr-7 py-2 text-sm focus:outline-none"
                    />
                    {query && (
                      <button
                        type="button"
                        aria-label="Clear search"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setQuery(""); setSearch(""); }}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center text-gray-400 hover:text-brand-ink text-lg leading-none"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label="Search"
                    title="Search"
                    onClick={applyTyped}
                    className="px-3 border-l border-slate-200 rounded-r-lg text-gray-500 hover:bg-brand-blueSoft hover:text-brand-blueDark transition"
                  >
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4" aria-hidden="true">
                      <circle cx="8.5" cy="8.5" r="5.5" />
                      <path d="M12.5 12.5L17 17" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                {suggestOpen && (
                  <ul
                    id="client-suggest"
                    role="listbox"
                    onMouseDown={(e) => e.preventDefault()}
                    className="absolute left-0 right-0 top-full mt-1 z-30 max-h-72 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-sm"
                  >
                    {suggestions.length === 0 ? (
                      <li className="px-3 py-2 text-gray-400">
                        {clientCounts.size === 0 ? "No clients in this view" : "No matching client"}
                      </li>
                    ) : suggestions.map((s, idx) => (
                      <li
                        key={s.name}
                        role="option"
                        aria-selected={idx === suggestHi}
                        onClick={() => applySearch(s.name)}
                        onMouseEnter={() => setSuggestHi(idx)}
                        className={`flex items-center justify-between gap-3 px-3 py-1.5 cursor-pointer ${idx === suggestHi ? "bg-brand-blueSoft text-brand-blueDark" : "text-brand-ink"}`}
                      >
                        <span className="truncate">{s.name}</span>
                        <span className="text-xs text-gray-400 tabular-nums">{s.count}</span>
                      </li>
                    ))}
                  </ul>
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
                {INVOICING_ENABLED && (
                  <button onClick={() => setInvoiceOpen(true)} disabled={rows.length === 0}
                    title="Preview, edit and download an invoice for the entries in this view"
                    className="border border-brand-blue text-brand-blueDark hover:bg-brand-blue hover:text-white font-semibold px-3 py-2 rounded-lg text-sm transition disabled:opacity-40 disabled:pointer-events-none">
                    Invoice
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
                  {search && ` · “${search}” first`}
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
                  {/* Group title bars, only while a group is expanded. A
                      collapsed group's ⇔ marker spans both header rows. */}
                  {anyGroupOpen && (
                    <tr>
                      {SEGMENTS.map((s, si) => {
                        if (!s.group) return <th key={si} colSpan={s.cols.length} />;
                        if (!openGroups[s.group]) return groupMarker(s, si, 2);
                        const g = GROUPS[s.group];
                        const gid = s.group;
                        const collapseBtn = (arrow: string) => (
                          <button
                            type="button"
                            onClick={() => toggleGroup(gid)}
                            title={`Collapse ${g.title}`}
                            aria-label={`Collapse ${g.title}`}
                            className="px-1.5 rounded hover:bg-white/70 text-sm leading-none"
                          >
                            {arrow}
                          </button>
                        );
                        return (
                          <th key={si} colSpan={s.cols.length}
                            className={`px-1 py-1 border-x-2 border-t-2 ${g.edge} ${g.bar}`}>
                            <div className="flex items-center justify-between gap-2 normal-case">
                              {collapseBtn("⇥")}
                              <span className="font-semibold whitespace-nowrap">{g.title}</span>
                              {collapseBtn("⇤")}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  )}
                  <tr>
                    {SEGMENTS.map((s, si) => {
                      if (s.group && !openGroups[s.group]) return anyGroupOpen ? null : groupMarker(s, si, 1);
                      return s.cols.map((h, ci) => {
                        const sortable = h.id in SORT_KIND;
                        const active = sortable && h.id === sortCol;
                        const arrow = active ? (sortDir === "asc" ? " ↑" : sortDir === "desc" ? " ↓" : "") : "";
                        return (
                          <th key={h.id} className={`px-3 py-2 text-left whitespace-nowrap ${groupCellCls(s, ci)}`}>
                            {sortable ? (
                              <button
                                type="button"
                                onClick={() => toggleSort(h.id)}
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
                      });
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td className="p-10 text-center text-gray-400" colSpan={visibleColCount}>No matching entries{periodLabel ? ` in ${periodLabel}` : ""}.</td></tr>
                  ) : pageRows.map((r, i) => (
                    <tr key={r.id} className="border-t hover:bg-brand-blueSoft">
                      {SEGMENTS.map((s, si) =>
                        s.group && !openGroups[s.group]
                          ? <td key={`g${si}`} className="bg-slate-50 border-x border-slate-200" />
                          : s.cols.map((c, ci) => renderCell(c, r, i, groupCellCls(s, ci))),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      {INVOICING_ENABLED && invoiceOpen && (
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
function MetricCards({ m, scope, children }: {
  m: { hours: number; revenue: number; perHour: number; count: number };
  /** What the numbers are narrowed to (the searched client), if anything. */
  scope?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white border border-slate-200/70 shadow-sm px-4 py-2.5 flex flex-wrap items-center gap-x-8 gap-y-2">
      <MetricInline label="Entries" value={m.count.toLocaleString()} />
      <MetricInline label="Total Hours" value={Math.round(m.hours).toLocaleString()} />
      <MetricInline label="Revenue" value={`AED ${m.revenue.toLocaleString()}`} accent />
      <MetricInline label="Avg AED/hr" value={m.perHour.toFixed(2)} accent />
      {scope}
      {children && <div className="ml-auto">{children}</div>}
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
