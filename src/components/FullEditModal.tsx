import { useState } from "react";
import { supabase, POINT_FIELDS } from "../lib/supabase";
import type { WorkEntry } from "../lib/supabase";
import { timeWarnings, maxHours } from "../lib/data";
import type { ToastKind } from "./Toast";

/**
 * Admin-only Full Edit modal for a work entry.
 *
 * - Every field editable in one place (identifiers, times, manpower, hours,
 *   point counts, price).
 * - Optimistic concurrency: the UPDATE only succeeds if none of the fields
 *   being changed have moved on since the modal opened.
 * - Warns on unsaved changes when closing.
 * - Used from both the Admin Queue and the Admin Finalized Entries table.
 */
export function FullEditModal({
  row, onClose, onDone, flash,
}: {
  row: WorkEntry; onClose: () => void; onDone: () => void;
  flash: (m: string, k?: ToastKind) => void;
}) {
  const [f, setF] = useState<Partial<WorkEntry>>(() => ({ ...row }));
  const [saving, setSaving] = useState(false);

  // Pricing helpers — NOT persisted to DB. They let the admin quickly arrive
  // at a Total price via two common billing shapes:
  //   • Per-hour price × actual hours   (hourly jobs)
  //   • Per-quantity price × 1          (unit-priced lots; qty baked into entry)
  // The "Use →" chip copies the computed total into the Total price field.
  const [perHourPrice, setPerHourPrice] = useState<string>("");
  const [perQuantityPrice, setPerQuantityPrice] = useState<string>("");

  const helperHint = (() => {
    const php = parseFloat(perHourPrice);
    const pqp = parseFloat(perQuantityPrice);
    const hrs = f.hours != null && (f.hours as any) !== "" ? Number(f.hours) : null;
    if (Number.isFinite(php) && php > 0 && hrs && hrs > 0) {
      return { label: `${hrs}h × AED ${php.toLocaleString(undefined, { maximumFractionDigits: 2 })}/hr =`, total: +(php * hrs).toFixed(2) };
    }
    if (Number.isFinite(pqp) && pqp > 0) {
      return { label: `Per-quantity price (one unit) =`, total: +pqp.toFixed(2) };
    }
    return null;
  })();

  function set<K extends keyof WorkEntry>(k: K, v: WorkEntry[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

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
    if (f.total_price != null && f.total_price !== ("" as any)) patch.total_price = Number(f.total_price);
    return patch;
  }

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
    const nums: [string, unknown][] = [
      ["Actual hours", f.hours],
      ["Total manpower", f.total_manpower], ["Total price", f.total_price],
      ...POINT_FIELDS.map((p) => [p.label, (f as any)[p.key]] as [string, unknown]),
    ];
    const neg = nums.find(([, v]) => v != null && (v as any) !== "" && Number(v) < 0);
    if (neg) return flash(`${neg[0]} cannot be negative`, "error");
    const cap = maxHours(f.total_manpower);
    if (f.hours != null && (f.hours as any) !== "" && Number(f.hours) > cap) {
      return flash(`Actual hours look too high — max ${cap}h for ${f.total_manpower} people`, "error");
    }
    const warn = timeWarnings(f);
    if (warn.length && !confirm(`${warn.join(". ")}.\n\nSave anyway (for example a night shift)?`)) return;

    const patch = changedPatch();
    if (Object.keys(patch).length === 0) { onClose(); return; }

    setSaving(true);
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
        <div className="p-6 border-b flex items-start justify-between flex-shrink-0">
          <div>
            <div className="text-lg font-bold text-brand-ink">Edit entry — Villa {row.villa}</div>
            <div className="text-xs text-gray-500 mt-1">
              Admin full edit · every field is editable. Changes save on Save.
            </div>
          </div>
          <button onClick={requestClose} aria-label="Close" className="text-gray-400 hover:text-brand-ink text-2xl leading-none">×</button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 flex-1">
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

          <Section title="Hours & price">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <FE label="Actual hours">
                <input type="number" min={0} step="0.5" value={f.hours ?? ""}
                  onChange={(e) => set("hours", e.target.value ? Number(e.target.value) : null)} className={cx}/>
              </FE>
              <FE label="Per-hour price (AED)">
                <input type="number" min={0} step="0.01" value={perHourPrice}
                  onChange={(e) => setPerHourPrice(e.target.value)} className={cx}
                  placeholder="helper · × hours"/>
              </FE>
              <FE label="Per-quantity price (AED)">
                <input type="number" min={0} step="0.01" value={perQuantityPrice}
                  onChange={(e) => setPerQuantityPrice(e.target.value)} className={cx}
                  placeholder="helper · one unit"/>
              </FE>
              <FE label="Total price (AED)">
                <input type="number" min={0} step="0.01" value={f.total_price ?? ""}
                  onChange={(e) => set("total_price", e.target.value ? Number(e.target.value) : null)} className={cx}/>
              </FE>
            </div>
            {helperHint && (
              <div className="mt-2 flex items-center justify-between gap-3 bg-brand-blueSoft/60 border border-brand-blue/20 rounded-lg px-3 py-2 text-xs">
                <span className="text-brand-blueDark">{helperHint.label}</span>
                <button type="button"
                  onClick={() => set("total_price", helperHint.total)}
                  className="font-bold text-brand-ink hover:underline">
                  Use → AED {helperHint.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </button>
              </div>
            )}
          </Section>

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
                        if (n < 0) return;
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

/* ---- helpers (kept inside the module so both callers share one copy) ---- */

const TIME_KEYS = new Set(["check_in_time", "check_out_time", "break_start_time", "break_end_time"]);
const NUM_KEYS = new Set(["hours", "total_manpower", "total_price"]);
const POINT_KEYS = new Set(POINT_FIELDS.map((p) => p.key as string));

/** Normalise a field value so "unchanged" compares equal regardless of format
 *  (e.g. DB time "08:00:00" vs input "08:00", null vs "", 0 vs null for point counts). */
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
