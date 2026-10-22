import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type { WorkEntry } from "../lib/supabase";
import type { ToastKind } from "./Toast";
import {
  blankLine, buildInvoice, editLine, fmtMoney, matchBillingClient, nextInvoiceNo, parseNum, totals,
} from "../lib/invoice";
import type { BillingClient, InvoiceDoc, InvoiceLine } from "../lib/invoice";
import logoUrl from "../assets/invoice-logo.jpg";
import stampUrl from "../assets/invoice-stamp.jpg";

const TABLE = "sunstar_invoice_clients";

async function toDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/* Inline editable controls — look like plain invoice text until hovered/focused. */
const EDIT =
  "w-full bg-transparent rounded-sm px-1 -mx-1 border border-transparent outline-none " +
  "hover:border-dashed hover:border-sky-400 focus:border-sky-500 focus:bg-sky-50/70 placeholder:text-slate-400 placeholder:font-normal";

function Field({ value, onChange, className = "", placeholder, inputMode }: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string;
  inputMode?: "decimal" | "text";
}) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      inputMode={inputMode} className={`${EDIT} ${className}`} />
  );
}

/** Number field: shows "1,250.00" when idle, the raw typed value while editing. */
function MoneyField({ value, onChange, className = "" }: {
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

function Area({ value, onChange, className = "", placeholder }: {
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
function ClientNameField({ value, onChange, clients, onPick }: {
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

/** Save/refresh the billing client after a download so the next invoice is pre-filled. */
async function rememberClient(inv: InvoiceDoc, entryClient: string, clients: BillingClient[]) {
  const name = inv.clientName.trim();
  if (!name) return;
  const key = name.toLowerCase();
  const label = entryClient.trim();
  const existing = clients.find((c) => c.name.trim().toLowerCase() === key);
  const fields = {
    name,
    address: inv.clientAddress.trim(),
    trn: inv.clientTrn.trim(),
    ...(inv.invoiceNo.trim() ? { last_invoice_no: inv.invoiceNo.trim() } : {}),
    ...(inv.project.trim() ? { last_project: inv.project.trim() } : {}),
    updated_at: new Date().toISOString(),
  };
  const hasLabel = (c: BillingClient) => c.entry_clients.some((e) => e.trim().toLowerCase() === label.toLowerCase());

  if (existing) {
    const entry_clients = label && !hasLabel(existing) ? [...existing.entry_clients, label] : existing.entry_clients;
    const { error } = await supabase.from(TABLE).update({ ...fields, entry_clients }).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from(TABLE).insert({ ...fields, entry_clients: label ? [label] : [] });
    if (error) throw error;
  }
  // An entry label maps to one billing client: unlink it from any other.
  if (label) {
    for (const c of clients) {
      if (c.name.trim().toLowerCase() === key || !hasLabel(c)) continue;
      const entry_clients = c.entry_clients.filter((e) => e.trim().toLowerCase() !== label.toLowerCase());
      await supabase.from(TABLE).update({ entry_clients }).eq("id", c.id);
    }
  }
}

export function InvoiceModal({ rows, onClose, flash }: {
  rows: WorkEntry[];
  onClose: () => void;
  flash: (m: string, k?: ToastKind) => void;
}) {
  // Work-entry clients in this view, most entries first.
  const entryClients = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const c = (r.client ?? "").toString().trim() || "No client";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [rows]);

  const [entryClient, setEntryClient] = useState(entryClients[0] ?? "");
  const [clients, setClients] = useState<BillingClient[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [inv, setInv] = useState<InvoiceDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from(TABLE).select("*").order("name").then(({ data, error }) => {
      if (error) flash("Couldn't load saved clients — you can still type them in", "error");
      setClients((data as BillingClient[]) ?? []);
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Re)build the invoice whenever the chosen work-entry client changes.
  useEffect(() => {
    if (!loaded) return;
    const list = rows.filter((r) => ((r.client ?? "").toString().trim() || "No client") === entryClient);
    setInv(buildInvoice(list, entryClient, matchBillingClient(entryClient, clients)));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, entryClient]);

  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dirtyRef.current && !confirm("Close the invoice preview? Your edits will be lost.")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function requestClose() {
    if (dirty && !confirm("Close the invoice preview? Your edits will be lost.")) return;
    onClose();
  }

  const set = <K extends keyof InvoiceDoc>(k: K, v: InvoiceDoc[K]) => {
    setInv((d) => (d ? { ...d, [k]: v } : d));
    setDirty(true);
  };
  const setLine = (id: string, field: keyof Omit<InvoiceLine, "id">, value: string) =>
    set("lines", inv!.lines.map((l) => (l.id === id ? editLine(l, field, value) : l)));

  function pickClient(c: BillingClient) {
    setInv((d) => d && {
      ...d,
      clientName: c.name,
      clientAddress: c.address,
      clientTrn: c.trn,
      invoiceNo: d.invoiceNo.trim() ? d.invoiceNo : nextInvoiceNo(c.last_invoice_no),
      project: d.project.trim() ? d.project : c.last_project,
    });
    setDirty(true);
  }

  async function download() {
    if (!inv) return;
    if (!inv.clientName.trim()) return flash("Add the client name before downloading", "error");
    setBusy(true);
    try {
      const [{ renderInvoicePdf }, logo, stamp] = await Promise.all([
        import("../lib/invoicePdf"), toDataUrl(logoUrl), toDataUrl(stampUrl),
      ]);
      const name = `Invoice_${inv.invoiceNo.trim() || inv.clientName.trim()}_${inv.invoiceDate}`
        .replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(0, 100);
      renderInvoicePdf(inv, { logo, stamp }).save(`${name}.pdf`);
    } catch (e: any) {
      setBusy(false);
      return flash(`Couldn't create the PDF: ${e?.message ?? e}`, "error");
    }
    try {
      await rememberClient(inv, entryClient, clients);
      flash("Invoice downloaded", "success");
    } catch {
      flash("Invoice downloaded, but the client details couldn't be saved", "error");
    }
    setBusy(false);
    setDirty(false);
  }

  const t = inv ? totals(inv) : null;
  const cell = "border border-black px-2 py-1.5 align-middle";

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-stretch justify-center p-3 md:p-6" onClick={requestClose}>
      <div className="w-full max-w-[920px] bg-slate-100 rounded-2xl shadow-2xl flex flex-col min-h-0" onClick={(e) => e.stopPropagation()}>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-slate-200 bg-white rounded-t-2xl">
          <div className="min-w-0">
            <div className="font-bold text-brand-ink">Invoice preview</div>
            <div className="text-xs text-slate-500">Click any text or number to edit. Empty optional rows are left off the PDF.</div>
          </div>
          {entryClients.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              For
              <select value={entryClient}
                onChange={(e) => {
                  if (dirty && !confirm("Switching client rebuilds the invoice and drops your edits. Continue?")) return;
                  setEntryClient(e.target.value);
                }}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm max-w-[260px]">
                {entryClients.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={requestClose} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm">Cancel</button>
            <button onClick={download} disabled={!inv || busy}
              className="px-4 py-2 rounded-lg bg-brand-ink text-white text-sm font-bold disabled:opacity-50">
              {busy ? "Preparing…" : "Download PDF"}
            </button>
          </div>
        </div>

        {/* A4 sheet */}
        <div className="flex-1 overflow-auto p-4 md:p-6">
          {!inv || !t ? (
            <div className="text-center text-slate-500 py-20">Preparing invoice…</div>
          ) : (
            <div className="mx-auto bg-white shadow-lg w-[794px] max-w-full p-[34px] text-black text-[12px]" style={{ fontFamily: "Helvetica, Arial, sans-serif" }}>
              {/* Header */}
              <div className="border border-black flex items-center gap-4 px-3 py-3">
                <img src={logoUrl} alt="" className="w-[166px] shrink-0" />
                <div className="flex-1 text-center text-[#7030A0] italic">
                  <Field value={inv.companyName} onChange={(v) => set("companyName", v)} className="text-center text-[21px] font-bold" />
                  <Field value={inv.companyAddress} onChange={(v) => set("companyAddress", v)} className="text-center text-[13px]" />
                  <Field value={inv.companyContact} onChange={(v) => set("companyContact", v)} className="text-center text-[11px]" />
                </div>
              </div>

              {/* TO | TITLE | FROM */}
              <div className="grid grid-cols-[64fr_54fr_64fr] border-x border-b border-black bg-[#E4DFEC] font-bold">
                <div className="p-2 border-r border-black space-y-0.5">
                  <div>TO:</div>
                  <ClientNameField value={inv.clientName} onChange={(v) => set("clientName", v)} clients={clients} onPick={pickClient} />
                  <Area value={inv.clientAddress} onChange={(v) => set("clientAddress", v)} placeholder="Address" />
                  <div className="flex items-baseline gap-1"><span>TRN:</span>
                    <Field value={inv.clientTrn} onChange={(v) => set("clientTrn", v)} placeholder="Client TRN" /></div>
                </div>
                <div className="p-2 border-r border-black flex items-center">
                  <Area value={inv.title} onChange={(v) => set("title", v)} className="text-center text-[16px]" />
                </div>
                <div className="p-2 space-y-0.5">
                  <Field value={inv.fromName} onChange={(v) => set("fromName", v)} />
                  <div className="flex items-baseline gap-1"><span className="shrink-0">INVOICE NO:</span>
                    <Field value={inv.invoiceNo} onChange={(v) => set("invoiceNo", v)} placeholder="e.g. INV/…/01" /></div>
                  <div className="flex items-baseline gap-1"><span className="shrink-0">INVOICE DATE:</span>
                    <Field value={inv.invoiceDate} onChange={(v) => set("invoiceDate", v)} /></div>
                  <div className="flex items-baseline gap-1"><span>TRN:</span>
                    <Field value={inv.ourTrn} onChange={(v) => set("ourTrn", v)} /></div>
                </div>
              </div>

              {/* Optional reference rows */}
              <div className="grid grid-cols-[28fr_154fr] border-x border-b border-black bg-[#F2F2F2] items-center">
                <div className="px-2 py-1.5 border-r border-black text-[10px] font-bold">PROJECT NAME</div>
                <div className="px-2 py-1"><Field value={inv.project} onChange={(v) => set("project", v)}
                  placeholder="Project name (optional)" className="text-center text-[16px] font-bold" /></div>
              </div>
              <div className="flex items-baseline justify-between gap-6 border-x border-b border-black px-2 py-1 font-bold">
                <div className="flex items-baseline gap-1 flex-1"><span className="shrink-0">JOB NO:</span>
                  <Field value={inv.jobNo} onChange={(v) => set("jobNo", v)} placeholder="optional" /></div>
                <div className="flex items-baseline gap-1 flex-1"><span className="shrink-0 ml-auto">LPO REF:</span>
                  <Field value={inv.lpoRef} onChange={(v) => set("lpoRef", v)} placeholder="optional" className="text-right" /></div>
              </div>

              {/* Lines */}
              <table className="w-full border-collapse">
                <thead className="bg-[#D9D9D9] font-bold text-center">
                  <tr>
                    <th className={`${cell} w-[46px]`}>S.NO</th>
                    <th className={cell}>DESCRIPTION</th>
                    <th className={`${cell} w-[118px]`}>QTY</th>
                    <th className={`${cell} w-[56px]`}>UNIT</th>
                    <th className={`${cell} w-[92px]`}>RATE (AED)</th>
                    <th className={`${cell} w-[108px]`}>AMOUNT (AED)</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map((l, i) => (
                    <tr key={l.id} className="group">
                      <td className={`${cell} text-center relative`}>
                        <span className="group-hover:invisible">{i + 1}</span>
                        <button type="button" title="Remove line"
                          onClick={() => set("lines", inv.lines.filter((x) => x.id !== l.id))}
                          className="inv-del absolute inset-0 hidden group-hover:flex items-center justify-center text-red-600 font-bold text-base">×</button>
                      </td>
                      <td className={cell}><Area value={l.desc} onChange={(v) => setLine(l.id, "desc", v)} placeholder="Description" /></td>
                      <td className={cell}><Area value={l.qty} onChange={(v) => setLine(l.id, "qty", v)} className="text-right" /></td>
                      <td className={cell}><Field value={l.unit} onChange={(v) => setLine(l.id, "unit", v)} className="text-center" /></td>
                      <td className={cell}><MoneyField value={l.rate} onChange={(v) => setLine(l.id, "rate", v)} className="text-right" /></td>
                      <td className={cell}><MoneyField value={l.amount} onChange={(v) => setLine(l.id, "amount", v)} className="text-right" /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[#F2F2F2] font-bold text-right">
                  <tr><td colSpan={5} className={cell}>SUB TOTAL</td><td className={cell}>{fmtMoney(t.subtotal)}</td></tr>
                  <tr>
                    <td colSpan={5} className={cell}>
                      <span className="inline-flex items-baseline justify-end gap-1">VAT (
                        <input value={inv.vatRate} onChange={(e) => set("vatRate", e.target.value)} inputMode="decimal"
                          className={`${EDIT} !w-10 text-center !mx-0`} />%)</span>
                    </td>
                    <td className={cell}>{fmtMoney(t.vat)}</td>
                  </tr>
                  <tr className="text-[14px]"><td colSpan={5} className={cell}>GRAND TOTAL</td><td className={cell}>{fmtMoney(t.grand)}</td></tr>
                </tfoot>
              </table>
              <button type="button" onClick={() => set("lines", [...inv.lines, blankLine()])}
                className="mt-1 mb-2 w-full border border-dashed border-sky-400 text-sky-700 rounded-md py-1 text-xs font-semibold hover:bg-sky-50">
                + Add line
              </button>

              {/* Account details + stamp, regards */}
              <div className="border border-black bg-[#D9D9D9] px-2 py-1 font-bold">ACCOUNT DETAILS</div>
              <div className="border-x border-b border-black grid grid-cols-2 items-center min-h-[136px]">
                <div className="p-2 font-bold"><Area value={inv.bankLines} onChange={(v) => set("bankLines", v)} className="leading-[1.65]" /></div>
                <div className="p-2"><img src={stampUrl} alt="Company stamp" className="w-[196px]" /></div>
              </div>
              <div className="border-x border-b border-black p-2 font-bold">
                <Area value={inv.regardsLines} onChange={(v) => set("regardsLines", v)} className="leading-[1.65]" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
