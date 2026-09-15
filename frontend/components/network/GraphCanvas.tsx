"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { ENTITY_META, entityKind } from "@/lib/case";

export interface CanvasNode {
  id: string;
  label: string;
  type: string;
  confidence?: number;
  cluster?: string | null;
  cluster_label?: string | null;
  source_evidence_id?: number | string | null;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  confidence?: number;
  snippet?: string;
  source_evidence_id?: number | string | null;
}

export interface CanvasCluster {
  id: string;
  label: string;
  members: string[];
}

export interface GraphCanvasHandle {
  focus: (id: string) => void;
  reset: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  isolate: (id: string | null) => void;
}

interface SimNode extends CanvasNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
  hidden: boolean;
}

const FG = "rgba(230,237,243,.75)";
const GRID = "rgba(26,34,45,.5)";

function nodeColor(type: string): string {
  return ENTITY_META[entityKind(type)].color;
}

function nodeRadius(type: string): number {
  return entityKind(type) === "case" ? 9 : 6;
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  clusters: CanvasCluster[];
  selectedId: string | null;
  highlightIds?: string[];
  highlightEdgeIds?: string[];
  onSelect: (id: string | null) => void;
  onZoom?: (scale: number) => void;
}>(function GraphCanvas({ nodes, edges, clusters, selectedId, highlightIds = [], highlightEdgeIds = [], onSelect, onZoom }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({
    sim: [] as SimNode[],
    edges: [] as CanvasEdge[],
    clusters: [] as CanvasCluster[],
    scale: 1,
    ox: 0,
    oy: 0,
    alpha: 1,
    selectedId: null as string | null,
    highlight: [] as string[],
    highlightEdges: [] as string[],
    isolated: null as string | null,
    onSelect: (_id: string | null) => {},
    onZoom: null as ((scale: number) => void) | null,
    dirty: true,
  });
  state.current.selectedId = selectedId;
  state.current.highlight = highlightIds;
  state.current.highlightEdges = highlightEdgeIds;
  state.current.onSelect = onSelect;
  state.current.onZoom = onZoom ?? null;

  // Selection/highlight changes repaint even when physics has cooled.
  useEffect(() => {
    state.current.dirty = true;
  }, [selectedId, highlightIds, highlightEdgeIds]);

  // Rebuild simulation when data changes.
  useEffect(() => {
    const st = state.current;
    const W = canvasRef.current?.clientWidth || 800;
    const H = canvasRef.current?.clientHeight || 600;
    st.sim = nodes.map((n, i) => {
      const prev = st.sim.find((s) => s.id === n.id);
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      return {
        ...n,
        x: prev?.x ?? W / 2 + Math.cos(a) * Math.min(W, H) * 0.32,
        y: prev?.y ?? H / 2 + Math.sin(a) * Math.min(W, H) * 0.32,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        hidden: false,
      };
    });
    st.edges = edges;
    st.clusters = clusters;
    st.alpha = 1;
    st.dirty = true;
  }, [nodes, edges, clusters]);

  useImperativeHandle(ref, () => ({
    focus(id: string) {
      const st = state.current;
      const n = st.sim.find((s) => s.id === id);
      const cv = canvasRef.current;
      if (!n || !cv) return;
      st.scale = Math.max(st.scale, 1.4);
      st.ox = cv.clientWidth / 2 - n.x * st.scale;
      st.oy = cv.clientHeight / 2 - n.y * st.scale;
      st.dirty = true;
      st.onZoom?.(st.scale);
    },
    reset() {
      const st = state.current;
      st.isolated = null;
      st.sim.forEach((n) => (n.hidden = false));
      st.alpha = 1;
      st.dirty = true;
    },
    zoomIn() {
      const st = state.current;
      const cv = canvasRef.current;
      if (!cv) return;
      const cx = cv.clientWidth / 2;
      const cy = cv.clientHeight / 2;
      const s = Math.min(3, st.scale * 1.25);
      st.ox = cx - ((cx - st.ox) / st.scale) * s;
      st.oy = cy - ((cy - st.oy) / st.scale) * s;
      st.scale = s;
      st.dirty = true;
      st.onZoom?.(st.scale);
    },
    zoomOut() {
      const st = state.current;
      const cv = canvasRef.current;
      if (!cv) return;
      const cx = cv.clientWidth / 2;
      const cy = cv.clientHeight / 2;
      const s = Math.max(0.3, st.scale * 0.8);
      st.ox = cx - ((cx - st.ox) / st.scale) * s;
      st.oy = cy - ((cy - st.oy) / st.scale) * s;
      st.scale = s;
      st.dirty = true;
      st.onZoom?.(st.scale);
    },
    fit() {
      const st = state.current;
      const cv = canvasRef.current;
      const vis = st.sim.filter((n) => !n.hidden);
      if (!cv || vis.length === 0) return;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const n of vis) {
        x0 = Math.min(x0, n.x);
        y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x);
        y1 = Math.max(y1, n.y);
      }
      const W = cv.clientWidth;
      const H = cv.clientHeight;
      const s = Math.max(0.3, Math.min(2, Math.min((W - 80) / Math.max(1, x1 - x0), (H - 80) / Math.max(1, y1 - y0))));
      st.scale = s;
      st.ox = W / 2 - ((x0 + x1) / 2) * s;
      st.oy = H / 2 - ((y0 + y1) / 2) * s;
      st.dirty = true;
      st.onZoom?.(st.scale);
    },
    isolate(id: string | null) {
      const st = state.current;
      st.isolated = id;
      if (!id) {
        st.sim.forEach((n) => (n.hidden = false));
        st.dirty = true;
        return;
      }
      const keep = new Set<string>([id]);
      for (const e of st.edges) {
        if (e.source === id) keep.add(e.target);
        if (e.target === id) keep.add(e.source);
      }
      st.sim.forEach((n) => (n.hidden = !keep.has(n.id)));
      st.dirty = true;
    },
  }), []);

  // Main loop: physics + render.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const st = state.current;
    let raf = 0;
    let dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, cv.clientWidth * dpr);
      cv.height = Math.max(1, cv.clientHeight * dpr);
      st.dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    resize();

    const toWorld = (sx: number, sy: number) => ({
      x: (sx - st.ox) / st.scale,
      y: (sy - st.oy) / st.scale,
    });

    const tick = () => {
      const sim = st.sim;
      if (st.alpha > 0.02) {
        // Repulsion within 200px.
        for (let i = 0; i < sim.length; i++) {
          const a = sim[i];
          if (a.hidden || (a.fx != null && st.alpha < 0.3)) continue;
          for (let j = i + 1; j < sim.length; j++) {
            const b = sim[j];
            if (b.hidden) continue;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > 40000 || d2 < 0.01) continue;
            const d = Math.sqrt(d2);
            const f = (2400 / d2) * st.alpha;
            const ux = dx / d;
            const uy = dy / d;
            if (a.fx == null) {
              a.vx += ux * f;
              a.vy += uy * f;
            }
            if (b.fx == null) {
              b.vx -= ux * f;
              b.vy -= uy * f;
            }
          }
        }
        // Attraction along links.
        const byId = new Map(sim.map((n) => [n.id, n]));
        for (const e of st.edges) {
          const a = byId.get(e.source);
          const b = byId.get(e.target);
          if (!a || !b || a.hidden || b.hidden) continue;
          const soft = (e.confidence ?? 0) < 0.5;
          const k = soft ? 0.0016 : 0.0052;
          const target = soft ? 140 : 105;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const f = (d - target) * k * st.alpha;
          const ux = dx / d;
          const uy = dy / d;
          if (a.fx == null) {
            a.vx += ux * f;
            a.vy += uy * f;
          }
          if (b.fx == null) {
            b.vx -= ux * f;
            b.vy -= uy * f;
          }
        }
        // Centering.
        const W = cv.clientWidth;
        const H = cv.clientHeight;
        const cx = (W / 2 - st.ox) / st.scale;
        const cy = (H / 2 - st.oy) / st.scale;
        for (const n of sim) {
          if (n.hidden || n.fx != null) continue;
          n.vx += (cx - n.x) * 0.0016 * st.alpha;
          n.vy += (cy - n.y) * 0.0016 * st.alpha;
        }
        // Integrate.
        for (const n of sim) {
          if (n.hidden) continue;
          if (n.fx != null && n.fy != null) {
            n.x = n.fx;
            n.y = n.fy;
            n.vx = 0;
            n.vy = 0;
            continue;
          }
          n.vx *= 0.85;
          n.vy *= 0.85;
          n.x += n.vx * st.alpha * 10;
          n.y += n.vy * st.alpha * 10;
        }
        st.alpha *= 0.985;
        st.dirty = true;
      }
      if (st.dirty) {
        draw(ctx, st, cv.clientWidth, cv.clientHeight, dpr);
        st.dirty = false;
      }
      raf = requestAnimationFrame(tick);
    };

    const draw = (
      c: CanvasRenderingContext2D,
      s: typeof st,
      W: number,
      H: number,
      ratio: number
    ) => {
      c.setTransform(ratio, 0, 0, ratio, 0, 0);
      c.clearRect(0, 0, W, H);
      // Background grid: 44px tiles.
      c.strokeStyle = GRID;
      c.lineWidth = 1;
      c.beginPath();
      const gx0 = Math.floor(-s.ox / s.scale / 44) * 44;
      const gy0 = Math.floor(-s.oy / s.scale / 44) * 44;
      for (let x = gx0; x * s.scale + s.ox < W + 44; x += 44) {
        const sx = x * s.scale + s.ox;
        c.moveTo(sx, 0);
        c.lineTo(sx, H);
      }
      for (let y = gy0; y * s.scale + s.oy < H + 44; y += 44) {
        const sy = y * s.scale + s.oy;
        c.moveTo(0, sy);
        c.lineTo(W, sy);
      }
      c.stroke();

      const byId = new Map(s.sim.map((n) => [n.id, n]));
      const vis = (id: string) => {
        const n = byId.get(id);
        return n && !n.hidden;
      };

      // Cluster halos behind everything.
      for (const cl of s.clusters) {
        const members = cl.members.map((m) => byId.get(m)).filter((n) => n && !n.hidden);
        if (members.length < 2) continue;
        const cx = members.reduce((a, n) => a + (n as SimNode).x, 0) / members.length;
        const cy = members.reduce((a, n) => a + (n as SimNode).y, 0) / members.length;
        const sx = cx * s.scale + s.ox;
        const sy = cy * s.scale + s.oy;
        const r = 130 * s.scale;
        c.beginPath();
        c.arc(sx, sy, r, 0, Math.PI * 2);
        c.fillStyle = "rgba(0,217,255,.025)";
        c.fill();
        c.setLineDash([5, 5]);
        c.strokeStyle = "rgba(0,217,255,.09)";
        c.lineWidth = 1;
        c.stroke();
        c.setLineDash([]);
        c.font = "10px 'JetBrains Mono', monospace";
        c.fillStyle = "rgba(163,177,194,.85)";
        c.textAlign = "center";
        c.fillText(cl.label.toUpperCase(), sx, sy - r - 8);
      }

      // Links. A shortest-path run highlights the exact edges (by id);
      // everything else dims so the route reads at a glance.
      const pathEdges = new Set(s.highlightEdges);
      const pathActive = pathEdges.size > 0;
      const hlNodes = new Set(s.highlight);
      const onPathFallback = (e: CanvasEdge) =>
        pathActive && hlNodes.has(e.source) && hlNodes.has(e.target);
      // Pass 1: base + dimmed links.
      for (const e of s.edges) {
        if (!vis(e.source) || !vis(e.target)) continue;
        const a = byId.get(e.source) as SimNode;
        const b = byId.get(e.target) as SimNode;
        const soft = (e.confidence ?? 0) < 0.5;
        const sel =
          s.selectedId != null &&
          ((e.source === s.selectedId || e.target === s.selectedId));
        const onPath = pathEdges.has(e.id) || (!pathEdges.size && onPathFallback(e));
        if (onPath) continue; // drawn in pass 2, above the dimmed layer
        c.beginPath();
        c.moveTo(a.x * s.scale + s.ox, a.y * s.scale + s.oy);
        c.lineTo(b.x * s.scale + s.ox, b.y * s.scale + s.oy);
        if (pathActive) {
          c.strokeStyle = "rgba(120,140,160,.10)";
          c.lineWidth = 0.7;
        } else {
          c.strokeStyle = sel ? "rgba(0,217,255,.55)" : soft ? "rgba(120,140,160,.12)" : "rgba(0,217,255,.28)";
          c.lineWidth = soft ? 0.7 : 1;
        }
        c.stroke();
      }
      // Pass 2: the path itself — bright, wide, with a glow so it is
      // unmistakable even on dense canvases. Arrowheads mark direction.
      if (pathActive) {
        c.save();
        c.shadowColor = "rgba(0,217,255,.8)";
        c.shadowBlur = 8;
        for (const e of s.edges) {
          const onPath = pathEdges.has(e.id) || (!pathEdges.size && onPathFallback(e));
          if (!onPath || !vis(e.source) || !vis(e.target)) continue;
          const a = byId.get(e.source) as SimNode;
          const b = byId.get(e.target) as SimNode;
          const ax = a.x * s.scale + s.ox;
          const ay = a.y * s.scale + s.oy;
          const bx = b.x * s.scale + s.ox;
          const by = b.y * s.scale + s.oy;
          c.beginPath();
          c.moveTo(ax, ay);
          c.lineTo(bx, by);
          c.strokeStyle = "rgba(0,217,255,.95)";
          c.lineWidth = 2.5;
          c.stroke();
          // Direction chevron at the midpoint.
          const mx = (ax + bx) / 2;
          const my = (ay + by) / 2;
          const ang = Math.atan2(by - ay, bx - ax);
          const s6 = 6;
          c.beginPath();
          c.moveTo(mx + Math.cos(ang) * s6, my + Math.sin(ang) * s6);
          c.lineTo(mx + Math.cos(ang + 2.5) * s6, my + Math.sin(ang + 2.5) * s6);
          c.lineTo(mx + Math.cos(ang - 2.5) * s6, my + Math.sin(ang - 2.5) * s6);
          c.closePath();
          c.fillStyle = "rgba(0,217,255,.95)";
          c.fill();
        }
        c.restore();
      }

      // Nodes. Path members get a filled halo so the route endpoints
      // read even when zoomed out; plain highlights keep the thin ring.
      const hl = new Set(s.highlight);
      const pathOn = s.highlightEdges.length > 0 || hl.size > 0;
      for (const n of s.sim) {
        if (n.hidden) continue;
        const sx = n.x * s.scale + s.ox;
        const sy = n.y * s.scale + s.oy;
        if (sx < -30 || sy < -30 || sx > W + 30 || sy > H + 30) continue;
        const r = nodeRadius(n.type) * Math.max(0.7, Math.min(1.4, s.scale));
        const col = nodeColor(n.type);
        const sel = s.selectedId === n.id;
        const inPath = hl.has(n.id);
        if (inPath && pathOn) {
          c.beginPath();
          c.arc(sx, sy, r + 7, 0, Math.PI * 2);
          c.fillStyle = "rgba(0,217,255,.18)";
          c.fill();
          c.beginPath();
          c.arc(sx, sy, r + 4, 0, Math.PI * 2);
          c.strokeStyle = "#00d9ff";
          c.lineWidth = 2;
          c.stroke();
        } else if (sel || inPath) {
          c.beginPath();
          c.arc(sx, sy, r + 4, 0, Math.PI * 2);
          c.strokeStyle = "#00d9ff";
          c.lineWidth = sel ? 2 : 1;
          c.stroke();
        }
        c.beginPath();
        c.arc(sx, sy, r, 0, Math.PI * 2);
        c.fillStyle = "#0d1117";
        c.fill();
        c.strokeStyle = col;
        c.lineWidth = 1.5;
        c.stroke();
        c.beginPath();
        c.arc(sx, sy, r * 0.42, 0, Math.PI * 2);
        c.fillStyle = col;
        c.fill();
        c.font = "10px Inter, sans-serif";
        c.fillStyle = FG;
        c.textAlign = "center";
        c.fillText(n.label, sx, sy + r + 13);
      }
    };

    // Interactions.
    let dragNode: SimNode | null = null;
    let panning = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    let unpinTimer: ReturnType<typeof setTimeout> | null = null;

    const pick = (sx: number, sy: number): SimNode | null => {
      const st2 = state.current;
      let best: SimNode | null = null;
      let bestD = 14;
      for (const n of st2.sim) {
        if (n.hidden) continue;
        const nx = n.x * st2.scale + st2.ox;
        const ny = n.y * st2.scale + st2.oy;
        const d = Math.hypot(nx - sx, ny - sy);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    };

    const onDown = (ev: MouseEvent) => {
      const rect = cv.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const n = pick(sx, sy);
      moved = 0;
      lastX = sx;
      lastY = sy;
      if (unpinTimer) {
        clearTimeout(unpinTimer);
        unpinTimer = null;
      }
      if (n) {
        dragNode = n;
        const w = toWorld(sx, sy);
        n.fx = w.x;
        n.fy = w.y;
        state.current.alpha = Math.max(state.current.alpha, 0.4);
      } else {
        panning = true;
      }
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragNode && !panning) return;
      const rect = cv.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      moved += Math.abs(sx - lastX) + Math.abs(sy - lastY);
      const st2 = state.current;
      if (dragNode) {
        const w = toWorld(sx, sy);
        dragNode.fx = w.x;
        dragNode.fy = w.y;
        st2.dirty = true;
      } else if (panning) {
        st2.ox += sx - lastX;
        st2.oy += sy - lastY;
        st2.dirty = true;
      }
      lastX = sx;
      lastY = sy;
    };
    const onUp = (ev: MouseEvent) => {
      const st2 = state.current;
      if (dragNode) {
        const n = dragNode;
        dragNode = null;
        unpinTimer = setTimeout(() => {
          n.fx = null;
          n.fy = null;
          st2.alpha = Math.max(st2.alpha, 0.3);
          st2.dirty = true;
        }, 900);
        if (moved < 4) {
          st2.onSelect(n.id);
          st2.dirty = true;
        }
      } else if (panning) {
        panning = false;
        if (moved < 4) {
          const rect = cv.getBoundingClientRect();
          const n = pick(ev.clientX - rect.left, ev.clientY - rect.top);
          st2.onSelect(n ? n.id : null);
          st2.dirty = true;
        }
      }
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const st2 = state.current;
      const rect = cv.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const f = ev.deltaY < 0 ? 1.12 : 0.89;
      const s = Math.max(0.3, Math.min(3, st2.scale * f));
      st2.ox = sx - ((sx - st2.ox) / st2.scale) * s;
      st2.oy = sy - ((sy - st2.oy) / st2.scale) * s;
      st2.scale = s;
      st2.dirty = true;
      st2.onZoom?.(st2.scale);
    };

    cv.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    cv.addEventListener("wheel", onWheel, { passive: false });
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      cv.removeEventListener("wheel", onWheel);
      if (unpinTimer) clearTimeout(unpinTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ cursor: "grab" }} />;
});
