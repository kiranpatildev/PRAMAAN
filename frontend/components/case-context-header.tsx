"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type CaseDetail = {
  id: number; fir_no: string; title: string; status: string; risk_level: string;
  station: string; district: string; state: string; owner?: { id: number; username: string };
  assignments?: { user: { id: number; username: string }; permission: string }[];
};

const RISK_STYLE: Record<string, string> = {
  high: "text-risk-high",
  medium: "text-risk-medium",
  low: "text-slate-400",
};

/** Persistent case-context header: which case you're in, its risk/status,
 *  and your relationship to it. Sticky so it survives section scrolling. */
export function CaseContextHeader({ caseId }: { caseId: string }) {
  const [c, setC] = useState<CaseDetail | null>(null);
  const [meId, setMeId] = useState<number | null>(null);
  const [isSHO, setIsSHO] = useState(false);

  useEffect(() => {
    api.cases(`${caseId}/`).then(setC).catch(() => {});
    api.me().then((m) => {
      setMeId(m.id ?? null);
      setIsSHO(m.role === "sho" || m.role === "admin");
    }).catch(() => {});
  }, [caseId]);

  if (!c) return <div className="card"><div className="skeleton h-6 w-1/2" /></div>;
  const mine = (c.assignments ?? []).find((a) => a.user.id === meId);
  const owned = meId != null && c.owner?.id === meId;

  return (
    <div className="card sticky top-2 z-20 !py-3 shadow-lg">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">{c.fir_no} — {c.title}</h1>
        <span className={`text-xs font-semibold ${RISK_STYLE[c.risk_level] ?? RISK_STYLE.low}`}>
          {c.risk_level} risk · {c.status}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
        <span>{[c.station, c.district, c.state].filter(Boolean).join(" · ") || "No location set"}</span>
        {isSHO ? (
          <span className="rounded-full border border-amber-400 px-2 py-0.5 font-semibold text-amber-400">
            owner · {c.owner?.username ?? "—"}
          </span>
        ) : (
          <span className="rounded-full border border-teal-300 px-2 py-0.5 font-semibold text-teal-300">
            assigned to you{owned ? " (owner)" : mine ? ` · ${mine.permission}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
