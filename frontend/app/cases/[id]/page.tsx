"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Core } from "cytoscape";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { AnalyticsPanel } from "@/components/analytics";import { CopilotPanel } from "@/components/copilot";
import { DistrictPanel } from "@/components/district";
import { GeoMap } from "@/components/geo-map";
import { ReportsCard } from "@/components/reports";
import { WorkflowPanel } from "@/components/workflow";
import { EvidenceManager } from "@/components/evidence-manager";
import { EvidencePanel, type EvidenceRef } from "@/components/evidence-panel";
import { GraphToolbar } from "@/components/graph-toolbar";
import { NODE_TYPES, type GraphData, type GraphFilters } from "@/components/graph-types";
import { ReplayControl } from "@/components/replay";
import { ReviewQueue } from "@/components/review-queue";
import { SnapshotManager } from "@/components/snapshots";
import { TimelineList } from "@/components/timeline-list";

const TYPE_COLORS: Record<string, string> = {
  Person: "#38bdf8",
  Organization: "#a78bfa",
  Location: "#22c55e",
  Vehicle: "#f59e0b",
  PhoneNumber: "#f472b6",
  Event: "#94a3b8",
};

const DEFAULT_FILTERS: GraphFilters = {
  types: [...NODE_TYPES],
  minConfidence: 0,
  dateFrom: "",
  dateTo: "",
};

function toElements(graph: GraphData) {
  return [
    ...graph.nodes.map((n) => ({
      data: {
        id: n.id, label: n.label, type: n.type,
        confidence_score: n.confidence, source_evidence_id: n.source_evidence_id,
        color: TYPE_COLORS[n.type] ?? "#38bdf8",
      },
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

/** Graph explorer centerpiece: live Neo4j data with type/confidence/date
 *  filters, expand-node, saved views + time comparison, and the evidence
 *  panel ("Why?" affordance) on every node/edge. */
export default function CaseGraphPage({ params }: { params: { id: string } }) {
  const { t } = useI18n();
  const mountRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);
  const [viewLabel, setViewLabel] = useState<string | null>(null);
  const [selected, setSelected] = useState<EvidenceRef | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [replayOn, setReplayOn] = useState(false);

  // @types/cytoscape omits singular show/hide/visible; all exist at runtime.
  type CyNode = { id(): string; show(): void; hide(): void; style(k: string, v: string | number): void };
  type CyEdge = CyNode & { data(k: string): string };

  function applyOverlay(scores: { key: string; level: string }[] | null) {
    const cy = cyRef.current;
    if (!cy) return;
    const colors: Record<string, string> = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
    const nodes = cy.nodes().toArray() as unknown as CyNode[];
    cy.batch(() => {
      if (!scores) {
        nodes.forEach((n) => {
          n.style("border-width", 0);
        });
        return;
      }
      const map = new Map(scores.map((s) => [s.key, s.level] as const));
      nodes.forEach((n) => {
        const lv = map.get(n.id());
        if (lv) {
          n.style("border-width", 4);
          n.style("border-color", colors[lv]);
        }
      });
    });
  }

  function applyReplay(ids: Set<string> | null) {
    const cy = cyRef.current;
    if (!cy) return;
    const edges = cy.edges().toArray() as unknown as CyEdge[];
    const nodes = cy.nodes().toArray() as unknown as CyNode[];
    cy.batch(() => {
      if (ids === null) {
        edges.forEach((e) => {
          e.show();
        });
        nodes.forEach((n) => {
          n.show();
        });
        return;
      }
      const shown = new Set<string>();
      edges.forEach((e) => {
        if (ids.has(e.id())) {
          e.show();
          shown.add(e.data("source"));
          shown.add(e.data("target"));
        } else {
          e.hide();
        }
      });
      nodes.forEach((n) => {
        if (shown.has(n.id())) {
          n.show();
        } else {
          n.hide();
        }
      });
    });
  }

  const refresh = useCallback(async (f: GraphFilters) => {
    const allTypes = f.types.length === NODE_TYPES.length;
    try {
      const g = await api.caseGraph(params.id, {
        ...(allTypes ? {} : { types: f.types.join(",") }),
        ...(f.minConfidence > 0 ? { min_confidence: f.minConfidence } : {}),
        ...(f.dateFrom ? { date_from: f.dateFrom } : {}),
        ...(f.dateTo ? { date_to: f.dateTo } : {}),
      });
      setGraph(g);
    } catch {
      /* not logged in / backend down — empty state renders */
    }
  }, [params.id]);

  // Debounced refetch on filter change.
  useEffect(() => {
    setViewLabel(null);
    const t = setTimeout(() => refresh(filters), 400);
    return () => clearTimeout(t);
  }, [filters, refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!mountRef.current || !graph) return;
      const cytoscape = (await import("cytoscape")).default;
      if (cancelled) return;
      cyRef.current?.destroy();
      const cy = cytoscape({
        container: mountRef.current,
        elements: toElements(graph),
        style: [
          { selector: "node", style: { "background-color": "data(color)", label: "data(label)", color: "#e2e8f0", "font-size": "10px" } },
          { selector: "edge", style: { "line-color": "#475569", "target-arrow-shape": "triangle", "target-arrow-color": "#475569", label: "data(label)", color: "#94a3b8", "font-size": "9px" } },
        ],
        layout: { name: "cose" },
      });
      cyRef.current = cy;
      cy.on("tap", "edge, node", (evt: { target: { data: () => Record<string, unknown> } }) => {
        const d = evt.target.data();
        const isEdge = d.source !== undefined;
        setSelected({
          edgeId: String(d.id ?? "?"),
          label: isEdge ? `${d.source} —[${d.label}]→ ${d.target}` : String(d.label ?? d.id),
          confidence: typeof d.confidence_score === "number" ? d.confidence_score : 0,
          sourceEvidenceId: String(d.source_evidence_id ?? "unknown"),
          snippet: isEdge
            ? String(d.snippet || "No snippet stored.")
            : `Confirmed ${d.type} entity (confidence ${((d.confidence_score as number) * 100).toFixed(0)}%).`,
          extractedOn: typeof d.extracted_on === "string" ? d.extracted_on : undefined,
          extractedBy: typeof d.extracted_by === "string" ? d.extracted_by : undefined,
          validFrom: typeof d.valid_from === "string" ? d.valid_from : undefined,
          nodeKey: isEdge ? undefined : String(d.id),
          isEdge,
        });
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [graph]);

  async function expand(nodeKey: string, depth: number) {
    const cy = cyRef.current;
    if (!cy) return;
    try {
      const nb = await api.expandGraph(params.id, nodeKey, depth);
      const els = toElements(nb);
      let added = 0;
      for (const el of els) {
        if (cy.getElementById(el.data.id).empty()) {
          cy.add(el);
          added += 1;
        }
      }
      if (added > 0) {
        cy.layout({ name: "cose", animate: true, animationDuration: 400, fit: false } as never).run();
      }
      setSelected((s) => (s ? { ...s, snippet: `${s.snippet} (+${added} elements expanded)` } : s));
    } catch {
      /* backend unreachable — selection stays */
    }
  }

  async function rebuild() {
    setRebuilding(true);
    try {
      await api.buildGraph(params.id);
      setTimeout(() => refresh(filters), 3000); // worker rebuilds async; re-fetch after
    } catch {
      /* broker down — reviewer sees error via queue actions */
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <div className="space-y-4">
      <GraphToolbar filters={filters} onChange={setFilters} />
      <ReplayControl caseId={params.id} active={replayOn} onToggle={setReplayOn} onStep={applyReplay} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="card">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">
              Case {params.id} — {t("case.graph", "graph explorer")}
              {viewLabel && <span className="ml-2 text-sm font-normal text-accent">viewing: {viewLabel}</span>}
            </h1>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">
                {graph ? `${graph.nodes.length} nodes · ${graph.edges.length} edges` : "loading…"}
              </span>
              <button className="btn !px-3 !py-1 text-xs" disabled={rebuilding} onClick={rebuild}>
                {rebuilding ? "Queued…" : t("case.rebuild", "Rebuild graph")}
              </button>
            </div>
          </div>
          <div ref={mountRef} className="mt-3 h-[320px] rounded-lg border border-ink-700 bg-ink-950 md:h-[480px]" />
          {!graph && <div className="skeleton mt-3 h-6 w-1/2" />}
          {graph && graph.nodes.length === 0 && (
            <p className="mt-2 text-sm text-slate-400">
              Empty graph — confirm entities in the review queue below, then rebuild.
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">drag · scroll to zoom · click edge for Why? · undated evidence always passes date filters</p>
        </div>
        <EvidencePanel ref_={selected} caseId={params.id} onClose={() => setSelected(null)} onExpand={expand} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SnapshotManager
          caseId={params.id}
          filters={filters}
          onLoad={(g, label) => { setGraph(g); setViewLabel(label); }}
        />
        <TimelineList caseId={params.id} />
      </div>
      <AnalyticsPanel caseId={params.id} onOverlay={applyOverlay} />
      <CopilotPanel caseId={params.id} />
      <div className="grid gap-4 lg:grid-cols-2">
        <GeoMap caseId={params.id} />
        <ReportsCard caseId={params.id} />
      </div>
      <WorkflowPanel caseId={params.id} />
      <ReviewQueue caseId={params.id} onChanged={() => setTimeout(() => refresh(filters), 2500)} />
      <EvidenceManager caseId={params.id} />
    </div>
  );
}
