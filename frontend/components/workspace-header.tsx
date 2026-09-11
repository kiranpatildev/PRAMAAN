"use client";

/** Case workspace header: breadcrumb, title + badges, subtext, the
 *  4-stage pipeline tracker, and ownership. Reports live counts upward
 *  so the tab bar can show real Evidence/Entities numbers. */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { StatusPill, RiskText, Icon } from "@/components/ui";

export type CaseCounts = { evidence: number; entities: number };

type CaseDetail = {
  id: number; fir_no: string; title: string; status: string; risk_level: string;
  station: string; district: string; state: string; updated_at?: string;
  legal_section?: string; section?: string;
  entities_count?: number; evidence_count?: number; relations_count?: number;
  owner?: { id: number; username: string };
  assignments?: { user: { id: number; username: string }; permission: string }[];
};

const STEPS = ["Upload", "Extract", "Verify", "Network ready"];

function PipelineTracker({ c }: { c: CaseDetail }) {
  const done = [
    (c.evidence_count ?? 0) > 0,
    (c.entities_count ?? 0) > 0,
    (c.relations_count ?? 0) > 0,
    c.status !== "pending_review" && (c.relations_count ?? 0) > 0,
  ];
  const active = done.findIndex((d) => !d);
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Case pipeline">
      {STEPS.map((label, i) => {
        const isDone = done[i];
        const isActive = !isDone && i === active;
        return (
          <li key={label} className="flex items-center">
            <span className="flex items-center gap-2">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[11px] font-bold"
                style={
                  isDone
                    ? { borderColor: "#10B981", color: "#10B981", backgroundColor: "rgb(16 185 129 / 0.15)" }
                    : isActive
                      ? { borderColor: "#F59E0B", color: "#F59E0B", backgroundColor: "rgb(245 158 11 / 0.12)" }
                      : { borderColor: "#1F2733", color: "#8B93A1" }
                }
              >
                {isDone ? <Icon name="check" className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}
              </span>
              <span className={`text-xs font-semibold ${isDone ? "text-[#E5E7EB]" : isActive ? "text-[#F59E0B]" : "text-[#8B93A1]"}`}>
                {label}
              </span>
            </span>
            {i < STEPS.length - 1 && <span className="mx-2 h-px w-6 bg-[#1F2733] sm:w-10" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

export function WorkspaceHeader({ caseId, onLoaded }: {
  caseId: string; onLoaded?: (counts: CaseCounts) => void;
}) {
  const [c, setC] = useState<CaseDetail | null>(null);
  const [meId, setMeId] = useState<number | null>(null);
  const [isSHO, setIsSHO] = useState(false);

  useEffect(() => {
    api.cases(`${caseId}/`).then((d) => {
      setC(d);
      onLoaded?.({ evidence: d.evidence_count ?? 0, entities: d.entities_count ?? 0 });
    }).catch(() => {});
    api.me().then((m) => {
      setMeId(m.id ?? null);
      setIsSHO(m.role === "sho" || m.role === "admin");
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  if (!c) return <div className="card"><div className="skeleton h-16 w-2/3" /></div>;

  const mine = (c.assignments ?? []).find((a) => a.user.id === meId);
  const owned = meId != null && c.owner?.id === meId;
  const section = c.legal_section || c.section;

  return (
    <div className="space-y-3">
      <nav className="font-mono text-xs text-[#8B93A1]" aria-label="Breadcrumb">
        <a href="/cases" className="hover:text-[#3B82F6] hover:underline">Cases</a>
        <span className="mx-1.5">/</span>
        <span className="text-[#E5E7EB]">{c.fir_no}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold leading-tight">
            <span className="truncate">{c.title}</span>
            <RiskText level={c.risk_level} />
            <StatusPill status={c.status} />
          </h1>
          <p className="mt-1 font-mono text-xs text-[#8B93A1]">
            {[c.fir_no, c.station, section].filter(Boolean).join(" · ")}
            {c.updated_at ? ` · Updated ${new Date(c.updated_at).toLocaleDateString()}` : ""}
          </p>
        </div>
        {isSHO ? (
          <span className="shrink-0 rounded-full border border-[#F59E0B]/50 px-2.5 py-1 font-mono text-[11px] font-semibold text-[#F59E0B]">
            owner · {c.owner?.username ?? "—"}
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-[#14B8A6]/50 px-2.5 py-1 font-mono text-[11px] font-semibold text-[#14B8A6]">
            Assigned to you{owned ? " · owner" : mine ? ` · ${mine.permission}` : " · edit"}
          </span>
        )}
      </div>

      <PipelineTracker c={c} />
    </div>
  );
}
