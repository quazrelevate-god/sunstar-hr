import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { supabase, POINT_FIELDS } from "../lib/supabase";
import type { WorkEntry } from "../lib/supabase";
import { fetchAll, fetchEntry, todayDubai, timeWarnings, maxHours } from "../lib/data";
import { Toast } from "../components/Toast";
import type { ToastKind } from "../components/Toast";
import { StateBadge, relativeAgo } from "../components/StateBadge";
import { Logo } from "../components/Logo";

const BEDROOM_SEED = ["3 BR", "4 BR", "5 BR", "6 BR", "Studio"];
const FLOOR_SEED   = ["SOG", "FF", "SF", "RF", "GF"];
const STATUS_OPTS  = ["DONE", "IN PROGRESS", "PENDING"];
const SUGGEST_COLS = ["cluster","phase","villa","bedroom_type","floor_type","description","client","status","apartment_number"] as const;

function currentHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Fresh blank morning form. Dates/times are computed at call time (not page load),
 *  so a tablet left open overnight still defaults to today's Dubai date. */
function emptyNew(): Partial<WorkEntry> {
  return {
    cluster: "",
    phase: "",
    villa: "",
    bedroom_type: "3 BR",
    description: "",
    floor_type: "SOG",
    start_date: todayDubai(),
    status: "IN PROGRESS",
    client: "",
    target_hours: null,
    apartment_number: "",
    total_manpower: null,
    check_in_time: currentHHMM(),
    check_out_time: "",
    break_start_time: "",
    break_end_time: "",
  };
}

/* ---- Per-row draft of the "Fill actuals" form, kept on the tablet ---- */
type Draft = { hours: number | ""; checkOut: string; breakStart: string; breakEnd: string; points: Record<string, number> };
const draftKey = (id: string) => `sunstar-actuals-draft-${id}`;
function readDraft(id: string): Draft | null {
  try { const s = localStorage.getItem(draftKey(id)); return s ? (JSON.parse(s) as Draft) : null; } catch { return null; }
}
function writeDraft(id: string, d: Draft) {
  try { localStorage.setItem(draftKey(id), JSON.stringify(d)); } catch { /* storage unavailable */ }
}
function clearDraft(id: string) {
  try { localStorage.removeItem(draftKey(id)); } catch { /* storage unavailable */ }
}

const byCreatedAsc = (a: WorkEntry, b: WorkEntry) =>
  String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));

type Tab = "queue" | "new";
type SuggestionMap = Partial<Record<string, string[]>>;

export default function EmployeeEntry() {
  const { employee, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("queue");
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionMap>({});
  const flash = (msg: string, kind: ToastKind = "info") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  /** Add one row's text values into the autocomplete lists (no refetch). */
  function mergeSuggestions(row: any) {
    if (!row) return;
    setSuggestions((prev) => {
      const next: SuggestionMap = { ...prev };
      SUGGEST_COLS.forEach((c) => {
        const v = row[c];
        if (v == null || String(v).trim() === "") return;
        const val = String(v).trim();
        const list = next[c] ?? [];
        if (!list.includes(val)) next[c] = [...list, val].sort((a, b) => a.localeCompare(b));
      });
      return next;
    });
  }

  // Load distinct text-column history for autocomplete (all rows, paged past the 1,000-row API cap)
  async function loadSuggestions() {
    const cols = SUGGEST_COLS;
    const { data, error } = await fetchAll<any>(() =>
      supabase.from("sunstar_work_entries").select(`id,${cols.join(",")}`).order("id"));
    if (error) return;
    const acc: Record<string, Set<string>> = {};
    (data ?? []).forEach((row: any) => {
      cols.forEach((c) => {
        const v = row[c];
        if (v == null || String(v).trim() === "") return;
        (acc[c] ||= new Set()).add(String(v).trim());
      });
    });
    const out: SuggestionMap = {};
    // Seed bedroom/floor with defaults so first-time users see something
    (["bedroom_type"] as const).forEach((c) => {
      if (!acc[c]) acc[c] = new Set();
      BEDROOM_SEED.forEach((s) => acc[c].add(s));
    });
    (["floor_type"] as const).forEach((c) => {
      if (!acc[c]) acc[c] = new Set();
      FLOOR_SEED.forEach((s) => acc[c].add(s));
    });
    cols.forEach((c) => {
      if (acc[c]) out[c] = Array.from(acc[c]).sort((a, b) => a.localeCompare(b));
    });
    setSuggestions(out);
  }

  useEffect(() => {
    loadSuggestions();
    const ch = supabase
      .channel("we-suggestions-live")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "sunstar_work_entries" },
        (p: any) => mergeSuggestions(p.new))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 via-white to-blue-50/40">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-card">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <div className="border-l border-gray-200 pl-3">
              <div className="font-semibold text-brand-ink text-sm">Work Portal</div>
              <div className="text-xs text-gray-500">
                {employee?.full_name} · {employee?.employee_code}
              </div>
            </div>
          </div>
          <button
            onClick={signOut}
            className="bg-brand-ink hover:bg-black text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Sign out
          </button>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-6">
          <nav className="flex gap-1">
            {(["queue", "new"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition ${
                  tab === t
                    ? "border-brand-blue text-brand-blue"
                    : "border-transparent text-gray-500 hover:text-brand-ink"
                }`}
              >
                {t === "queue" ? "Queue" : "+ New Entry"}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {toast && <Toast msg={toast.msg} kind={toast.kind} />}

      <main className="max-w-6xl mx-auto p-4 md:p-6">
        {tab === "queue"
          ? <QueueTab flash={flash} />
          : <NewEntryTab flash={flash} onDone={() => setTab("queue")} suggestions={suggestions} />}
      </main>
    </div>
  );
}

/* ==============================
   QUEUE TAB
   ============================== */
function QueueTab({ flash }: { flash: (m: string, k?: ToastKind) => void }) {
  const [rows, setRows] = useState<WorkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  /**
   * Silent refresh: the "Loading…" screen only shows on first load (initial state).
   * Showing it on every refresh used to unmount the open "Fill actuals" forms and
   * wipe whatever the worker had typed.
   */
  async function load() {
    const { data, error } = await fetchAll<WorkEntry>(() =>
      supabase
        .from("sunstar_work_entries")
        .select("*")
        .eq("state", "AWAITING_ACTUAL")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }));
    if (error) flash(error.message, "error");
    else setRows(data);
    setLoading(false);
  }

  /** Apply one realtime change to the list instead of reloading everything. */
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
      if (!fresh || fresh.state !== "AWAITING_ACTUAL") return rs.filter((r) => r.id !== id);
      const exists = rs.some((r) => r.id === id);
      const next = exists ? rs.map((r) => (r.id === id ? fresh : r)) : [...rs, fresh];
      return next.sort(byCreatedAsc);
    });
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("work-entries-live-employee")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sunstar_work_entries" },
        (p: any) => { applyChange(p); },
      )
      .subscribe();
    // Tablet woke up / came back online: catch up on anything realtime missed.
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", load);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function del(id: string) {
    if (!confirm("Delete this queued entry? This cannot be undone.")) return;
    const { error } = await supabase.from("sunstar_work_entries").delete().eq("id", id);
    if (error) return flash(error.message, "error");
    clearDraft(id);
    if (openId === id) setOpenId(null);
    flash("Entry deleted", "success");
    load();
  }

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading queue…</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-3xl shadow-lg p-10 text-center">
        <div className="text-5xl mb-3">✓</div>
        <div className="text-xl font-bold text-brand-ink">All caught up</div>
        <div className="text-gray-600 mt-2">
          Nothing pending. You can head home 🏠
        </div>
        <div className="text-xs text-gray-400 mt-6">
          To add a new morning job, open the <b>+ New Entry</b> tab.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-brand-ink/70 px-1">
        {rows.length} pending — fill actual hours and points before you leave the site.
      </div>
      {rows.map((r) => (
        <QueueRow
          key={r.id}
          row={r}
          open={openId === r.id}
          onToggle={() => setOpenId(openId === r.id ? null : r.id!)}
          onDelete={() => del(r.id!)}
          onFilled={() => {
            setOpenId(null);
            flash("Submitted — awaiting admin pricing", "success");
            load();
          }}
          flash={flash}
        />
      ))}
    </div>
  );
}

function QueueRow({
  row,
  open,
  onToggle,
  onDelete,
  onFilled,
  flash,
}: {
  row: WorkEntry;
  open: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onFilled: () => void;
  flash: (m: string, k?: ToastKind) => void;
}) {
  const { employee } = useAuth();
  // Restore any draft typed earlier on this tablet (survives refresh / reload).
  const [draft] = useState<Draft | null>(() => readDraft(row.id!));
  const [hours, setHours] = useState<number | "">(draft?.hours ?? "");
  const [checkOut, setCheckOut] = useState<string>(draft?.checkOut ?? row.check_out_time ?? "");
  const [breakStart, setBreakStart] = useState<string>(draft?.breakStart ?? row.break_start_time ?? "");
  const [breakEnd, setBreakEnd] = useState<string>(draft?.breakEnd ?? row.break_end_time ?? "");
  const [points, setPoints] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    POINT_FIELDS.forEach((p) => { init[p.key as string] = draft?.points?.[p.key as string] ?? 0; });
    return init;
  });
  const [saving, setSaving] = useState(false);

  // Save a draft whenever anything is typed.
  useEffect(() => {
    const anyPoints = Object.values(points).some((v) => v);
    if (hours === "" && !checkOut && !breakStart && !breakEnd && !anyPoints) return;
    writeDraft(row.id!, { hours, checkOut, breakStart, breakEnd, points });
  }, [row.id, hours, checkOut, breakStart, breakEnd, points]);

  const setPt = (k: string, v: number) => setPoints((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!hours || +hours <= 0) return flash("Enter actual hours (> 0)", "error");
    const cap = maxHours(row.total_manpower);
    if (+hours > cap) {
      return flash(`Actual hours look too high — max ${cap}h for ${row.total_manpower} people`, "error");
    }
    const warn = timeWarnings({
      check_in_time: row.check_in_time, check_out_time: checkOut,
      break_start_time: breakStart, break_end_time: breakEnd,
    });
    if (warn.length && !confirm(`${warn.join(". ")}.\n\nIs this correct (for example a night shift)?`)) return;

    setSaving(true);
    const update: any = {
      hours: +hours,
      check_out_time: checkOut || null,
      break_start_time: breakStart || null,
      break_end_time: breakEnd || null,
      state: "AWAITING_PRICE",
      actual_by_id: employee?.id ?? null,
    };
    POINT_FIELDS.forEach((p) => { update[p.key as string] = points[p.key as string] ?? 0; });
    // Only update if the job is still waiting for actuals — stops two workers
    // overwriting each other's submission for the same job.
    const { error, count } = await supabase
      .from("sunstar_work_entries")
      .update(update, { count: "exact" })
      .eq("id", row.id!)
      .eq("state", "AWAITING_ACTUAL");
    setSaving(false);
    if (error) return flash(error.message, "error");
    clearDraft(row.id!);
    if (count === 0) {
      flash("This job was already submitted or removed by someone else", "error");
      return;
    }
    onFilled();
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      {/* Row summary */}
      <div className="flex items-center gap-3 p-4 md:p-5 cursor-pointer" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-bold text-brand-ink">
              Villa {row.villa}
              <span className="text-gray-400 font-normal"> · {row.cluster}{row.phase ? ` · ${row.phase}` : ""}</span>
            </div>
            <StateBadge state={row.state} />
          </div>
          <div className="text-sm text-gray-500 mt-0.5 truncate">
            {row.description} · {row.bedroom_type} · {row.floor_type} · Client: {row.client || "—"}
            {row.apartment_number ? ` · Apt ${row.apartment_number}` : ""}
          </div>
          <div className="text-xs text-gray-400 mt-1 flex gap-3 flex-wrap">
            <span>Target {row.target_hours ?? "—"}h</span>
            {row.total_manpower != null && <span>Manpower {row.total_manpower}</span>}
            {row.check_in_time && <span>In {row.check_in_time.slice(0,5)}</span>}
            <span>queued {row.created_at ? relativeAgo(row.created_at) : ""}</span>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="min-h-[44px] min-w-[44px] border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium px-3 rounded-lg"
            title="Delete"
          >
            Delete
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="min-h-[44px] bg-brand-blue hover:bg-brand-blueDark text-white font-semibold px-4 py-2 rounded-lg text-sm"
          >
            {open ? "Close" : "Fill actuals →"}
          </button>
        </div>
      </div>

      {/* Expanded form */}
      {open && (
        <div className="border-t bg-brand-blueSoft/40 p-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <NumField required label="Actual Hours *" v={hours} on={setHours as any} decimal />
            <Field label="Check-out">
              <input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)}
                className="w-full border rounded-lg px-3 py-2" />
            </Field>
            <Field label="Break start">
              <input type="time" value={breakStart} onChange={(e) => setBreakStart(e.target.value)}
                className="w-full border rounded-lg px-3 py-2" />
            </Field>
            <Field label="Break end">
              <input type="time" value={breakEnd} onChange={(e) => setBreakEnd(e.target.value)}
                className="w-full border rounded-lg px-3 py-2" />
            </Field>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-2">Point Counts</div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {POINT_FIELDS.map((p) => (
                <NumField
                  key={p.key as string}
                  label={p.label}
                  v={points[p.key as string] ?? 0}
                  on={(v) => setPt(p.key as string, v)}
                  decimal={p.decimal}
                />
              ))}
            </div>
          </div>
          <div className="text-xs text-gray-500">
            End date is stamped automatically when you submit.
          </div>
          <button
            onClick={submit}
            disabled={saving}
            className="w-full bg-brand-ink hover:bg-black disabled:opacity-50 text-white font-bold rounded-xl py-4 text-lg shadow"
          >
            {saving ? "Submitting…" : "✓ Submit for pricing"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ==============================
   NEW ENTRY TAB (morning form)
   ============================== */
function NewEntryTab({
  flash, onDone, suggestions,
}: {
  flash: (m: string, k?: ToastKind) => void;
  onDone: () => void;
  suggestions: SuggestionMap;
}) {
  const { employee } = useAuth();
  const [form, setForm] = useState<Partial<WorkEntry>>(() => emptyNew());
  const [saving, setSaving] = useState(false);

  function set<K extends keyof WorkEntry>(k: K, v: WorkEntry[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  /** Ref-based lock: prevents a rapid double-tap from firing two inserts before
   *  React's setSaving(true) actually disables the button. */
  const submitting = useRef(false);

  async function submit() {
    if (submitting.current) return;
    if (!form.villa?.trim()) return flash("Villa is required", "error");
    if (!form.client?.trim()) return flash("Client is required", "error");
    if (!form.description?.trim()) return flash("Description is required", "error");
    if (!form.target_hours || form.target_hours <= 0) return flash("Target hours must be > 0", "error");
    if (!form.total_manpower || form.total_manpower <= 0 || !Number.isInteger(form.total_manpower)) {
      return flash("Total manpower must be a whole number above 0", "error");
    }
    const cap = maxHours(form.total_manpower);
    if (form.target_hours > cap) {
      return flash(`Target hours look too high — max ${cap}h for ${form.total_manpower} people`, "error");
    }
    if (!form.check_in_time) return flash("Check-in time is required", "error");
    const warn = timeWarnings(form);
    if (warn.length && !confirm(`${warn.join(". ")}.\n\nIs this correct (for example a night shift)?`)) return;

    // Duplicate check: warn if there's already an entry for the same
    // villa + client + start_date in ANY state. Prevents the common "manager
    // re-types the same job the next morning without realising it's already
    // logged" mistake seen in production. User can still confirm to proceed.
    const villa = form.villa.trim();
    const client = form.client.trim();
    const startDate = form.start_date || todayDubai();
    const { data: dups, error: dupErr } = await supabase
      .from("sunstar_work_entries")
      .select("id, state, hours, target_hours, created_at")
      .ilike("villa", villa)
      .ilike("client", client)
      .eq("start_date", startDate)
      .limit(3);
    if (dupErr) {
      // Non-blocking: if the check fails for any reason, proceed with insert.
      // The DB will still take the row, and the admin can clean up if needed.
      console.warn("Duplicate check failed:", dupErr.message);
    } else if (dups && dups.length > 0) {
      const stateLabel = (s: string) =>
        s === "AWAITING_ACTUAL" ? "waiting for actual hours"
        : s === "AWAITING_PRICE" ? "waiting for price"
        : "already finalized";
      const lines = dups.map((d) =>
        `• ${stateLabel(d.state)} · target ${d.target_hours ?? "?"}h`
      ).join("\n");
      const okDup = confirm(
        `Villa ${villa} for "${client}" on ${startDate} already exists (${dups.length}):\n\n${lines}\n\nCreate ANOTHER entry anyway?`
      );
      if (!okDup) return;
    }

    submitting.current = true;
    setSaving(true);
    const payload = {
      state: "AWAITING_ACTUAL",
      cluster: form.cluster ?? "",
      phase: form.phase ?? "",
      villa: form.villa,
      bedroom_type: form.bedroom_type ?? "3 BR",
      description: form.description,
      floor_type: form.floor_type ?? "SOG",
      start_date: form.start_date || todayDubai(),
      status: form.status ?? "IN PROGRESS",
      client: form.client,
      target_hours: form.target_hours,
      apartment_number: form.apartment_number?.trim() ? form.apartment_number.trim() : null,
      total_manpower: form.total_manpower,
      check_in_time: form.check_in_time || null,
      check_out_time: form.check_out_time || null,
      break_start_time: form.break_start_time || null,
      break_end_time: form.break_end_time || null,
      employee_id: employee?.id ?? null,
      employee_name: employee?.full_name ?? null,
      created_by_id: employee?.id ?? null,
    };
    const { error } = await supabase.from("sunstar_work_entries").insert(payload);
    setSaving(false);
    submitting.current = false;
    if (error) return flash(error.message, "error");
    flash(`Queued · Villa ${form.villa} · ${form.target_hours}h target`, "success");
    setForm({
      ...emptyNew(),
      cluster: form.cluster,
      phase: form.phase,
      client: form.client,
      floor_type: form.floor_type,
      description: form.description,
      bedroom_type: form.bedroom_type,
      total_manpower: form.total_manpower,
      check_in_time: currentHHMM(),
    });
    onDone();
  }

  const cx = (extra = "") =>
    `w-full border rounded-xl px-4 py-3 focus:outline-none focus:ring-4 focus:ring-brand-blue/30 focus:border-brand-blue ${extra}`;

  return (
    <div className="bg-white rounded-3xl shadow-lg p-6 tap-lg">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-ink font-serif">New Morning Entry</h1>
          <div className="text-sm text-gray-500">
            Enter the job identifiers and target hours. Actual hours & points are filled later, from the Queue tab.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field label="Cluster">
          <SuggestInput value={form.cluster ?? ""} onChange={(v) => set("cluster", v)}
            className={cx()} placeholder="e.g. V-14" options={suggestions.cluster ?? []} listId="s-cluster" />
        </Field>
        <Field label="Phase">
          <SuggestInput value={form.phase ?? ""} onChange={(v) => set("phase", v)}
            className={cx()} placeholder="e.g. PH-2" options={suggestions.phase ?? []} listId="s-phase" />
        </Field>
        <Field label="Villa *">
          <SuggestInput value={form.villa ?? ""} onChange={(v) => set("villa", v)}
            className={cx()} placeholder="e.g. 101" options={suggestions.villa ?? []} listId="s-villa" />
        </Field>

        <Field label="Bedroom">
          <SuggestInput value={form.bedroom_type ?? ""} onChange={(v) => set("bedroom_type", v)}
            className={cx()} placeholder="e.g. 3 BR" options={suggestions.bedroom_type ?? []} listId="s-bedroom" />
        </Field>
        <Field label="Floor">
          <SuggestInput value={form.floor_type ?? ""} onChange={(v) => set("floor_type", v)}
            className={cx()} placeholder="e.g. SOG" options={suggestions.floor_type ?? []} listId="s-floor" />
        </Field>
        <Field label="Description *">
          <SuggestInput value={form.description ?? ""} onChange={(v) => set("description", v)}
            className={cx()} placeholder="e.g. Slab Conduiting" options={suggestions.description ?? []} listId="s-desc" />
        </Field>

        <Field label="Client *">
          <SuggestInput value={form.client ?? ""} onChange={(v) => set("client", v)}
            className={cx()} placeholder="Client / project" options={suggestions.client ?? []} listId="s-client" />
        </Field>
        <Field label="Status">
          <select value={form.status ?? "IN PROGRESS"} onChange={(e) => set("status", e.target.value)} className={cx()}>
            {STATUS_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Start Date">
          <input type="date" value={form.start_date ?? ""} onChange={(e) => set("start_date", e.target.value)} className={cx()} />
        </Field>

        <Field label="Apartment">
          <SuggestInput value={form.apartment_number ?? ""} onChange={(v) => set("apartment_number", v)}
            className={cx()} placeholder="e.g. 12A (optional)" options={suggestions.apartment_number ?? []} listId="s-apt" />
        </Field>
        <Field label="Total Manpower *">
          <input
            type="number" inputMode="numeric" min={1} step={1}
            value={form.total_manpower ?? ""}
            onChange={(e) => set("total_manpower", e.target.value ? parseInt(e.target.value) : null)}
            className={cx("font-semibold")}
            placeholder="e.g. 4"
          />
        </Field>
        <Field label="Target Hours *">
          <input
            type="number" inputMode="decimal" min={0} step={0.5}
            value={form.target_hours ?? ""}
            onChange={(e) => set("target_hours", e.target.value ? parseFloat(e.target.value) : null)}
            className={cx("font-semibold")}
            placeholder="e.g. 25"
          />
        </Field>

        <Field label="Check-in *">
          <input type="time" value={form.check_in_time ?? ""} onChange={(e) => set("check_in_time", e.target.value)} className={cx()} />
        </Field>
        <Field label="Check-out (optional)">
          <input type="time" value={form.check_out_time ?? ""} onChange={(e) => set("check_out_time", e.target.value)} className={cx()} />
        </Field>
        <div />
        <Field label="Break start (optional)">
          <input type="time" value={form.break_start_time ?? ""} onChange={(e) => set("break_start_time", e.target.value)} className={cx()} />
        </Field>
        <Field label="Break end (optional)">
          <input type="time" value={form.break_end_time ?? ""} onChange={(e) => set("break_end_time", e.target.value)} className={cx()} />
        </Field>
      </div>

      <button
        onClick={submit}
        disabled={saving}
        className="mt-6 w-full bg-brand-blue hover:bg-brand-blueDark disabled:opacity-50 text-white font-bold rounded-2xl py-5 text-xl shadow-lg active:scale-[.99] transition"
      >
        {saving ? "Queueing…" : "✓ Queue for actuals"}
      </button>
      <div className="text-xs text-gray-500 text-center mt-2">
        You can edit anything before submitting. After submit, only the admin can change target hours.
      </div>
    </div>
  );
}

/* ==============================
   Small field helpers
   ============================== */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-gray-500 mb-1">{label}</div>
      {children}
    </label>
  );
}

function NumField({
  label, v, on, decimal, required,
}: { label: string; v: number | ""; on: (n: number) => void; decimal?: boolean; required?: boolean }) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold text-gray-500 mb-1">{label}</div>
      <input
        type="number"
        inputMode={decimal ? "decimal" : "numeric"}
        min={0}
        step={decimal ? 0.5 : 1}
        required={required}
        value={v === 0 && !required ? "" : v}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return on(0);
          const n = decimal ? parseFloat(raw) : parseInt(raw, 10);
          if (!Number.isFinite(n) || n < 0) return; // ignore negatives / junk
          on(n);
        }}
        className="w-full border rounded-lg px-3 py-2 text-center font-semibold focus:outline-none focus:ring-4 focus:ring-brand-blue/30 focus:border-brand-blue"
      />
    </label>
  );
}

/** Free text input with an attached <datalist> for autocomplete suggestions */
function SuggestInput({
  value, onChange, className, placeholder, options, listId,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  options: string[];
  listId: string;
}) {
  return (
    <>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        placeholder={placeholder}
        list={listId}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((o) => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}
