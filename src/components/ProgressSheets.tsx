import { Fragment } from "react";
import { fmtMoney, parseNum } from "../lib/invoice";
import type { BillingClient } from "../lib/invoice";
import type { ProformaDoc, ProgressRow, SummaryDoc } from "../lib/progress";
import {
  rowCalc, proformaTotals, summaryTotals, amountInWords, fmtPct, fmtQtyNum, newProgressRow,
} from "../lib/progress";
import { EDIT, Field, MoneyField, Area, ClientNameField } from "./invoiceFields";

/* Editable A4 previews for the two China Railway–style documents. They
 * mirror the PDFs in lib/progressPdf.ts; every text and number can be typed
 * over before downloading. */

const dash = (n: number) => (n ? fmtMoney(n) : "-");
const letter = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : "");

/* ================================================================ PROFORMA */

export function ProformaSheet({ doc, set, clients, onPickClient, logoUrl, stampUrl }: {
  doc: ProformaDoc;
  set: <K extends keyof ProformaDoc>(k: K, v: ProformaDoc[K]) => void;
  clients: BillingClient[];
  onPickClient: (c: BillingClient) => void;
  logoUrl: string;
  stampUrl: string;
}) {
  const t = proformaTotals(doc);
  const setRow = (id: string, field: keyof Omit<ProgressRow, "id">, v: string) =>
    set("rows", doc.rows.map((r) => (r.id === id ? { ...r, [field]: v } : r)));
  const cell = "border border-black px-1 py-1 align-middle";
  const num = `${EDIT} text-right !px-0.5`;

  // Sections in order, with each row's number inside its section.
  let section = "", sIdx = -1, n = 0;
  const lines = doc.rows.map((r) => {
    const first = r.section !== section;
    if (first) { section = r.section; sIdx++; n = 0; }
    n++;
    return { r, first, sIdx, n };
  });

  return (
    <div className="mx-auto bg-white shadow-lg w-[794px] max-w-full p-[30px] text-black text-[11px]" style={{ fontFamily: "Helvetica, Arial, sans-serif" }}>
      <SheetHeader doc={doc} set={set} logoUrl={logoUrl} />

      {/* TO | TITLE | FROM */}
      <div className="grid grid-cols-[64fr_54fr_64fr] border-x border-b border-black bg-[#E4DFEC] font-bold">
        <div className="p-2 border-r border-black space-y-0.5">
          <div>TO:</div>
          <ClientNameField value={doc.clientName} onChange={(v) => set("clientName", v)} clients={clients} onPick={onPickClient} />
          <Area value={doc.clientAddress} onChange={(v) => set("clientAddress", v)} placeholder="Address" />
          <div className="flex items-baseline gap-1"><span>TRN:</span>
            <Field value={doc.clientTrn} onChange={(v) => set("clientTrn", v)} placeholder="Client TRN" /></div>
        </div>
        <div className="p-2 border-r border-black flex items-center">
          <Area value={doc.title} onChange={(v) => set("title", v)} className="text-center text-[15px]" />
        </div>
        <div className="p-2 space-y-0.5">
          <Field value={doc.fromName} onChange={(v) => set("fromName", v)} />
          <div className="flex items-baseline gap-1"><span className="shrink-0">INVOICE NO:</span>
            <Field value={doc.invoiceNo} onChange={(v) => set("invoiceNo", v)} placeholder="e.g. 001" /></div>
          <div className="flex items-baseline gap-1"><span className="shrink-0">INVOICE DATE:</span>
            <Field value={doc.invoiceDate} onChange={(v) => set("invoiceDate", v)} /></div>
          <div className="flex items-baseline gap-1"><span>TRN:</span>
            <Field value={doc.ourTrn} onChange={(v) => set("ourTrn", v)} /></div>
        </div>
      </div>

      <div className="flex items-baseline gap-1 border-x border-b border-black px-2 py-1 font-bold">
        <span className="shrink-0">PROJECT:</span>
        <Field value={doc.project} onChange={(v) => set("project", v)} placeholder="Project name" />
      </div>
      <div className="flex items-baseline gap-1 border-x border-b border-black px-2 py-1 text-[10px] text-slate-600 bg-amber-50/60">
        <span className="shrink-0 font-bold">Scope after each tower:</span>
        <Field value={doc.scope} onChange={(v) => set("scope", v)} placeholder="e.g. Final Fixing of Electrical Wiring Accessories" />
      </div>

      <table className="w-full border-collapse text-[10px]">
        <thead className="bg-[#D9D9D9] font-bold text-center">
          <tr>
            <th rowSpan={2} className={`${cell} w-[26px]`}>Sl No</th>
            <th rowSpan={2} className={cell}>Description</th>
            <th rowSpan={2} className={`${cell} w-[30px]`}>UOM</th>
            <th rowSpan={2} className={`${cell} w-[36px]`}>Qty</th>
            <th rowSpan={2} className={`${cell} w-[34px]`}>Rate</th>
            <th rowSpan={2} className={`${cell} w-[56px]`}>Amount</th>
            <th colSpan={3} className={cell}>QUANTITY</th>
            <th colSpan={3} className={cell}>QUANTITY %</th>
            <th colSpan={3} className={cell}>AMOUNT</th>
          </tr>
          <tr className="text-[9px]">
            {["Prev.", "Present", "Cumul.", "Prev.", "Present", "Cumul.", "Prev.", "Present", "Cumul."].map((h, i) => (
              <th key={i} className={cell}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map(({ r, first, sIdx: si, n: num_ }) => {
            const c = rowCalc(r);
            return (
              <Fragment key={r.id}>
              {first && (
                <tr>
                  <td className={`${cell} text-center font-bold`}>{letter(si)}</td>
                  <td className={`${cell} font-bold bg-[#FFF2CC]`}>
                    {[r.section, doc.scope.trim()].filter(Boolean).join(" - ")}
                  </td>
                  <td colSpan={13} className={cell} />
                </tr>
              )}
              <tr className="group">
                <td className={`${cell} text-center relative`}>
                  <span className="group-hover:invisible">{num_}</span>
                  <button type="button" title="Remove row"
                    onClick={() => set("rows", doc.rows.filter((x) => x.id !== r.id))}
                    className="absolute inset-0 hidden group-hover:flex items-center justify-center text-red-600 font-bold text-base">×</button>
                </td>
                <td className={cell}><Field value={r.item} onChange={(v) => setRow(r.id, "item", v)} /></td>
                <td className={cell}><Field value={r.uom} onChange={(v) => setRow(r.id, "uom", v)} className="text-center" /></td>
                <td className={cell}>
                  <input value={r.contractQty} onChange={(e) => setRow(r.id, "contractQty", e.target.value)} inputMode="decimal"
                    placeholder="?" title="Contract quantity for this level — remembered for next time"
                    className={`${num} ${r.contractQty.trim() ? "" : "bg-amber-100"}`} />
                </td>
                <td className={cell}><input value={r.rate} onChange={(e) => setRow(r.id, "rate", e.target.value)} inputMode="decimal" className={num} /></td>
                <td className={`${cell} text-right`}>{c.contractAmt != null ? fmtMoney(c.contractAmt) : "-"}</td>
                <td className={cell}><input value={r.prevQty} onChange={(e) => setRow(r.id, "prevQty", e.target.value)} inputMode="decimal" className={num} /></td>
                <td className={cell}><input value={r.presentQty} onChange={(e) => setRow(r.id, "presentQty", e.target.value)} inputMode="decimal" className={`${num} font-bold`} /></td>
                <td className={`${cell} text-right`}>{fmtQtyNum(c.cumQty)}</td>
                <td className={`${cell} text-right`}>{fmtPct(c.prevPct)}</td>
                <td className={`${cell} text-right`}>{fmtPct(c.presPct)}</td>
                <td className={`${cell} text-right`}>{fmtPct(c.cumPct)}</td>
                <td className={`${cell} text-right`}>{dash(c.prevAmt)}</td>
                <td className={`${cell} text-right font-bold`}>{dash(c.presAmt)}</td>
                <td className={`${cell} text-right`}>{dash(c.cumAmt)}</td>
              </tr>
              </Fragment>
            );
          })}
        </tbody>
        <tfoot className="bg-[#F2F2F2] font-bold text-right text-[11px]">
          <tr><td colSpan={14} className={cell}>SUB TOTAL</td><td className={cell}>{fmtMoney(t.subtotal)}</td></tr>
          <tr>
            <td colSpan={14} className={cell}>
              <span className="inline-flex items-baseline justify-end gap-1">RETENTION (
                <input value={doc.retentionRate} onChange={(e) => set("retentionRate", e.target.value)} inputMode="decimal"
                  className={`${EDIT} !w-9 text-center !mx-0`} />%)</span>
            </td>
            <td className={cell}>{fmtMoney(t.retention)}</td>
          </tr>
          <tr><td colSpan={14} className={cell}>TOTAL</td><td className={cell}>{fmtMoney(t.total)}</td></tr>
          <tr>
            <td colSpan={14} className={cell}>
              <span className="inline-flex items-baseline justify-end gap-1">VAT (
                <input value={doc.vatRate} onChange={(e) => set("vatRate", e.target.value)} inputMode="decimal"
                  className={`${EDIT} !w-9 text-center !mx-0`} />%)</span>
            </td>
            <td className={cell}>{fmtMoney(t.vat)}</td>
          </tr>
          <tr className="text-[13px]"><td colSpan={14} className={cell}>GRAND TOTAL</td><td className={cell}>{fmtMoney(t.grand)}</td></tr>
        </tfoot>
      </table>
      <button type="button"
        onClick={() => {
          const last = doc.rows[doc.rows.length - 1];
          set("rows", [...doc.rows, { ...newProgressRow(last?.section ?? "", ""), rate: last?.rate ?? "" }]);
        }}
        className="mt-1 mb-2 w-full border border-dashed border-sky-400 text-sky-700 rounded-md py-1 text-xs font-semibold hover:bg-sky-50">
        + Add row
      </button>

      <AccountAndRegards bankLines={doc.bankLines} regardsLines={doc.regardsLines}
        onBank={(v) => set("bankLines", v)} onRegards={(v) => set("regardsLines", v)} stampUrl={stampUrl} />
    </div>
  );
}

function SheetHeader({ doc, set, logoUrl }: {
  doc: ProformaDoc;
  set: <K extends keyof ProformaDoc>(k: K, v: ProformaDoc[K]) => void;
  logoUrl: string;
}) {
  return (
    <div className="border border-black flex items-center gap-4 px-3 py-3">
      <img src={logoUrl} alt="" className="w-[166px] shrink-0" />
      <div className="flex-1 text-center text-[#7030A0] italic">
        <Field value={doc.companyName} onChange={(v) => set("companyName", v)} className="text-center text-[21px] font-bold" />
        <Field value={doc.companyAddress} onChange={(v) => set("companyAddress", v)} className="text-center text-[13px]" />
        <Field value={doc.companyContact} onChange={(v) => set("companyContact", v)} className="text-center text-[11px]" />
      </div>
    </div>
  );
}

function AccountAndRegards({ bankLines, regardsLines, onBank, onRegards, stampUrl }: {
  bankLines: string; regardsLines: string; onBank: (v: string) => void; onRegards: (v: string) => void; stampUrl: string;
}) {
  return (
    <>
      <div className="border border-black bg-[#D9D9D9] px-2 py-1 font-bold">ACCOUNT DETAILS</div>
      <div className="border-x border-b border-black grid grid-cols-2 items-center min-h-[136px]">
        <div className="p-2 font-bold"><Area value={bankLines} onChange={onBank} className="leading-[1.65]" /></div>
        <div className="p-2"><img src={stampUrl} alt="Company stamp" className="w-[196px]" /></div>
      </div>
      <div className="border-x border-b border-black p-2 font-bold">
        <Area value={regardsLines} onChange={onRegards} className="leading-[1.65]" />
      </div>
    </>
  );
}

/* ======================================================= SUMMARY TAX INVOICE */

export function SummarySheet({ doc, set, proformaSubtotal, logoUrl, stampUrl }: {
  doc: SummaryDoc;
  set: <K extends keyof SummaryDoc>(k: K, v: SummaryDoc[K]) => void;
  /** Shown as a hint so the admin can see what was proposed vs approved. */
  proformaSubtotal: number | null;
  logoUrl: string;
  stampUrl: string;
}) {
  const t = summaryTotals(doc);
  const row = "border border-black px-2 py-1";
  const work = parseNum(doc.workDone);
  return (
    <div className="mx-auto bg-white shadow-lg w-[794px] max-w-full px-[56px] pt-[30px] pb-[20px] text-black text-[13px] flex flex-col min-h-[1060px]" style={{ fontFamily: "Helvetica, Arial, sans-serif" }}>
      <div className="flex items-center justify-between border-b-2 border-black pb-3 -mx-[56px] px-[40px]">
        <img src={logoUrl} alt="" className="w-[180px]" />
        <div className="text-[25px] text-[#1F4E9C] tracking-wide">SUNSTAR TECHNICAL SERVICES L.L.C</div>
      </div>

      <div className="text-center font-bold underline mt-6 mb-5">
        <Field value={doc.title} onChange={(v) => set("title", v)} className="text-center font-bold underline" />
      </div>
      <div className="flex justify-between font-bold gap-6">
        <div className="flex items-baseline gap-1 flex-1"><span className="shrink-0">INVOICE NO:</span>
          <Field value={doc.invoiceNo} onChange={(v) => set("invoiceNo", v)} placeholder="e.g. CR/10/26/001" /></div>
        <div className="flex items-baseline gap-1 w-[170px]"><span className="shrink-0">Date:</span>
          <Field value={doc.invoiceDate} onChange={(v) => set("invoiceDate", v)} /></div>
      </div>
      <div className="flex justify-between font-bold gap-6 mt-3">
        <Field value={doc.reference} onChange={(v) => set("reference", v)} placeholder="Reference (optional), e.g. SCA.Ref.7-LW-2026-PL-7-199" className="flex-1" />
        <Field value={doc.pcNo} onChange={(v) => set("pcNo", v)} placeholder="PC:01 (optional)" className="!w-[140px]" />
      </div>

      <div className="mt-4 font-bold">From,</div>
      <Area value={doc.fromLines} onChange={(v) => set("fromLines", v)} className="leading-[1.75] first-line:font-bold" />
      <div className="mt-1 font-bold">To</div>
      <Area value={doc.toName} onChange={(v) => set("toName", v)} placeholder="Client name" className="font-bold" />
      <Area value={doc.toLines} onChange={(v) => set("toLines", v)} placeholder="TRN, P.O. Box, city" className="leading-[1.75]" />

      <div className="flex items-baseline gap-1 mt-2"><span className="font-bold shrink-0">Subject:</span>
        <Area value={doc.subject} onChange={(v) => set("subject", v)} placeholder="Subject" /></div>
      <div className="flex items-baseline gap-1 mt-1 text-[12px]"><span className="font-bold shrink-0">PROJECT:</span>
        <Area value={doc.project} onChange={(v) => set("project", v)} placeholder="Project" /></div>

      <table className="w-full border-collapse mt-4 text-[13px]">
        <thead><tr className="bg-[#EBEBEB] font-bold text-center"><th className={row}>Works Done Details</th><th className={`${row} w-[150px]`}>AMOUNT</th></tr></thead>
        <tbody>
          <tr>
            <td className={row}>Total Amount of Work Done:</td>
            <td className={`${row} text-right`}><MoneyField value={doc.workDone} onChange={(v) => set("workDone", v)} className="text-right font-semibold" /></td>
          </tr>
          <tr>
            <td className={row}>
              <span className="inline-flex items-baseline gap-1">Less Retention
                <input value={doc.retentionRate} onChange={(e) => set("retentionRate", e.target.value)} inputMode="decimal"
                  className={`${EDIT} !w-9 text-center !mx-0`} />%:</span>
            </td>
            <td className={`${row} text-right`}>{fmtMoney(t.retention)}</td>
          </tr>
          <tr><td className={row}>Net Payable Amount Before VAT:</td><td className={`${row} text-right`}>{fmtMoney(t.net)}</td></tr>
          <tr>
            <td className={row}>
              <span className="inline-flex items-baseline gap-1">VAT
                <input value={doc.vatRate} onChange={(e) => set("vatRate", e.target.value)} inputMode="decimal"
                  className={`${EDIT} !w-9 text-center !mx-0`} />%:</span>
            </td>
            <td className={`${row} text-right`}>{fmtMoney(t.vat)}</td>
          </tr>
          <tr><td className={row}>Net Payable Amount Due:</td><td className={`${row} text-right font-semibold`}>{fmtMoney(t.due)}</td></tr>
          <tr><td colSpan={2} className={`${row} text-[15px] text-justify`}>UAE Dirham: {amountInWords(t.due)}</td></tr>
        </tbody>
      </table>
      {proformaSubtotal != null && work != null && Math.abs(work - proformaSubtotal) > 0.004 && (
        <div className="text-[11px] text-amber-700 mt-1">
          Proforma sub total was AED {fmtMoney(proformaSubtotal)}; this invoice uses the approved amount above.
        </div>
      )}

      <div className="mt-8 flex items-end gap-10">
        <div className="leading-[1.5]">
          <div>Thanks &amp; Regards</div>
          <Field value={doc.regardsName} onChange={(v) => set("regardsName", v)} className="font-bold" />
          <Area value={doc.regardsLines} onChange={(v) => set("regardsLines", v)} className="leading-[1.5]" />
        </div>
        <img src={stampUrl} alt="Company stamp" className="w-[170px]" />
      </div>

      <div className="mt-auto -mx-[56px] border-t-2 border-black pt-2 text-center font-bold text-[14px]">
        <Area value={doc.footerLines} onChange={(v) => set("footerLines", v)} className="text-center font-bold leading-[1.5]" />
      </div>
    </div>
  );
}
