import { supabase } from "./supabase";

/**
 * Supabase's API returns at most 1,000 rows per request by default
 * (Dashboard → Settings → API → "Max rows"), on every plan.
 * This helper keeps asking for the next page until everything is loaded,
 * so dashboards and exports never silently drop older rows.
 *
 * `build` must return a fresh query each time (select + filters + order);
 * we add the .range() for each page. Always include a unique column
 * (e.g. id) in the ordering so pages don't overlap or skip rows.
 */
const PAGE = 1000;

export async function fetchAll<T extends { id?: string | null }>(
  build: () => any,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  const seen = new Set<string>();
  // Advance by however many rows actually came back and stop only on an empty
  // page — works even if "Max rows" is set lower than 1,000.
  for (let from = 0; ; ) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) return { data: out, error };
    const rows = (data ?? []) as T[];
    if (rows.length === 0) break;
    for (const r of rows) {
      // De-duplicate in case a row shifted between pages during the load.
      const key = r.id ?? "";
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push(r);
    }
    from += rows.length;
  }
  return { data: out, error: null };
}

/**
 * Fetch one work entry by id (used to apply a single realtime change).
 * `data` is null when the row no longer exists (or isn't visible);
 * `error` is set when the request itself failed (e.g. bad network) —
 * callers must NOT treat that as "row deleted".
 */
export async function fetchEntry(id: string) {
  const { data, error } = await supabase
    .from("sunstar_work_entries")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return { data, error };
}

/** Today's date in Dubai as YYYY-MM-DD, computed fresh on every call. */
export function todayDubai(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** "HH:MM" → minutes since midnight (NaN if empty/invalid). */
export function toMinutes(t: string | null | undefined): number {
  if (!t) return NaN;
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
}

/**
 * Soft checks on time order. Returns warnings (not errors) because
 * night shifts can legitimately cross midnight.
 */
export function timeWarnings(t: {
  check_in_time?: string | null;
  check_out_time?: string | null;
  break_start_time?: string | null;
  break_end_time?: string | null;
}): string[] {
  const w: string[] = [];
  const ci = toMinutes(t.check_in_time), co = toMinutes(t.check_out_time);
  const bs = toMinutes(t.break_start_time), be = toMinutes(t.break_end_time);
  if (Number.isFinite(ci) && Number.isFinite(co) && co <= ci)
    w.push("Check-out is not after check-in");
  if (Number.isFinite(bs) && Number.isFinite(be) && be <= bs)
    w.push("Break end is not after break start");
  return w;
}

/** Most hours one job can plausibly log: 24h × manpower (no cap if manpower unknown). */
export function maxHours(manpower: number | null | undefined): number {
  const m = Number(manpower);
  return Number.isFinite(m) && m > 0 ? 24 * m : Infinity;
}
