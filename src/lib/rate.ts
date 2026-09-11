import type { WorkEntry, Condition, FilterCol } from "./supabase";

/** Compare actual vs target hours to signal profit/loss */
export type RateTone = "profit" | "onplan" | "loss" | "neutral";

export function rateTone(row: Pick<WorkEntry, "hours" | "target_hours">): RateTone {
  if (row.hours == null || row.target_hours == null) return "neutral";
  const a = Number(row.hours);
  const t = Number(row.target_hours);
  if (!a || !t) return "neutral";
  if (a < t) return "profit";
  if (a > t) return "loss";
  return "onplan";
}

export function rateToneClasses(tone: RateTone): string {
  switch (tone) {
    case "profit":  return "bg-green-100 text-green-800 border border-green-200";
    case "loss":    return "bg-red-100 text-red-800 border border-red-200";
    case "onplan":  return "bg-amber-100 text-amber-800 border border-amber-200";
    default:        return "bg-gray-100 text-gray-700 border border-gray-200";
  }
}

/* Column kind — used to interpret operators consistently */
export const COLUMN_KIND: Record<FilterCol, "text" | "date" | "number"> = {
  cluster: "text", phase: "text", villa: "text", bedroom_type: "text",
  floor_type: "text", description: "text", client: "text", status: "text",
  start_date: "date", end_date: "date",
  hours: "number", target_hours: "number", total_price: "number", per_hour_ratio: "number",
};

function cellValue(row: any, col: FilterCol): any { return row[col]; }

function eqLoose(a: any, b: any): boolean {
  if (a == null || b == null) return a == b;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/** Milliseconds-since-epoch for a date-y value (string or Date). NaN if unparseable. */
function toMs(v: unknown): number {
  if (v == null || v === "") return NaN;
  const t = new Date(v as any).getTime();
  return Number.isFinite(t) ? t : NaN;
}

export function passesConditions(row: any, conds: Condition[]): boolean {
  for (const c of conds) {
    const kind = COLUMN_KIND[c.col];
    const v = cellValue(row, c.col);

    switch (c.op) {
      case "equals":
        if (kind === "date") {
          if (toMs(v) !== toMs(c.value)) return false;
        } else if (!eqLoose(v, c.value)) return false;
        break;
      case "neq":
        if (kind === "date") {
          if (toMs(v) === toMs(c.value)) return false;
        } else if (eqLoose(v, c.value)) return false;
        break;
      case "in":
        if (!c.values.some((x) => eqLoose(v, x))) return false;
        break;
      case "nin":
        if (c.values.some((x) => eqLoose(v, x))) return false;
        break;
      case "contains":
        if (v == null || !String(v).toLowerCase().includes(String(c.value).toLowerCase())) return false;
        break;
      case "between": {
        if (kind === "date") {
          const d = toMs(v);
          const from = c.from ? toMs(c.from) : -Infinity;
          const to = c.to ? toMs(c.to) : Infinity;
          if (!(d >= from && d <= to)) return false;
        } else {
          const nv = Number(v);
          const from = Number(c.from);
          const to = Number(c.to);
          if (!(nv >= from && nv <= to)) return false;
        }
        break;
      }
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        if (kind === "date") {
          const d = toMs(v);
          const target = toMs(c.value);
          if (!Number.isFinite(d) || !Number.isFinite(target)) return false;
          if (c.op === "gt"  && !(d >  target)) return false;
          if (c.op === "gte" && !(d >= target)) return false;
          if (c.op === "lt"  && !(d <  target)) return false;
          if (c.op === "lte" && !(d <= target)) return false;
        } else {
          const nv = Number(v);
          const target = Number(c.value);
          if (!Number.isFinite(nv) || !Number.isFinite(target)) return false;
          if (c.op === "gt"  && !(nv >  target)) return false;
          if (c.op === "gte" && !(nv >= target)) return false;
          if (c.op === "lt"  && !(nv <  target)) return false;
          if (c.op === "lte" && !(nv <= target)) return false;
        }
        break;
      }
    }
  }
  return true;
}
