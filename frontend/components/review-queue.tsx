"use client";

/** Entities tab: left = Entity Review Queue (confirm/reject), right =
 *  condensed network preview + AI merge-suggestion callout.
 *  Human-in-the-loop is unchanged: investigators verify, SHO approves merges. */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Panel, EmptyState, ErrorState, friendlyError, ConfidenceBar, Icon } from "@/components/ui";
import { entityColor } from "@/lib/theme";
import { toElements, TYPE_COLORS, type GraphData } from "@/components/graph-types";

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

function TypeTag({ type }: { type: string }) {
  const c = entityColor(type);
  return (
    <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider"
      style={{ color: c, borderColor: `${c}66`, background: `${c}14` }}>
      {type}
    </span>
  );
}

function ConfirmBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="rounded-md border border-[#10B981]/60 px-2.5 py-1 font-mono text-[11px] font-bold text-[#10B981] hover:bg-[#10B981]/10">
      Confirm
    </button>
  );
}

function RejectBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="rounded-md border border-[#1F2733] px-2.5 py-1 font-mono text-[11px] font-bold text-[#8B93A1] hover:border-[#EF4444]/60 hover:text-[#EF4444]">
      Reject
    </button>
  );
}

/** Condensed read-only preview of the current graph view. */
function GraphPreview({ graph, commOf, onInspect }: {
  graph: GraphData | null; commOf: Record<string, string>; onInspect: (id: string) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let cy: { destroy(): void; destroyed(): boolean } | null = null;
    (async () => {
      if (!mountRef.current || !graph || graph.nodes.length === 0) return;
      const cytoscape = (await import("cytoscape")).default;
      if (cancelled || !mountRef.current) return;
      try {
        cy = cytoscape({
          container: mountRef.current,
          elements: toElements(graph, commOf),
          style: [
            { selector: "node", style: { "background-color": "data(color)", width: 14, height: 14, label: "" } },
            { selector: "node:parent", style: { "background-color": "#3B82F6", "background-opacity": 0.06, "border-width": 1, "border-color": "#1F2733", label: "" } },
            { selector: "edge", style: { "line-color": "#475569", width: 1 } },
          ],
          layout: { name: "cose", animate: false },
          userZoomingEnabled: false,
          userPanningEnabled: true,
          boxSelectionEnabled: false,
        }) as unknown as typeof cy;
        (cy as unknown as { on(ev: string, sel: string, fn: (e: { target: { id(): string } }) => void): void })
          .on("tap", "node", (e) => { try { onInspect(e.target.id()); } catch { /* gone */ } });
      } catch { /* container detached */ }
    })();
    return () => {
      cancelled = true;
      try { if (cy && !cy.destroyed()) cy.destroy(); } catch { /* gone */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  const counts: Record<string, number> = {};
  for (const n of graph?.nodes ?? []) counts[n.type] = (counts[n.type] ?? 0) + 1;

  return (
    <Panel title="Network preview" right={<span className="font-mono text-[11px] text-[#8B93A1]">condensed · full graph on the Network tab</span>}>
      {!graph || graph.nodes.length === 0 ? (
        <EmptyState icon="network" title="Nothing to preview yet" hint="Confirm entities below and the preview appears here." />
      ) : (
        <>
          <div ref={mountRef} className="h-64 rounded-md border border-[#1F2733] bg-[#0B0F17]" />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {Object.entries(counts).map(([t, n]) => (
              <span key={t} className="flex items-center gap-1.5 font-mono text-[11px] text-[#8B93A1]">
                <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[t] ?? "#9CA3AF" }} />
                {t} {n}
              </span>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

export function ReviewQueue({ caseId, onChanged, preview, commOf, onInspectNode }: {
  caseId: string; onChanged?: () => void;
  preview?: GraphData | null; commOf?: Record<string, string>;
  onInspectNode?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [merges, setMerges] = useState<Merge[]>([]);
  const [error, setError] = useState("");
  const [canVerify, setCanVerify] = useState(true);

  useEffect(() => {
    // Verification is investigator work: hide the buttons for SHO/admin
    // (the API 403s them anyway) instead of letting clicks fail.
    api.me().then((m) => setCanVerify(m.role === "investigator")).catch(() => {});
  }, []);

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
      setError("");
    } catch (err) {
      setError(friendlyError(err, "Failed to load review queue"));
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
      setError(friendlyError(err, "Action failed (merges need SHO role)"));
    }
  }

  const pending = entities.length + relations.length + merges.length;
  const [topMerge, ...restMerges] = merges;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[1fr_340px]">
      <Panel
        title={t("case.review", "Entity Review Queue")}
        count={`${pending} pending`}
        right={error ? undefined : <span className="font-mono text-[11px] text-[#8B93A1]">AI suggests · you decide</span>}
      >
        {error && <div className="mb-3"><ErrorState detail={error} onRetry={refresh} /></div>}
        {!canVerify && (
          <p className="mb-3 rounded-md border border-[#1F2733] bg-[#0B0F17] p-2.5 text-xs text-[#8B93A1]">
            Verification is investigator work — switch to an investigator account to confirm or reject. Merge approvals remain SHO-gated below.
          </p>
        )}

        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]">
          {t("review.entities", "Entities")} ({entities.length})
        </p>
        <div className="divide-y divide-[#1F2733]">
          {entities.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5">
              <span className="min-w-0">
                <TypeTag type={e.node_type} />{" "}
                <b className="text-sm">{e.value}</b>
                <span className="mt-0.5 block font-mono text-[11px] text-[#8B93A1]">
                  {(e.confidence * 100).toFixed(0)}% · {e.engine} · ×{e.mention_count} · {e.evidence_file || "source pending"}
                </span>
              </span>
              {canVerify && (
                <span className="flex gap-2">
                  <ConfirmBtn onClick={() => act(api.decideEntity(e.id, "confirm"))} />
                  <RejectBtn onClick={() => act(api.decideEntity(e.id, "reject"))} />
                </span>
              )}
            </div>
          ))}
          {entities.length === 0 && <p className="py-3 text-sm text-[#8B93A1]">No pending entities — extraction drops new candidates here.</p>}
        </div>

        <p className="mt-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]">
          {t("review.relations", "Relationships")} ({relations.length})
        </p>
        <div className="divide-y divide-[#1F2733]">
          {relations.map((r) => (
            <div key={r.id} className="py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <span className="text-sm"><b>{r.src_value}</b> <span className="font-mono text-xs text-[#3B82F6]">—[{r.edge_type}]→</span> <b>{r.dst_value}</b></span>
                <span className="flex items-center gap-2">
                  <ConfidenceBar value={r.confidence} className="w-28" />
                  {canVerify && (
                    <>
                      <ConfirmBtn onClick={() => act(api.decideRelation(r.id, "confirm"))} />
                      <RejectBtn onClick={() => act(api.decideRelation(r.id, "reject"))} />
                    </>
                  )}
                </span>
              </div>
              {r.snippet && <p className="mt-1 text-xs italic text-[#8B93A1]">“{r.snippet}”</p>}
            </div>
          ))}
          {relations.length === 0 && <p className="py-3 text-sm text-[#8B93A1]">No pending relationships.</p>}
        </div>
      </Panel>

      <div className="space-y-4">
        <GraphPreview graph={preview ?? null} commOf={commOf ?? {}} onInspect={onInspectNode ?? (() => {})} />

        <div className="rounded-lg border border-[#F59E0B]/40 bg-[#F59E0B]/[0.06] p-4">
          <p className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#F59E0B]">
            <Icon name="spark" className="h-3.5 w-3.5" /> AI Merge Suggestion
          </p>
          {!topMerge ? (
            <p className="mt-2 text-sm text-[#8B93A1]">No duplicates suspected right now — resolution runs after every upload.</p>
          ) : (
            <div className="mt-2">
              <p className="text-sm">
                <b>Possible duplicate:</b> {topMerge.a_value} ↔ {topMerge.b_value}{" "}
                <span className="font-mono text-xs text-[#F59E0B]">({(topMerge.score * 100).toFixed(0)} match)</span>
              </p>
              <p className="mt-1 text-xs text-[#8B93A1]">{topMerge.reason}</p>
              <div className="mt-2.5 flex gap-2">
                <button onClick={() => act(api.decideMerge(topMerge.id, "approve"))}
                  className="rounded-md bg-[#10B981] px-3 py-1.5 font-mono text-[11px] font-bold text-[#06121f] hover:opacity-90">
                  Accept
                </button>
                <button onClick={() => act(api.decideMerge(topMerge.id, "reject"))}
                  className="rounded-md border border-[#1F2733] px-3 py-1.5 font-mono text-[11px] font-bold text-[#8B93A1] hover:border-[#EF4444]/60 hover:text-[#EF4444]">
                  Dismiss
                </button>
              </div>
              <p className="mt-1.5 font-mono text-[10px] text-[#8B93A1]">Accepting merges needs the SHO role.</p>
            </div>
          )}
          {restMerges.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-[#F59E0B]/20 pt-2.5">
              {restMerges.slice(0, 4).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">{m.a_value} ≈ {m.b_value} <span className="font-mono text-[#8B93A1]">{(m.score * 100).toFixed(0)}%</span></span>
                  <span className="flex shrink-0 gap-1.5 font-mono text-[11px]">
                    <button className="text-[#10B981] hover:underline" onClick={() => act(api.decideMerge(m.id, "approve"))}>accept</button>
                    <button className="text-[#8B93A1] hover:underline" onClick={() => act(api.decideMerge(m.id, "reject"))}>dismiss</button>
                  </span>
                </li>
              ))}
              {restMerges.length > 4 && <li className="font-mono text-[11px] text-[#8B93A1]">+{restMerges.length - 4} more in the queue</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
