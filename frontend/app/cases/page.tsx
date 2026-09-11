"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ShoCaseActions, CaseModals } from "@/components/case-modals";

type CaseRow = {
  id: number; fir_no: string; title: string; status: string; risk_level: string;
  station: string; district: string; state: string;
  entities_count?: number; evidence_count?: number; alerts_count?: number;
};

const RISK_STYLE: Record<string, string> = {
  high: "bg-risk-high/15 text-risk-high border-risk-high",
  medium: "bg-risk-medium/15 text-risk-medium border-risk-medium",
  low: "border-ink-700 text-slate-400",
};

export default function CasesPage() {
  const router = useRouter();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [modal, setModal] = useState<"create" | "import" | null>(null);

  useEffect(() => {
    api.me().then((m) => setRole(m.role ?? null)).catch(() => {});
    api.cases().then((d) => setCases(d.results ?? d)).catch(() => {});
  }, []);

  const isSHO = role === "sho" || role === "admin";
  const go = (id: number) => router.push(`/cases/${id}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Cases</h1>
        <ShoCaseActions role={role} onOpen={setModal} />
      </div>

      <CaseModals modal={modal} onClose={() => setModal(null)} onDone={go} />

      <div className="grid gap-3 md:grid-cols-2">
        {cases.map((c) => (
          <a key={c.id} href={`/cases/${c.id}`}
            className="card block transition-colors hover:border-accent">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-slate-500">{c.fir_no}{c.district ? ` · ${c.district}` : ""}</p>
                <h2 className="font-semibold">{c.title}</h2>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${RISK_STYLE[c.risk_level] ?? RISK_STYLE.low}`}>
                {c.risk_level} risk
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              <span>Status: <b className="text-slate-200">{c.status}</b></span>
              <span>{c.entities_count ?? 0} entities</span>
              <span>{c.evidence_count ?? 0} evidence</span>
              <span>{c.alerts_count ?? 0} alerts</span>
            </div>
          </a>
        ))}
        {cases.length === 0 && (
          <p className="text-sm text-slate-400">No cases. Log in first{isSHO ? ", or create one above" : ""}.</p>
        )}
      </div>
    </div>
  );
}
