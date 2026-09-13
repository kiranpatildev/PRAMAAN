"use client";

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { Panel } from "../ui/Panel";
import { Table, TableSkeleton } from "../ui/Table";
import { Tag } from "../ui/Tag";
import { KpiStrip } from "../ui/KpiStrip";
import { Empty } from "../ui/Empty";
import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import {
  analyticsOverview, analyticsRisk, caseAnomalies,
  type Anomaly, type RiskScore,
} from "@/lib/endpoints";

interface KeyPlayer {
  key?: string;
  id?: string;
  label?: string;
  type?: string;
  pagerank?: number;
  degree?: number;
}

function levelTone(l: string): "red" | "amber" | "green" | "muted" {
  if (l === "high") return "red";
  if (l === "medium") return "amber";
  if (l === "low") return "green";
  return "muted";
}

export function AnalyticsTab({ caseId: cid }: { caseId: string | number }) {
  const [players, setPlayers] = useState<KeyPlayer[]>([]);
  const [engine, setEngine] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [scores, setScores] = useState<RiskScore[]>([]);
  const [weightsVersion, setWeightsVersion] = useState("");
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [degraded, setDegraded] = useState("");

  const refresh = () => {
    setLoading(true);
    setError("");
    setDegraded("");
    Promise.all([
      analyticsOverview(cid).catch((e) => {
        setDegraded(e instanceof Error ? e.message : "Graph analytics unavailable");
        return null;
      }),
      analyticsRisk(cid).catch(() => null),
      caseAnomalies(cid).catch(() => null),
    ])
      .then(([ov, risk, anom]) => {
        if (ov) {
          setPlayers((ov.key_players ?? []).slice(0, 10));
          setEngine(ov.engine ?? "");
          setNotes(ov.notes ?? []);
        }
        if (risk) {
          setScores((risk.scores ?? []).slice(0, 15));
          setWeightsVersion(risk.weights_version ?? "");
        }
        if (anom) setAnomalies(anom.anomalies ?? []);
        if (!ov && !risk && !anom) setError("Analytics unavailable.");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Analytics failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [cid]);

  const high = scores.filter((s) => s.level === "high").length;

  return (
    <div className="space-y-[18px]">
      {error && (
        <Notice variant="warn" action={<Button variant="ghost" small onClick={refresh}>Retry</Button>}>
          {error}
        </Notice>
      )}
      {degraded && !error && (
        <Notice variant="warn">
          Graph engine degraded: {degraded.slice(0, 160)}. Risk and anomaly panels show
          whatever computed before the outage.
        </Notice>
      )}

      {loading ? (
        <TableSkeleton rows={3} />
      ) : (
        <KpiStrip
          items={[
            { label: "Top risk", dot: "#f87171", value: high, sub: "high-level nodes" },
            { label: "Scored", dot: "#00d9ff", value: scores.length, sub: `weights ${weightsVersion || "—"}` },
            { label: "Anomalies", dot: "#fbbf24", value: anomalies.length, sub: "statistical flags" },
            { label: "Key players", dot: "#a78bfa", value: players.length, sub: engine || "centrality" },
          ]}
        />
      )}

      <div className="grid grid-cols-[1.6fr_1fr] gap-[18px] max-[1100px]:grid-cols-1">
        <Panel title={`Risk ranking${scores.length ? ` · top ${scores.length}` : ""}`} flush>
          {loading ? (
            <TableSkeleton rows={6} />
          ) : (
            <Table<RiskScore & { id: string }>
              columns={[
                {
                  key: "node",
                  head: "Node",
                  width: "34%",
                  render: (s) => (
                    <span>
                      <b className="block truncate text-[12.5px] font-medium text-fg">{s.label}</b>
                      <span className="block font-mono text-[10.5px] text-fg-4">{s.type}</span>
                    </span>
                  ),
                },
                {
                  key: "score",
                  head: "Score",
                  render: (s) => (
                    <span className="flex max-w-[110px] items-center gap-2">
                      <span className="h-[3px] flex-1 overflow-hidden rounded-[2px] bg-line">
                        <span
                          className="block h-full rounded-[2px]"
                          style={{
                            width: `${Math.round(s.score * 100)}%`,
                            background: s.level === "high" ? "#f87171" : s.level === "medium" ? "#fbbf24" : "#4ade80",
                          }}
                        />
                      </span>
                      <span className="font-mono text-[11px] text-fg-3">{s.score.toFixed(2)}</span>
                    </span>
                  ),
                },
                { key: "level", head: "Level", render: (s) => <Tag tone={levelTone(s.level)}>{s.level}</Tag> },
                {
                  key: "top",
                  head: "Top factor",
                  render: (s) => {
                    const top = [...(s.factors ?? [])].sort((a, b) => b.contribution - a.contribution)[0];
                    return <span className="font-mono text-[11px] text-fg-3">{top ? `${top.name} ${top.contribution.toFixed(2)}` : "—"}</span>;
                  },
                },
              ]}
              rows={scores.map((s) => ({ ...s, id: s.key }))}
              empty={
                <div className="p-[14px]">
                  <Empty icon={Gauge} title="No risk scores" body="Scores compute from the live graph once entities are confirmed." />
                </div>
              }
            />
          )}
        </Panel>

        <div className="space-y-[18px]">
          <Panel title={`Anomalies${anomalies.length ? ` · ${anomalies.length}` : ""}`}>
            {loading ? (
              <TableSkeleton rows={3} />
            ) : anomalies.length === 0 ? (
              <Empty icon={Gauge} title="No anomalies" body="Hub, burst and weak-evidence checks found nothing unusual." />
            ) : (
              <ul className="divide-y divide-line">
                {anomalies.map((a, i) => (
                  <li key={i} className="py-[9px]">
                    <p className="flex items-center justify-between gap-2">
                      <Tag tone={a.severity === "high" ? "red" : a.severity === "medium" ? "amber" : "muted"}>
                        {a.severity}
                      </Tag>
                      <span className="font-mono text-[10.5px] text-fg-4">{a.kind}</span>
                    </p>
                    <p className="mt-[5px] text-[12.5px] leading-[1.55] text-fg-2">{a.explanation}</p>
                    {(a.nodes ?? []).length > 0 && (
                      <p className="mt-[3px] font-mono text-[10.5px] text-fg-4">
                        {(a.nodes ?? []).map((n) => n.label).join(", ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Key players${players.length ? ` · ${players.length}` : ""}`}>
            {players.length === 0 ? (
              <p className="text-[12.5px] text-fg-3">Pagerank ranking appears after the first graph build.</p>
            ) : (
              <ul className="divide-y divide-line">
                {players.map((p, i) => (
                  <li key={p.key ?? p.id ?? i} className="flex items-center justify-between gap-2 py-[8px]">
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] text-fg">
                        <span className="mr-2 font-mono text-[10.5px] text-fg-4">{i + 1}</span>
                        {p.label ?? p.key}
                      </span>
                      <span className="block font-mono text-[10.5px] text-fg-4">
                        {p.type ?? ""}{p.degree != null ? ` · degree ${p.degree}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {notes.length > 0 && (
              <p className="mt-2 font-mono text-[10.5px] leading-[1.6] text-fg-4">{notes.join(" · ").slice(0, 300)}</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
