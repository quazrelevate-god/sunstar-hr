import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { WorkEntry } from "../lib/supabase";
import { Toast } from "../components/Toast";
import type { ToastKind } from "../components/Toast";
import { StateBadge, relativeAgo } from "../components/StateBadge";

const BEDROOM_OPTS = ["3 BR", "4 BR", "5 BR", "6 BR", "Studio"];
const FLOOR_OPTS = ["SOG", "FF", "SF", "RF", "GF"];
const STATUS_OPTS = ["DONE", "IN PROGRESS", "PENDING"];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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
};

type Tab = "queue" | "new";

export default function EmployeeEntry() {
  const { employee, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("queue");
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const flash = (msg: string, kind: ToastKind = "info") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  return (
    <div className="min-h-screen bg-brand-yellowSoft">
      {/* Header */}
      <header className="bg-brand-yellow shadow">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-ink rounded-lg flex items-center justify-center text-brand-yellow font-bold">
              S
            </div>
            <div>
              <div className="font-bold text-brand-ink">Sunstar Work</div>
              <div className="text-xs text-brand-ink/70">
                {employee?.full_name} · {employee?.employee_code}
              </div>
            </div>
          </div>
          <button
            onClick={signOut}
            className="bg-brand-ink text-white px-4 py-2 rounded-lg text-sm font-medium"
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
                    ? "border-brand-ink text-brand-ink"
                    : "border-transparent text-brand-ink/60 hover:text-brand-ink"
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
        {tab === "queue" ? <QueueTab flash={flash} /> : <NewEntryTab flash={flash} onDone={() => setTab("queue")} />}
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
  const [pp, setPp] = useState(0);
  const [gi, setGi] = useState(0);
  const [dp, setDp] = useState(0);
  const [tel, setTel] = useState(0);
  const [lt, setLt] = useState(0);
  const [fc, setFc] = useState(0);
  const [db, setDb] = useState(0);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!hours || +hours <= 0) return flash("Enter actual hours (> 0)", "error");
    setSaving(true);
    const { error } = await supabase
      .from("sunstar_work_entries")
      .update({
        hours: +hours,
        power_point: pp,
        gi_box_nos: gi,
        data_point: dp,
        telephone_point: tel,
        lighting_point: lt,
        fcu_point: fc,
        db_conduit: db,
        state: "AWAITING_PRICE",
        actual_by_id: employee?.id ?? null,
      })
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
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Target {row.target_hours ?? "—"}h · queued {row.created_at ? relativeAgo(row.created_at) : ""}
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
            className="bg-brand-yellow hover:bg-brand-yellowDark text-brand-ink font-semibold px-4 py-2 rounded-lg text-sm"
          >
            {open ? "Close" : "Fill actuals →"}
          </button>
        </div>
      </div>

      {/* Expanded form */}
      {open && (
        <div className="border-t bg-brand-yellowSoft/40 p-5 space-y-4">
          <div className="grid md:grid-cols-4 gap-3">
            <NumField required label="Actual Hours *" v={hours} on={setHours as any} decimal />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-2">Point Counts</div>
            <div className="grid grid-cols-3 md:grid-cols-7 gap-3">
              <NumField label="Power" v={pp} on={setPp} />
              <NumField label="GI Box" v={gi} on={setGi} />
              <NumField label="Data" v={dp} on={setDp} />
              <NumField label="Telephone" v={tel} on={setTel} />
              <NumField label="Lighting" v={lt} on={setLt} />
              <NumField label="FCU" v={fc} on={setFc} />
              <NumField label="DB Conduit" v={db} on={setDb} />
            </div>
          </div>
          <div className="text-xs text-gray-500">
            End date is stamped automatically when you submit.
          </div>
          <button
            onClick={submit}
            disabled={saving}
            className="w-full bg-brand-ink hover:bg-black disabled:opacity-50 text-brand-yellow font-bold rounded-xl py-4 text-lg shadow"
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
function NewEntryTab({ flash, onDone }: { flash: (m: string, k?: ToastKind) => void; onDone: () => void }) {
  const { employee } = useAuth();
  const [form, setForm] = useState<Partial<WorkEntry>>(EMPTY_NEW);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof WorkEntry>(k: K, v: WorkEntry[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!form.villa?.trim()) return flash("Villa is required", "error");
    if (!form.client?.trim()) return flash("Client is required", "error");
    if (!form.description?.trim()) return flash("Description is required", "error");
    if (!form.target_hours || form.target_hours <= 0) return flash("Target hours must be > 0", "error");

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
      employee_id: employee?.id ?? null,
      employee_name: employee?.full_name ?? null,
      created_by_id: employee?.id ?? null,
    };
    const { error } = await supabase.from("sunstar_work_entries").insert(payload);
    setSaving(false);
    if (error) return flash(error.message, "error");
    flash(`Queued · Villa ${form.villa} · ${form.target_hours}h target`, "success");
    // keep cluster/phase/client for next entry, reset the rest
    setForm({
      ...EMPTY_NEW,
      cluster: form.cluster,
      phase: form.phase,
      client: form.client,
      floor_type: form.floor_type,
      description: form.description,
      bedroom_type: form.bedroom_type,
    });
    onDone();
  }

  const cx = (extra = "") =>
    `w-full border rounded-xl px-4 py-3 focus:outline-none focus:ring-4 focus:ring-brand-yellow/30 focus:border-brand-yellow ${extra}`;

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
          <input value={form.cluster ?? ""} onChange={(e) => set("cluster", e.target.value)} className={cx()} placeholder="e.g. V-14" />
        </Field>
        <Field label="Phase">
          <input value={form.phase ?? ""} onChange={(e) => set("phase", e.target.value)} className={cx()} placeholder="e.g. PH-2" />
        </Field>
        <Field label="Villa *">
          <input value={form.villa ?? ""} onChange={(e) => set("villa", e.target.value)} className={cx()} placeholder="e.g. 101" />
        </Field>

        <Field label="Bedroom">
          <select value={form.bedroom_type ?? "3 BR"} onChange={(e) => set("bedroom_type", e.target.value)} className={cx()}>
            {BEDROOM_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Floor">
          <select value={form.floor_type ?? "SOG"} onChange={(e) => set("floor_type", e.target.value)} className={cx()}>
            {FLOOR_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Description *">
          <input value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} className={cx()} placeholder="e.g. Slab Conduiting" />
        </Field>

        <Field label="Client *">
          <input value={form.client ?? ""} onChange={(e) => set("client", e.target.value)} className={cx()} placeholder="Client / project" />
        </Field>
        <Field label="Status">
          <select value={form.status ?? "IN PROGRESS"} onChange={(e) => set("status", e.target.value)} className={cx()}>
            {STATUS_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Start Date">
          <input type="date" value={form.start_date ?? ""} onChange={(e) => set("start_date", e.target.value)} className={cx()} />
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
      </div>

      <button
        onClick={submit}
        disabled={saving}
        className="mt-6 w-full bg-brand-yellow hover:bg-brand-yellowDark disabled:opacity-50 text-brand-ink font-bold rounded-2xl py-5 text-xl shadow-lg active:scale-[.99] transition"
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
        className="w-full border rounded-lg px-3 py-2 text-center font-semibold focus:outline-none focus:ring-4 focus:ring-brand-yellow/30 focus:border-brand-yellow"
      />
    </label>
  );
}
