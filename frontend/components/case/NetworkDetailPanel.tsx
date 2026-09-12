"use client";

/** Network-tab right panel: same detail structure as Entities. */
import { EntityDetailPanel, type RelCardData } from "../case/EntityDetailPanel";
import type { CanvasEdge, CanvasNode } from "../network/GraphCanvas";
import type { TimelineEvent } from "@/lib/types";

export function NetworkDetailPanel({ node, edges, nodes, onSelect }: {
  node: CanvasNode | null;
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  onSelect: (id: string) => void;
}) {
  if (!node) {
    return (
      <EntityDetailPanel
        entity={null}
        relations={[]}
        events={[]}
        canVerify={false}
        showActions={false}
        onConfirm={() => {}}
        onReject={() => {}}
        onSelect={() => {}}
      />
    );
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rels: RelCardData[] = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const otherId = e.source === node.id ? e.target : e.source;
      const other = byId.get(otherId);
      return {
        id: e.id,
        otherId,
        other: other?.label ?? otherId,
        otherType: other?.type,
        edge: e.label,
        confidence: e.confidence ?? 0,
      };
    });

  return (
    <EntityDetailPanel
      entity={{
        id: node.id,
        node_type: node.type,
        value: node.label,
        confidence: node.confidence ?? 1,
        status: "confirmed",
      }}
      relations={rels}
      events={[] as TimelineEvent[]}
      evidenceNote="Graph nodes render confirmed rows only."
      canVerify={false}
      showActions={false}
      onConfirm={() => {}}
      onReject={() => {}}
      onSelect={(id) => onSelect(String(id))}
    />
  );
}
