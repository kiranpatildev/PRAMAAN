"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type CaseDetail = {
  id: number; fir_no: string; title: string; status: string; risk_level: string;
  station: string; district: string; state: string;
  entities_count?: number; evidence_count?: number; alerts_count?: number;
  relations_count?: number;
};

const RISK_STYLE: Record<string, string> = {
  high: "text-risk-high",
  medium: "text-risk-medium",
  low: "text-slate-400",
};

/** Case overview header: identity + live stat row from the case's own data. */
export function CaseOverview({ caseId }: { caseId: string }) {
  const [c, setC] = useState<CaseDetail | null>(null);

  useEffect(() => {
    api.cases(`${caseId}/`).then(setC).catch(() => {});
  }, [caseId]);

  if (!c) return <div className="card"><div className="skeleton h-6 w-1/2" /></div>;
  const stats: [string, string | number][] = [
    ["Entities analyzed", c.entities_count ?? 0],
    ["Relationships in graph", c.relations_count ?? 0],
    ["Evidence processed", c.evidence_count ?? 0],
    ["Findings", c.alerts_count ?? 0],
  ];
  return (
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">{c.fir_no} — {c.title}</h1>
        <span className={`text-xs font-semibold ${RISK_STYLE[c.risk_level] ?? RISK_STYLE.low}`}>
          {c.risk_level} risk · {c.status}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        {[c.station, c.district, c.state].filter(Boolean).join(" · ") || "No location set"}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-ink-700 bg-ink-950 p-3">
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-slate-400">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
