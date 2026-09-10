"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

/** Investigation replay: step through how connections emerged over time.
 *  Edges appear at their valid_from date; undated edges toggle separately. */
export function ReplayControl({
  caseId,
  active,
  onToggle,
  onStep,
}: {
  caseId: string;
  active: boolean;
  onToggle: (on: boolean) => void;
  onStep: (visibleEdgeIds: Set<string> | null) => void;
}) {
  const [dates, setDates] = useState<string[]>([]);
  const [edges, setEdges] = useState<{ id: string; valid_from: string | null }[]>([]);
  const [step, setStep] = useState(0);
  const [undated, setUndated] = useState(true);

  useEffect(() => {
    if (!active) {
      onStep(null);
      return;
    }
    api.caseGraph(caseId).then((g: { edges?: { id: string; valid_from: string | null }[] }) => {
      const es = (g.edges ?? []).map((e) => ({ id: e.id, valid_from: e.valid_from ?? null }));
      setEdges(es);
      const ds = sortedUnique(es.map((e) => e.valid_from).filter((d): d is string => !!d));
      setDates(ds);
      setStep(0);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, caseId]);

  const visible = useMemo(() => {
    if (!active || dates.length === 0) return null;
    const cutoff = dates[Math.min(step, dates.length - 1)];
    return new Set(
      edges.filter((e) => (e.valid_from ? e.valid_from <= cutoff : undated)).map((e) => e.id)
    );
  }, [active, dates, edges, step, undated]);

  useEffect(() => {
    if (active) onStep(visible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, active]);

  if (!active) {
    return (
      <button className="btn !px-3 !py-1 text-xs" onClick={() => onToggle(true)}>
        ▶ Replay investigation
      </button>
    );
  }
  return (
    <div className="card !p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn !px-3 !py-1 text-xs" onClick={() => onToggle(false)}>Exit replay</button>
        {dates.length > 0 ? (
          <>
            <input type="range" min={0} max={dates.length - 1} value={Math.min(step, dates.length - 1)}
              onChange={(e) => setStep(Number(e.target.value))} className="w-48 accent-sky-400" />
            <b className="text-accent">≤ {dates[Math.min(step, dates.length - 1)]}</b>
            <span className="text-xs text-slate-400">{visible?.size ?? 0}/{edges.length} connections visible</span>
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <input type="checkbox" checked={undated} onChange={(e) => setUndated(e.target.checked)} />
              include undated
            </label>
          </>
        ) : (
          <span className="text-xs text-slate-400">No dated connections — nothing to replay yet.</span>
        )}
      </div>
    </div>
  );
}

function sortedUnique(ds: string[]): string[] {
  return Array.from(new Set(ds)).sort();
}
