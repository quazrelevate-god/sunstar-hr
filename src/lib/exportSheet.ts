import * as XLSX from "xlsx";
import { POINT_FIELDS } from "./supabase";
import type { WorkEntry } from "./supabase";

/*
 * Finalized-entries export, modelled on the client's own per-client workbook.
 *
 *  - One sheet per client (XLSX). CSV is a single combined table.
 *  - Columns with no data in that sheet are dropped; zeros render as blank.
 *  - The M/P → AED/Hr block is always present (except point counts, which
 *    are pruned like everything else).
 *  - D.Hrs and AED/Hr are live Excel formulas; a totals row sums T.Hrs and
 *    Total AED and derives the weighted average AED/Hr (total ÷ hours).
 */

type Cell = string | number | null;

type Col = {
  id: string;
  header: string;
  value: (r: WorkEntry) => Cell;
  /** Core columns are never pruned, even when empty. */
  core?: boolean;
};

// Shown in the app for data entry but never exported.
const EXCLUDED_POINTS = new Set(["gi_circular_box", "gi_offset", "final_fix_socket"]);

const POINT_SHORT: Record<string, string> = {
  power_point: "PS",
  gi_box_nos: "GI Box",
  data_point: "20mm",
  telephone_point: "25mm",
  lighting_point: "32mm",
  fcu_point: "50mm",
  db_conduit: "DB",
  gi_conduiting: "GI Cond.",
  final_fix_switch: "Wiring Acc.",
  type_no_1_light: "L1",
  type_no_2_light: "L2",
  type_no_3_light: "L3",
  type_no_4_light: "L4",
  type_no_5_light: "L5",
  type_no_6_light: "L6",
  led_strip_light_meter: "LED (m)",
};

/** Non-zero finite number, else null (so 0 exports as a blank cell). */
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}
function txt(v: unknown): string | null {
  const s = (v ?? "").toString().trim();
  return s ? s : null;
}
function hhmm(v: unknown): string | null {
  const s = txt(v);
  return s ? s.slice(0, 5) : null;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

const COLUMNS: Col[] = [
  { id: "cluster", header: "Cluster",    value: (r) => txt(r.cluster) },
  { id: "phase",   header: "Phase",      value: (r) => txt(r.phase) },
  { id: "villa",   header: "Villa",      value: (r) => txt(r.villa) },
  { id: "br",      header: "BR",         value: (r) => txt(r.bedroom_type) },
  { id: "desc",    header: "Desc",       value: (r) => txt(r.description) },
  { id: "floor",   header: "Floor",      value: (r) => txt(r.floor_type) },
  { id: "start",   header: "Start Date", value: (r) => txt(r.start_date) },
  { id: "end",     header: "End Date",   value: (r) => txt(r.end_date) },
  { id: "client",  header: "Client",     value: (r) => txt(r.client) },

  { id: "mp",   header: "M/P",   core: true, value: (r) => num(r.total_manpower) },
  { id: "in",   header: "In",    core: true, value: (r) => hhmm(r.check_in_time) },
  { id: "out",  header: "Out",   core: true, value: (r) => hhmm(r.check_out_time) },
  {
    id: "dhrs", header: "D.Hrs", core: true,
    value: (r) => {
      const h = num(r.hours), m = num(r.total_manpower);
      return h != null && m != null ? round2(h / m) : null;
    },
  },
  { id: "thrs", header: "T.Hrs", core: true, value: (r) => num(r.hours) },

  ...POINT_FIELDS
    .filter((p) => !EXCLUDED_POINTS.has(p.key as string))
    .map<Col>((p) => ({
      id: p.key as string,
      header: POINT_SHORT[p.key as string] ?? p.label,
      value: (r) => num((r as any)[p.key]),
    })),

  { id: "total", header: "Total AED", core: true, value: (r) => num(r.total_price) },
  {
    id: "rate", header: "AED/Hr", core: true,
    value: (r) => {
      const t = num(r.total_price), h = num(r.hours);
      return t != null && h != null ? round2(t / h) : null;
    },
  },
];

type ExportTable = {
  cols: Col[];          // kept columns, excluding the leading "#"
  headers: string[];    // includes "#"
  body: Cell[][];       // includes the row number in column 0
  sums: { thrs: number; total: number; rate: number | null };
};

function buildTable(rows: WorkEntry[]): ExportTable {
  const cols = COLUMNS.filter((c) => c.core || rows.some((r) => c.value(r) != null));
  const body = rows.map((r, i) => [i + 1, ...cols.map((c) => c.value(r))]);
  const thrs = rows.reduce((s, r) => s + (num(r.hours) ?? 0), 0);
  const total = rows.reduce((s, r) => s + (num(r.total_price) ?? 0), 0);
  return {
    cols,
    headers: ["#", ...cols.map((c) => c.header)],
    body,
    sums: { thrs, total: round2(total), rate: thrs > 0 ? round2(total / thrs) : null },
  };
}

/* ---------------------------------------------------------------- XLSX */

function tableToSheet(t: ExportTable): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([t.headers, ...t.body]);

  // Excel column letter for a kept column id (offset 1 for the "#" column).
  const letter = (id: string) => {
    const i = t.cols.findIndex((c) => c.id === id);
    return i < 0 ? null : XLSX.utils.encode_col(i + 1);
  };
  const L = {
    mp: letter("mp"), dhrs: letter("dhrs"), thrs: letter("thrs"),
    total: letter("total"), rate: letter("rate"),
  };

  const lastData = t.body.length + 1;   // 1-based Excel row of the last entry

  // Swap the pre-computed D.Hrs / AED/Hr values for live formulas, keeping
  // the computed value cached so previews (WhatsApp, Quick Look) show numbers.
  for (let i = 0; i < t.body.length; i++) {
    const row = i + 2;
    const put = (col: string | null, formula: string, z?: string) => {
      if (!col) return;
      const addr = `${col}${row}`;
      const cell = ws[addr] as XLSX.CellObject | undefined;
      if (!cell || cell.v == null || cell.v === "") return;
      ws[addr] = { t: "n", v: cell.v, f: formula, ...(z ? { z } : {}) };
    };
    if (L.dhrs && L.thrs && L.mp) put(L.dhrs, `IFERROR(ROUND(${L.thrs}${row}/${L.mp}${row},2),"")`);
    if (L.rate && L.total && L.thrs) put(L.rate, `IFERROR(ROUND(${L.total}${row}/${L.thrs}${row},2),"")`, "0.00");
  }

  // Totals row.
  const totalsRow = lastData + 1;
  if (t.body.length > 0) {
    ws[`A${totalsRow}`] = { t: "s", v: "TOTAL" };
    if (L.thrs) {
      ws[`${L.thrs}${totalsRow}`] = { t: "n", v: t.sums.thrs, f: `SUM(${L.thrs}2:${L.thrs}${lastData})` };
    }
    if (L.total) {
      ws[`${L.total}${totalsRow}`] = {
        t: "n", v: t.sums.total, f: `SUM(${L.total}2:${L.total}${lastData})`, z: "#,##0.00",
      };
    }
    if (L.rate && L.total && L.thrs) {
      ws[`${L.rate}${totalsRow}`] = {
        t: "n", v: t.sums.rate ?? 0,
        f: `IFERROR(ROUND(${L.total}${totalsRow}/${L.thrs}${totalsRow},2),"")`, z: "0.00",
      };
    }
  }

  const lastCol = t.headers.length - 1;
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: t.body.length > 0 ? totalsRow - 1 : 0, c: lastCol },
  });
  if (t.body.length > 0) {
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastData - 1, c: lastCol } }),
    };
  }

  // Width = longest of header / values in that column.
  ws["!cols"] = t.headers.map((h, c) => {
    let w = h.length;
    for (const r of t.body) {
      const v = r[c];
      if (v != null) w = Math.max(w, String(v).length);
    }
    return { wch: Math.min(45, Math.max(4, w + 1)) };
  });

  return ws;
}

/** Excel sheet names: ≤31 chars, none of : \ / ? * [ ], no leading/trailing
 *  apostrophe, unique (case-insensitive), and not the reserved "History". */
function sheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim();
  base = base.replace(/^'+|'+$/g, "").trim() || "Sheet";
  if (base.toLowerCase() === "history") base = "History (client)";
  base = base.slice(0, 31).trim();
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length).trim() + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

/** Download an .xlsx with one sheet per client, rows in the given order. */
export function downloadWorkbook(rows: WorkEntry[], filename: string) {
  const groups = new Map<string, WorkEntry[]>();
  for (const r of rows) {
    const key = txt(r.client) ?? "No client";
    const list = groups.get(key);
    if (list) list.push(r); else groups.set(key, [r]);
  }

  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const clients = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const client of clients) {
    XLSX.utils.book_append_sheet(wb, tableToSheet(buildTable(groups.get(client)!)), sheetName(client, used));
  }
  if (clients.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["No entries in this view"]]), "Sunstar");
  }
  XLSX.writeFile(wb, filename);
}

/* ----------------------------------------------------------------- CSV */

/** Neutralise spreadsheet formula injection in user-typed text. */
function csvCell(v: Cell): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Single combined CSV (CSV can't hold tabs or formulas, so values only). */
export function buildCsv(rows: WorkEntry[]): string {
  const t = buildTable(rows);
  const lines = [t.headers.map(csvCell).join(",")];
  for (const r of t.body) lines.push(r.map(csvCell).join(","));
  if (t.body.length > 0) {
    const totals: Cell[] = t.headers.map(() => null);
    totals[0] = "TOTAL";
    const at = (id: string) => t.cols.findIndex((c) => c.id === id) + 1;
    if (at("thrs") > 0) totals[at("thrs")] = t.sums.thrs;
    if (at("total") > 0) totals[at("total")] = t.sums.total;
    if (at("rate") > 0) totals[at("rate")] = t.sums.rate;
    lines.push(totals.map(csvCell).join(","));
  }
  return lines.join("\n");
}
