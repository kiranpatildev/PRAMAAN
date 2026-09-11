"use client";

import { NODE_TYPES, TYPE_COLORS, TYPE_SHAPES, type GraphCommunity, type GraphData } from "./graph-types";

/** Self-explanatory graph: entity shapes/colors with live counts, edge
 *  types with counts, community count. No need to open the inspector. */
export function GraphLegend({ graph, communities }: { graph: GraphData | null; communities: GraphCommunity[] }) {
  if (!graph) return null;
  const nodeCounts: Record<string, number> = {};
  for (const n of graph.nodes) nodeCounts[n.type] = (nodeCounts[n.type] ?? 0) + 1;
  const edgeCounts: Record<string, number> = {};
  for (const e of graph.edges) edgeCounts[e.label] = (edgeCounts[e.label] ?? 0) + 1;

  return (
    <div className="card !p-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="font-semibold text-slate-200">Legend</span>
        {NODE_TYPES.filter((t) => nodeCounts[t] > 0).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 text-slate-300" title={`${t} nodes in view`}>
            <Swatch shape={TYPE_SHAPES[t] ?? "ellipse"} color={TYPE_COLORS[t] ?? "#38bdf8"} />
            {t} <b className="text-slate-100">{nodeCounts[t]}</b>
          </span>
        ))}
        {Object.entries(edgeCounts).map(([label, n]) => (
          <span key={label} className="inline-flex items-center gap-1.5 text-slate-300" title={`${label} edges in view`}>
            <span aria-hidden className="inline-block h-0 w-5 border-t-2 border-slate-500" />
            {label} <b className="text-slate-100">{n}</b>
          </span>
        ))}
        {communities.length > 1 && (
          <span className="text-slate-400">{communities.length} communities</span>
        )}
      </div>
    </div>
  );
}

// Split out so clip-path always applies (the inline attempt above is redundant by design).
function Swatch({ shape, color }: { shape: string; color: string }) {
  const clips: Record<string, string> = {
    ellipse: "ellipse(50% 50% at 50% 50%)",
    "round-rectangle": "inset(0% round 4px)",
    diamond: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
    hexagon: "polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%)",
    triangle: "polygon(50% 0%, 0% 100%, 100% 100%)",
    star: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
  };
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5"
      style={{ backgroundColor: color, clipPath: clips[shape] ?? clips.ellipse }}
    />
  );
}
