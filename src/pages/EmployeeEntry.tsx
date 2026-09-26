import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { supabase, POINT_FIELDS } from "../lib/supabase";
import type { WorkEntry } from "../lib/supabase";
import { Toast } from "../components/Toast";
import type { ToastKind } from "../components/Toast";
import { StateBadge, relativeAgo } from "../components/StateBadge";
import { Logo } from "../components/Logo";

const BEDROOM_SEED = ["3 BR", "4 BR", "5 BR", "6 BR", "Studio"];
const FLOOR_SEED   = ["SOG", "FF", "SF", "RF", "GF"];
const STATUS_OPTS  = ["DONE", "IN PROGRESS", "PENDING"];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function currentHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const EMPTY_NEW: Partial<WorkEntry> = {
  cluster: "",
  phase: "",
  villa: "",
  bedroom_type: "3 BR",
  description: "",
  floor_type: "SOG",
  start_date: todayISO(),
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

  // Load distinct text-column history for autocomplete
  async function loadSuggestions() {
    const cols = ["cluster","phase","villa","bedroom_type","floor_type","description","client","status","apartment_number"] as const;
    const { data, error } = await supabase.from("sunstar_work_entries").select(cols.join(","));
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
        () => loadSuggestions())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
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

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("sunstar_work_entries")
      .select("*")
      .eq("state", "AWAITING_ACTUAL")
      .order("created_at", { ascending: true });
    if (error) flash(error.message, "error");
    setRows((data as WorkEntry[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    const ch = supabase
      .channel("work-entries-live-employee")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sunstar_work_entries" },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function del(id: string) {
    if (!confirm("Delete this queued entry? This cannot be undone.")) return;
    const { error } = await supabase.from("sunstar_work_entries").delete().eq("id", id);
    if (error) return flash(error.message, "error");
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
  const [hours, setHours] = useState<number | "">("");
  const [checkOut, setCheckOut] = useState<string>(row.check_out_time ?? "");
  const [breakStart, setBreakStart] = useState<string>(row.break_start_time ?? "");
  const [breakEnd, setBreakEnd] = useState<string>(row.break_end_time ?? "");
  const [points, setPoints] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    POINT_FIELDS.forEach((p) => { init[p.key as string] = 0; });
    return init;
  });
  const [saving, setSaving] = useState(false);

  const setPt = (k: string, v: number) => setPoints((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!hours || +hours <= 0) return flash("Enter actual hours (> 0)", "error");
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
    const { error } = await supabase
      .from("sunstar_work_entries")
      .update(update)
      .eq("id", row.id!);
    setSaving(false);
    if (error) return flash(error.message, "error");
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
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="text-red-600 hover:bg-red-50 text-xs font-medium px-2 py-1 rounded"
            title="Delete"
          >
            Delete
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="bg-brand-blue hover:bg-brand-blueDark text-brand-ink font-semibold px-4 py-2 rounded-lg text-sm"
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
            className="w-full bg-brand-ink hover:bg-black disabled:opacity-50 text-brand-blue font-bold rounded-xl py-4 text-lg shadow"
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
  const [form, setForm] = useState<Partial<WorkEntry>>({ ...EMPTY_NEW, check_in_time: currentHHMM() });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof WorkEntry>(k: K, v: WorkEntry[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!form.villa?.trim()) return flash("Villa is required", "error");
    if (!form.client?.trim()) return flash("Client is required", "error");
    if (!form.description?.trim()) return flash("Description is required", "error");
    if (!form.target_hours || form.target_hours <= 0) return flash("Target hours must be > 0", "error");
    if (!form.total_manpower || form.total_manpower <= 0) return flash("Total manpower is required", "error");
    if (!form.check_in_time) return flash("Check-in time is required", "error");

    setSaving(true);
    const payload = {
      state: "AWAITING_ACTUAL",
      cluster: form.cluster ?? "",
      phase: form.phase ?? "",
      villa: form.villa,
      bedroom_type: form.bedroom_type ?? "3 BR",
      description: form.description,
      floor_type: form.floor_type ?? "SOG",
      start_date: form.start_date ?? todayISO(),
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
    if (error) return flash(error.message, "error");
    flash(`Queued · Villa ${form.villa} · ${form.target_hours}h target`, "success");
    setForm({
      ...EMPTY_NEW,
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
        className="mt-6 w-full bg-brand-blue hover:bg-brand-blueDark disabled:opacity-50 text-brand-ink font-bold rounded-2xl py-5 text-xl shadow-lg active:scale-[.99] transition"
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
        onChange={(e) => on(decimal ? (parseFloat(e.target.value) || 0) : (parseInt(e.target.value) || 0))}
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
