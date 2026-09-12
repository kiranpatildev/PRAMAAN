"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { Panel } from "../ui/Panel";
import { KpiStrip } from "../ui/KpiStrip";
import { Table, TableSkeleton } from "../ui/Table";
import { Tag } from "../ui/Tag";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Empty } from "../ui/Empty";
import { listEvidence, reviewEntities, reviewRelations, caseTimeline } from "@/lib/endpoints";
import { displayName, isSho } from "@/lib/auth";
import { caseId, dayLabel, timeLabel } from "@/lib/format";
import { progressOf } from "@/lib/case";
import { useSession } from "../shell/useSession";
import type { CaseItem, Evidence, TimelineEvent } from "@/lib/types";

const STAGE_ROWS = [
  { n: "01", key: "upload", label: "Upload" },
  { n: "02", key: "extract", label: "Extract" },
  { n: "03", key: "verify", label: "Verify" },
  { n: "04", key: "network", label: "Network" },
] as const;

export function OverviewTab({ caseId: cid, kase, onManageTeam }: {
  caseId: string | number;
  kase: CaseItem;
  onManageTeam: () => void;
}) {
  const { user } = useSession();
  const [pending, setPending] = useState(0);
  const [verified, setVerified] = useState(0);
  const [relTotal, setRelTotal] = useState(0);
  const [relTypes, setRelTypes] = useState(0);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      reviewEntities(cid, "pending", 1).then((d) => d),
      listEvidence(cid),
      reviewRelations(cid, "", 500),
      caseTimeline(cid).catch(() => ({ events: [] })),
    ])
      .then(([pend, ev, rels, tl]) => {
        const list = (pend as { results?: unknown[] }).results ?? (pend as unknown[]);
        setPending(Array.isArray(list) ? list.length : 0);
        setVerified(ev.filter((e) => e.ocr_status === "done").length);
        setRelTotal(rels.length);
        setRelTypes(new Set(rels.map((r) => r.edge_type)).size);
        setEvents(((tl.events ?? []) as TimelineEvent[]).slice(0, 5));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [cid]);

  const p = progressOf(kase);
  const stageState = (key: keyof typeof p extends never ? never : "upload" | "extract" | "verify" | "network") =>
    p[key] ? "done" : "pending";
  const detail: Record<string, string> = {
    upload: `${kase.evidence_count ?? 0} files hashed into custody`,
    extract: `${kase.entities_count ?? 0} entities extracted`,
    verify: `${kase.relations_count ?? 0} relationships confirmed`,
    network: p.network ? "temporal graph live" : "awaiting confirmations",
  };

  const team = kase.assignments ?? [];
  const meta: [string, string][] = [
    ["Case ID", caseId(kase.id)],
    ["FIR", kase.fir_no],
    ["Opened", kase.created_at ? dayLabel(kase.created_at) : "—"],
    ["Progress", `${p.done}/4 stages`],
    ["Team count", String(team.length)],
  ];

  return (
    <div className="space-y-[18px]">
      {loading ? (
        <TableSkeleton rows={2} />
      ) : (
        <KpiStrip
          items={[
            { label: "Entities", dot: "#00d9ff", value: kase.entities_count ?? 0, sub: `${pending} pending review` },
            { label: "Evidence", dot: "#4ade80", value: kase.evidence_count ?? 0, sub: `${verified} verified` },
            { label: "Relationships", dot: "#a3b1c2", value: relTotal, sub: `${relTypes} types` },
            { label: "Pipeline", dot: p.done === 4 ? "#4ade80" : "#00d9ff", value: `${p.done}/4`, sub: p.done === 4 ? "complete" : "in progress" },
          ]}
        />
      )}

      <div className="grid grid-cols-[1.6fr_1fr] gap-[18px] max-[1100px]:grid-cols-1">
        <div className="space-y-[18px]">
          <Panel title="Pipeline stages" flush>
            <Table<{ id: string; n: string; label: string }>
              columns={[
                { key: "n", head: "Stage", width: "90px", render: (r) => <span className="font-mono text-[11.5px] text-fg-3">{r.n}</span> },
                {
                  key: "label",
                  head: "",
                  render: (r) => <b className="text-[12.5px] font-medium text-fg">{r.label}</b>,
                },
                {
                  key: "status",
                  head: "Status",
                  render: (r) => {
                    const st = stageState(r.label.toLowerCase() as "upload" | "extract" | "verify" | "network");
                    return <Tag tone={st === "done" ? "green" : "amber"}>{st}</Tag>;
                  },
                },
                {
                  key: "detail",
                  head: "Detail",
                  render: (r) => <span className="text-fg-3">{detail[r.label.toLowerCase()]}</span>,
                },
              ]}
              rows={STAGE_ROWS.map((s) => ({ id: s.n, n: s.n, label: s.label }))}
            />
          </Panel>

          <Panel title="Recent activity" flush>
            {events.length === 0 ? (
              <div className="p-[14px]">
                <Empty icon={Activity} title="No activity yet" body="Timeline events will appear here as evidence is confirmed." />
              </div>
            ) : (
              <Table<TimelineEvent & { id: string }>
                columns={[
                  {
                    key: "when",
                    head: "Date",
                    width: "110px",
                    render: (e) => (
                      <span className="font-mono text-[11px]">
                        <span className="block font-medium text-fg-2">{e.date ?? dayLabel(e.valid_from ?? "")}</span>
                        <span className="block text-fg-3">{e.time ?? timeLabel(e.valid_from ?? "")}</span>
                      </span>
                    ),
                  },
                  {
                    key: "what",
                    head: "Event",
                    render: (e) => (
                      <span>
                        <span className="text-[12.5px] text-fg">
                          {e.title ?? `${e.from ?? ""} — ${e.to ?? ""}`} <Tag tone="muted">{e.type ?? e.label ?? ""}</Tag>
                        </span>
                        {(e.desc ?? e.snippet) && (
                          <span className="mt-[3px] block text-[12px] text-fg-3">{e.desc ?? e.snippet}</span>
                        )}
                      </span>
                    ),
                  },
                ]}
                rows={events.map((e, i) => ({ ...e, id: String(e.id ?? i) }))}
              />
            )}
          </Panel>
        </div>

        <div className="space-y-[18px]">
          <Panel title="Case metadata">
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-[9px] text-[12.5px]">
              {meta.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-fg-4">{k}</dt>
                  <dd className="font-mono text-[11.5px] text-fg-2">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel
            title="Assigned team"
            right={isSho(user?.role) ? (
              <Button variant="ghost" small onClick={onManageTeam}>
                Manage assignments
              </Button>
            ) : undefined}
          >
            {team.length === 0 ? (
              <p className="text-[12.5px] text-fg-3">No investigators assigned yet.</p>
            ) : (
              <ul className="space-y-[10px]">
                {team.map((a) => (
                  <li key={a.id} className="flex items-center gap-[10px]">
                    <Avatar name={displayName(a.user)} lg />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-fg">{displayName(a.user)}</span>
                      <span className="block font-mono text-[10.5px] text-fg-4">#{a.user.id}</span>
                    </span>
                    <Tag tone="cyan">{a.permission}</Tag>
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
