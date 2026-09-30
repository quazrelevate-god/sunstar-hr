import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type { WorkEntry, EntryState } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { fetchAll, fetchEntry } from "../lib/data";
import AdminEmployees from "./AdminEmployees";
import AdminFinalized from "./AdminFinalized";
import { StateBadge, relativeAgo } from "../components/StateBadge";
import { Toast } from "../components/Toast";
import type { ToastKind } from "../components/Toast";
import { Logo } from "../components/Logo";
import { FullEditModal } from "../components/FullEditModal";

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

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
