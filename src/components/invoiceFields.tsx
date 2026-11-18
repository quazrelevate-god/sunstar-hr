import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmtMoney, parseNum } from "../lib/invoice";
import type { BillingClient } from "../lib/invoice";

/* Inline editable controls — look like plain invoice text until hovered/focused. */
export const EDIT =
  "w-full bg-transparent rounded-sm px-1 -mx-1 border border-transparent outline-none " +
  "hover:border-dashed hover:border-sky-400 focus:border-sky-500 focus:bg-sky-50/70 placeholder:text-slate-400 placeholder:font-normal";

export function Field({ value, onChange, className = "", placeholder, inputMode }: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string;
  inputMode?: "decimal" | "text";
}) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      inputMode={inputMode} className={`${EDIT} ${className}`} />
  );
}

/** Number field: shows "1,250.00" when idle, the raw typed value while editing. */
export function MoneyField({ value, onChange, className = "" }: {
  value: string; onChange: (v: string) => void; className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const n = parseNum(value);
  return (
    <input value={focused || n == null ? value : fmtMoney(n)} inputMode="decimal"
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={(e) => onChange(e.target.value)} className={`${EDIT} ${className}`} />
  );
}

export function Area({ value, onChange, className = "", placeholder }: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea ref={ref} rows={1} value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} className={`${EDIT} resize-none overflow-hidden leading-snug ${className}`} />
  );
}

/** Billing-client name with a type-ahead list of saved clients. */
export function ClientNameField({ value, onChange, clients, onPick }: {
  value: string; onChange: (v: string) => void; clients: BillingClient[]; onPick: (c: BillingClient) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const q = value.trim().toLowerCase();
  const matches = (q
    ? [...clients.filter((c) => c.name.toLowerCase().startsWith(q)),
       ...clients.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q))]
    : clients
  ).filter((c) => c.name.toLowerCase() !== q).slice(0, 8);

  return (
    <div className="relative" ref={wrap}>
      <Area value={value} placeholder="Client name — type to pick a saved client"
        onChange={(v) => { onChange(v); setOpen(true); }} />
      {open && matches.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-slate-200 rounded-lg shadow-xl py-1 font-normal normal-case">
          {matches.map((c) => (
            <li key={c.id}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onPick(c); setOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-sky-50">
                <div className="text-[12px] font-semibold text-slate-900">{c.name}</div>
                <div className="text-[11px] text-slate-500">
                  {[c.address, c.trn && `TRN ${c.trn}`].filter(Boolean).join(" · ") || "No address saved"}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
