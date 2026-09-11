"use client";

/** Network-graph left control panel: in-graph search, filters, relationship
 *  types + entity legend with live counts, and shortest-path search between
 *  two named entities (computed client-side on the loaded view). */
import { useMemo, useState } from "react";
import { GraphSearch } from "@/components/graph-search";
import { GraphToolbar } from "@/components/graph-toolbar";
import { TYPE_COLORS, type GraphData, type GraphFilters } from "@/components/graph-types";
import { relColor } from "@/lib/theme";
import { Icon } from "@/components/ui";

function shortestPath(graph: GraphData, from: string, to: string): string[] | null {
  const adj = new Map<string, { to: string; edge: string }[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push({ to: e.target, edge: e.id });
    adj.get(e.target)!.push({ to: e.source, edge: e.id });
  }
  if (!adj.has(from) || !adj.has(to)) return null;
  const prev = new Map<string, string | null>([[from, null]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === to) break;
    for (const { to: nx } of adj.get(cur) ?? []) {
      if (!prev.has(nx)) {
        prev.set(nx, cur);
        q.push(nx);
      }
    }
  }
  if (!prev.has(to)) return null;
  const path: string[] = [];
  let cur: string | null = to;
  while (cur) {
    path.unshift(cur);
    cur = prev.get(cur) ?? null;
  }
  return path;
}

function matchId(graph: GraphData, q: string): string | null {
  const needle = q.trim().toLowerCase();
  if (!needle) return null;
  const exact = graph.nodes.find((n) => n.label.toLowerCase() === needle || n.id.toLowerCase() === needle);
  if (exact) return exact.id;
  return graph.nodes.find((n) => n.label.toLowerCase().includes(needle))?.id ?? null;
}

export function GraphControls({ graph, filters, onFilters, onFocus, onExpand, onFilter, onReset, onPath }: {
  graph: GraphData | null;
  filters: GraphFilters;
  onFilters: (f: GraphFilters) => void;
  onFocus: (id: string) => void;
  onExpand: (id: string) => void;
  onFilter: (id: string | null) => void;
  onReset: () => void;
  onPath: (nodeIds: string[] | null) => void;
}) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [pathMsg, setPathMsg] = useState("");

  const relCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of graph?.edges ?? []) m.set(e.label, (m.get(e.label) ?? 0) + 1);
    return Array.from(m.entries()).sort((x, y) => y[1] - x[1]);
  }, [graph]);

  const entCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of graph?.nodes ?? []) m.set(n.type, (m.get(n.type) ?? 0) + 1);
    return Array.from(m.entries()).sort((x, y) => y[1] - x[1]);
  }, [graph]);

  function findPath() {
    setPathMsg("");
    onPath(null);
    if (!graph) return;
    const from = matchId(graph, a);
    const to = matchId(graph, b);
    if (!from || !to) {
      setPathMsg("Couldn't match one or both names to graph entities.");
      return;
    }
    const path = shortestPath(graph, from, to);
    if (!path) {
      setPathMsg("No connecting path in the current view.");
      return;
    }
    const names = path.map((id) => graph.nodes.find((n) => n.id === id)?.label ?? id);
    setPathMsg(`${names.join(" → ")} (${path.length - 1} hop${path.length === 2 ? "" : "s"})`);
    onPath(path);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#1F2733] bg-[#121826] p-4">
        <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]">
          Search within graph
        </p>
        <GraphSearch graph={graph} onFocus={onFocus} onExpand={onExpand} onFilter={onFilter} onReset={onReset} />
      </div>

      <div className="rounded-lg border border-[#1F2733] bg-[#121826] p-4">
        <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]">
          Filters
        </p>
        <GraphToolbar filters={filters} onChange={onFilters} />
      </div>

      <div className="rounded-lg border border-[#1F2733] bg-[#121826] p-4">
        <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]">
          Relationship types
        </p>
        {relCounts.length === 0 ? (
          <p className="text-xs text-[#8B93A1]">No edges in view.</p>
        ) : (
          <ul className="space-y-1.5">
            {relCounts.map(([label, n]) => (
              <li key={label} className="flex items-center gap-2 text-[13px]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: relColor(label) }} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{label}</span>
                <span className="font-mono text-xs text-[#8B93A1]">{n}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="mb-2 mt-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]">
          Entity legend
        </p>
        {entCounts.length === 0 ? (
          <p className="text-xs text-[#8B93A1]">No entities in view.</p>
        ) : (
          <ul className="space-y-1.5">
            {entCounts.map(([type, n]) => (
              <li key={type} className="flex items-center gap-2 text-[13px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TYPE_COLORS[type] ?? "#9CA3AF" }} />
                <span className="min-w-0 flex-1 truncate">{type}</span>
                <span className="font-mono text-xs text-[#8B93A1]">{n}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-[#1F2733] bg-[#121826] p-4">
        <p className="mb-2 flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]">
          <Icon name="route" className="h-3.5 w-3.5" /> Path analysis
        </p>
        <div className="space-y-2">
          <input className="input !py-1.5 text-xs" placeholder="From entity…" value={a} onChange={(e) => setA(e.target.value)} />
          <input className="input !py-1.5 text-xs" placeholder="To entity…" value={b} onChange={(e) => setB(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={findPath} className="btn flex-1 !py-1.5 text-xs">Find path</button>
            <button onClick={() => { setA(""); setB(""); setPathMsg(""); onPath(null); }}
              className="btn-ghost !px-3 !py-1.5 text-xs">Clear</button>
          </div>
          {pathMsg && <p className="text-xs leading-relaxed text-[#8B93A1]">{pathMsg}</p>}
        </div>
      </div>
    </div>
  );
}
