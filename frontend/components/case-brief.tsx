"use client";

/** Overview-tab intelligence cards: an auto-computed case brief (violet =
 *  generated content) plus the top key influencers from graph analytics.
 *  Every figure is computed from live case data, never placeholder. */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Panel, EmptyState, Icon } from "@/components/ui";
import { entityColor } from "@/lib/theme";

type Player = { key: string; label: string; type: string; degree: number; pagerank: number };

export function CaseBrief({ caseId, onInspect }: { caseId: string; onInspect?: (nodeId: string) => void }) {
  const [detail, setDetail] = useState<{
    fir_no: string; title: string; entities_count?: number; evidence_count?: number;
    relations_count?: number; alerts_count?: number;
  } | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [notes, setNotes] = useState<string[]>([]);

  useEffect(() => {
    api.cases(`${caseId}/`).then(setDetail).catch(() => {});
    api.analyticsOverview(caseId).then((ov) => {
      setPlayers((ov.key_players ?? []).slice(0, 5));
      setNotes(ov.notes ?? []);
    }).catch(() => {});
  }, [caseId]);

  const top = players.slice(0, 3).map((p) => p.label).filter(Boolean);
  const brief = detail
    ? `${detail.fir_no} — ${detail.title}: ${detail.entities_count ?? 0} entities extracted from ` +
      `${detail.evidence_count ?? 0} evidence files, with ${detail.relations_count ?? 0} confirmed ` +
      `relationships in the temporal graph${top.length ? `; most connected: ${top.join(", ")}` : ""}. ` +
      `${detail.alerts_count ?? 0} findings raised.`
    : "";

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
      <div className="rounded-lg border border-[#A855F7]/35 bg-[#A855F7]/[0.07] p-5">
        <p className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A855F7]">
          <Icon name="spark" className="h-3.5 w-3.5" /> Auto brief · computed from case data
        </p>
        {brief ? (
          <p className="mt-2 text-sm leading-relaxed text-[#E5E7EB]">{brief}</p>
        ) : (
          <div className="skeleton mt-2 h-10 w-full" />
        )}
        {notes.length > 0 && (
          <ul className="mt-2 space-y-1">
            {notes.slice(0, 3).map((n, i) => (
              <li key={i} className="text-xs text-[#F59E0B]">⚠ {n}</li>
            ))}
          </ul>
        )}
      </div>

      <Panel title="Top Key Influencers">
        {players.length === 0 ? (
          <EmptyState icon="network" title="No influencers yet" hint="Confirm entities and relationships to rank key players." />
        ) : (
          <ul className="space-y-2">
            {players.map((p, i) => (
              <li key={p.key}>
                <button
                  onClick={() => onInspect?.(p.key)}
                  className="flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-left hover:bg-[#1A2233]"
                  title={onInspect ? "Inspect in graph" : undefined}
                >
                  <span className="font-mono text-xs font-bold text-[#8B93A1]">{String(i + 1).padStart(2, "0")}</span>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entityColor(p.type) }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{p.label}</span>
                    <span className="block font-mono text-[10px] uppercase tracking-wider text-[#8B93A1]">{p.type}</span>
                  </span>
                  <span className="font-mono text-xs text-[#8B93A1]" title={`${p.degree} connections · pagerank ${p.pagerank?.toFixed?.(3) ?? "—"}`}>
                    {p.degree}°
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
