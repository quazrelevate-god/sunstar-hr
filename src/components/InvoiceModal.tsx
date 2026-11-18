import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, COUNT_FIELDS } from "../lib/supabase";
import type { WorkEntry } from "../lib/supabase";
import type { ToastKind } from "./Toast";
import {
  blankLine, buildInvoice, editLine, fmtMoney, matchBillingClient, nextInvoiceNo, parseNum, totals,
} from "../lib/invoice";
import type { BillingClient, InvoiceDoc, InvoiceLine } from "../lib/invoice";
import {
  buildProgressRows, buildProforma, buildSummary, clientKey, isChinaRailway, normLabel,
  pickCountField, proformaTotals, typicalRate, usedCountFields,
} from "../lib/progress";
import type { DocDefaults, ProformaDoc, SavedItem, SummaryDoc } from "../lib/progress";
import logoUrl from "../assets/invoice-logo.jpg";
import stampUrl from "../assets/invoice-stamp.jpg";
import { EDIT, Field, MoneyField, Area, ClientNameField } from "./invoiceFields";
import { ProformaSheet, SummarySheet } from "./ProgressSheets";

const TABLE = "sunstar_invoice_clients";
const ITEMS = "sunstar_progress_items";

async function toDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const fileName = (prefix: string, no: string, fallback: string, date: string) =>
  `${prefix}_${no.trim() || fallback.trim()}_${date}`.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(0, 100);

/** Save/refresh the billing client after a download so the next document is
 *  pre-filled. Fields left undefined are not touched. */
async function rememberClient(f: {
  name: string; address?: string; trn?: string; project?: string;
  invoiceNo?: string; proformaNo?: string; docDefaults?: DocDefaults;
}, entryClient: string, clients: BillingClient[]) {
  const name = f.name.trim();
  if (!name) return;
  const key = name.toLowerCase();
  const label = entryClient.trim();
  const existing = clients.find((c) => c.name.trim().toLowerCase() === key);
  const fields = {
    name,
    ...(f.address !== undefined ? { address: f.address.trim() } : {}),
    ...(f.trn !== undefined ? { trn: f.trn.trim() } : {}),
    ...(f.invoiceNo?.trim() ? { last_invoice_no: f.invoiceNo.trim() } : {}),
    ...(f.proformaNo?.trim() ? { last_proforma_no: f.proformaNo.trim() } : {}),
    ...(f.project?.trim() ? { last_project: f.project.trim() } : {}),
    ...(f.docDefaults ? { doc_defaults: { ...(existing?.doc_defaults ?? {}), ...f.docDefaults } } : {}),
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

/** What the Finalized list was narrowed by — shown above the preview so the
 *  admin can confirm which entries the invoice is built from. */
export type InvoiceScope = {
  period: string; conditions: number; view?: string; search?: string;
  /** Printed PERIOD when a date range is selected (otherwise derived from the entries). */
  invoicePeriod?: string;
};

type DocType = "standard" | "proforma" | "summary";
const DOC_TYPES: { key: DocType; label: string; hint: string }[] = [
  { key: "standard", label: "Invoice", hint: "Standard tax invoice with material lines" },
  { key: "proforma", label: "Proforma", hint: "Progress per tower / level — submit for approval first" },
  { key: "summary", label: "Tax invoice (summary)", hint: "One-page tax invoice raised after the proforma is approved" },
];

export function InvoiceModal({ rows, history, periodStart, scope, onClose, flash }: {
  rows: WorkEntry[];
  /** Every finalized entry — the proforma's "Previous" quantities come from here. */
  history: WorkEntry[];
  /** First day of the selected period (YYYY-MM-DD); null = no cut-off. */
  periodStart: string | null;
  scope?: InvoiceScope;
  onClose: () => void;
  flash: (m: string, k?: ToastKind) => void;
}) {
  // Work-entry clients in this view, most entries first (same name however spaced/cased).
  const entryClients = useMemo(() => {
    const counts = new Map<string, { label: string; n: number }>();
    for (const r of rows) {
      const label = (r.client ?? "").toString().trim() || "No client";
      const k = clientKey(label);
      const c = counts.get(k);
      if (c) c.n++; else counts.set(k, { label, n: 1 });
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.label);
  }, [rows]);

  const [entryClient, setEntryClient] = useState(entryClients[0] ?? "");
  const [clients, setClients] = useState<BillingClient[]>([]);
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [docType, setDocType] = useState<DocType>(isChinaRailway(entryClients[0] ?? "") ? "proforma" : "standard");
  const [inv, setInv] = useState<InvoiceDoc | null>(null);
  const [proforma, setProforma] = useState<ProformaDoc | null>(null);
  const [summary, setSummary] = useState<SummaryDoc | null>(null);
  const [countKey, setCountKey] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from(TABLE).select("*").order("name"),
      supabase.from(ITEMS).select("section,item,uom,contract_qty,rate").eq("client_label", clientKey(entryClient)),
    ]).then(([c, it]) => {
      if (c.error) flash("Couldn't load saved clients — you can still type them in", "error");
      if (it.error) flash("Couldn't load saved contract quantities — you can still type them in", "error");
      setClients((c.data as BillingClient[]) ?? []);
      setSaved((it.data as SavedItem[]) ?? []);
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryClient]);

  const clientRows = useMemo(
    () => rows.filter((r) => clientKey((r.client ?? "").toString().trim() || "No client") === clientKey(entryClient)),
    [rows, entryClient],
  );
  const basis = [
    `${clientRows.length} entr${clientRows.length === 1 ? "y" : "ies"}`,
    entryClient,
    scope?.period || "All dates",
    scope?.view ? `view “${scope.view}”` : "",
    scope?.conditions ? `${scope.conditions} condition${scope.conditions === 1 ? "" : "s"}` : "",
    scope?.search ? `search “${scope.search}”` : "",
  ].filter(Boolean).join(" · ");

  const billing = matchBillingClient(entryClient, clients);
  const countOptions = useMemo(() => usedCountFields(clientRows), [clientRows]);

  function makeProforma(key: string): ProformaDoc {
    const progressRows = buildProgressRows({
      rows: clientRows, history, client: entryClient, periodStart, countKey: key, saved,
      defaultRate: typicalRate(clientRows, key),
    });
    const desc = clientRows.map((r) => (r.description ?? "").toString().trim()).find(Boolean) ?? "";
    return buildProforma({
      rows: progressRows,
      billing: billing && {
        name: billing.name, address: billing.address, trn: billing.trn, last_project: billing.last_project,
        last_proforma_no: billing.last_proforma_no ?? "", doc_defaults: billing.doc_defaults ?? {},
      },
      entryClient, defaultScope: desc, nextNo: nextInvoiceNo,
    });
  }

  // (Re)build every document whenever the chosen work-entry client changes.
  useEffect(() => {
    if (!loaded) return;
    const built = buildInvoice(clientRows, entryClient, billing);
    if (scope?.invoicePeriod) built.period = scope.invoicePeriod;
    setInv(built);
    const key = pickCountField(clientRows);
    setCountKey(key);
    setProforma(makeProforma(key));
    setSummary(null);
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
  const setP = <K extends keyof ProformaDoc>(k: K, v: ProformaDoc[K]) => {
    setProforma((d) => (d ? { ...d, [k]: v } : d));
    setDirty(true);
  };
  const setS = <K extends keyof SummaryDoc>(k: K, v: SummaryDoc[K]) => {
    setSummary((d) => (d ? { ...d, [k]: v } : d));
    setDirty(true);
  };

  function switchType(next: DocType) {
    // The summary is built from the proforma the first time it's opened, so
    // it carries the same client, project, scope and sub total.
    if (next === "summary" && !summary && proforma) {
      setSummary(buildSummary(proforma, {
        billing: billing && { last_invoice_no: billing.last_invoice_no, doc_defaults: billing.doc_defaults ?? {} },
        nextNo: nextInvoiceNo,
      }));
    }
    setDocType(next);
  }

  function changeCountField(key: string) {
    if (dirty && !confirm("Changing the quantity source rebuilds the proforma rows and drops your edits there. Continue?")) return;
    setCountKey(key);
    setProforma(makeProforma(key));
  }

  function pickClient(c: BillingClient) {
    if (docType === "proforma") {
      setProforma((d) => d && {
        ...d, clientName: c.name, clientAddress: c.address, clientTrn: c.trn,
        invoiceNo: d.invoiceNo.trim() ? d.invoiceNo : nextInvoiceNo(c.last_proforma_no ?? ""),
        project: d.project.trim() ? d.project : c.last_project,
      });
      setDirty(true);
      return;
    }
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
    const name = docType === "standard" ? inv?.clientName : docType === "proforma" ? proforma?.clientName : summary?.toName;
    if (!name?.trim()) return flash("Add the client name before downloading", "error");
    setBusy(true);
    try {
      const [logo, stamp] = await Promise.all([toDataUrl(logoUrl), toDataUrl(stampUrl)]);
      if (docType === "standard" && inv) {
        const { renderInvoicePdf } = await import("../lib/invoicePdf");
        renderInvoicePdf(inv, { logo, stamp }).save(`${fileName("Invoice", inv.invoiceNo, inv.clientName, inv.invoiceDate)}.pdf`);
      } else if (docType === "proforma" && proforma) {
        const { renderProformaPdf } = await import("../lib/progressPdf");
        renderProformaPdf(proforma, { logo, stamp }).save(`${fileName("Proforma", proforma.invoiceNo, proforma.clientName, proforma.invoiceDate)}.pdf`);
      } else if (docType === "summary" && summary) {
        const { renderSummaryPdf } = await import("../lib/progressPdf");
        renderSummaryPdf(summary, { logo, stamp }).save(`${fileName("TaxInvoice", summary.invoiceNo, summary.toName, summary.invoiceDate)}.pdf`);
      }
    } catch (e: any) {
      setBusy(false);
      return flash(`Couldn't create the PDF: ${e?.message ?? e}`, "error");
    }
    try {
      if (docType === "standard" && inv) {
        await rememberClient({
          name: inv.clientName, address: inv.clientAddress, trn: inv.clientTrn,
          invoiceNo: inv.invoiceNo, project: inv.project,
        }, entryClient, clients);
      } else if (docType === "proforma" && proforma) {
        await rememberClient({
          name: proforma.clientName, address: proforma.clientAddress, trn: proforma.clientTrn,
          proformaNo: proforma.invoiceNo, project: proforma.project,
          docDefaults: { scope: proforma.scope, retention: proforma.retentionRate },
        }, entryClient, clients);
        const items = proforma.rows
          .filter((r) => normLabel(r.section) && normLabel(r.item))
          .map((r) => ({
            client_label: clientKey(entryClient), section: normLabel(r.section), item: normLabel(r.item),
            uom: r.uom.trim(), contract_qty: parseNum(r.contractQty), rate: parseNum(r.rate),
          }));
        if (items.length) {
          const { error } = await supabase.from(ITEMS).upsert(items, { onConflict: "client_label,section,item" });
          if (error) throw error;
        }
      } else if (docType === "summary" && summary) {
        await rememberClient({
          name: summary.toName, invoiceNo: summary.invoiceNo,
          docDefaults: { subject: summary.subject, reference: summary.reference, retention: summary.retentionRate },
        }, entryClient, clients);
      }
      flash(docType === "proforma" ? "Proforma downloaded" : "Invoice downloaded", "success");
    } catch {
      flash("Downloaded, but the details for next time couldn't be saved", "error");
    }
    setBusy(false);
    setDirty(false);
  }

  const t = inv ? totals(inv) : null;
  const cell = "border border-black px-2 py-1.5 align-middle";
  const countLabel = (key: string) => COUNT_FIELDS.find((f) => f.key === key)?.label ?? "—";

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-stretch justify-center p-3 md:p-6" onClick={requestClose}>
      <div className="w-full max-w-[920px] bg-slate-100 rounded-2xl shadow-2xl flex flex-col min-h-0" onClick={(e) => e.stopPropagation()}>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-slate-200 bg-white rounded-t-2xl">
          <div className="min-w-0">
            <div className="font-bold text-brand-ink">Invoice preview</div>
            <div className="text-xs text-slate-500">Click any text or number to edit. Empty optional rows are left off the PDF.</div>
            <div className="text-xs font-semibold text-brand-blueDark mt-0.5" title="The entries in your current Finalized list for this client">
              Based on: {basis}
            </div>
          </div>
          {entryClients.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              For
              <select value={entryClient}
                onChange={(e) => {
                  if (dirty && !confirm("Switching client rebuilds the invoice and drops your edits. Continue?")) return;
                  setLoaded(false);
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
          {/* Document type + (proforma) quantity source */}
          <div className="w-full flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="Document type">
              {DOC_TYPES.map((d) => (
                <button key={d.key} type="button" role="tab" aria-selected={docType === d.key} title={d.hint}
                  onClick={() => switchType(d.key)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full transition ${
                    docType === d.key ? "bg-brand-ink text-white shadow-sm" : "text-slate-600 hover:text-brand-ink"}`}>
                  {d.label}
                </button>
              ))}
            </div>
            {docType === "proforma" && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Quantity from
                <select value={countKey} onChange={(e) => changeCountField(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1 text-sm">
                  {!countOptions.some((f) => f.key === countKey) && <option value={countKey}>{countLabel(countKey)}</option>}
                  {countOptions.map((f) => <option key={f.key as string} value={f.key as string}>{f.label}</option>)}
                </select>
              </label>
            )}
            {docType === "proforma" && (
              <span className="text-[11px] text-slate-500">
                Previous = earlier entries {periodStart ? `before ${periodStart.split("-").reverse().join("/")}` : "(none — no period start)"} · amber boxes need the contract qty (remembered)
              </span>
            )}
            {docType === "summary" && proforma && (
              <span className="text-[11px] text-slate-500">
                Raise after the proforma is approved — type the approved amount in “Total Amount of Work Done”.
              </span>
            )}
          </div>
        </div>

        {/* A4 sheet */}
        <div className="flex-1 overflow-auto p-4 md:p-6">
          {!inv || !t ? (
            <div className="text-center text-slate-500 py-20">Preparing invoice…</div>
          ) : docType === "proforma" && proforma ? (
            <ProformaSheet doc={proforma} set={setP} clients={clients} onPickClient={pickClient} logoUrl={logoUrl} stampUrl={stampUrl} />
          ) : docType === "summary" && summary ? (
            <SummarySheet doc={summary} set={setS} logoUrl={logoUrl} stampUrl={stampUrl}
              proformaSubtotal={proforma ? proformaTotals(proforma).subtotal : null} />
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
                  <div className="flex items-baseline gap-1"><span className="shrink-0">PERIOD:</span>
                    <Field value={inv.period} onChange={(v) => set("period", v)} placeholder="optional" /></div>
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
