export type GraphNode = {
  id: string; label: string; type: string; confidence: number;
  source_evidence_id: number | string | null;
};
export type GraphEdge = {
  id: string; source: string; target: string; label: string; confidence: number;
  source_evidence_id: number | string | null; snippet: string;
  extracted_on: string; extracted_by: string; valid_from: string | null;
};
export type GraphData = {
  nodes: GraphNode[]; edges: GraphEdge[]; live?: boolean;
  filters?: Record<string, unknown>;
};
export type GraphFilters = {
  types: string[];
  minConfidence: number; // 0..1
  dateFrom: string;
  dateTo: string;
};
export const NODE_TYPES = ["Person", "Organization", "Location", "Vehicle", "PhoneNumber", "Event"];

// Single source of truth for entity visuals (graph canvas + legend share it).
// Hexes mirror lib/theme.ts ENTITY_COLOR.
export const TYPE_COLORS: Record<string, string> = {
  Person: "#3B82F6",
  Organization: "#A855F7",
  Location: "#22C55E",
  Vehicle: "#F59E0B",
  PhoneNumber: "#14B8A6",
  Event: "#9CA3AF",
};

// Cytoscape-native shapes — type is readable without relying on color alone.
export type NodeShape =
  | "ellipse" | "round-rectangle" | "diamond" | "hexagon" | "triangle" | "star";
export const TYPE_SHAPES: Record<string, NodeShape> = {
  Person: "ellipse",
  Organization: "round-rectangle",
  Location: "diamond",
  Vehicle: "hexagon",
  PhoneNumber: "triangle",
  Event: "star",
};

export type GraphCommunity = { id: string; label: string; size: number; members: string[] };

// Parent id prefix (can never collide: node keys are `{case}:{Type}:{name}`).
export const parentId = (cid: string) => `$community-${cid}`;

/** Shared element builder: degree classes, community regions, per-type
 *  color/shape. Used by the full explorer and the entities-tab preview. */
export function toElements(graph: GraphData, commOf: Record<string, string> = {}) {
  const degree: Record<string, number> = {};
  for (const e of graph.edges) {
    degree[e.source] = (degree[e.source] ?? 0) + 1;
    degree[e.target] = (degree[e.target] ?? 0) + 1;
  }
  // Only communities with ≥2 members present earn a visible region.
  const present: Record<string, string[]> = {};
  for (const n of graph.nodes) {
    const c = commOf[n.id];
    if (c) (present[c] ??= []).push(n.id);
  }
  const regions = Object.entries(present).filter(([, ms]) => ms.length >= 2);
  const nodeParent: Record<string, string> = {};
  for (const [c, ms] of regions) for (const id of ms) nodeParent[id] = parentId(c);
  return [
    ...regions.map(([c, ms]) => ({
      data: { id: parentId(c), label: `${c} · ${ms.length}`, type: "__community" },
    })),
    ...graph.nodes.map((n) => ({
      data: {
        id: n.id, label: n.label, type: n.type,
        confidence_score: n.confidence, source_evidence_id: n.source_evidence_id,
        color: TYPE_COLORS[n.type] ?? "#3B82F6",
        shape: TYPE_SHAPES[n.type] ?? "ellipse",
        community: commOf[n.id] ?? "",
        ...(nodeParent[n.id] ? { parent: nodeParent[n.id] } : {}),
      },
      classes: (degree[n.id] ?? 0) >= 3 ? "major" : "",
    })),
    ...graph.edges.map((e) => ({
      data: {
        id: e.id, source: e.source, target: e.target, label: e.label,
        confidence_score: e.confidence, source_evidence_id: e.source_evidence_id,
        snippet: e.snippet, extracted_on: e.extracted_on, extracted_by: e.extracted_by,
        valid_from: e.valid_from,
      },
    })),
  ];
}
