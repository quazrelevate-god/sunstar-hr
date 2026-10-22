import { POINT_FIELDS } from "./supabase";
import type { WorkEntry } from "./supabase";

/* Everything on the invoice is a string so the admin can type freely in the
 * preview; numbers are parsed only when computing totals or the PDF. */
export type InvoiceLine = {
  id: string;
  desc: string;
  qty: string;
  unit: string;
  rate: string;
  amount: string;
};

export type InvoiceDoc = {
  companyName: string;
  companyAddress: string;
  companyContact: string;
  title: string;
  clientName: string;
  clientAddress: string;
  clientTrn: string;
  fromName: string;
  invoiceNo: string;
  invoiceDate: string;
  ourTrn: string;
  project: string;
  jobNo: string;
  lpoRef: string;
  lines: InvoiceLine[];
  vatRate: string;
  bankLines: string;
  regardsLines: string;
};

export type BillingClient = {
  id: string;
  name: string;
  address: string;
  trn: string;
  entry_clients: string[];
  last_invoice_no: string;
  last_project: string;
};

export const COMPANY_DEFAULTS = {
  companyName: "SUNSTAR TECHNICAL SERVICES L.L.C.",
  companyAddress: "P.O.Box No. 31628, Deira, Dubai, United Arab Emirates.",
  companyContact: "License Nr. 668259.  Tel. No. 04/297 8244.  Fax. No. 04/297 8244.",
  fromName: "SUNSTAR TECHNICAL SERVICE LLC",
  ourTrn: "100064452400003",
  bankLines: [
    "SUNSTAR TECHNICAL SERVICES LLC",
    "ACCOUNT NO: 03 3202 8838 001",
    "IBAN NO: AE 850400 0003 3202 8838 001",
    "RAK BANK",
    "SWIFT: NRAKAEAK",
  ].join("\n"),
  regardsLines: [
    "THANKS AND REGARDS,",
    "SUNSTAR TECHNICAL SERVICE LLC",
    "KARMEGAM.K",
    "MOBILE NO: 056-9517007",
  ].join("\n"),
};

let seq = 0;
export const newLineId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;
export const blankLine = (): InvoiceLine => ({ id: newLineId(), desc: "", qty: "", unit: "", rate: "", amount: "" });

/** Parse "1,234.50" → 1234.5; anything non-numeric → null. */
export function parseNum(s: string): number | null {
  const t = s.replace(/,/g, "").trim();
  if (!t || !/^-?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Format a typed quantity for display: numbers get grouping, text stays as typed. */
export function fmtQty(s: string): string {
  const n = parseNum(s);
  return n == null ? s : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function totals(doc: InvoiceDoc) {
  const subtotal = round2(doc.lines.reduce((s, l) => s + (parseNum(l.amount) ?? 0), 0));
  const rate = parseNum(doc.vatRate) ?? 0;
  const vat = round2((subtotal * rate) / 100);
  return { subtotal, rate, vat, grand: round2(subtotal + vat) };
}

/** Apply an edit to one line. Changing qty or rate re-derives the amount when
 *  both are numbers; editing the amount directly keeps what was typed. */
export function editLine(line: InvoiceLine, field: keyof Omit<InvoiceLine, "id">, value: string): InvoiceLine {
  const next = { ...line, [field]: value };
  if (field === "qty" || field === "rate") {
    const q = parseNum(next.qty), r = parseNum(next.rate);
    if (q != null && r != null) next.amount = round2(q * r).toFixed(2);
  }
  return next;
}

/** "INV/SAMEP-07/26/04" → "INV/SAMEP-07/26/05"; keeps zero padding. */
export function nextInvoiceNo(last: string): string {
  const m = last.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return "";
  const [, pre, digits, post] = m;
  return pre + (BigInt(digits) + BigInt(1)).toString().padStart(digits.length, "0") + post;
}

/** Today's Dubai date as dd/mm/yyyy (the format on the client's invoices). */
export function todayDubaiDMY(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai", day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")}`;
}

/* ------------------------------------------------------------------ lines */

// Units the admin can overwrite in the preview; only these are known to be metres.
const METRE_KEYS = new Set(["gi_conduiting", "led_strip_light_meter"]);
const INVOICE_LABEL: Record<string, string> = { final_fix_switch: "Wiring accessories" };

const isSupply = (r: WorkEntry) => /supply/i.test(`${r.villa ?? ""} ${r.description ?? ""}`);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const qtyOf = (r: WorkEntry, key: string) => Number((r as any)[key] ?? 0) || 0;

/**
 * Build invoice lines from finalized entries — material quantities and
 * amounts only, no dates or days worked:
 *  - one material on the entry      → line per (description, material), rate = amount ÷ qty
 *  - several materials on the entry → one line per description listing every quantity
 *  - manpower supply                → line per description, qty = hours, unit HRS
 *  - no material recorded           → line per description, 1 LS
 */
export function buildLines(rows: WorkEntry[]): InvoiceLine[] {
  type Group = { desc: string; kind: "single" | "multi" | "supply" | "ls"; unit: string;
                 qty: number; amount: number; mats: Map<string, number> };
  const groups = new Map<string, Group>();
  const labelOf = (key: string) => INVOICE_LABEL[key] ?? POINT_FIELDS.find((p) => p.key === key)?.label ?? key;

  for (const r of rows) {
    const desc = (r.description ?? "").toString().trim() || "Work";
    const amount = Number(r.total_price ?? 0) || 0;
    const mats = POINT_FIELDS.map((p) => p.key as string).filter((k) => qtyOf(r, k) !== 0);

    let key: string, init: () => Group;
    if (isSupply(r) && mats.length === 0) {
      key = `sup::${desc}`;
      init = () => ({ desc, kind: "supply", unit: "HRS", qty: 0, amount: 0, mats: new Map() });
    } else if (mats.length === 1) {
      const m = mats[0];
      const label = labelOf(m);
      const lineDesc = norm(desc).includes(norm(label)) ? desc : `${desc} — ${label}`;
      key = `one::${desc}::${m}`;
      init = () => ({ desc: lineDesc, kind: "single", unit: METRE_KEYS.has(m) ? "M" : "NOS", qty: 0, amount: 0, mats: new Map() });
    } else if (mats.length > 1) {
      key = `multi::${desc}`;
      init = () => ({ desc, kind: "multi", unit: "", qty: 0, amount: 0, mats: new Map() });
    } else {
      key = `ls::${desc}`;
      init = () => ({ desc, kind: "ls", unit: "LS", qty: 1, amount: 0, mats: new Map() });
    }

    const g = groups.get(key) ?? init();
    g.amount += amount;
    if (g.kind === "supply") g.qty += Number(r.hours ?? 0) || 0;
    if (g.kind === "single") g.qty += qtyOf(r, mats[0]);
    if (g.kind === "multi") for (const m of mats) g.mats.set(m, (g.mats.get(m) ?? 0) + qtyOf(r, m));
    groups.set(key, g);
  }

  return [...groups.values()].map((g) => {
    const amount = round2(g.amount);
    if (g.kind === "multi") {
      const qty = [...g.mats.entries()]
        .map(([k, v]) => `${labelOf(k)}: ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`)
        .join(" · ");
      return { id: newLineId(), desc: g.desc, qty, unit: "", rate: "", amount: amount.toFixed(2) };
    }
    const qty = round2(g.qty);
    // qty 0 (e.g. supply rows without hours): leave qty and rate blank for the
    // admin to fill — printing rate=amount next to qty 0 reads as a math error
    // on a tax invoice.
    return {
      id: newLineId(), desc: g.desc,
      qty: qty > 0 ? String(qty) : "", unit: g.unit,
      rate: qty > 0 ? round2(amount / qty).toFixed(2) : "",
      amount: amount.toFixed(2),
    };
  });
}

/** Billing client previously used for this work-entry client label, if any. */
export function matchBillingClient(entryClient: string, clients: BillingClient[]): BillingClient | undefined {
  const k = entryClient.trim().toLowerCase();
  return clients.find((c) => c.entry_clients.some((e) => e.trim().toLowerCase() === k));
}

export function buildInvoice(rows: WorkEntry[], entryClient: string, billing?: BillingClient): InvoiceDoc {
  return {
    ...COMPANY_DEFAULTS,
    title: "TAX INVOICE",
    clientName: billing?.name ?? entryClient,
    clientAddress: billing?.address ?? "",
    clientTrn: billing?.trn ?? "",
    invoiceNo: billing ? nextInvoiceNo(billing.last_invoice_no) : "",
    invoiceDate: todayDubaiDMY(),
    project: billing?.last_project ?? "",
    jobNo: "",
    lpoRef: "",
    lines: buildLines(rows),
    vatRate: "5",
  };
}
