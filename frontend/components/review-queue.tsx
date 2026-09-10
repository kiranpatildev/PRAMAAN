"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Entity = {
  id: number; node_type: string; value: string; confidence: number;
  engine: string; status: string; mention_count: number; evidence_file: string;
};
type Relation = {
  id: number; src_value: string; dst_value: string; edge_type: string;
  confidence: number; snippet: string; engine: string;
};
type Merge = {
  id: number; a_value: string; b_value: string; node_type: string;
  score: number; reason: string;
};

/** Human-in-the-loop review: AI-extracted entities/relations queue for
 *  investigator confirm/reject; merge approvals are SHO-gated server-side. */
export function ReviewQueue({ caseId, onChanged }: { caseId: string; onChanged?: () => void }) {
  const { t } = useI18n();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [merges, setMerges] = useState<Merge[]>([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [e, r, m] = await Promise.all([
        api.reviewEntities(caseId),
        api.reviewRelations(caseId),
        api.reviewMerges(caseId),
      ]);
      setEntities(e);
      setRelations(r);
      setMerges(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review queue");
    }
  }, [caseId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function act(p: Promise<unknown>) {
    setError("");
    try {
      await p;
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed (merges need SHO role)");
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{t("case.review", "AI review queue")}</h2>
        <span className="text-xs text-slate-400">{entities.length + relations.length + merges.length} pending</span>
      </div>
      {error && <p className="mt-2 text-sm text-risk-high">{error}</p>}

      <h3 className="mt-3 text-sm font-semibold text-slate-300">{t("review.entities", "Entities")} ({entities.length})</h3>
      <div className="divide-y divide-ink-700">
        {entities.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>
              <span className="rounded bg-ink-700 px-1.5 py-0.5 text-xs text-accent">{e.node_type}</span>{" "}
              <b>{e.value}</b>{" "}
              <span className="text-xs text-slate-400">
                {(e.confidence * 100).toFixed(0)}% · {e.engine} · ×{e.mention_count} · {e.evidence_file || "?"}
              </span>
            </span>
            <span className="flex gap-2 text-xs">
              <button className="text-risk-low hover:underline" onClick={() => act(api.decideEntity(e.id, "confirm"))}>confirm</button>
              <button className="text-risk-high hover:underline" onClick={() => act(api.decideEntity(e.id, "reject"))}>reject</button>
            </span>
          </div>
        ))}
        {entities.length === 0 && <p className="py-2 text-sm text-slate-500">No pending entities.</p>}
      </div>

      <h3 className="mt-3 text-sm font-semibold text-slate-300">{t("review.relations", "Relationships")} ({relations.length})</h3>
      <div className="divide-y divide-ink-700">
        {relations.map((r) => (
          <div key={r.id} className="py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span><b>{r.src_value}</b> <span className="text-accent">—[{r.edge_type}]→</span> <b>{r.dst_value}</b>{" "}
                <span className="text-xs text-slate-400">{(r.confidence * 100).toFixed(0)}% · {r.engine}</span></span>
              <span className="flex gap-2 text-xs">
                <button className="text-risk-low hover:underline" onClick={() => act(api.decideRelation(r.id, "confirm"))}>confirm</button>
                <button className="text-risk-high hover:underline" onClick={() => act(api.decideRelation(r.id, "reject"))}>reject</button>
              </span>
            </div>
            {r.snippet && <p className="mt-1 text-xs italic text-slate-400">“{r.snippet}”</p>}
          </div>
        ))}
        {relations.length === 0 && <p className="py-2 text-sm text-slate-500">No pending relationships.</p>}
      </div>

      <h3 className="mt-3 text-sm font-semibold text-slate-300">{t("review.merges", "Merge suggestions")} ({merges.length})</h3>
      <div className="divide-y divide-ink-700">
        {merges.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span><b>{m.a_value}</b> <span className="text-slate-400">≈ {m.b_value}</span>{" "}
              <span className="text-xs text-slate-400">{m.node_type} · {(m.score * 100).toFixed(0)}% · {m.reason} · needs SHO</span></span>
            <span className="flex gap-2 text-xs">
              <button className="text-risk-low hover:underline" onClick={() => act(api.decideMerge(m.id, "approve"))}>approve</button>
              <button className="text-risk-high hover:underline" onClick={() => act(api.decideMerge(m.id, "reject"))}>reject</button>
            </span>
          </div>
        ))}
        {merges.length === 0 && <p className="py-2 text-sm text-slate-500">No pending merges.</p>}
      </div>
    </div>
  );
}
