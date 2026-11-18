import { COUNT_FIELDS } from "./supabase";
import type { WorkEntry } from "./supabase";
import { COMPANY_DEFAULTS, parseNum, round2, todayDubaiDMY } from "./invoice";

/*
 * Progress invoicing, modelled on the China Railway documents:
 *  1. PROFORMA INVOICE: one block per tower, one row per level, with the
 *     contract quantity × rate and quantity / % / amount as
 *     Previous · Present · Cumulative. Submitted first for approval.
 *  2. TAX INVOICE (summary): one page. Total amount of work done, less
 *     retention, VAT, net payable, amount in words. Raised after approval
 *     (the approved amount can differ from the proforma).
 * Like the standard invoice, every field is a string so the admin can type
 * freely; numbers are parsed only for totals and the PDF.
 */

export type ProgressRow = {
  id: string;
  section: string;     // tower, e.g. "TOWER 1A"
  item: string;        // level, e.g. "LEVEL 9"
  uom: string;
  contractQty: string;
  rate: string;
  prevQty: string;
  presentQty: string;
};

export type ProformaDoc = {
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
  /** Appended to each tower in its section row: "TOWER 1A - <scope>". */
  scope: string;
  rows: ProgressRow[];
  retentionRate: string;
  vatRate: string;
  bankLines: string;
  regardsLines: string;
};

export type SummaryDoc = {
  title: string;
  invoiceNo: string;
  invoiceDate: string;
  reference: string;   // e.g. "SCA.Ref.7-LW-2026-PL-7-199"
  pcNo: string;        // payment certificate, e.g. "PC:01"
  fromLines: string;
  toName: string;
  toLines: string;
  subject: string;
  project: string;
  workDone: string;
  retentionRate: string;
  vatRate: string;
  regardsName: string;
  regardsLines: string;
  footerLines: string;
};

/** Remembered per billing client (sunstar_invoice_clients.doc_defaults). */
export type DocDefaults = { scope?: string; subject?: string; reference?: string; retention?: string };

/** Remembered per tower/level (sunstar_progress_items). */
export type SavedItem = { section: string; item: string; uom: string; contract_qty: number | null; rate: number | null };

let seq = 0;
const newId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Same client label however it was typed: trimmed, single spaces, lower case. */
export const clientKey = (s: string | null | undefined) =>
  (s ?? "").toString().trim().replace(/\s+/g, " ").toLowerCase();

/** Tower / level labels as typed by workers vary ("LEVEL-7", "LEVEL -7",
 *  "TOWER 1 B"). Normalise so the same place always lands on one row. */
export function normLabel(s: string | null | undefined): string {
  return (s ?? "").toString().toUpperCase()
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/(\d) ([A-Z])\b/g, "$1$2")
    .trim();
}

export const isChinaRailway = (client: string) => /china\s*railway/i.test(client);

const qtyIn = (r: WorkEntry, key: string) => Number((r as any)[key] ?? 0) || 0;
const dateOf = (r: WorkEntry) => (r.end_date || r.start_date || "").toString().slice(0, 10);

/** The count box these entries are measured in: the one filled most often. */
export function pickCountField(rows: WorkEntry[]): string {
  let best = "", bestN = 0;
  for (const f of COUNT_FIELDS) {
    const n = rows.filter((r) => qtyIn(r, f.key as string) !== 0).length;
    if (n > bestN) { best = f.key as string; bestN = n; }
  }
  return best;
}

/** Count boxes used by any of these entries (for the "Quantity from" picker). */
export const usedCountFields = (rows: WorkEntry[]) =>
  COUNT_FIELDS.filter((f) => rows.some((r) => qtyIn(r, f.key as string) !== 0));

/** Most common price per unit across the entries (e.g. AED 10 per NO). */
export function typicalRate(rows: WorkEntry[], countKey: string): number | null {
  const tally = new Map<number, number>();
  for (const r of rows) {
    const q = qtyIn(r, countKey), p = Number(r.total_price ?? 0) || 0;
    if (q > 0 && p > 0) {
      const rate = round2(p / q);
      tally.set(rate, (tally.get(rate) ?? 0) + 1);
    }
  }
  let best: number | null = null, bestN = 0;
  for (const [rate, n] of tally) if (n > bestN) { best = rate; bestN = n; }
  return best;
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(round2(n)));
const byNatural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * One row per tower/level found in the listed entries (nothing outside the
 * list is added). Present = quantities in the list; Previous = the same
 * client's earlier finalized entries for that tower/level, dated before the
 * period start. Contract qty / rate / unit come from what was saved last time.
 */
export function buildProgressRows(opts: {
  rows: WorkEntry[];
  history: WorkEntry[];
  client: string;
  periodStart: string | null;
  countKey: string;
  saved: SavedItem[];
  defaultRate: number | null;
}): ProgressRow[] {
  const { rows, history, client, periodStart, countKey, saved, defaultRate } = opts;
  const key = (r: WorkEntry) => `${normLabel(r.cluster) || "—"}|${normLabel(r.villa) || "—"}`;

  const present = new Map<string, number>();
  for (const r of rows) present.set(key(r), (present.get(key(r)) ?? 0) + qtyIn(r, countKey));

  const prev = new Map<string, number>();
  if (periodStart) {
    const ck = clientKey(client);
    const listed = new Set(rows.map((r) => r.id));
    for (const r of history) {
      if (listed.has(r.id) || clientKey(r.client) !== ck) continue;
      const d = dateOf(r);
      if (!d || d >= periodStart || !present.has(key(r))) continue;
      prev.set(key(r), (prev.get(key(r)) ?? 0) + qtyIn(r, countKey));
    }
  }

  const savedBy = new Map(saved.map((s) => [`${s.section}|${s.item}`, s]));
  return [...present.keys()]
    .map((k) => k.split("|") as [string, string])
    .sort((a, b) => byNatural(a[0], b[0]) || byNatural(a[1], b[1]))
    .map(([section, item]) => {
      const s = savedBy.get(`${section}|${item}`);
      const rate = s?.rate ?? defaultRate;
      return {
        id: newId(), section, item,
        uom: s?.uom || "NO",
        contractQty: s?.contract_qty != null ? fmtNum(s.contract_qty) : "",
        rate: rate != null ? fmtNum(rate) : "",
        prevQty: fmtNum(prev.get(`${section}|${item}`) ?? 0),
        presentQty: fmtNum(present.get(`${section}|${item}`) ?? 0),
      };
    });
}

/* ------------------------------------------------------------ calculations */

export type RowCalc = {
  contractAmt: number | null;
  cumQty: number;
  prevPct: number | null; presPct: number | null; cumPct: number | null;
  prevAmt: number; presAmt: number; cumAmt: number;
};

export function rowCalc(r: ProgressRow): RowCalc {
  const cq = parseNum(r.contractQty), rate = parseNum(r.rate) ?? 0;
  const pq = parseNum(r.prevQty) ?? 0, nq = parseNum(r.presentQty) ?? 0;
  const cum = pq + nq;
  const pct = (q: number) => (cq && cq > 0 ? (q / cq) * 100 : null);
  return {
    contractAmt: cq != null ? round2(cq * rate) : null,
    cumQty: cum,
    prevPct: pct(pq), presPct: pct(nq), cumPct: pct(cum),
    prevAmt: round2(pq * rate), presAmt: round2(nq * rate), cumAmt: round2(cum * rate),
  };
}

/** Totals bill the PRESENT amounts, i.e. this period's work. */
export function proformaTotals(doc: ProformaDoc) {
  const subtotal = round2(doc.rows.reduce((s, r) => s + rowCalc(r).presAmt, 0));
  const rRate = parseNum(doc.retentionRate) ?? 0;
  const retention = round2((subtotal * rRate) / 100);
  const total = round2(subtotal - retention);
  const vRate = parseNum(doc.vatRate) ?? 0;
  const vat = round2((total * vRate) / 100);
  return { subtotal, rRate, retention, total, vRate, vat, grand: round2(total + vat) };
}

export function summaryTotals(doc: SummaryDoc) {
  const work = round2(parseNum(doc.workDone) ?? 0);
  const rRate = parseNum(doc.retentionRate) ?? 0;
  const retention = round2((work * rRate) / 100);
  const net = round2(work - retention);
  const vRate = parseNum(doc.vatRate) ?? 0;
  const vat = round2((net * vRate) / 100);
  return { work, rRate, retention, net, vRate, vat, due: round2(net + vat) };
}

/** "87%" — whole percent like the client's sheet; "-" when there's no contract qty. */
export const fmtPct = (p: number | null) => (p == null ? "-" : `${Math.round(p)}%`);
export const fmtQtyNum = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/* --------------------------------------------------------- amount in words */

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under1000(n: number): string {
  const h = Math.floor(n / 100), rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(rest < 20 ? ONES[rest] : TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${ONES[rest % 10]}` : ""));
  return parts.join(" ");
}

function intToWords(n: number): string {
  if (n === 0) return "Zero";
  const scales: [number, string][] = [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"], [1, ""]];
  const parts: string[] = [];
  for (const [size, name] of scales) {
    const chunk = Math.floor(n / size) % 1000;
    if (chunk) parts.push(`${under1000(chunk)}${name ? ` ${name}` : ""}`);
  }
  return parts.join(" ");
}

/** 116398.28 → "One Hundred Sixteen Thousand Three Hundred Ninety-Eight and Twenty-Eight Fils Only" */
export function amountInWords(amount: number): string {
  const total = Math.round(Math.abs(amount) * 100);
  const dirhams = Math.floor(total / 100), fils = total % 100;
  return `${intToWords(dirhams)}${fils ? ` and ${intToWords(fils)} Fils` : ""} Only`;
}

/* ---------------------------------------------------------------- builders */

export function buildProforma(opts: {
  rows: ProgressRow[];
  billing?: { name: string; address: string; trn: string; last_project: string; last_proforma_no: string; doc_defaults: DocDefaults };
  entryClient: string;
  defaultScope: string;
  nextNo: (last: string) => string;
}): ProformaDoc {
  const { billing, entryClient } = opts;
  const dd = billing?.doc_defaults ?? {};
  return {
    companyName: COMPANY_DEFAULTS.companyName,
    companyAddress: COMPANY_DEFAULTS.companyAddress,
    companyContact: COMPANY_DEFAULTS.companyContact,
    title: "PROFORMA INVOICE",
    clientName: billing?.name ?? entryClient,
    clientAddress: billing?.address ?? "",
    clientTrn: billing?.trn ?? "",
    fromName: COMPANY_DEFAULTS.fromName,
    invoiceNo: billing?.last_proforma_no ? opts.nextNo(billing.last_proforma_no) : "001",
    invoiceDate: todayDubaiDMY(),
    ourTrn: COMPANY_DEFAULTS.ourTrn,
    project: billing?.last_project ?? "",
    scope: dd.scope ?? opts.defaultScope,
    rows: opts.rows,
    retentionRate: dd.retention ?? "5",
    vatRate: "5",
    bankLines: COMPANY_DEFAULTS.bankLines,
    regardsLines: COMPANY_DEFAULTS.regardsLines,
  };
}

/** The summary tax invoice, pre-filled from the proforma (same client,
 *  project, scope, retention) with Total Work Done = the proforma sub total. */
export function buildSummary(p: ProformaDoc, opts: {
  billing?: { last_invoice_no: string; doc_defaults: DocDefaults };
  nextNo: (last: string) => string;
}): SummaryDoc {
  const dd = opts.billing?.doc_defaults ?? {};
  return {
    title: "TAX INVOICE",
    invoiceNo: opts.billing?.last_invoice_no ? opts.nextNo(opts.billing.last_invoice_no) : "",
    invoiceDate: todayDubaiDMY(),
    reference: dd.reference ?? "",
    pcNo: "",
    fromLines: [
      `M/s ${p.companyName.replace(/\s*L\.?L\.?C\.?\s*$/i, " LLC").trim()}`,
      `TRN NO: ${p.ourTrn}`,
      "PO Box 31628,",
      "Dubai, UAE",
    ].join("\n"),
    toName: p.clientName,
    toLines: [p.clientTrn.trim() && `TRN: ${p.clientTrn.trim()}`, p.clientAddress.trim()].filter(Boolean).join("\n"),
    subject: dd.subject ?? p.scope,
    project: p.project,
    workDone: proformaTotals(p).subtotal.toFixed(2),
    retentionRate: p.retentionRate,
    vatRate: p.vatRate,
    regardsName: "For Sunstar Technical Services LLC",
    regardsLines: ["Karmegam. K", "Manager", "056-9517007"].join("\n"),
    footerLines: [
      `Licence No: 668259 P.O.Box 31628, Dubai, TRN: ${p.ourTrn}`,
      "Email: karmegamsunstar@gmail.com Web: www.sunstarmep.com",
    ].join("\n"),
  };
}

export const newProgressRow = (section = "", item = ""): ProgressRow =>
  ({ id: newId(), section, item, uom: "NO", contractQty: "", rate: "", prevQty: "0", presentQty: "" });
