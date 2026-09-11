"use client";

import { useMemo, useState } from "react";
import type { GraphData } from "./graph-types";

export type SearchAction = "focus" | "expand" | "filter";

/** In-graph entity search: find by name, then focus / expand / isolate /
 *  reset. Focus + filter are client-side; expand reuses the existing
 *  neighborhood endpoint. */
export function GraphSearch({
  graph,
  onFocus,
  onExpand,
  onFilter,
  onReset,
}: {
  graph: GraphData | null;
  onFocus: (id: string) => void;
  onExpand: (id: string) => void;
  onFilter: (id: string | null) => void;
  onReset: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState("");
  const [filtered, setFiltered] = useState(false);

  const matches = useMemo(() => {
    if (!graph || q.trim().length < 2) return [];
    const needle = q.trim().toLowerCase();
    return graph.nodes
      .filter((n) => n.label.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [graph, q]);

  function choose(id: string) {
    setPicked(id);
  }

  function reset() {
    setQ("");
    setPicked("");
    setFiltered(false);
    onFilter(null);
    onReset();
  }

  function filterAround() {
    if (!picked) return;
    setFiltered(true);
    onFilter(picked);
  }

  return (
    <div className="card !p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input !w-auto min-w-52 flex-1"
          placeholder="Find entity in graph…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {picked && !filtered && (
          <>
            <button className="btn !px-3 !py-1 text-xs" onClick={() => onFocus(picked)}>Focus</button>
            <button className="btn !px-3 !py-1 text-xs" onClick={() => onExpand(picked)}>Expand</button>
            <button className="btn !px-3 !py-1 text-xs" onClick={filterAround}>Filter</button>
          </>
        )}
        {(filtered || q) && (
          <button className="text-xs text-slate-400 hover:text-white hover:underline" onClick={reset}>
            Reset
          </button>
        )}
      </div>
      {q.trim().length >= 2 && (
        <ul className="mt-2 divide-y divide-ink-700">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => choose(m.id)}
                className={`flex w-full items-center justify-between py-1 text-left text-sm hover:text-white ${picked === m.id ? "text-accent" : "text-slate-300"}`}
              >
                <span><b>{m.label}</b> <span className="text-xs text-slate-500">· {m.type}</span></span>
                <span className="text-xs text-slate-500">{(m.confidence * 100).toFixed(0)}%</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="py-1 text-sm text-slate-500">No entities match “{q.trim()}” in this view.</li>
          )}
        </ul>
      )}
      {filtered && <p className="mt-1 text-xs text-slate-500">Showing 1-degree neighborhood — Reset to restore full view.</p>}
    </div>
  );
}
