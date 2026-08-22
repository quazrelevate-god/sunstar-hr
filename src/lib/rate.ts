import type { WorkEntry } from "./supabase";

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

/** Filter engine — applies a Condition[] to a WorkEntry[] client-side */
import type { Condition, FilterCol } from "./supabase";

function cellValue(row: any, col: FilterCol): any {
  return row[col];
}

function eqLoose(a: any, b: any): boolean {
  if (a == null || b == null) return a == b;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

export function passesConditions(row: any, conds: Condition[]): boolean {
  for (const c of conds) {
    const v = cellValue(row, c.col);
    switch (c.op) {
      case "equals":
        if (!eqLoose(v, c.value)) return false;
        break;
      case "in":
        if (!c.values.some((x) => eqLoose(v, x))) return false;
        break;
      case "contains":
        if (v == null || !String(v).toLowerCase().includes(String(c.value).toLowerCase())) return false;
        break;
      case "between": {
        const nv = Number(v);
        const from = Number(c.from);
        const to = Number(c.to);
        const isDate = String(c.col).endsWith("_date");
        if (isDate) {
          const d = v ? new Date(v as any).getTime() : NaN;
          const dfrom = c.from ? new Date(c.from as any).getTime() : -Infinity;
          const dto = c.to ? new Date(c.to as any).getTime() : Infinity;
          if (!(d >= dfrom && d <= dto)) return false;
        } else {
          if (!(nv >= from && nv <= to)) return false;
        }
        break;
      }
      case "gt":
        if (!(Number(v) > c.value)) return false;
        break;
      case "lt":
        if (!(Number(v) < c.value)) return false;
        break;
    }
  }
  return true;
}
