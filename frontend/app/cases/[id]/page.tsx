"use client";

/** Case workspace: header (breadcrumb, badges, pipeline) + sticky tab bar +
 *  Overview · Team · Evidence · Entities · Network Graph · Timeline ·
 *  Cross-Case Links · Notes & Log. All explorer logic (cytoscape lifecycle,
 *  filters, expand, replay, overlay, rebuild) is preserved from the prior
 *  implementation — only the structure around it changed. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Core } from "cytoscape";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { AnalyticsPanel } from "@/components/analytics";
import { TeamPanel } from "@/components/team-panel";
import { CaseOverview } from "@/components/case-overview";
import { CaseBrief } from "@/components/case-brief";
import { WorkspaceHeader, type CaseCounts } from "@/components/workspace-header";
import { CrossCasePanel } from "@/components/cross-case";
import { AiReviewQueue } from "@/components/ai-review-queue";
import { GeoMap } from "@/components/geo-map";
import { ReportsCard } from "@/components/reports";
import { WorkflowPanel } from "@/components/workflow";
import { EvidenceManager } from "@/components/evidence-manager";
import { EvidencePanel, type EvidenceRef } from "@/components/evidence-panel";
import { GraphControls } from "@/components/graph-controls";
import { NODE_TYPES, TYPE_SHAPES, toElements, type GraphCommunity, type GraphData, type GraphFilters } from "@/components/graph-types";
import { ReplayControl } from "@/components/replay";
import { ReviewQueue } from "@/components/review-queue";
import { SnapshotManager } from "@/components/snapshots";
import { TimelineList } from "@/components/timeline-list";
import { Icon } from "@/components/ui";

const DEFAULT_FILTERS: GraphFilters = {
  types: [...NODE_TYPES],
  minConfidence: 0,
  dateFrom: "",
  dateTo: "",
};

type Tab = { id: string; label: string };

export default function CaseWorkspacePage({ params }: { params: { id: string } }) {
  const { t } = useI18n();
  const mountRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const layoutRef = useRef<{ stop(): void } | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);
  const [viewLabel, setViewLabel] = useState<string | null>(null);
  const [selected, setSelected] = useState<EvidenceRef | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [replayOn, setReplayOn] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [me, setMe] = useState<{ username?: string; role?: string } | null>(null);
  const [communities, setCommunities] = useState<GraphCommunity[]>([]);
  const [commOf, setCommOf] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<CaseCounts>({ evidence: 0, entities: 0 });
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    api.me().then(setMe).catch(() => {});
  }, []);

  const role = me?.role ?? null;
  const isSHO = role === "sho" || role === "admin";

  const tabs: Tab[] = [
    { id: "overview", label: "Overview" },
    ...(isSHO ? [{ id: "team", label: "Team" }] : []),
    { id: "evidence", label: `Evidence (${counts.evidence})` },
    { id: "entities", label: `Entities (${counts.entities})` },
    { id: "graph", label: "Network Graph" },
    { id: "timeline", label: "Timeline" },
    { id: "crosscase", label: "Cross-Case Links" },
    { id: "workflow", label: "Notes & Log" },
  ];

  // @types/cytoscape omits singular show/hide/visible; all exist at runtime.
  type CyNode = { id(): string; show(): void; hide(): void; style(k: string, v: string | number): void };
  type CyEdge = CyNode & { data(k: string): string };

  // A tracked instance may have been destroyed by a newer render —
  // never touch Cytoscape through a dead reference (stale animation
  // frames on destroyed instances throw inside cytoscape's renderer).
  function liveCy(): Core | null {
    const cy = cyRef.current;
    if (!cy) return null;
    try {
      if (cy.destroyed()) {
        if (cyRef.current === cy) cyRef.current = null;
        return null;
      }
    } catch {
      return null;
    }
    return cy;
  }

  function applyOverlay(scores: { key: string; level: string }[] | null) {
    const cy = liveCy();
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
    const cy = liveCy();
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

  /** Highlight a shortest-path node chain (path analysis box). */
  function highlightPath(nodeIds: string[] | null) {
    const cy = liveCy();
    if (!cy || !graph) return;
    try {
      cy.elements().unselect();
      if (!nodeIds || nodeIds.length === 0) return;
      const inPath = new Set(nodeIds);
      const edgeIds = new Set<string>();
      for (let i = 0; i < nodeIds.length - 1; i++) {
        const e = graph.edges.find(
          (x) =>
            (x.source === nodeIds[i] && x.target === nodeIds[i + 1]) ||
            (x.source === nodeIds[i + 1] && x.target === nodeIds[i])
        );
        if (e) edgeIds.add(e.id);
      }
      cy.batch(() => {
        nodeIds.forEach((id) => {
          const el = cy.getElementById(id);
          if (!el.empty()) el.select();
        });
        edgeIds.forEach((id) => {
          const el = cy.getElementById(id);
          if (!el.empty()) el.select();
        });
      });
      const first = cy.getElementById(nodeIds[0]);
      if (!first.empty()) cy.center(first);
    } catch {
      /* instance gone mid-gesture */
    }
  }

  function zoomBy(f: number) {
    const cy = liveCy();
    if (!cy) return;
    try {
      cy.zoom({ level: cy.zoom() * f, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    } catch {
      /* instance gone mid-gesture */
    }
  }

  function fitView() {
    const cy = liveCy();
    if (!cy) return;
    try {
      cy.fit(undefined, 30);
    } catch {
      /* instance gone mid-gesture */
    }
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

  // Community regions (GDS Louvain): fetched once per case + after rebuilds,
  // never per keystroke — the overview call is the expensive one.
  const refreshCommunities = useCallback(async () => {
    try {
      const ov = await api.analyticsOverview(params.id);
      const list: GraphCommunity[] = (ov.communities ?? [])
        .map((c: { id: string; members: string[] }) => ({
          id: String(c.id),
          label: "",
          size: (c.members ?? []).length,
          members: c.members ?? [],
        }))
        .filter((c: GraphCommunity) => c.size > 0)
        .sort((a: GraphCommunity, b: GraphCommunity) => b.size - a.size);
      list.forEach((c, i) => {
        c.label = `Community ${i + 1}`;
      });
      const map: Record<string, string> = {};
      for (const c of list) for (const m of c.members) map[m] = c.label;
      setCommunities(list);
      setCommOf(map);
    } catch {
      setCommunities([]);
      setCommOf({});
    }
  }, [params.id]);

  useEffect(() => {
    refreshCommunities();
  }, [refreshCommunities]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!mountRef.current || !graph) return;
      const cytoscape = (await import("cytoscape")).default;
      if (cancelled || !mountRef.current) return;
      // Tear down the previous instance first: a leaked instance keeps its
      // requestAnimationFrame loop alive and throws against the reused container.
      const prev = cyRef.current;
      cyRef.current = null;
      try {
        if (prev && !prev.destroyed()) prev.destroy();
      } catch {
        /* already gone */
      }
      if (cancelled || !mountRef.current) return;
      let cy: Core;
      try {
        cy = cytoscape({
          container: mountRef.current,
          elements: toElements(graph, commOf),
          style: [
            // Label policy (anti-soup): nodes show text only when major
            // (degree ≥ 3), hovered/selected, or zoomed in past the floor.
            // Edges show text only when hovered/selected.
            {
              selector: "node",
              style: {
                "background-color": "data(color)",
                color: "#e2e8f0",
                "font-size": "11px",
                label: "data(label)",
                "min-zoomed-font-size": 18,
                "text-outline-color": "#0b0f17",
                "text-outline-width": 2,
              },
            },
            ...(Object.entries(TYPE_SHAPES).map(([t, s]) => ({
              selector: `node[type = "${t}"]`,
              style: { shape: s },
            }))),
            {
              selector: "node.major, node:selected, node.hovered",
              style: { label: "data(label)", "min-zoomed-font-size": 0 },
            },
            {
              selector: "node:selected",
              style: { "overlay-padding": 5, "overlay-opacity": 0.25, "overlay-color": "#ffffff" },
            },
            {
              selector: "node:parent",
              style: {
                shape: "round-rectangle",
                "background-color": "#3B82F6",
                "background-opacity": 0.07,
                "border-width": 1,
                "border-color": "#1F2733",
                label: "data(label)",
                "font-size": "11px",
                color: "#8B93A1",
                "text-valign": "top",
                "text-halign": "center",
                padding: "10px",
                "min-zoomed-font-size": 0,
              },
            },
            {
              selector: "edge",
              style: {
                "line-color": "#475569",
                "target-arrow-shape": "triangle",
                "target-arrow-color": "#475569",
                label: "",
                color: "#8B93A1",
                "font-size": "9px",
              },
            },
            {
              selector: "edge:selected, edge.hovered",
              style: { label: "data(label)", width: 2.5 },
            },
          ],
          // animate:false is load-bearing: cose animates by default and its
          // rAF loop outlives cy.destroy() (destroy stops the renderer loop
          // but NOT running layouts), crashing every frame on a nulled
          // renderer. Only the expand layout animates, and it is tracked +
          // stopped explicitly via layoutRef.
          layout: { name: "cose", animate: false },
        });
      } catch {
        return; // container detached mid-init (navigated away)
      }
      if (cancelled) {
        try {
          if (!cy.destroyed()) cy.destroy();
        } catch {
          /* already gone */
        }
        return;
      }
      cyRef.current = cy;
      setZoom(Math.round(cy.zoom() * 100));
      cy.on("zoom", () => {
        try {
          const z = cyRef.current;
          if (z && !z.destroyed()) setZoom(Math.round(z.zoom() * 100));
        } catch {
          /* instance gone mid-gesture */
        }
      });
      const hoverIn = (evt: { target: { addClass(c: string): void } }) => {
        try {
          evt.target.addClass("hovered");
        } catch {
          /* instance gone mid-gesture */
        }
      };
      const hoverOut = (evt: { target: { removeClass(c: string): void } }) => {
        try {
          evt.target.removeClass("hovered");
        } catch {
          /* instance gone mid-gesture */
        }
      };
      cy.on("mouseover", "node, edge", hoverIn);
      cy.on("mouseout", "node, edge", hoverOut);
      cy.on("tap", "edge, node", (evt: { target: { data: () => Record<string, unknown> } }) => {
        const d = evt.target.data();
        // Community regions are visual grouping only — not inspectable entities.
        if (d.type === "__community") return;
        const isEdge = d.source !== undefined;
        const id = String(d.id ?? "?");
        let degree: number | undefined;
        let relations: { id: string; label: string; other: string; otherId: string; confidence: number }[] | undefined;
        let nodeType: string | undefined;
        if (!isEdge) {
          const labels: Record<string, string> = {};
          for (const n of graph.nodes) labels[n.id] = n.label;
          relations = graph.edges
            .filter((e) => e.source === id || e.target === id)
            .map((e) => {
              const otherId = e.source === id ? e.target : e.source;
              return {
                id: e.id, label: e.label, other: labels[otherId] ?? otherId,
                otherId, confidence: e.confidence,
              };
            });
          degree = relations.length;
          nodeType = String(d.type ?? "");
        }
        const conf = typeof d.confidence_score === "number" ? d.confidence_score : 0;
        setSelected({
          edgeId: String(d.id ?? "?"),
          label: isEdge ? `${d.source} —[${d.label}]→ ${d.target}` : String(d.label ?? d.id),
          confidence: conf,
          sourceEvidenceId: String(d.source_evidence_id ?? "unknown"),
          snippet: isEdge
            ? String(d.snippet || "No snippet stored.")
            : `Confirmed ${d.type} entity (confidence ${(conf * 100).toFixed(0)}%).`,
          extractedOn: typeof d.extracted_on === "string" ? d.extracted_on : undefined,
          extractedBy: typeof d.extracted_by === "string" ? d.extracted_by : undefined,
          validFrom: typeof d.valid_from === "string" ? d.valid_from : undefined,
          nodeKey: isEdge ? undefined : String(d.id),
          isEdge,
          nodeType: isEdge ? undefined : nodeType,
          degree,
          community: isEdge ? undefined : commOf[id] ?? null,
          relations,
        });
      });
    })();
    return () => {
      cancelled = true;
      try {
        layoutRef.current?.stop();
      } catch {
        /* no layout running */
      }
      layoutRef.current = null;
      const cur = cyRef.current;
      cyRef.current = null;
      try {
        if (cur && !cur.destroyed()) cur.destroy();
      } catch {
        /* already gone */
      }
    };
  }, [graph, commOf]);

  async function expand(nodeKey: string, depth: number) {
    const cy = liveCy();
    if (!cy) return;
    try {
      const nb = await api.expandGraph(params.id, nodeKey, depth);
      if (liveCy() !== cy) return; // instance replaced while fetching
      const els = toElements(nb);
      let added = 0;
      for (const el of els) {
        if (cy.getElementById(el.data.id).empty()) {
          cy.add(el);
          added += 1;
        }
      }
      if (added > 0) {
        try {
          layoutRef.current?.stop();
        } catch {
          /* no layout running */
        }
        const layout = cy.layout({ name: "cose", animate: true, animationDuration: 400, fit: false } as never);
        layoutRef.current = layout;
        layout.run();
      }
      setSelected((s) => (s ? { ...s, snippet: `${s.snippet} (+${added} elements expanded)` } : s));
    } catch {
      /* backend unreachable — selection stays */
    }
  }

  function goSection(id: string) {
    setActiveTab(id);
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Scroll-spy: the sticky tab bar follows manual scrolling.
  useEffect(() => {
    const ids = ["overview", ...(isSHO ? ["team"] : []), "evidence", "entities", "graph", "timeline", "crosscase", "workflow"];
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveTab(e.target.id.replace(/^sec-/, ""));
        }
      },
      { rootMargin: "-30% 0px -60% 0px" }
    );
    for (const id of ids) {
      const el = document.getElementById(`sec-${id}`);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [isSHO, graph !== null]);

  function nodeById(id: string) {
    return graph?.nodes.find((n) => n.id === id);
  }

  function selectNode(id: string) {
    const n = nodeById(id);
    if (!n || !graph) return;
    const relations = graph.edges
      .filter((e) => e.source === id || e.target === id)
      .map((e) => {
        const otherId = e.source === id ? e.target : e.source;
        const other = nodeById(otherId);
        return { id: e.id, label: e.label, other: other?.label ?? otherId, otherId, confidence: e.confidence };
      });
    setSelected({
      edgeId: id,
      label: n.label,
      confidence: n.confidence,
      sourceEvidenceId: String(n.source_evidence_id ?? "unknown"),
      snippet: `Confirmed ${n.type} entity.`,
      nodeKey: id,
      isEdge: false,
      nodeType: n.type,
      degree: relations.length,
      community: commOf[id] ?? null,
      relations,
    });
    const cy = liveCy();
    if (cy) {
      try {
        cy.getElementById(id).select();
        cy.center(cy.getElementById(id));
      } catch {
        /* instance gone mid-gesture */
      }
    }
  }

  function focusNode(id: string) {
    selectNode(id);
  }

  /** Timeline → graph handoff: match an entity name to a node id. */
  function selectByLabel(name: string) {
    if (!graph) return;
    const needle = name.trim().toLowerCase();
    const n =
      graph.nodes.find((x) => x.label.toLowerCase() === needle) ??
      graph.nodes.find((x) => x.label.toLowerCase().includes(needle));
    if (!n) return;
    goSection("graph");
    setTimeout(() => selectNode(n.id), 350);
  }

  function filterAround(id: string | null) {
    const cy = liveCy();
    if (!cy || !graph) return;
    try {
      if (id === null) {
        cy.batch(() => {
          cy.edges().forEach((e) => (e as unknown as { show(): void }).show());
          cy.nodes().forEach((n) => (n as unknown as { show(): void }).show());
        });
        return;
      }
      const keep = new Set<string>([id]);
      const keepEdges = new Set<string>();
      for (const e of graph.edges) {
        if (e.source === id || e.target === id) {
          keep.add(e.source);
          keep.add(e.target);
          keepEdges.add(e.id);
        }
      }
      cy.batch(() => {
        cy.edges().forEach((e) => {
          const el = e as unknown as { id(): string; show(): void; hide(): void };
          if (keepEdges.has(el.id())) el.show();
          else el.hide();
        });
        cy.nodes().forEach((n) => {
          const el = n as unknown as { id(): string; show(): void; hide(): void };
          if (keep.has(el.id()) || el.id().startsWith("$community-")) el.show();
          else el.hide();
        });
      });
    } catch {
      /* instance gone mid-gesture */
    }
  }
  async function rebuild() {
    setRebuilding(true);
    try {
      await api.buildGraph(params.id);
      setTimeout(() => {
        refresh(filters);
        refreshCommunities();
      }, 3000); // worker rebuilds async; re-fetch after
    } catch {
      /* broker down — reviewer sees error via queue actions */
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <div className="space-y-4">
      <WorkspaceHeader caseId={params.id} onLoaded={setCounts} />

      {/* ---------- sticky tab bar ---------- */}
      <div className="sticky top-[57px] z-30 -mx-4 border-y border-[#1F2733] bg-[#0B0F17]/95 px-4 backdrop-blur lg:-mx-6 lg:px-6">
        <div className="flex items-center gap-1 overflow-x-auto py-2" role="tablist" aria-label="Case sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => goSection(tab.id)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-[#3B82F6]/12 font-semibold text-[#3B82F6]"
                  : "text-[#8B93A1] hover:bg-[#1A2233] hover:text-[#E5E7EB]"
              }`}
            >
              {tab.label}
            </button>
          ))}
          <span className="flex-1" />
          <a href={`/copilot?case=${params.id}`}
            className="hidden shrink-0 items-center gap-1.5 rounded-md border border-[#A855F7]/40 px-2.5 py-1.5 text-xs font-semibold text-[#A855F7] hover:bg-[#A855F7]/10 sm:inline-flex"
            title="Ask the AI assistant about this case">
            <Icon name="spark" className="h-3.5 w-3.5" /> Ask about this case
          </a>
        </div>
      </div>

      <section id="sec-overview" className="scroll-mt-32 space-y-4">
        <CaseOverview caseId={params.id} />
        <CaseBrief caseId={params.id} onInspect={(id) => { goSection("graph"); setTimeout(() => selectNode(id), 350); }} />
      </section>

      {isSHO && (
        <section id="sec-team" className="scroll-mt-32">
          <TeamPanel caseId={params.id} isSHO={isSHO} />
        </section>
      )}

      <section id="sec-evidence" className="scroll-mt-32">
        <EvidenceManager caseId={params.id} />
      </section>

      <section id="sec-entities" className="scroll-mt-32">
        <ReviewQueue
          caseId={params.id}
          onChanged={() => setTimeout(() => refresh(filters), 2500)}
          preview={graph}
          commOf={commOf}
          onInspectNode={(id) => { goSection("graph"); setTimeout(() => selectNode(id), 350); }}
        />
      </section>

      <section id="sec-graph" className="scroll-mt-32 space-y-4">
        <ReplayControl caseId={params.id} active={replayOn} onToggle={setReplayOn} onStep={applyReplay} />
        <div className="grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
          <GraphControls
            graph={graph}
            filters={filters}
            onFilters={setFilters}
            onFocus={focusNode}
            onExpand={(id) => expand(id, 2)}
            onFilter={filterAround}
            onReset={() => { filterAround(null); highlightPath(null); }}
            onPath={highlightPath}
          />

          <div className="rounded-lg border border-[#1F2733] bg-[#121826]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2733] px-4 py-2.5">
              <h2 className="text-sm font-bold">
                Case {params.id} — {t("case.graph", "graph explorer")}
                {viewLabel && <span className="ml-2 font-mono text-xs font-normal text-[#3B82F6]">viewing: {viewLabel}</span>}
              </h2>
              <div className="flex items-center gap-1.5">
                <button onClick={() => zoomBy(1.25)} className="rounded-md border border-[#1F2733] p-1.5 text-[#8B93A1] hover:border-[#3B82F6] hover:text-[#E5E7EB]" title="Zoom in" aria-label="Zoom in">
                  <Icon name="plus" className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-12 text-center font-mono text-[11px] text-[#8B93A1]">{zoom}%</span>
                <button onClick={() => zoomBy(0.8)} className="rounded-md border border-[#1F2733] p-1.5 text-[#8B93A1] hover:border-[#3B82F6] hover:text-[#E5E7EB]" title="Zoom out" aria-label="Zoom out">
                  <Icon name="minus" className="h-3.5 w-3.5" />
                </button>
                <button onClick={fitView} className="rounded-md border border-[#1F2733] p-1.5 text-[#8B93A1] hover:border-[#3B82F6] hover:text-[#E5E7EB]" title="Fit to view" aria-label="Fit to view">
                  <Icon name="fit" className="h-3.5 w-3.5" />
                </button>
                <button className="btn ml-1 !px-3 !py-1.5 text-xs" disabled={rebuilding} onClick={rebuild}>
                  {rebuilding ? "Queued…" : t("case.rebuild", "Rebuild graph")}
                </button>
              </div>
            </div>

            <div className="relative">
              <div ref={mountRef} className="h-[420px] bg-[#0B0F17] md:h-[520px]" />
              <p className="pointer-events-none absolute right-3 top-2.5 font-mono text-[10px] tracking-wider text-[#8B93A1]">
                {graph ? `${graph.nodes.length} NODES · ${graph.edges.length} EDGES` : "LOADING…"}
              </p>
              {!graph && <div className="skeleton absolute inset-x-8 top-1/2 h-6" />}
              {graph && graph.nodes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center p-6">
                  <p className="max-w-sm text-center text-sm text-[#8B93A1]">
                    Empty graph — confirm entities in the review queue, then rebuild.
                  </p>
                </div>
              )}
              <p className="pointer-events-none absolute inset-x-0 bottom-8 text-center font-mono text-[10px] tracking-wide text-[#8B93A1]/80">
                Analytical confidence does not represent guilt or criminality
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#1F2733] px-4 py-2 font-mono text-[11px] text-[#8B93A1]">
              <span>ZOOM {zoom}%</span>
              <span>{graph ? `NODES ${graph.nodes.length} · EDGES ${graph.edges.length}` : "—"}</span>
              <span className="min-w-0 flex-1 truncate normal-case">
                {selected ? `selected: ${selected.label}` : "drag · scroll to zoom · hover or zoom in for labels · click node or edge for Why?"}
              </span>
            </div>
          </div>

          <EvidencePanel ref_={selected} caseId={params.id} onClose={() => setSelected(null)} onExpand={expand} onSelectNode={selectNode} />
        </div>

        <SnapshotManager
          caseId={params.id}
          filters={filters}
          onLoad={(g, label) => { setGraph(g); setViewLabel(label); }}
        />
        <AnalyticsPanel caseId={params.id} onOverlay={applyOverlay} />
      </section>

      <section id="sec-timeline" className="scroll-mt-32">
        <TimelineList caseId={params.id} onSelectEntity={selectByLabel} />
      </section>

      <section id="sec-crosscase" className="scroll-mt-32 space-y-4">
        <div className="grid items-start gap-4 xl:grid-cols-[1fr_340px]">
          <CrossCasePanel caseId={params.id} />
          <AiReviewQueue caseId={params.id} onReview={() => goSection("entities")} />
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <GeoMap caseId={params.id} />
          <ReportsCard caseId={params.id} />
        </div>
      </section>

      <section id="sec-workflow" className="scroll-mt-32">
        <WorkflowPanel caseId={params.id} />
      </section>
    </div>
  );
}
