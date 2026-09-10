"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Player = {
  key: string; label: string; type: string;
  degree: number; pagerank: number; betweenness: number; wcc: number; louvain: number;
};
type Bridge = { key: string; label: string; type: string; kinds: string[]; degree: number; betweenness: number };
type Community = { id: string; size: number; members: string[] };
type Factor = { name: string; value: number; weight: number; contribution: number; reason: string };
type Score = { key: string; label: string; type: string; score: number; level: string; factors: Factor[] };
type Anomaly = {
  kind: string; severity: string; nodes: { key: string; label: string }[];
  explanation: string; evidence: Record<string, unknown>;
};

const LEVEL_COLOR: Record<string, string> = { high: "text-risk-high", medium: "text-risk-medium", low: "text-risk-low" };

/** Analytics workbench: key players, bridges, communities, explainable risk,
 *  anomalies — every figure traces to evidence, never a black-box score. */
export function AnalyticsPanel({
  caseId,
  onOverlay,
}: {
  caseId: string;
  onOverlay: (scores: { key: string; level: string }[] | null) => void;
}) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [engine, setEngine] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [history, setHistory] = useState<{ id: number; created_at: string; node_count: number }[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [overlayOn, setOverlayOn] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ov, rk, an, hist] = await Promise.all([
        api.analyticsOverview(caseId),
        api.analyticsRisk(caseId),
        api.analyticsAnomalies(caseId),
        api.riskHistory(caseId),
      ]);
      setPlayers(ov.key_players ?? []);
      setBridges(ov.bridges ?? []);
      setCommunities(ov.communities ?? []);
      setEngine(ov.engine ?? "");
      setNotes(ov.notes ?? []);
      setScores(rk.scores ?? []);
      setAnomalies(an.anomalies ?? []);
      setHistory(hist ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analytics failed (GDS reachable?)");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function toggleOverlay() {
    if (overlayOn) {
      onOverlay(null);
      setOverlayOn(false);
    } else {
      onOverlay(scores.map((s) => ({ key: s.key, level: s.level })));
      setOverlayOn(true);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Network analytics {engine && <span className="text-xs font-normal text-slate-500">· {engine}</span>}</h2>
        <div className="flex gap-2">
          <button className="btn !px-3 !py-1 text-xs" onClick={toggleOverlay} disabled={scores.length === 0}>
            {overlayOn ? "Clear risk overlay" : "Overlay risk on graph"}
          </button>
          <button className="btn !px-3 !py-1 text-xs" onClick={refresh}>Recompute</button>
        </div>
      </div>
      {loading && <div className="skeleton mt-3 h-6 w-2/3" />}
      {error && <p className="mt-2 text-sm text-risk-high">{error}</p>}
      {notes.map((n, i) => <p key={i} className="mt-1 text-xs text-risk-medium">⚠ {n}</p>)}

      <h3 className="mt-3 text-sm font-semibold text-slate-300">Key players & risk ({scores.length})</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="text-xs text-slate-500">
            <th className="py-1">Entity</th><th>deg</th><th>PageRank</th><th>btw</th><th>comm</th><th>Risk</th>
          </tr></thead>
          <tbody>
            {scores.map((s) => {
              const p = players.find((x) => x.key === s.key);
              return (
                <tr key={s.key} className="border-t border-ink-700">
                  <td className="py-1"><b>{s.label}</b> <span className="text-xs text-slate-500">{s.type}</span></td>
                  <td>{p?.degree ?? "–"}</td>
                  <td>{(p?.pagerank ?? 0).toFixed(3)}</td>
                  <td>{(p?.betweenness ?? 0).toFixed(2)}</td>
                  <td className="text-xs">{p ? String(p.louvain) : "–"}</td>
                  <td>
                    <span className={`font-semibold ${LEVEL_COLOR[s.level]}`}
                      title={s.factors.map((f) => `${f.name} ${f.value}×${f.weight}=${f.contribution} — ${f.reason}`).join("\n")}>
                      {(s.score * 100).toFixed(0)}% {s.level}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {scores.length === 0 && !loading && <p className="py-2 text-sm text-slate-500">No scored entities — build the graph first.</p>}

      {bridges.length > 0 && (
        <>
          <h3 className="mt-3 text-sm font-semibold text-slate-300">Bridges / brokers ({bridges.length})</h3>
          <ul className="text-sm">
            {bridges.map((b) => (
              <li key={b.key} className="py-1"><b>{b.label}</b> <span className="text-xs text-slate-400">— {b.kinds.join("; ")}</span></li>
            ))}
          </ul>
        </>
      )}

      {communities.length > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          {communities.length} communit{communities.length === 1 ? "y" : "ies"}:{" "}
          {communities.map((c) => `${c.id} (${c.size})`).join(" · ")}
        </p>
      )}

      <h3 className="mt-3 text-sm font-semibold text-slate-300">Anomalies ({anomalies.length})</h3>
      <div className="space-y-1.5 text-sm">
        {anomalies.map((a, i) => (
          <p key={i} className={a.severity === "high" ? "text-risk-high" : a.severity === "medium" ? "text-risk-medium" : "text-slate-300"}>
            <b>[{a.severity}] {a.kind.replace(/_/g, " ")}</b> — {a.explanation}
          </p>
        ))}
        {anomalies.length === 0 && !loading && <p className="text-sm text-slate-500">No unusual patterns detected.</p>}
      </div>

      {history.length > 1 && (
        <p className="mt-2 text-xs text-slate-500">{history.length} saved assessments (latest shown above).</p>
      )}
    </div>
  );
}
