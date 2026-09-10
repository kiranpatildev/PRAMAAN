"use client";

import { NODE_TYPES, type GraphFilters } from "./graph-types";

/** Explorer filter bar: entity-type toggles, confidence threshold, date range. */
export function GraphToolbar({
  filters,
  onChange,
}: {
  filters: GraphFilters;
  onChange: (f: GraphFilters) => void;
}) {
  function toggleType(t: string) {
    const has = filters.types.includes(t);
    onChange({
      ...filters,
      types: has ? filters.types.filter((x) => x !== t) : [...filters.types, t],
    });
  }

  return (
    <div className="card !p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">Types:</span>
        {NODE_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => toggleType(t)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${
              filters.types.includes(t)
                ? "border-accent bg-accent/15 text-accent"
                : "border-ink-700 text-slate-500 line-through"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <label className="flex items-center gap-2">
          Min confidence {(filters.minConfidence * 100).toFixed(0)}%
          <input
            type="range" min={0} max={100} step={5}
            value={Math.round(filters.minConfidence * 100)}
            onChange={(e) => onChange({ ...filters, minConfidence: Number(e.target.value) / 100 })}
            className="w-32 accent-sky-400"
          />
        </label>
        <label className="flex items-center gap-2">
          From
          <input type="date" className="input !w-auto !py-1 text-xs" value={filters.dateFrom}
            onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })} />
        </label>
        <label className="flex items-center gap-2">
          To
          <input type="date" className="input !w-auto !py-1 text-xs" value={filters.dateTo}
            onChange={(e) => onChange({ ...filters, dateTo: e.target.value })} />
        </label>
        {(filters.types.length < NODE_TYPES.length || filters.minConfidence > 0 || filters.dateFrom || filters.dateTo) && (
          <button
            className="text-accent hover:underline"
            onClick={() => onChange({ types: [...NODE_TYPES], minConfidence: 0, dateFrom: "", dateTo: "" })}
          >
            Reset filters
          </button>
        )}
      </div>
    </div>
  );
}
