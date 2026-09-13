"use client";

import { useEffect, useRef, useState } from "react";
import { Panel } from "../ui/Panel";
import { Empty } from "../ui/Empty";
import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { NetworkGraph } from "./NetworkGraph";
import { NetworkDetailPanel } from "./NetworkDetailPanel";
import { GraphSidebar } from "../network/GraphSidebar";
import { buildGraph, caseGraph, caseRelationships, expandGraph } from "@/lib/endpoints";
import { useToast } from "../ui/Toast";
import { Share2 } from "lucide-react";
import type { GraphCanvasHandle, CanvasEdge, CanvasNode } from "../network/GraphCanvas";
import { SnapshotsPanel } from "./SnapshotsPanel";

export function NetworkTab({ caseId: cid, highlightLabels = [], canEdit = false }: {
  caseId: string | number;
  highlightLabels?: string[];
  canEdit?: boolean;
}) {
  const toast = useToast();
  const canvasRef = useRef<GraphCanvasHandle>(null);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [clusters, setClusters] = useState<{ id: string; label: string; members: string[] }[]>([]);
  const [relCounts, setRelCounts] = useState<{ type: string; count: number }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = () => {
    setLoading(true);
    setError("");
    Promise.all([caseGraph(cid), caseRelationships(cid).catch(() => ({ types: [] as { type: string; count: number }[] }))])
      .then(([g, rel]) => {
        setNodes((g.nodes ?? []) as CanvasNode[]);
        setEdges((g.edges ?? []) as CanvasEdge[]);
        setClusters((g.clusters ?? []) as { id: string; label: string; members: string[] }[]);
        const fromEdges = new Map<string, number>();
        for (const e of g.edges ?? []) fromEdges.set(e.label, (fromEdges.get(e.label) ?? 0) + 1);
        setRelCounts(
          (rel.types ?? []).length
            ? rel.types
            : Array.from(fromEdges.entries()).map(([type, count]) => ({ type, count }))
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Graph failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [cid]);

  // Timeline handoff: highlight entities by label.
  useEffect(() => {
    if (!highlightLabels.length || !nodes.length) {
      setHighlight([]);
      return;
    }
    const ids = nodes
      .filter((n) => highlightLabels.some((l) => n.label.toLowerCase() === l.toLowerCase()))
      .map((n) => n.id);
    setHighlight(ids);
    if (ids.length) canvasRef.current?.focus(ids[0]);
  }, [highlightLabels, nodes]);

  async function onExpand() {
    if (!selectedId) return;
    try {
      const nb = await expandGraph(cid, selectedId, 1);
      setNodes((ns) => {
        const have = new Set(ns.map((n) => n.id));
        return [...ns, ...(nb.nodes ?? []).filter((n) => !have.has(n.id))];
      });
      setEdges((es) => {
        const have = new Set(es.map((e) => e.id));
        return [...es, ...(nb.edges ?? []).filter((e) => !have.has(e.id))];
      });
    } catch (err) {
      toast({ kind: "warn", title: "Expand failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  async function onRebuild() {
    try {
      await buildGraph(cid);
      toast({ kind: "ok", title: "Graph rebuild queued", body: "Confirmed rows rebuild in the background." });
    } catch (err) {
      toast({ kind: "warn", title: "Rebuild failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)_320px] gap-[18px] max-[1200px]:grid-cols-[220px_minmax(0,1fr)]">
      <div className="border-r border-line pr-[18px]">
        <GraphSidebar
          nodes={nodes}
          edges={edges}
          relCounts={relCounts}
          onFocusId={(id) => {
            setSelectedId(id);
            canvasRef.current?.focus(id);
          }}
          onHighlight={(ids) => {
            setHighlight(ids ?? []);
            if (ids?.length) canvasRef.current?.focus(ids[0]);
          }}
        />
      </div>

      <div className="min-w-0">
        {error ? (
          <Notice variant="warn" action={<Button variant="ghost" small onClick={refresh}>Retry</Button>}>
            {error}
          </Notice>
        ) : (
          <NetworkGraph
            canvasRef={canvasRef}
            nodes={nodes}
            edges={edges}
            clusters={clusters}
            selectedId={selectedId}
            highlightIds={highlight}
            onSelect={setSelectedId}
            onExpand={onExpand}
            onFilter={() => selectedId && canvasRef.current?.isolate(selectedId)}
            onReset={() => {
              canvasRef.current?.isolate(null);
              setHighlight([]);
              refresh();
            }}
          />
        )}
        {loading && <p className="mt-2 font-mono text-[11px] text-fg-4">Loading graph…</p>}
        {canEdit && (
          <div className="mt-2">
            <Button variant="ghost" small onClick={onRebuild}>
              Rebuild graph
            </Button>
          </div>
        )}
        <div className="mt-[18px]">
          <SnapshotsPanel caseId={cid} canEdit={canEdit} />
        </div>
      </div>

      <aside className="border-l border-line bg-panel-2 pl-[18px] max-[1200px]:col-span-2 max-[1200px]:border-l-0 max-[1200px]:border-t max-[1200px]:pl-0 max-[1200px]:pt-[18px]">
        {selected ? (
          <NetworkDetailPanel node={selected} edges={edges} nodes={nodes} onSelect={setSelectedId} />
        ) : (
          <Panel title="Details">
            <Empty icon={Share2} title="Nothing selected" body="Click a node to inspect it here." />
          </Panel>
        )}
      </aside>
    </div>
  );
}
