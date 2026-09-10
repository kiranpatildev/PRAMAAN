"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CrossCasePanel } from "@/components/cross-case";
import { DistrictPanel } from "@/components/district";
import { SecurityCard } from "@/components/security";
import { useI18n } from "@/lib/i18n";

type CaseItem = {
  id: number;
  fir_no: string;
  title: string;
  status: string;
  risk_level: string;
  district: string;
};

function riskColor(risk: string) {
  if (risk === "high") return "text-risk-high";
  if (risk === "medium") return "text-risk-medium";
  return "text-risk-low";
}

export default function DashboardPage() {
  const { t } = useI18n();
  const [me, setMe] = useState<{ username?: string; role?: string } | null>(null);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.me().then(setMe).catch(() => setError("Not logged in — go to /login first."));
    api.cases().then((d) => setCases(d.results ?? d)).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{t("dash.title", "Command dashboard")}</h1>
          <p className="text-sm text-slate-400">
            {me ? `${me.username} · ${me.role}` : "Loading session…"}
          </p>
        </div>
        <a className="btn" href="/cases">{t("dash.open", "Open cases")}</a>
      </div>
      {error && <p className="text-sm text-risk-high">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card"><p className="text-sm text-slate-400">{t("dash.active", "Active cases")}</p><p className="text-2xl font-bold">{cases.length}</p></div>
        <div className="card"><p className="text-sm text-slate-400">{t("dash.highrisk", "High risk")}</p><p className="text-2xl font-bold text-risk-high">{cases.filter((c) => c.risk_level === "high").length}</p></div>
        <div className="card"><p className="text-sm text-slate-400">{t("dash.pending", "Pending review")}</p><p className="text-2xl font-bold text-risk-medium">{cases.filter((c) => c.status === "pending_review").length}</p></div>
      </div>
      <CrossCasePanel />
      <DistrictPanel />
      <div className="grid gap-4 lg:grid-cols-2">
        <SecurityCard />
        <div className="card">
          <h2 className="font-semibold">{t("dash.jurisdiction", "Cases under jurisdiction")}</h2>
        <div className="mt-2 divide-y divide-ink-700">
          {cases.map((c) => (
            <a key={c.id} href={`/cases/${c.id}`} className="flex items-center justify-between py-2 hover:text-accent">
              <span className="text-sm"><b>{c.fir_no}</b> — {c.title}</span>
              <span className={`text-xs font-semibold ${riskColor(c.risk_level)}`}>{c.risk_level} · {c.status}</span>
            </a>
          ))}
          {cases.length === 0 && <p className="py-4 text-sm text-slate-400">No cases yet. Seed the backend or create one via API.</p>}
        </div>
        </div>
      </div>
    </div>
  );
}
