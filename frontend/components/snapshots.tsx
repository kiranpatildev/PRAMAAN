"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { GraphData, GraphFilters } from "./graph-types";

type Snapshot = {
  id: number; label: string; created_by: string | null;
  filters: Record<string, unknown>; node_count: number; edge_count: number;
  created_at: string;
};
type Diff = {
  a: { id?: number; label: string };
  b: { id?: number; label: string };
  nodes: { added: { id: string; label: string; type: string }[]; removed: { id: string; label: string; type: string }[] };
  edges: { added: { id: string; label: string }[]; removed: { id: string; label: string }[] };
};

export function DiffView({ diff }: { diff: Diff }) {
  return (
    <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
      <div className="rounded-lg bg-ink-950 p-2">
        <b className="text-risk-low">+ Added in {diff.b.label} ({diff.nodes.added.length}n/{diff.edges.added.length}e)</b>
        <ul className="mt-1 space-y-0.5 text-slate-300">
          {diff.nodes.added.map((n) => <li key={n.id}>• {n.label} <span className="text-slate-500">({n.type})</span></li>)}
          {diff.edges.added.map((e) => <li key={e.id}>• —[{e.label}]→</li>)}
          {diff.nodes.added.length + diff.edges.added.length === 0 && <li className="text-slate-500">nothing</li>}
        </ul>
      </div>
      <div className="rounded-lg bg-ink-950 p-2">
        <b className="text-risk-high">− Removed from {diff.a.label} ({diff.nodes.removed.length}n/{diff.edges.removed.length}e)</b>
        <ul className="mt-1 space-y-0.5 text-slate-300">
          {diff.nodes.removed.map((n) => <li key={n.id}>• {n.label} <span className="text-slate-500">({n.type})</span></li>)}
          {diff.edges.removed.map((e) => <li key={e.id}>• —[{e.label}]→</li>)}
          {diff.nodes.removed.length + diff.edges.removed.length === 0 && <li className="text-slate-500">nothing</li>}
        </ul>
      </div>
    </div>
  );
}

/** Date-based "what changed": graph ≤ A vs graph ≤ B (valid_from). */
export function CompareDates({ caseId }: { caseId: string }) {
  const [from, setFrom] = useState("2026-03-12");
  const [to, setTo] = useState("2026-03-15");
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState("");

  async function compare() {
    setError("");
    try {
      setDiff(await api.analyticsCompare(caseId, from, to));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compare failed");
    }
  }

  return (
    <div className="mt-3 border-t border-ink-700 pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">Network on</span>
        <input type="date" className="input !w-auto !py-1 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-xs text-slate-400">vs</span>
        <input type="date" className="input !w-auto !py-1 text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn !px-3 !py-1 text-xs" onClick={compare}>What changed?</button>
      </div>
      {error && <p className="mt-1 text-sm text-risk-high">{error}</p>}
      {diff && <DiffView diff={diff} />}
    </div>
  );
}

/** Saved graph views for reports + side-by-side time comparison. */
export function SnapshotManager({
  caseId,
  filters,
  onLoad,
}: {
  caseId: string;
  filters: GraphFilters;
  onLoad: (g: GraphData, label: string) => void;
}) {
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [label, setLabel] = useState("");
  const [cmpA, setCmpA] = useState("");
  const [cmpB, setCmpB] = useState("");
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setSnaps(await api.snapshots(caseId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load snapshots");
    }
  }, [caseId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save() {
    if (!label.trim()) return;
    setError("");
    try {
      await api.saveSnapshot(caseId, label.trim(), {
        node_types: filters.types,
        min_confidence: filters.minConfidence,
        date_from: filters.dateFrom || undefined,
        date_to: filters.dateTo || undefined,
      });
      setLabel("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function load(id: number) {
    try {
      const d = await api.snapshotDetail(caseId, id);
      onLoad({ nodes: d.data.nodes, edges: d.data.edges }, d.label);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }

  async function compare() {
    if (!cmpA || !cmpB) return;
    try {
      setDiff(await api.snapshotDiff(caseId, Number(cmpA), Number(cmpB)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Diff failed");
    }
  }

  return (
    <div className="card">
      <h2 className="font-semibold">Saved views & time comparison ({snaps.length})</h2>
      {error && <p className="mt-1 text-sm text-risk-high">{error}</p>}
      <div className="mt-2 flex gap-2">
        <input className="input" placeholder="Snapshot label, e.g. pre-raid network" value={label}
          onChange={(e) => setLabel(e.target.value)} />
        <button className="btn whitespace-nowrap" onClick={save}>Save current view</button>
      </div>
      <div className="mt-2 divide-y divide-ink-700 text-sm">
        {snaps.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span><b>{s.label}</b> <span className="text-xs text-slate-400">{s.node_count}n · {s.edge_count}e · {new Date(s.created_at).toLocaleString()}</span></span>
            <span className="flex gap-2 text-xs">
              <button className="text-accent hover:underline" onClick={() => load(s.id)}>load</button>
              <button className="text-risk-high hover:underline" onClick={() => api.deleteSnapshot(caseId, s.id).then(refresh).catch(() => {})}>delete</button>
            </span>
          </div>
        ))}
        {snaps.length === 0 && <p className="py-2 text-sm text-slate-500">No saved views yet.</p>}
      </div>
      {snaps.length >= 2 && (
        <div className="mt-3 border-t border-ink-700 pt-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">Compare</span>
            <select className="input !w-auto !py-1 text-xs" value={cmpA} onChange={(e) => setCmpA(e.target.value)}>
              <option value="">A…</option>
              {snaps.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <span className="text-xs text-slate-400">vs</span>
            <select className="input !w-auto !py-1 text-xs" value={cmpB} onChange={(e) => setCmpB(e.target.value)}>
              <option value="">B…</option>
              {snaps.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button className="btn !px-3 !py-1 text-xs" onClick={compare}>What changed?</button>
          </div>
          {diff && <DiffView diff={diff} />}
        </div>
      )}
      <CompareDates caseId={caseId} />
    </div>
  );
}
