import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, POINT_FIELDS } from "../lib/supabase";
import type { WorkEntry, EntryState } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { fetchAll, fetchEntry, timeWarnings, maxHours } from "../lib/data";
import AdminEmployees from "./AdminEmployees";
import AdminFinalized from "./AdminFinalized";
import { StateBadge, relativeAgo } from "../components/StateBadge";
import { Toast } from "../components/Toast";
import type { ToastKind } from "../components/Toast";
import { Logo } from "../components/Logo";

type Tab = "queue" | "finalized" | "employees";
type QFilter = "ALL" | EntryState;

export default function AdminDashboard() {
  const { employee, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("queue");
  const [rows, setRows] = useState<WorkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const flash = (msg: string, kind: ToastKind = "info") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  /**
   * Loads ALL entries, paging past Supabase's 1,000-rows-per-request API cap
   * so analytics and exports never silently drop older rows.
   * Only the first load (or the Refresh button) shows the spinner.
   */
  async function load(showSpinner = false) {
    if (showSpinner) setLoading(true);
    const { data, error } = await fetchAll<WorkEntry>(() =>
      supabase
        .from("sunstar_work_entries")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }));
    if (error) flash(error.message, "error");
    else setRows(data);
    setLoading(false);
  }

  /** Apply one realtime change instead of reloading every row. */
  const seq = useRef<Record<string, number>>({});
  async function applyChange(p: any) {
    const id: string | undefined = p.new?.id ?? p.old?.id;
    if (!id) return load();
    const mySeq = (seq.current[id] = (seq.current[id] ?? 0) + 1);
    if (p.eventType === "DELETE") {
      setRows((rs) => rs.filter((r) => r.id !== id));
      return;
    }
    const { data, error } = await fetchEntry(id);
    if (seq.current[id] !== mySeq) return; // a newer change for this row is already being applied
    if (error) return load();              // network hiccup: resync, never drop the row
    const fresh = data as WorkEntry | null;
    setRows((rs) => {
      if (!fresh) return rs.filter((r) => r.id !== id);
      const i = rs.findIndex((r) => r.id === id);
      if (i === -1) return [fresh, ...rs];
      const next = [...rs];
      next[i] = fresh;
      return next;
    });
  }

  useEffect(() => {
    load();
    // Realtime subscription — any change to work entries updates all open sessions
    const ch = supabase
      .channel("work-entries-live-admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sunstar_work_entries" },
        (p: any) => { applyChange(p); }
      )
      .subscribe();
    // Laptop woke up / came back online: catch up on anything realtime missed.
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    const onOnline = () => load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finalized = useMemo(() => rows.filter((r) => r.state === "FINALIZED"), [rows]);
  const queue = useMemo(() => rows.filter((r) => r.state !== "FINALIZED"), [rows]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 via-white to-blue-50/40">
      <header className="bg-white border-b border-slate-200/70 shadow-card">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <div className="border-l border-slate-200 pl-3">
              <div className="font-semibold text-brand-ink text-sm">Admin Portal</div>
              <div className="text-xs text-slate-500">{employee?.full_name}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => load(true)} className="bg-slate-100 hover:bg-slate-200 text-brand-ink px-3.5 py-2 rounded-lg text-sm font-medium">Refresh</button>
            <button onClick={signOut} className="bg-brand-ink hover:bg-black text-white px-3.5 py-2 rounded-lg text-sm font-medium">Sign out</button>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-6">
          <nav className="flex gap-1">
            {(["queue", "finalized", "employees"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition ${
                  tab === t
                    ? "border-brand-blue text-brand-blue"
                    : "border-transparent text-slate-500 hover:text-brand-ink"
                }`}
              >
                {t === "queue" ? `Queue${queue.length ? ` (${queue.length})` : ""}`
                 : t === "finalized" ? "Finalized Entries"
                 : "Employees"}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {toast && <Toast msg={toast.msg} kind={toast.kind} />}

      <main className="max-w-[1400px] mx-auto p-6">
        {tab === "employees" && <AdminEmployees />}
        {tab === "queue" && (
          <QueuePanel rows={queue} loading={loading} reload={load} flash={flash} />
        )}
        {tab === "finalized" && <AdminFinalized finalized={finalized} />}
      </main>
    </div>
  );
}

/* ==============================
   QUEUE PANEL (full-width, no metrics)
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
  const [confirmDel, setConfirmDel] = useState<WorkEntry | null>(null);
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

  async function del(row: WorkEntry) {
    const { error } = await supabase.from("sunstar_work_entries").delete().eq("id", row.id!);
    setConfirmDel(null);
    if (error) return flash(error.message, "error");
    flash(`Deleted Villa ${row.villa}`, "success");
    reload();
  }

  return (
    <>
      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold text-brand-ink text-lg font-serif">Live Queue</div>
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
            className="ml-auto text-sm border rounded-lg px-3 py-1.5 min-w-[240px] focus:outline-none focus:ring-2 focus:ring-brand-blue"
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
            <div key={r.id} className="bg-white rounded-2xl shadow-sm p-4 md:p-5 hover:shadow transition">
              <div className="flex items-start gap-4">
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

                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 flex-shrink-0">
                  {r.state === "AWAITING_PRICE" && (
                    <button
                      onClick={() => setPriceRow(r)}
                      className="bg-brand-blue hover:bg-brand-blueDark text-white font-bold px-4 py-2 rounded-lg text-sm shadow"
                    >
                      Set price →
                    </button>
                  )}
                  <button
                    onClick={() => setEditRow(r)}
                    className="border border-brand-ink text-brand-ink hover:bg-brand-ink hover:text-white font-semibold px-4 py-2 rounded-lg text-sm transition"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setConfirmDel(r)}
                    className="border border-red-500 text-red-600 hover:bg-red-600 hover:text-white font-semibold px-4 py-2 rounded-lg text-sm transition"
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
        <FullEditModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onDone={() => { setEditRow(null); reload(); flash("Updated", "success"); }}
          flash={flash}
        />
      )}
      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)}>
          <div className="text-lg font-bold text-brand-ink mb-2">Delete Villa {confirmDel.villa}?</div>
          <div className="text-sm text-gray-600 mb-5">
            This entry will vanish from all portals. This cannot be undone.
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDel(null)} className="px-4 py-2 rounded-lg border">Cancel</button>
            <button onClick={() => del(confirmDel)}
              className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold">Delete</button>
          </div>
        </Modal>
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
          ? "bg-brand-ink text-white border-brand-ink"
          : "bg-white text-gray-700 border-gray-200 hover:border-brand-blue"
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

  // Rate tone preview
  const previewClass = (() => {
    if (!price || !row.hours || row.target_hours == null) return "bg-gray-100 text-gray-700";
    if (row.hours < row.target_hours) return "bg-green-100 text-green-800";
    if (row.hours > row.target_hours) return "bg-red-100 text-red-800";
    return "bg-amber-100 text-amber-800";
  })();

  async function submit() {
    if (!price || +price <= 0) return flash("Enter a valid price", "error");
    setSaving(true);
    // Only finalize if the entry is still waiting for a price (not deleted,
    // not already finalized by another admin in a different window).
    const { error, count } = await supabase
      .from("sunstar_work_entries")
      .update({ total_price: +price, state: "FINALIZED", priced_by_id: employee?.id ?? null }, { count: "exact" })
      .eq("id", row.id!)
      .eq("state", "AWAITING_PRICE");
    setSaving(false);
    if (error) return flash(error.message, "error");
    if (count === 0) {
      flash("This entry was already finalized, changed or deleted — nothing saved", "error");
      onClose();
      return;
    }
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
          className="w-full border rounded-xl px-4 py-3 font-semibold focus:outline-none focus:ring-4 focus:ring-brand-blue/30 focus:border-brand-blue"
        />
      </label>
      <div className={`rounded-xl p-3 mb-4 text-sm flex justify-between font-semibold ${previewClass}`}>
        <span>Live per-hour rate</span>
        <b>AED {perHour}/hr</b>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border">Cancel</button>
        <button onClick={submit} disabled={saving}
          className="px-4 py-2 rounded-lg bg-brand-ink text-white font-bold disabled:opacity-50">
          {saving ? "Saving…" : "Finalize"}
        </button>
      </div>
    </Modal>
  );
}

/* ==============================
   FULL EDIT MODAL (admin only)
   ============================== */
function FullEditModal({
  row, onClose, onDone, flash,
}: {
  row: WorkEntry; onClose: () => void; onDone: () => void;
  flash: (m: string, k?: ToastKind) => void;
}) {
  const [f, setF] = useState<Partial<WorkEntry>>(() => ({ ...row }));
  const [saving, setSaving] = useState(false);

  function set<K extends keyof WorkEntry>(k: K, v: WorkEntry[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  /** Full patch built from the form (same shape as before). */
  function buildPatch(): Record<string, any> {
    const patch: any = {
      cluster: f.cluster ?? "",
      phase: f.phase ?? "",
      villa: f.villa,
      bedroom_type: f.bedroom_type ?? "",
      description: f.description,
      floor_type: f.floor_type ?? "",
      status: f.status ?? "IN PROGRESS",
      client: f.client,
      start_date: f.start_date || null,
      end_date: f.end_date || null,
      target_hours: Number(f.target_hours),
      hours: f.hours != null && f.hours !== ("" as any) ? Number(f.hours) : null,
      apartment_number: f.apartment_number?.toString().trim() ? String(f.apartment_number).trim() : null,
      total_manpower: f.total_manpower != null && f.total_manpower !== ("" as any) ? Number(f.total_manpower) : null,
      check_in_time: f.check_in_time || null,
      check_out_time: f.check_out_time || null,
      break_start_time: f.break_start_time || null,
      break_end_time: f.break_end_time || null,
    };
    POINT_FIELDS.forEach((p) => {
      const k = p.key as string;
      patch[k] = (f as any)[k] != null && (f as any)[k] !== "" ? Number((f as any)[k]) : 0;
    });
    // Admin can also adjust price on a not-yet-finalized row if they want
    if (f.total_price != null && f.total_price !== ("" as any)) patch.total_price = Number(f.total_price);
    return patch;
  }

  /** Only the fields the admin actually changed in this window. */
  function changedPatch(): Record<string, any> {
    const full = buildPatch();
    const out: Record<string, any> = {};
    for (const k of Object.keys(full)) {
      if (normField(k, full[k]) !== normField(k, (row as any)[k])) out[k] = full[k];
    }
    return out;
  }

  const dirty = Object.keys(changedPatch()).length > 0;

  function requestClose() {
    if (dirty && !confirm("Discard your unsaved changes to this entry?")) return;
    onClose();
  }

  async function submit() {
    if (!f.villa?.trim()) return flash("Villa is required", "error");
    if (!f.client?.trim()) return flash("Client is required", "error");
    if (!f.description?.trim()) return flash("Description is required", "error");
    if (!f.target_hours || Number(f.target_hours) <= 0) return flash("Target hours must be > 0", "error");
    const nums: [string, unknown][] = [
      ["Target hours", f.target_hours], ["Actual hours", f.hours],
      ["Total manpower", f.total_manpower], ["Total price", f.total_price],
      ...POINT_FIELDS.map((p) => [p.label, (f as any)[p.key]] as [string, unknown]),
    ];
    const neg = nums.find(([, v]) => v != null && (v as any) !== "" && Number(v) < 0);
    if (neg) return flash(`${neg[0]} cannot be negative`, "error");
    const cap = maxHours(f.total_manpower);
    if (Number(f.target_hours) > cap) return flash(`Target hours look too high — max ${cap}h for ${f.total_manpower} people`, "error");
    if (f.hours != null && (f.hours as any) !== "" && Number(f.hours) > cap) {
      return flash(`Actual hours look too high — max ${cap}h for ${f.total_manpower} people`, "error");
    }
    const warn = timeWarnings(f);
    if (warn.length && !confirm(`${warn.join(". ")}.\n\nSave anyway (for example a night shift)?`)) return;

    const patch = changedPatch();
    if (Object.keys(patch).length === 0) { onClose(); return; }

    setSaving(true);
    // Conditional save: only succeeds if every field being changed still holds
    // the value it had when this window opened. If an employee submitted actuals
    // (or another admin edited) in the meantime, nothing is overwritten.
    let q = supabase
      .from("sunstar_work_entries")
      .update(patch, { count: "exact" })
      .eq("id", row.id!);
    for (const k of Object.keys(patch)) {
      const orig = (row as any)[k];
      q = orig == null ? q.is(k, null) : q.eq(k, orig);
    }
    const { error, count } = await q;
    setSaving(false);
    if (error) return flash(error.message, "error");
    if (count === 0) {
      flash("Someone updated this entry while you were editing — close and reopen it to see the latest, then redo your change", "error");
      return;
    }
    onDone();
  }

  const cx = "w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-brand-blue";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={requestClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Sticky header */}
        <div className="p-6 border-b flex items-start justify-between flex-shrink-0">
          <div>
            <div className="text-lg font-bold text-brand-ink">Edit entry — Villa {row.villa}</div>
            <div className="text-xs text-gray-500 mt-1">
              Admin full edit · every field is editable. Changes save on Save.
            </div>
          </div>
          <button onClick={requestClose} aria-label="Close" className="text-gray-400 hover:text-brand-ink text-2xl leading-none">×</button>
        </div>

        {/* Scrollable body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Identifiers */}
          <Section title="Identifiers">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <FE label="Cluster"><input value={f.cluster ?? ""} onChange={(e) => set("cluster", e.target.value)} className={cx}/></FE>
              <FE label="Phase"><input value={f.phase ?? ""} onChange={(e) => set("phase", e.target.value)} className={cx}/></FE>
              <FE label="Villa *"><input value={f.villa ?? ""} onChange={(e) => set("villa", e.target.value)} className={cx}/></FE>
              <FE label="Apartment"><input value={f.apartment_number ?? ""} onChange={(e) => set("apartment_number", e.target.value)} className={cx}/></FE>
              <FE label="Bedroom"><input value={f.bedroom_type ?? ""} onChange={(e) => set("bedroom_type", e.target.value)} className={cx}/></FE>
              <FE label="Floor"><input value={f.floor_type ?? ""} onChange={(e) => set("floor_type", e.target.value)} className={cx}/></FE>
              <FE label="Description *"><input value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} className={cx}/></FE>
              <FE label="Client *"><input value={f.client ?? ""} onChange={(e) => set("client", e.target.value)} className={cx}/></FE>
              <FE label="Status">
                <select value={f.status ?? "IN PROGRESS"} onChange={(e) => set("status", e.target.value)} className={cx}>
                  <option>DONE</option><option>IN PROGRESS</option><option>PENDING</option>
                </select>
              </FE>
              <FE label="Start date"><input type="date" value={f.start_date ?? ""} onChange={(e) => set("start_date", e.target.value)} className={cx}/></FE>
              <FE label="End date"><input type="date" value={f.end_date ?? ""} onChange={(e) => set("end_date", e.target.value)} className={cx}/></FE>
            </div>
          </Section>

          {/* Ops */}
          <Section title="Times & manpower">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <FE label="Total manpower">
                <input type="number" min={0} value={f.total_manpower ?? ""}
                  onChange={(e) => set("total_manpower", e.target.value ? Number(e.target.value) : null)} className={cx}/>
              </FE>
              <FE label="Check-in">
                <input type="time" value={(f.check_in_time ?? "").slice(0,5)} onChange={(e) => set("check_in_time", e.target.value)} className={cx}/>
              </FE>
              <FE label="Check-out">
                <input type="time" value={(f.check_out_time ?? "").slice(0,5)} onChange={(e) => set("check_out_time", e.target.value)} className={cx}/>
              </FE>
              <FE label="Break start">
                <input type="time" value={(f.break_start_time ?? "").slice(0,5)} onChange={(e) => set("break_start_time", e.target.value)} className={cx}/>
              </FE>
              <FE label="Break end">
                <input type="time" value={(f.break_end_time ?? "").slice(0,5)} onChange={(e) => set("break_end_time", e.target.value)} className={cx}/>
              </FE>
            </div>
          </Section>

          {/* Hours + price */}
          <Section title="Hours & price">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <FE label="Target hours *">
                <input type="number" min={0} step="0.5" value={f.target_hours ?? ""}
                  onChange={(e) => set("target_hours", e.target.value ? Number(e.target.value) : null)} className={cx}/>
              </FE>
              <FE label="Actual hours">
                <input type="number" min={0} step="0.5" value={f.hours ?? ""}
                  onChange={(e) => set("hours", e.target.value ? Number(e.target.value) : null)} className={cx}/>
              </FE>
              <FE label="Total price (AED)">
                <input type="number" min={0} step="0.01" value={f.total_price ?? ""}
                  onChange={(e) => set("total_price", e.target.value ? Number(e.target.value) : null)} className={cx}/>
              </FE>
            </div>
          </Section>

          {/* Points */}
          <Section title="Point counts">
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {POINT_FIELDS.map((p) => {
                const k = p.key as string;
                const val = (f as any)[k] ?? 0;
                return (
                  <FE key={k} label={p.label}>
                    <input
                      type="number" min={0} step={p.decimal ? "0.01" : "1"}
                      value={val === 0 ? "" : val}
                      onChange={(e) => {
                        const n = (p.decimal ? parseFloat(e.target.value) : parseInt(e.target.value, 10)) || 0;
                        if (n < 0) return; // ignore negatives
                        set(k as any, n);
                      }}
                      className={`${cx} text-center font-semibold`}
                    />
                  </FE>
                );
              })}
            </div>
          </Section>
        </div>

        {/* Sticky footer */}
        <div className="p-4 border-t flex justify-end gap-2 flex-shrink-0 bg-white rounded-b-2xl">
          <button onClick={requestClose} className="px-4 py-2 rounded-lg border">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-5 py-2 rounded-lg bg-brand-ink text-white font-bold disabled:opacity-50">
            {saving ? "Saving…" : "Save all changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Normalise a field value so "unchanged" compares equal regardless of format
   (e.g. DB time "08:00:00" vs input "08:00", null vs "", 0 vs null for point counts). */
const TIME_KEYS = new Set(["check_in_time", "check_out_time", "break_start_time", "break_end_time"]);
const NUM_KEYS = new Set(["target_hours", "hours", "total_manpower", "total_price"]);
const POINT_KEYS = new Set(POINT_FIELDS.map((p) => p.key as string));
function normField(k: string, v: unknown): string | number | null {
  if (POINT_KEYS.has(k)) {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  }
  if (v === undefined || v === null || v === "") return null;
  if (TIME_KEYS.has(k)) return String(v).slice(0, 5);
  if (NUM_KEYS.has(k)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return String(v).trim();
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{title}</div>
      {children}
    </div>
  );
}

function FE({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold text-gray-500 mb-1">{label}</div>
      {children}
    </label>
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
