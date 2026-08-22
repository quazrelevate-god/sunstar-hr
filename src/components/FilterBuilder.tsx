import { useMemo, useState } from "react";
import type { Condition, FilterCol } from "../lib/supabase";

const COLS: { key: FilterCol; label: string; kind: "text" | "date" | "number" }[] = [
  { key: "cluster",        label: "Cluster",        kind: "text" },
  { key: "phase",          label: "Phase",          kind: "text" },
  { key: "villa",          label: "Villa",          kind: "text" },
  { key: "bedroom_type",   label: "Bedroom",        kind: "text" },
  { key: "floor_type",     label: "Floor",          kind: "text" },
  { key: "description",    label: "Description",    kind: "text" },
  { key: "client",         label: "Client",         kind: "text" },
  { key: "status",         label: "Status",         kind: "text" },
  { key: "start_date",     label: "Start date",     kind: "date" },
  { key: "end_date",       label: "End date",       kind: "date" },
  { key: "hours",          label: "Actual hours",   kind: "number" },
  { key: "target_hours",   label: "Target hours",   kind: "number" },
  { key: "total_price",    label: "Total price",    kind: "number" },
  { key: "per_hour_ratio", label: "AED / hr",       kind: "number" },
];

export function conditionLabel(c: Condition): string {
  const col = COLS.find((x) => x.key === c.col)?.label ?? c.col;
  switch (c.op) {
    case "equals":   return `${col} = ${c.value}`;
    case "in":       return `${col} in (${c.values.join(", ")})`;
    case "contains": return `${col} contains "${c.value}"`;
    case "between":  return `${col} ${c.from ?? "…"} → ${c.to ?? "…"}`;
    case "gt":       return `${col} > ${c.value}`;
    case "lt":       return `${col} < ${c.value}`;
  }
}

export function FilterChip({
  cond, onRemove,
}: { cond: Condition; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-brand-yellowSoft border border-brand-yellow text-brand-ink text-xs px-2.5 py-1 rounded-full font-medium">
      {conditionLabel(cond)}
      {onRemove && (
        <button
          onClick={onRemove}
          className="text-brand-ink/50 hover:text-brand-ink text-sm leading-none"
          aria-label="Remove filter"
        >
          ×
        </button>
      )}
    </span>
  );
}

export function AddConditionPopover({
  open, onClose, onAdd,
  optionsByCol,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (c: Condition) => void;
  /** distinct existing values from history, per column — used to populate dropdowns for text cols */
  optionsByCol: Partial<Record<FilterCol, string[]>>;
}) {
  const [col, setCol] = useState<FilterCol>("cluster");
  const meta = COLS.find((c) => c.key === col)!;
  const [op, setOp] = useState<Condition["op"]>("equals");
  const [v1, setV1] = useState("");
  const [v2, setV2] = useState("");
  const [multi, setMulti] = useState<string[]>([]); // for "in"

  const options = useMemo(() => optionsByCol[col] ?? [], [optionsByCol, col]);

  if (!open) return null;

  function submit() {
    let cond: Condition | null = null;
    if (op === "equals") {
      if (!v1) return;
      cond = { col, op: "equals", value: meta.kind === "number" ? Number(v1) : v1 };
    } else if (op === "in") {
      if (!multi.length) return;
      cond = {
        col, op: "in",
        values: meta.kind === "number" ? multi.map(Number) : multi,
      };
    } else if (op === "contains") {
      if (!v1) return;
      cond = { col, op: "contains", value: v1 };
    } else if (op === "between") {
      cond = meta.kind === "date"
        ? { col, op: "between", from: v1, to: v2 }
        : { col, op: "between", from: Number(v1), to: Number(v2) };
    } else if (op === "gt" || op === "lt") {
      if (!v1) return;
      cond = { col, op, value: Number(v1) };
    }
    if (!cond) return;
    onAdd(cond);
    onClose();
  }

  const opsAll: { key: Condition["op"]; label: string; kinds: string[] }[] = [
    { key: "equals",   label: "equals",     kinds: ["text","date","number"] },
    { key: "in",       label: "is one of",  kinds: ["text","number"] },
    { key: "contains", label: "contains",   kinds: ["text"] },
    { key: "between",  label: "between",    kinds: ["date","number"] },
    { key: "gt",       label: ">",          kinds: ["number"] },
    { key: "lt",       label: "<",          kinds: ["number"] },
  ];
  const ops = opsAll.filter((o) => o.kinds.includes(meta.kind));

  const inputType = meta.kind === "date" ? "date" : meta.kind === "number" ? "number" : "text";
  const hasOptions = options.length > 0;

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-bold text-brand-ink text-lg">Add filter condition</div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-semibold text-gray-500 mb-1">Column</div>
            <select
              value={col}
              onChange={(e) => {
                const next = e.target.value as FilterCol;
                setCol(next);
                const m = COLS.find((x) => x.key === next)!;
                if (m.kind === "text") setOp("equals");
                else if (m.kind === "date") setOp("between");
                else setOp("equals");
                setV1(""); setV2(""); setMulti([]);
              }}
              className="w-full border rounded-lg px-3 py-2"
            >
              {COLS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>

          <label className="block">
            <div className="text-xs font-semibold text-gray-500 mb-1">Operator</div>
            <select value={op} onChange={(e) => { setOp(e.target.value as any); setV1(""); setV2(""); setMulti([]); }}
              className="w-full border rounded-lg px-3 py-2">
              {ops.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
        </div>

        {op === "in" ? (
          <label className="block">
            <div className="text-xs font-semibold text-gray-500 mb-1">
              Values {hasOptions && <span className="text-gray-400 font-normal">· pick from history ({options.length})</span>}
            </div>
            {hasOptions ? (
              <MultiPicker options={options} value={multi} onChange={setMulti} />
            ) : (
              <input
                value={multi.join(",")}
                onChange={(e) => setMulti(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
                placeholder="V-4, V-14, V-99"
                className="w-full border rounded-lg px-3 py-2"
              />
            )}
          </label>
        ) : op === "between" ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-xs font-semibold text-gray-500 mb-1">From</div>
              <input type={inputType} value={v1} onChange={(e) => setV1(e.target.value)}
                className="w-full border rounded-lg px-3 py-2" />
            </label>
            <label className="block">
              <div className="text-xs font-semibold text-gray-500 mb-1">To</div>
              <input type={inputType} value={v2} onChange={(e) => setV2(e.target.value)}
                className="w-full border rounded-lg px-3 py-2" />
            </label>
          </div>
        ) : (
          <label className="block">
            <div className="text-xs font-semibold text-gray-500 mb-1">
              Value
              {op === "equals" && hasOptions && (
                <span className="text-gray-400 font-normal"> · pick from history ({options.length})</span>
              )}
            </div>
            {op === "equals" && hasOptions ? (
              <select value={v1} onChange={(e) => setV1(e.target.value)}
                className="w-full border rounded-lg px-3 py-2" autoFocus>
                <option value="">— choose —</option>
                {options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type={inputType} value={v1} onChange={(e) => setV1(e.target.value)}
                className="w-full border rounded-lg px-3 py-2" autoFocus
                list={op === "equals" ? undefined : `history-${col}`} />
            )}
            {op === "contains" && hasOptions && (
              <datalist id={`history-${col}`}>
                {options.map((o) => <option key={o} value={o} />)}
              </datalist>
            )}
          </label>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border">Cancel</button>
          <button onClick={submit}
            className="px-4 py-2 rounded-lg bg-brand-ink text-brand-yellow font-bold">Add</button>
        </div>
      </div>
    </div>
  );
}

/* Multi-select chip picker for the "is one of" operator */
function MultiPicker({
  options, value, onChange,
}: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const filtered = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const toggle = (o: string) =>
    onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <div className="border rounded-lg">
      <input
        value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Filter list…"
        className="w-full px-3 py-2 border-b outline-none rounded-t-lg text-sm"
      />
      <div className="max-h-48 overflow-y-auto p-2 space-y-1">
        {filtered.length === 0 ? (
          <div className="text-xs text-gray-400 px-2 py-4 text-center">No matches</div>
        ) : filtered.map((o) => (
          <label key={o} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer text-sm">
            <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} />
            <span>{o}</span>
          </label>
        ))}
      </div>
      {value.length > 0 && (
        <div className="border-t p-2 flex flex-wrap gap-1">
          {value.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 bg-brand-yellowSoft border border-brand-yellow rounded-full px-2 py-0.5 text-xs">
              {v}
              <button onClick={() => toggle(v)} className="text-brand-ink/50 hover:text-brand-ink">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
