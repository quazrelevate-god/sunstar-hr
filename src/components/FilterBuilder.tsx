import { useMemo, useState } from "react";
import type { Condition, FilterCol } from "../lib/supabase";
import { COLUMN_KIND } from "../lib/rate";

const COLS: { key: FilterCol; label: string }[] = [
  { key: "cluster",          label: "Cluster" },
  { key: "phase",            label: "Phase" },
  { key: "villa",            label: "Villa" },
  { key: "apartment_number", label: "Apartment" },
  { key: "bedroom_type",     label: "Bedroom" },
  { key: "floor_type",       label: "Floor" },
  { key: "description",      label: "Description" },
  { key: "client",           label: "Client" },
  { key: "status",           label: "Status" },
  { key: "start_date",       label: "Start date" },
  { key: "end_date",         label: "End date" },
  { key: "total_manpower",   label: "Total manpower" },
  { key: "hours",            label: "Actual hours" },
  { key: "target_hours",     label: "Target hours" },
  { key: "total_price",      label: "Total price" },
  { key: "per_hour_ratio",   label: "AED / hr" },
];

/* Operator labels — different verbiage for dates vs numbers vs text */
function opLabel(op: Condition["op"], kind: "text" | "date" | "number"): string {
  switch (op) {
    case "equals":   return kind === "date" ? "on"           : "equals";
    case "neq":      return kind === "date" ? "not on"       : "does not equal";
    case "in":       return "is one of";
    case "nin":      return "is not one of";
    case "contains": return "contains";
    case "between":  return "between";
    case "gt":       return kind === "date" ? "after"        : ">";
    case "gte":      return kind === "date" ? "on or after"  : "≥";
    case "lt":       return kind === "date" ? "before"       : "<";
    case "lte":      return kind === "date" ? "on or before" : "≤";
  }
}

/* Which operators are allowed for each kind */
const OPS_BY_KIND: Record<"text" | "date" | "number", Condition["op"][]> = {
  text:   ["equals", "neq", "in", "nin", "contains"],
  date:   ["equals", "neq", "between", "gt", "gte", "lt", "lte"],
  number: ["equals", "neq", "in", "nin", "between", "gt", "gte", "lt", "lte"],
};

export function conditionLabel(c: Condition): string {
  const col = COLS.find((x) => x.key === c.col)?.label ?? c.col;
  const kind = COLUMN_KIND[c.col];
  const op = opLabel(c.op, kind);
  switch (c.op) {
    case "equals":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return `${col} ${op} ${c.value}`;
    case "in":
    case "nin":
      return `${col} ${op} (${c.values.join(", ")})`;
    case "contains":
      return `${col} ${op} "${c.value}"`;
    case "between":
      return `${col} ${op} ${c.from ?? "…"} → ${c.to ?? "…"}`;
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
  optionsByCol: Partial<Record<FilterCol, string[]>>;
}) {
  const [col, setCol] = useState<FilterCol>("cluster");
  const kind = COLUMN_KIND[col];
  const [op, setOp] = useState<Condition["op"]>("equals");
  const [v1, setV1] = useState("");
  const [v2, setV2] = useState("");
  const [multi, setMulti] = useState<string[]>([]);

  const options = useMemo(() => optionsByCol[col] ?? [], [optionsByCol, col]);
  const allowedOps = OPS_BY_KIND[kind];

  if (!open) return null;

  function submit() {
    let cond: Condition | null = null;
    if (op === "equals" || op === "neq") {
      if (!v1) return;
      cond = { col, op, value: kind === "number" ? Number(v1) : v1 };
    } else if (op === "in" || op === "nin") {
      if (!multi.length) return;
      cond = { col, op, values: kind === "number" ? multi.map(Number) : multi };
    } else if (op === "contains") {
      if (!v1) return;
      cond = { col, op, value: v1 };
    } else if (op === "between") {
      cond = kind === "date"
        ? { col, op, from: v1, to: v2 }
        : { col, op, from: Number(v1), to: Number(v2) };
    } else if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
      if (!v1) return;
      cond = { col, op, value: kind === "number" ? Number(v1) : v1 };
    }
    if (!cond) return;
    onAdd(cond);
    onClose();
  }

  const inputType = kind === "date" ? "date" : kind === "number" ? "number" : "text";
  const hasOptions = options.length > 0;
  const isDropdownable = kind === "text" && (op === "equals" || op === "neq") && hasOptions;
  const isMulti = op === "in" || op === "nin";
  const isBetween = op === "between";

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
                const k = COLUMN_KIND[next];
                // Snap the op to the first legal choice for this kind
                setOp(OPS_BY_KIND[k][0]);
                setV1(""); setV2(""); setMulti([]);
              }}
              className="w-full border rounded-lg px-3 py-2"
            >
              {COLS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>

          <label className="block">
            <div className="text-xs font-semibold text-gray-500 mb-1">Operator</div>
            <select value={op} onChange={(e) => { setOp(e.target.value as Condition["op"]); setV1(""); setV2(""); setMulti([]); }}
              className="w-full border rounded-lg px-3 py-2">
              {allowedOps.map((o) => <option key={o} value={o}>{opLabel(o, kind)}</option>)}
            </select>
          </label>
        </div>

        {isMulti ? (
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
                placeholder="value1, value2, value3"
                className="w-full border rounded-lg px-3 py-2"
              />
            )}
          </label>
        ) : isBetween ? (
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
              {isDropdownable && <span className="text-gray-400 font-normal"> · pick from history ({options.length})</span>}
            </div>
            {isDropdownable ? (
              <select value={v1} onChange={(e) => setV1(e.target.value)}
                className="w-full border rounded-lg px-3 py-2" autoFocus>
                <option value="">— choose —</option>
                {options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <>
                <input type={inputType} value={v1} onChange={(e) => setV1(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2" autoFocus
                  list={op === "contains" && hasOptions ? `history-${col}` : undefined} />
                {op === "contains" && hasOptions && (
                  <datalist id={`history-${col}`}>
                    {options.map((o) => <option key={o} value={o} />)}
                  </datalist>
                )}
              </>
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

/* Multi-select chip picker */
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
