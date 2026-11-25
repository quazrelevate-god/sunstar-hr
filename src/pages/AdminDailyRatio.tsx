import { useMemo, useState } from "react";
import type { WorkEntry } from "../lib/supabase";
import { todayDubai } from "../lib/data";
import { clientKey } from "../lib/progress";
import { EXPENSE_PER_HOUR, LOW_RATIO } from "../lib/rate";

/*
 * Daily Ratio Summary — one row per project (the entry's client name) with
 * total hours, AED per hour and the team leader (whoever logged the entries)
 * for the chosen day(s), then expenses (hours × 13) and what was achieved
 * (amount − expenses), like the owner's spreadsheet. Ratios under 15 are red;
 * the team leader is red when the ratio is under the 13/hr cost. Only finalized (priced) entries count: unpriced work has no
 * ratio yet. An entry's day is its End date (Start date if End is missing),
 * the same rule as the Finalized period filter. Opens on today every time.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const entryDate = (r: WorkEntry) => (r.end_date || r.start_date || "").toString().slice(0, 10);
const dmy = (iso: string) => iso.split("-").reverse().join("/");
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Shift a YYYY-MM-DD date by whole days (calendar maths in UTC, no DST surprises). */
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1, d + n)));
}
const lastOfMonth = (y: number, m: number) => iso(new Date(Date.UTC(y, m, 0)));
/** 800, 14.7, 18 — trimmed decimals, as on the summary sheet. */
const num = (n: number, digits = 2) => n.toLocaleString("en-US", { maximumFractionDigits: digits });
/** 12,945.60 — money with two decimals. */
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AdminDailyRatio({ finalized, allRows }: { finalized: WorkEntry[]; allRows: WorkEntry[] }) {
  const today = todayDubai();
  const yesterday = addDays(today, -1);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [lo, hi] = from && to && from > to ? [to, from] : [from, to];

  // Month / Year pickers just set the range to that whole month (or year).
  const [y0, m0] = [Number(lo.slice(0, 4)), Number(lo.slice(5, 7))];
  const wholeMonth = lo.slice(8) === "01" && hi === lastOfMonth(y0, m0) && lo.slice(0, 7) === hi.slice(0, 7);
  const wholeYear = lo === `${y0}-01-01` && hi === `${y0}-12-31`;
  const pickMonth = (y: number, m: number | null) => {
    if (m == null) { setFrom(`${y}-01-01`); setTo(`${y}-12-31`); return; }
    const mm = String(m).padStart(2, "0");
    setFrom(`${y}-${mm}-01`);
    setTo(lastOfMonth(y, m));
  };
  const years = useMemo(() => {
    const ys = new Set<number>([Number(today.slice(0, 4))]);
    for (const r of finalized) { const d = entryDate(r); if (d) ys.add(Number(d.slice(0, 4))); }
    return [...ys].sort((a, b) => b - a);
  }, [finalized, today]);

  const inRange = (r: WorkEntry) => { const d = entryDate(r); return !!d && d >= lo && d <= hi; };

  const summary = useMemo(() => {
    const byProject = new Map<string, { project: string; hours: number; amount: number; leaders: Set<string> }>();
    for (const r of finalized) {
      if (!inRange(r)) continue;
      const label = (r.client ?? "").toString().trim().replace(/\s+/g, " ") || "No client";
      const k = clientKey(label);
      const p = byProject.get(k) ?? { project: label, hours: 0, amount: 0, leaders: new Set<string>() };
      p.hours += Number(r.hours ?? 0) || 0;
      p.amount += Number(r.total_price ?? 0) || 0;
      const who = (r.employee_name ?? "").toString().trim().replace(/\s+/g, " ").toUpperCase();
      if (who) p.leaders.add(who);
      byProject.set(k, p);
    }
    const list = [...byProject.values()]
      .map((p) => ({ ...p, ratio: p.hours > 0 ? p.amount / p.hours : 0, leader: [...p.leaders].sort().join(" / ") }))
      .sort((a, b) => a.project.localeCompare(b.project, undefined, { sensitivity: "base", numeric: true }));
    const hours = list.reduce((s, p) => s + p.hours, 0);
    const amount = list.reduce((s, p) => s + p.amount, 0);
    const expenses = hours * EXPENSE_PER_HOUR;
    return { list, hours, amount, ratio: hours > 0 ? amount / hours : 0, expenses, achieve: amount - expenses };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalized, lo, hi]);

  // Entries in these days that still wait for actuals or a price.
  const pending = useMemo(() => allRows.filter((r) => r.state !== "FINALIZED" && inRange(r)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, lo, hi]);

  const label = lo === hi
    ? `${dmy(lo)}${lo === today ? " (today)" : lo === yesterday ? " (yesterday)" : ""}`
    : wholeMonth ? `${MONTHS[m0 - 1]} ${y0}`
    : wholeYear ? `${y0}`
    : `${dmy(lo)} – ${dmy(hi)}`;

  const chip = (active: boolean) =>
    `text-xs font-semibold px-3 py-1.5 rounded-md transition ${active ? "bg-white shadow-sm text-brand-blueDark" : "text-slate-500 hover:text-brand-ink"}`;
  const cell = "border border-slate-300 px-3 py-2";

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Filters — today by default */}
      <div className="bg-white rounded-2xl shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          <button type="button" className={chip(lo === today && hi === today)} onClick={() => { setFrom(today); setTo(today); }}>Today</button>
          <button type="button" className={chip(lo === yesterday && hi === yesterday)} onClick={() => { setFrom(yesterday); setTo(yesterday); }}>Yesterday</button>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <input type="date" aria-label="From date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-blue/40" />
          to
          <input type="date" aria-label="To date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-blue/40" />
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <select aria-label="Month" value={wholeMonth ? m0 : ""}
            onChange={(e) => pickMonth(y0, e.target.value ? Number(e.target.value) : null)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-sm bg-white">
            <option value="">{wholeYear ? "All months" : "Month…"}</option>
            {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
          </select>
          <select aria-label="Year" value={wholeMonth || wholeYear ? y0 : ""}
            onChange={(e) => e.target.value && pickMonth(Number(e.target.value), wholeMonth ? m0 : null)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-sm bg-white">
            {!(wholeMonth || wholeYear) && <option value="">Year…</option>}
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Summary sheet */}
      <div className="bg-white rounded-2xl shadow-sm p-4 md:p-6">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th colSpan={5} className="border border-slate-300 bg-amber-400 text-brand-ink text-2xl font-semibold tracking-wide py-2">
                DAILY RATIO SUMMARY
              </th>
            </tr>
            <tr>
              <th colSpan={5} className="border border-slate-300 bg-amber-50 text-brand-ink text-sm font-semibold py-1.5">{label}</th>
            </tr>
            <tr className="bg-slate-50">
              <th className={`${cell} w-16 text-center`}>SR.NO</th>
              <th className={`${cell} text-center`}>Project</th>
              <th className={`${cell} w-24 text-center`}>Total Hrs</th>
              <th className={`${cell} w-20 text-center`}>Ratio</th>
              <th className={`${cell} w-44 text-center`}>TEAM LEADER</th>
            </tr>
          </thead>
          <tbody>
            {summary.list.length === 0 ? (
              <tr>
                <td colSpan={5} className={`${cell} text-center text-slate-400 py-10`}>
                  No priced entries for {label}.
                  <div className="text-xs mt-1">Entries show here once they're finalized (priced) in the Queue.</div>
                </td>
              </tr>
            ) : summary.list.map((p, i) => {
              const low = p.ratio < LOW_RATIO, loss = p.ratio < EXPENSE_PER_HOUR;
              return (
                <tr key={p.project}>
                  <td className={`${cell} text-center`}>{i + 1}</td>
                  <td className={`${cell} uppercase`}>{p.project}</td>
                  <td className={`${cell} text-center tabular-nums`}>{num(p.hours)}</td>
                  <td className={`${cell} text-center tabular-nums bg-sky-100 font-bold ${low ? "text-red-600" : "text-brand-ink"}`}
                    title={low ? `Below ${LOW_RATIO} AED/hr` : undefined}>
                    {num(p.ratio, 1)}
                  </td>
                  <td className={`${cell} text-xs uppercase ${loss ? "text-red-600 font-semibold" : ""}`}
                    title={loss ? `Ratio is below the ${EXPENSE_PER_HOUR} AED/hr cost` : undefined}>
                    {p.leader || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {([
              ["TOTAL AMOUNT", money(summary.amount), ""],
              ["TOTAL HOURS", num(summary.hours), ""],
              ["RATIO", summary.hours > 0 ? money(summary.ratio) : "—", "text-brand-blueDark"],
              ["PER HOUR EXPENSES", money(EXPENSE_PER_HOUR), "text-xs"],
              [lo === hi ? "PER DAY EXPENSES" : "TOTAL EXPENSES", money(summary.expenses), "text-xs"],
              [lo === hi ? "PER DAY ACHIEVE" : "TOTAL ACHIEVE", money(summary.achieve),
                `text-xs font-bold ${summary.achieve < 0 ? "text-red-600" : "text-emerald-700"}`],
            ] as const).map(([name, value, cls]) => (
              <tr key={name}>
                <td colSpan={2} className={`${cell} text-right ${cls.includes("text-xs") ? "text-xs" : "font-semibold"}`}>{name}</td>
                <td colSpan={2} className={`${cell} text-center tabular-nums font-semibold ${cls}`}>{value}</td>
                <td className={cell} />
              </tr>
            ))}
          </tfoot>
        </table>
        {pending > 0 && (
          <div className="mt-3 text-xs text-amber-700">
            {pending} more entr{pending === 1 ? "y" : "ies"} on {lo === hi ? "this day" : "these days"} {pending === 1 ? "is" : "are"} still waiting for actuals or a price, so {pending === 1 ? "it isn't" : "they aren't"} counted yet.
          </div>
        )}
      </div>
    </div>
  );
}
