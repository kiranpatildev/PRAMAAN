"use client";

import { useState, type RefObject } from "react";
import { Info, Plus, Minus, Maximize } from "lucide-react";
import { GraphCanvas, type GraphCanvasHandle, type CanvasCluster, type CanvasEdge, type CanvasNode } from "../network/GraphCanvas";
import { Button } from "../ui/Button";

/** Center column assembly: toolbar, zoom stack, full-bleed canvas, footer. */
export function NetworkGraph({ canvasRef, nodes, edges, clusters, selectedId, highlightIds, onSelect, onExpand, onFilter, onReset }: {
  canvasRef: RefObject<GraphCanvasHandle>;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  clusters: CanvasCluster[];
  selectedId: string | null;
  highlightIds: string[];
  onSelect: (id: string | null) => void;
  onExpand: () => void;
  onFilter: () => void;
  onReset: () => void;
}) {
  const [zoom, setZoom] = useState(100);

  const zoomBy = (f: number) => {
    if (f > 1) canvasRef.current?.zoomIn();
    else canvasRef.current?.zoomOut();
    // Displayed % tracks the buttons; the canvas owns exact scale.
    setZoom((z) => Math.max(30, Math.min(300, Math.round(z * f))));
  };

  return (
    <div className="relative min-h-[660px] overflow-hidden rounded-md border border-line bg-bg">
      <div className="absolute left-3 top-3 z-10 flex gap-[6px]">
        <Button
          variant="ghost"
          small
          onClick={() => {
            if (selectedId) canvasRef.current?.focus(selectedId);
          }}
        >
          Focus
        </Button>
        <Button variant="ghost" small onClick={onExpand}>
          Expand
        </Button>
        <Button variant="ghost" small onClick={onFilter}>
          Filter
        </Button>
        <Button variant="ghost" small onClick={onReset}>
          Reset
        </Button>
      </div>

      <div className="absolute right-3 top-3 z-10 flex flex-col gap-[6px]">
        <button
          type="button"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.25)}
          className="flex h-7 w-7 items-center justify-center rounded border border-line bg-panel-2 text-fg-3 transition-colors duration-120 hover:border-line-2 hover:text-fg"
        >
          <Plus size={14} strokeWidth={1.6} aria-hidden />
        </button>
        <button
          type="button"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => zoomBy(0.8)}
          className="flex h-7 w-7 items-center justify-center rounded border border-line bg-panel-2 text-fg-3 transition-colors duration-120 hover:border-line-2 hover:text-fg"
        >
          <Minus size={14} strokeWidth={1.6} aria-hidden />
        </button>
        <button
          type="button"
          title="Fit"
          aria-label="Fit to view"
          onClick={() => canvasRef.current?.fit()}
          className="flex h-7 w-7 items-center justify-center rounded border border-line bg-panel-2 text-fg-3 transition-colors duration-120 hover:border-line-2 hover:text-fg"
        >
          <Maximize size={14} strokeWidth={1.6} aria-hidden />
        </button>
      </div>

      <GraphCanvas
        ref={canvasRef}
        nodes={nodes}
        edges={edges}
        clusters={clusters}
        selectedId={selectedId}
        highlightIds={highlightIds}
        onSelect={onSelect}
      />

      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 border-t border-line bg-panel px-[14px] py-[9px]">
        <span className="font-mono text-[10.5px] text-fg-3">
          Zoom {zoom}% · Nodes {nodes.length} · Edges {edges.length}
        </span>
        <span className="flex items-center gap-[7px] text-[11.5px] text-fg-3">
          <Info size={13} strokeWidth={1.6} aria-hidden />
          Analytical confidence does not represent guilt or criminality
        </span>
      </div>
    </div>
  );
}
