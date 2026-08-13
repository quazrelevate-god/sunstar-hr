import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { WorkEntry } from "../lib/supabase";
import { Toast } from "../components/Toast";
import type { ToastKind } from "../components/Toast";

const BEDROOM_OPTS = ["3 BR", "4 BR", "5 BR", "6 BR", "Studio"];
const FLOOR_OPTS = ["SOG", "FF", "SF", "RF", "GF"];
const STATUS_OPTS = ["DONE", "IN PROGRESS", "PENDING"];
const CLIENT_OPTS = ["GINCO-DIP", "GINCO-449", "GINCO-MAYDAN", "PIVOT-MASAR"];
const DESC_OPTS = ["SLAB CONDUITING", "WALL CONDUITING", "WIRING", "FIXTURE INSTALL"];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY: WorkEntry = {
  cluster: "",
  phase: "",
  villa: "",
  bedroom_type: "3 BR",
  description: "SLAB CONDUITING",
  floor_type: "SOG",
  start_date: todayISO(),
  end_date: todayISO(),
  status: "DONE",
  hours: 0,
  total_price: 0,
  cost: 0,
  power_point: 0,
  gi_box_nos: 0,
  data_point: 0,
  telephone_point: 0,
  lighting_point: 0,
  fcu_point: 0,
  db_conduit: 0,
  client: "GINCO-DIP",
};

const LAST_KEY = "sunstar_last_entry";

export default function EmployeeEntry() {
  const { employee, signOut } = useAuth();
  const [form, setForm] = useState<WorkEntry>(() => {
    const cached = localStorage.getItem(LAST_KEY);
    if (cached) {
      try {
        const c = JSON.parse(cached);
        return { ...EMPTY, cluster: c.cluster, phase: c.phase, client: c.client, floor_type: c.floor_type, description: c.description, bedroom_type: c.bedroom_type };
      } catch {}
    }
    return EMPTY;
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const [recent, setRecent] = useState<WorkEntry[]>([]);
  const flash = (msg: string, kind: ToastKind = "info") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  };

  const perHour = useMemo(() => {
    if (!form.hours || form.hours <= 0) return 0;
    return +(form.total_price / form.hours).toFixed(2);
  }, [form.hours, form.total_price]);

  const profit = useMemo(() => +(form.total_price - form.cost).toFixed(2), [form.total_price, form.cost]);

  async function loadRecent() {
    if (!employee) return;
    const { data } = await supabase
      .from("sunstar_work_entries")
      .select("*")
      .eq("employee_id", employee.id)
      .order("created_at", { ascending: false })
      .limit(5);
    setRecent((data as WorkEntry[]) ?? []);
  }

  useEffect(() => {
    loadRecent();
  }, [employee?.id]);

  function set<K extends keyof WorkEntry>(key: K, val: WorkEntry[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function reset(keepDefaults = true) {
    if (keepDefaults) {
      setForm((f) => ({
        ...EMPTY,
        cluster: f.cluster,
        phase: f.phase,
        client: f.client,
        floor_type: f.floor_type,
        description: f.description,
        bedroom_type: f.bedroom_type,
      }));
    } else {
      setForm(EMPTY);
    }
  }

  async function submit() {
    if (!employee) return;
    if (!form.villa.trim()) return flash("Villa is required", "error");
    if (form.hours <= 0) return flash("Hours must be greater than 0", "error");
    setSaving(true);

    const payload = {
      ...form,
      employee_id: employee.id,
      employee_name: employee.full_name,
    };
    delete (payload as any).per_hour_ratio;

    const { error } = await supabase.from("sunstar_work_entries").insert(payload);
    setSaving(false);
    if (error) return flash(error.message, "error");

    localStorage.setItem(
      LAST_KEY,
      JSON.stringify({
        cluster: form.cluster,
        phase: form.phase,
        client: form.client,
        floor_type: form.floor_type,
        description: form.description,
        bedroom_type: form.bedroom_type,
      })
    );
    flash(`Saved · Villa ${form.villa} · AED ${perHour}/hr`, "success");
    const savedVilla = form.villa;
    reset(true);
    loadRecent();
    window.scrollTo({ top: 0, behavior: "smooth" });
    void savedVilla;
  }

  return (
    <div className="min-h-screen bg-brand-yellowSoft">
      {/* Header */}
      <header className="bg-brand-yellow shadow">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-ink rounded-lg flex items-center justify-center text-brand-yellow font-bold">S</div>
            <div>
              <div className="font-bold text-brand-ink">Sunstar Work Entry</div>
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
      </header>

      {toast && <Toast msg={toast.msg} kind={toast.kind} />}

      <main className="max-w-6xl mx-auto p-4 md:p-6 grid md:grid-cols-3 gap-6">
        {/* Form */}
        <div className="md:col-span-2 bg-white rounded-3xl shadow-lg p-6 tap-lg">
          <div className="flex items-baseline justify-between mb-4">
            <h1 className="text-2xl font-bold text-brand-ink">New Entry</h1>
            <button onClick={() => reset(false)} className="text-sm text-gray-500 hover:underline">
              Clear all
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Cluster">
              <input value={form.cluster} onChange={(e) => set("cluster", e.target.value)} className={cx()} placeholder="e.g. V-14" />
            </Field>
            <Field label="Phase">
              <input value={form.phase} onChange={(e) => set("phase", e.target.value)} className={cx()} placeholder="e.g. PH-2" />
            </Field>
            <Field label="Villa *">
              <input value={form.villa} onChange={(e) => set("villa", e.target.value)} className={cx()} placeholder="e.g. 101" />
            </Field>

            <Field label="Bedroom">
              <select value={form.bedroom_type} onChange={(e) => set("bedroom_type", e.target.value)} className={cx()}>
                {BEDROOM_OPTS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Floor">
              <select value={form.floor_type} onChange={(e) => set("floor_type", e.target.value)} className={cx()}>
                {FLOOR_OPTS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Description">
              <select value={form.description} onChange={(e) => set("description", e.target.value)} className={cx()}>
                {DESC_OPTS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>

            <Field label="Client">
              <select value={form.client} onChange={(e) => set("client", e.target.value)} className={cx()}>
                {CLIENT_OPTS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => set("status", e.target.value)} className={cx()}>
                {STATUS_OPTS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Start Date">
              <input type="date" value={form.start_date ?? ""} onChange={(e) => set("start_date", e.target.value)} className={cx()} />
            </Field>
            <Field label="End Date">
              <input type="date" value={form.end_date ?? ""} onChange={(e) => set("end_date", e.target.value)} className={cx()} />
            </Field>

            <Field label="Hours *">
              <input
                type="number" inputMode="decimal" min={0} step={0.5}
                value={form.hours || ""} onChange={(e) => set("hours", parseFloat(e.target.value) || 0)}
                className={cx("font-semibold")}
              />
            </Field>
            <Field label="Total Price (AED)">
              <input
                type="number" inputMode="decimal" min={0}
                value={form.total_price || ""} onChange={(e) => set("total_price", parseFloat(e.target.value) || 0)}
                className={cx("font-semibold")}
              />
            </Field>
            <Field label="Cost (AED)">
              <input
                type="number" inputMode="decimal" min={0}
                value={form.cost || ""} onChange={(e) => set("cost", parseFloat(e.target.value) || 0)}
                className={cx("font-semibold")}
              />
            </Field>
          </div>

          <div className="mt-5 pt-5 border-t">
            <div className="text-sm font-semibold text-gray-500 mb-3">Point Counts</div>
            <div className="grid grid-cols-3 md:grid-cols-7 gap-3">
              <NumField label="Power" v={form.power_point} on={(v) => set("power_point", v)} />
              <NumField label="GI Box" v={form.gi_box_nos} on={(v) => set("gi_box_nos", v)} />
              <NumField label="Data" v={form.data_point} on={(v) => set("data_point", v)} />
              <NumField label="Telephone" v={form.telephone_point} on={(v) => set("telephone_point", v)} />
              <NumField label="Lighting" v={form.lighting_point} on={(v) => set("lighting_point", v)} />
              <NumField label="FCU" v={form.fcu_point} on={(v) => set("fcu_point", v)} />
              <NumField label="DB Conduit" v={form.db_conduit} on={(v) => set("db_conduit", v)} />
            </div>
          </div>

          <button
            onClick={submit}
            disabled={saving}
            className="mt-6 w-full bg-brand-yellow hover:bg-brand-yellowDark disabled:opacity-50 text-brand-ink font-bold rounded-2xl py-5 text-xl shadow-lg active:scale-[.99] transition"
          >
            {saving ? "Saving…" : "✓ Submit Entry"}
          </button>
          <div className="text-xs text-gray-500 text-center mt-2">
            Entries can be edited above before submit. After submit they are locked.
          </div>
        </div>

        {/* Live summary + recent */}
        <div className="space-y-4">
          <div className="bg-brand-ink text-white rounded-3xl p-6 shadow-lg">
            <div className="text-xs uppercase tracking-wider text-brand-yellow font-semibold">Live Calculation</div>
            <div className="mt-3 text-4xl font-bold text-brand-yellow">
              AED {perHour.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="text-sm text-gray-300 mt-1">per hour ratio</div>

            <div className="grid grid-cols-2 gap-3 mt-5 text-sm">
              <div className="bg-white/10 rounded-xl p-3">
                <div className="text-gray-400 text-xs">Total Price</div>
                <div className="font-bold text-lg">AED {form.total_price.toLocaleString()}</div>
              </div>
              <div className="bg-white/10 rounded-xl p-3">
                <div className="text-gray-400 text-xs">Cost</div>
                <div className="font-bold text-lg">AED {form.cost.toLocaleString()}</div>
              </div>
              <div className={`col-span-2 rounded-xl p-3 ${profit >= 0 ? "bg-green-500/20" : "bg-red-500/20"}`}>
                <div className="text-gray-300 text-xs">Est. Profit</div>
                <div className={`font-bold text-lg ${profit >= 0 ? "text-green-300" : "text-red-300"}`}>
                  AED {profit.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-5 shadow-lg">
            <div className="font-bold text-brand-ink mb-3">Your Recent 5</div>
            {recent.length === 0 ? (
              <div className="text-sm text-gray-500">No entries yet.</div>
            ) : (
              <ul className="space-y-2">
                {recent.map((r) => (
                  <li key={r.id} className="border rounded-xl p-3 text-sm">
                    <div className="flex justify-between font-semibold">
                      <span>Villa {r.villa}</span>
                      <span className="text-brand-yellowDark">AED {r.per_hour_ratio}/hr</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {r.client} · {r.floor_type} · {r.hours}h · AED {r.total_price}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-gray-500 mb-1">{label}</div>
      {children}
    </label>
  );
}

function NumField({ label, v, on }: { label: string; v: number; on: (n: number) => void }) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold text-gray-500 mb-1">{label}</div>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={v || ""}
        onChange={(e) => on(parseInt(e.target.value) || 0)}
        className="w-full border rounded-lg px-3 py-2 text-center font-semibold focus:outline-none focus:ring-4 focus:ring-brand-yellow/30 focus:border-brand-yellow"
      />
    </label>
  );
}

function cx(extra = "") {
  return `w-full border rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-yellow/30 focus:border-brand-yellow ${extra}`;
}
