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
