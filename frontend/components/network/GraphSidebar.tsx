"use client";

import { useMemo, useState } from "react";
import { SearchInput, Select } from "../ui/Input";
import { Button } from "../ui/Button";
import { ENTITY_META, entityKind, type EntityKind } from "@/lib/case";
import type { CanvasEdge, CanvasNode } from "./GraphCanvas";

function bfsPath(nodes: CanvasNode[], edges: CanvasEdge[], from: string, to: string): string[] | null {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
  }
  if (!adj.has(from) || !adj.has(to)) return null;
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift() as string;
    if (cur === to) break;
    for (const nx of adj.get(cur) ?? []) {
      if (!prev.has(nx)) {
        prev.set(nx, cur);
        queue.push(nx);
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

export function GraphSidebar({ nodes, edges, relCounts, onFocusId, onHighlight }: {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  relCounts: { type: string; count: number }[];
  onFocusId: (id: string) => void;
  onHighlight: (ids: string[] | null) => void;
}) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pathMsg, setPathMsg] = useState("");

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    return nodes.filter((n) => n.label.toLowerCase().includes(needle)).slice(0, 8);
  }, [nodes, q]);

  const entCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) {
      const k = entityKind(n.type);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries());
  }, [nodes]);

  const options = useMemo(() => [...nodes].sort((a, b) => a.label.localeCompare(b.label)), [nodes]);

  function find() {
    setPathMsg("");
    if (!from || !to) {
      setPathMsg("Pick both endpoints.");
      return;
    }
    const path = bfsPath(nodes, edges, from, to);
    if (!path) {
      setPathMsg("No connecting path in this view.");
      onHighlight(null);
      return;
    }
    setPathMsg(`${path.length - 1} hop${path.length === 2 ? "" : "s"}`);
    onHighlight(path);
  }

  return (
    <div className="space-y-4">
      <div>
        <SearchInput
          placeholder="Search within graph"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches.length) {
              onFocusId(matches[0].id);
              setQ("");
            }
          }}
        />
        {matches.length > 0 && (
          <ul className="mt-1 overflow-hidden rounded border border-line bg-panel">
            {matches.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    onFocusId(n.id);
                    setQ("");
                  }}
                  className="block w-full truncate px-[11px] py-[7px] text-left text-[12.5px] text-fg-2 transition-colors duration-120 hover:bg-panel-2 hover:text-fg"
                >
                  {n.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="micro-label mb-2">Relationship types</p>
        {relCounts.length === 0 ? (
          <p className="text-[12px] text-fg-3">No edges in view.</p>
        ) : (
          <ul className="space-y-[7px]">
            {relCounts.map((r) => (
              <li key={r.type} className="flex items-center gap-2">
                <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-cyan" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] uppercase text-fg-2">{r.type}</span>
                <span className="font-mono text-[10.5px] text-fg-3">{r.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="micro-label mb-2">Entity legend</p>
        <ul className="space-y-[7px]">
          {entCounts.map(([kind, n]) => (
            <li key={kind} className="flex items-center gap-2">
              <span
                className="h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ background: ENTITY_META[kind as EntityKind].color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-2">{ENTITY_META[kind as EntityKind].label}</span>
              <span className="font-mono text-[10.5px] text-fg-3">{n}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="micro-label mb-2">Path analysis</p>
        <div className="space-y-2">
          <Select value={from} onChange={(e) => setFrom(e.target.value)} className="w-full" aria-label="Path from">
            <option value="">From entity…</option>
            {options.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </Select>
          <Select value={to} onChange={(e) => setTo(e.target.value)} className="w-full" aria-label="Path to">
            <option value="">To entity…</option>
            {options.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Button variant="ghost" small className="flex-1" onClick={find}>
              Find shortest path
            </Button>
            <Button
              variant="ghost"
              small
              onClick={() => {
                setFrom("");
                setTo("");
                setPathMsg("");
                onHighlight(null);
              }}
            >
              Clear
            </Button>
          </div>
          {pathMsg && <p className="font-mono text-[10.5px] text-fg-3">{pathMsg}</p>}
        </div>
      </div>
    </div>
  );
}
