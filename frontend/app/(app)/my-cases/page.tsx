"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { Table, TableSkeleton } from "@/components/ui/Table";
import { StatusTag, Tag } from "@/components/ui/Tag";
import { AvatarStack } from "@/components/ui/Avatar";
import { Empty } from "@/components/ui/Empty";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";
import { listCases, getMe } from "@/lib/endpoints";
import { displayName } from "@/lib/auth";
import { caseId } from "@/lib/format";
import { progressOf, StageBar } from "@/lib/case";
import type { CaseItem } from "@/lib/types";

export default function MyCasesPage() {
  const router = useRouter();
  const [meId, setMeId] = useState<number | null>(null);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getMe().then((m) => setMeId(m.id)).catch(() => {});
    listCases({ ordering: "-created_at", limit: 100 })
      .then((d) => setCases(d.results))
      .catch((e) => setError(e instanceof Error ? e.message : "Cases failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        eyebrow="Assignment"
        title="My Cases"
        sub="Cases you own or are assigned to, with your access level on each."
      />

      {error && (
        <div className="mb-[14px]">
          <Notice variant="warn" action={<Button variant="ghost" small onClick={() => window.location.reload()}>Retry</Button>}>
            {error}
          </Notice>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={6} />
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
                  <span className="mt-[2px] block font-mono text-[10.5px] text-fg-4">{caseId(c.id)} · {c.fir_no}</span>
                </span>
              ),
            },
            { key: "status", head: "Status", render: (c) => <StatusTag status={c.status} /> },
            { key: "risk", head: "Risk", render: (c) => <StatusTag status={c.risk_level} /> },
            {
              key: "pipeline",
              head: "Pipeline",
              render: (c) => {
                const p = progressOf(c);
                return (
                  <span className="block min-w-[110px]">
                    <StageBar done={p.done} />
                    <span className="mt-1 block font-mono text-[10.5px] text-fg-3">{p.done}/4 stages</span>
                  </span>
                );
              },
            },
            {
              key: "evidence",
              head: "Evidence",
              numeric: true,
              render: (c) => <span>{c.evidence_count ?? 0}</span>,
            },
            {
              key: "team",
              head: "Team",
              render: (c) => <AvatarStack names={(c.assignments ?? []).map((a) => displayName(a.user))} />,
            },
            {
              key: "access",
              head: "Access",
              render: (c) => {
                const onTeam =
                  meId != null &&
                  ((c.assignments ?? []).some((a) => a.user.id === meId) || c.owner?.id === meId);
                return onTeam ? <Tag tone="violet">Edit</Tag> : <Tag tone="muted">Read</Tag>;
              },
            },
          ]}
          rows={cases}
          onRowClick={(c) => router.push(`/cases/${c.id}`)}
          actionFor={() => (
            <Button variant="ghost" small>
              Open →
            </Button>
          )}
          empty={
            <div className="p-[14px]">
              <Empty icon={ClipboardCheck} title="No assigned cases" body="Cases assigned to you will appear here." />
            </div>
          }
        />
      )}
    </div>
  );
}
