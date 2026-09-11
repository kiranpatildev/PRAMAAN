"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type CaseItem = {
  id: number;
  fir_no: string;
  title: string;
  status: string;
  risk_level: string;
  district: string;
  assignments?: { user: { id: number; username: string }; permission: string }[];
};

function riskColor(risk: string) {
  if (risk === "high") return "text-risk-high";
  if (risk === "medium") return "text-risk-medium";
  return "text-risk-low";
}

/** Investigator landing: only cases assigned to me. The backend scopes the
 *  queryset, so unassigned cases are unreachable here — no extra filtering. */
export default function MyCasesPage() {
  const { t } = useI18n();
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [meId, setMeId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.me().then((m) => setMeId(m.id ?? null)).catch(() => setError("Not logged in — go to /login first."));
    api.cases().then((d) => setCases(d.results ?? d)).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">
            {t("my.title", "My cases")} <span className="ml-1 rounded-full border border-teal-300 px-2 py-0.5 align-middle text-xs font-semibold text-teal-300">Investigator</span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t("my.sub", "Cases assigned to you by your SHO. New assignments appear here automatically.")}
          </p>
        </div>
        <span className="text-sm text-slate-400">{cases.length} assigned</span>
      </div>
      {error && <p className="text-sm text-risk-high">{error}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {cases.map((c) => {
          const mine = (c.assignments ?? []).find((a) => a.user.id === meId);
          return (
            <a key={c.id} href={`/cases/${c.id}`} className="card block transition-colors hover:border-teal-300">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm"><b>{c.fir_no}</b> — {c.title}</span>
                <span className={`shrink-0 text-xs font-semibold ${riskColor(c.risk_level)}`}>
                  {c.risk_level} · {c.status}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                {c.district && <span>{c.district}</span>}
                <span className="rounded-full border border-teal-300 px-2 py-0.5 font-semibold text-teal-300">
                  assigned to you{mine ? ` · ${mine.permission}` : ""}
                </span>
              </div>
            </a>
          );
        })}
        {cases.length === 0 && !error && (
          <div className="card md:col-span-2">
            <h2 className="font-semibold">No cases assigned yet</h2>
            <p className="mt-1 text-sm text-slate-400">
              Your supervisor will assign you to a case — it appears here automatically,
              no refresh or acceptance needed. If you expected a case here, check with your SHO.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
