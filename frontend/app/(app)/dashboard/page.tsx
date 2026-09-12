"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Download, FolderOpen, Inbox } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { KpiStrip } from "@/components/ui/KpiStrip";
import { Panel } from "@/components/ui/Panel";
import { Table, TableSkeleton } from "@/components/ui/Table";
import { Tag, StatusTag } from "@/components/ui/Tag";
import { AvatarStack } from "@/components/ui/Avatar";
import { Empty } from "@/components/ui/Empty";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";
import { dashboardKpis, listCases, reviewQueue, alertsFeed } from "@/lib/endpoints";
import { isSho, displayName } from "@/lib/auth";
import { caseId, timeAgo } from "@/lib/format";
import { progressOf, StageBar, EntityChip, entityKind, ENTITY_META } from "@/lib/case";
import { useCaseModals } from "@/components/case/CaseModals";
import type { AlertItem, CaseItem, DashboardKpis } from "@/lib/types";
import { useSession } from "@/components/shell/useSession";

function teamNames(c: CaseItem): string[] {
  return (c.assignments ?? []).map((a) => displayName(a.user));
}

export default function DashboardPage() {
  const { user } = useSession();
  const sho = isSho(user?.role);
  const { openNew, openImport, nodes: modals } = useCaseModals();
  const [today, setToday] = useState("");
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [pending, setPending] = useState<Record<string, unknown>[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setToday(new Date().toISOString().slice(0, 10));
    Promise.all([
      dashboardKpis().then(setKpis),
      listCases({ limit: 8, ordering: "-created_at" }).then((d) => setCases(d.results)),
      reviewQueue("pending", 8).then((q) => setPending(q.entities.results)),
      alertsFeed().then((a) => setAlerts(a.slice(0, 3))),
    ])
      .catch((e) => setError(e instanceof Error ? e.message : "Dashboard failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        eyebrow={`Dashboard · ${today || "…"}`}
        title="Overview"
        sub={sho ? "System-wide view across every case in the zone." : "Scoped view across the cases assigned to you."}
        actions={sho ? (
          <>
            <Button variant="ghost" onClick={openImport}>
              <Download size={14} strokeWidth={1.6} aria-hidden /> Import from ICJS
            </Button>
            <Button variant="primary" onClick={openNew}>
              <Plus size={14} strokeWidth={1.6} aria-hidden /> New case
            </Button>
          </>
        ) : undefined}
      />
      {modals}

      {error && (
        <div className="mb-[18px]">
          <Notice variant="warn" action={<Button variant="ghost" small onClick={() => window.location.reload()}>Retry</Button>}>
            {error}
          </Notice>
        </div>
      )}

      {loading || !kpis ? (
        <TableSkeleton rows={2} />
      ) : (
        <KpiStrip
          items={[
            { label: "Cases", dot: "#00d9ff", value: kpis.cases_total, sub: `${kpis.cases_open} active` },
            { label: "Evidence", dot: "#4ade80", value: kpis.evidence_files, sub: `${kpis.evidence_in_pipeline} in pipeline` },
            { label: "Entities", dot: "#a78bfa", value: kpis.entities_extracted, sub: `${kpis.entities_pending} pending review` },
            { label: "High risk", dot: "#f87171", value: kpis.high_risk_cases, sub: "Priority attention" },
          ]}
        />
      )}

      <div className="mt-[18px] grid grid-cols-[1.6fr_1fr] gap-[18px] max-[1100px]:grid-cols-1">
        <Panel title="Recent investigations" flush>
          {loading ? (
            <TableSkeleton rows={6} />
          ) : cases.length === 0 ? (
            <div className="p-[14px]">
              <Empty icon={FolderOpen} title="No cases yet" body="Cases you can access will appear here." />
            </div>
          ) : (
            <Table<CaseItem>
              columns={[
                {
                  key: "case",
                  head: "Case",
                  width: "36%",
                  render: (c) => (
                    <span>
                      <b className="block text-[12.5px] font-medium text-fg">{c.title}</b>
                      <span className="mt-[2px] block font-mono text-[10.5px] text-fg-4">
                        {caseId(c.id)} · {c.fir_no}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "risk",
                  head: "Risk",
                  render: (c) => <StatusTag status={c.risk_level} />,
                },
                {
                  key: "stage",
                  head: "Stage",
                  render: (c) => <StageBar done={progressOf(c).done} />,
                },
                {
                  key: "team",
                  head: "Team",
                  render: (c) => <AvatarStack names={teamNames(c)} />,
                },
              ]}
              rows={cases}
              onRowClick={(c) => (window.location.href = `/cases/${c.id}`)}
            />
          )}
        </Panel>

        <div className="space-y-[18px]">
          <Panel title={`Review queue${pending.length ? ` · ${pending.length}` : ""}`}>
            {loading ? (
              <TableSkeleton rows={4} />
            ) : pending.length === 0 ? (
              <Empty icon={Inbox} title="Queue clear" body="Every extracted entity has been decided." />
            ) : (
              <ul className="divide-y divide-line">
                {pending.slice(0, 6).map((e) => {
                  const r = e as { id: number; value?: string; label?: string; node_type?: string; case_id?: number; case?: number };
                  const cid = r.case_id ?? r.case;
                  return (
                    <li key={r.id}>
                      <Link href={cid ? `/cases/${cid}` : "/cases"} className="flex items-center gap-[10px] py-[9px]">
                        <EntityChip type={r.node_type} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-fg">{r.value ?? r.label ?? `#${r.id}`}</span>
                          <span className="block font-mono text-[10.5px] text-fg-4">
                            {ENTITY_META[entityKind(r.node_type)].label.toLowerCase()} · {cid ? caseId(cid) : "—"}
                          </span>
                        </span>
                        <Tag tone="amber">pending</Tag>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Alerts" right={<Link href="/alerts" className="text-[12px] text-cyan hover:underline">All</Link>}>
            {loading ? (
              <TableSkeleton rows={3} />
            ) : alerts.length === 0 ? (
              <Empty icon={Inbox} title="No alerts" body="Risk changes and high-confidence links surface here." />
            ) : (
              <ul className="divide-y divide-line">
                {alerts.map((a) => (
                  <li key={a.id} className="py-[9px]">
                    <p className="flex items-center justify-between gap-2">
                      <Tag tone={a.severity === "high" ? "red" : a.severity === "medium" ? "amber" : "muted"}>
                        {a.severity}
                      </Tag>
                      <span className="font-mono text-[10.5px] text-fg-4">{timeAgo(a.created_at)}</span>
                    </p>
                    <p className="mt-[5px] text-[12.5px] text-fg">{a.title ?? a.kind.replace(/_/g, " ")}</p>
                    <p className="mt-[2px] line-clamp-2 text-[11.5px] text-fg-3">{a.message}</p>
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
