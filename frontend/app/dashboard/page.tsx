"use client";

/** Command dashboard: greeting + stat cards + recent-cases table + alerts/activity.
 *  SHO variant shows jurisdiction-wide scope plus Create/Import actions. */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { StatCard, Panel, StatusPill, RiskText, EmptyState, ErrorState, PipelineMini } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { ShoCaseActions, CaseModals } from "@/components/case-modals";
import { RoleBadge } from "@/components/role-badge";

type CaseItem = {
  id: number; fir_no: string; title: string; status: string; risk_level: string;
  station: string; district: string;
  entities_count?: number; evidence_count?: number; relations_count?: number; alerts_count?: number;
};

type AlertItem = {
  id: number; kind: string; severity: string; message: string; case_fir?: string; created_at: string;
};

type NoteItem = {
  id: number; created_at: string;
  alert: { kind: string; severity: string; message: string; case_id: number | null };
};

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ username?: string; role?: string } | null>(null);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [activity, setActivity] = useState<NoteItem[]>([]);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"create" | "import" | null>(null);
  // Time-of-day greeting is client-only: SSR and client timezones differ,
  // and rendering it during prerender causes a hydration mismatch.
  const [hour, setHour] = useState<number | null>(null);

  useEffect(() => {
    setHour(new Date().getHours());
    api.me().then(setMe).catch(() => setError("Not logged in — go to /login first."));
    api.cases().then((d) => setCases(d.results ?? d)).catch(() => {});
    api.alertsFeed().then((d) => setAlerts((d.results ?? d).slice(0, 6))).catch(() => {});
    api.notifications().then((d) => setActivity((d.results ?? d).slice(0, 8))).catch(() => {});
  }, []);

  const isSHO = me?.role === "sho" || me?.role === "admin";
  const go = (id: number) => router.push(`/cases/${id}`);
  const evidenceTotal = cases.reduce((n, c) => n + (c.evidence_count ?? 0), 0);
  const entitiesTotal = cases.reduce((n, c) => n + (c.entities_count ?? 0), 0);
  const recent = [...cases].slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-xl font-bold">
            {hour === null ? "Welcome" : `${greeting(hour)}, ${me?.username ?? "…"}`}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#10B981]/40 bg-[#10B981]/10 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-[#10B981]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" /> ONLINE
            </span>
          </h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-[#8B93A1]">
            {isSHO ? `Jurisdiction overview — ${cases.length} cases` : `Showing your ${cases.length} assigned cases`}
            <RoleBadge />
          </p>
        </div>
        <div className="flex gap-2">
          <ShoCaseActions role={me?.role} onOpen={setModal} />
          <a className="btn-ghost !px-3 !py-1.5 text-sm" href="/cases">Open cases</a>
        </div>
      </div>
      <CaseModals modal={modal} onClose={() => setModal(null)} onDone={go} />

      {error && <ErrorState title="Couldn't load your dashboard" detail={error} onRetry={() => window.location.reload()} />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active cases" value={cases.length} sub={isSHO ? "across jurisdiction" : "assigned to you"} icon="cases" tone="#3B82F6" />
        <StatCard label="High risk" value={cases.filter((c) => c.risk_level === "high").length} sub="require attention" icon="warn" tone="#EF4444" />
        <StatCard label="Evidence files" value={evidenceTotal} sub="across all cases" icon="doc" tone="#E5E7EB" />
        <StatCard label="Entities" value={entitiesTotal} sub="extracted + confirmed" icon="network" tone="#14B8A6" />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_360px]">
        <Panel title="Recent Cases" right={<a href="/cases" className="text-xs font-semibold text-[#3B82F6] hover:underline">View all</a>}>
          {recent.length === 0 ? (
            <EmptyState icon="cases" title="No cases yet" hint="Seed the backend or create one via API." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-[#1F2733] text-left font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B93A1]">
                    <th className="pb-2 pr-3 font-semibold">FIR</th>
                    <th className="pb-2 pr-3 font-semibold">Title</th>
                    <th className="pb-2 pr-3 font-semibold">Status</th>
                    <th className="pb-2 pr-3 font-semibold">Risk</th>
                    <th className="pb-2 font-semibold">Progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F2733]">
                  {recent.map((c) => (
                    <tr key={c.id} className="cursor-pointer transition-colors hover:bg-[#1A2233]/60" onClick={() => go(c.id)}>
                      <td className="py-2.5 pr-3 font-mono text-xs font-semibold text-[#3B82F6]">{c.fir_no}</td>
                      <td className="py-2.5 pr-3">
                        <span className="block font-medium">{c.title}</span>
                        {c.station && <span className="block text-xs text-[#8B93A1]">{c.station}</span>}
                      </td>
                      <td className="py-2.5 pr-3"><StatusPill status={c.status} /></td>
                      <td className="py-2.5 pr-3"><RiskText level={c.risk_level} /></td>
                      <td className="py-2.5"><PipelineMini evidence={c.evidence_count ?? 0} entities={c.entities_count ?? 0} relations={c.relations_count ?? 0} status={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Alerts" count={alerts.length} right={<a href="/alerts" className="text-xs font-semibold text-[#3B82F6] hover:underline">All alerts</a>}>
            {alerts.length === 0 ? (
              <EmptyState icon="bell" title="No alerts" hint="High-confidence links and risk changes will surface here." />
            ) : (
              <div className="space-y-2.5">
                {alerts.map((a) => (
                  <div key={a.id} className="rounded-md border border-[#1F2733] border-l-4 bg-[#0B0F17] p-3"
                    style={{ borderLeftColor: a.severity === "high" ? "#EF4444" : "#F59E0B" }}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-bold leading-snug">{a.kind.replace(/_/g, " ")}</p>
                      <span className="shrink-0 font-mono text-[10px] text-[#8B93A1]">{a.created_at ? timeAgo(a.created_at) : ""}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-[#8B93A1]">{a.message}</p>
                    {a.case_fir && <p className="mt-1 font-mono text-[11px] text-[#3B82F6]">{a.case_fir}</p>}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Recent Activity">
            {activity.length === 0 ? (
              <EmptyState icon="clock" title="No recent activity" hint="Uploads, reviews and decisions will appear here." />
            ) : (
              <ul className="space-y-2.5">
                {activity.map((n) => (
                  <li key={n.id} className="flex gap-2 text-xs">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#3B82F6]" />
                    <span className="min-w-0">
                      <span className="block truncate text-[#E5E7EB]">{n.alert.message}</span>
                      <span className="font-mono text-[10px] text-[#8B93A1]">
                        [{n.alert.severity}] {n.created_at ? timeAgo(n.created_at) : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
