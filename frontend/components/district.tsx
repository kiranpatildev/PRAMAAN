"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type District = {
  district: string;
  cases: { total: number; by_status: Record<string, number>; by_risk: Record<string, number> };
  workload: { username: string; role: string; active_cases: number; pending_reviews: number }[];
  growth: { week: string; evidence_added: number }[];
  cross_case_top: { node_type: string; normalized: string; cases: number }[];
};

function bars(entries: [string, number][], color: string) {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div className="space-y-1">
      {entries.map(([k, n]) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 text-slate-400">{k}</span>
          <div className="h-3 flex-1 rounded bg-ink-700">
            <div className={`h-3 rounded ${color}`} style={{ width: `${(n / max) * 100}%` }} />
          </div>
          <span className="w-8 text-right">{n}</span>
        </div>
      ))}
    </div>
  );
}

/** District command view: caseload, risk, workload, growth, cross-case top. */
export function DistrictPanel() {
  const [districts, setDistricts] = useState<string[]>([]);
  const [sel, setSel] = useState("");
  const [data, setData] = useState<District | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.districts().then((d) => {
      setDistricts(d.districts ?? []);
      if (d.districts?.length) setSel(d.districts[0]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!sel) return;
    api.district(sel).then(setData).catch((e) => setError(e instanceof Error ? e.message : "District load failed"));
  }, [sel]);

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">District overview</h2>
        <select className="input !w-auto !py-1 text-xs" value={sel} onChange={(e) => setSel(e.target.value)}>
          {districts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      {error && <p className="mt-1 text-sm text-risk-high">{error}</p>}
      {data && (
        <div className="mt-2 grid gap-4 text-sm md:grid-cols-2">
          <div>
            <p className="text-xs text-slate-500">Caseload ({data.cases.total}) by status</p>
            {bars(Object.entries(data.cases.by_status), "bg-accent")}
            <p className="mt-2 text-xs text-slate-500">By risk</p>
            {bars(Object.entries(data.cases.by_risk), "bg-risk-medium")}
          </div>
          <div>
            <p className="text-xs text-slate-500">Investigator workload</p>
            {data.workload.map((w) => (
              <p key={w.username} className="py-0.5 text-xs">
                <b>{w.username}</b> <span className="text-slate-500">{w.active_cases} active · {w.pending_reviews} pending reviews</span>
              </p>
            ))}
            {data.workload.length === 0 && <p className="text-xs text-slate-500">No assignments.</p>}
            <p className="mt-2 text-xs text-slate-500">Evidence/week: {data.growth.map((g) => g.evidence_added).join(", ") || "—"}</p>
            {data.cross_case_top.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                Shared across cases: {data.cross_case_top.map((c) => `${c.normalized} (${c.cases})`).join(", ")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
