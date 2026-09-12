"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "../ui/Panel";
import { Table, TableSkeleton } from "../ui/Table";
import { StatusTag } from "../ui/Tag";
import { Empty } from "../ui/Empty";
import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { Link2 } from "lucide-react";
import { crossCase, listCases } from "@/lib/endpoints";
import { caseId } from "@/lib/format";
import type { CaseItem } from "@/lib/types";

interface Hit {
  node_type: string;
  normalized: string;
  value: string;
  confidence: number;
  cases: { id: number; fir_no: string; title: string }[];
  case_count: number;
  strength: number;
}

export function CrossCaseTab({ caseId: cid }: { caseId: string | number }) {
  const router = useRouter();
  const [hits, setHits] = useState<Hit[]>([]);
  const [byId, setById] = useState<Map<number, CaseItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = () => {
    setLoading(true);
    setError("");
    Promise.all([crossCase(cid), listCases({ limit: 200 })])
      .then(([cc, cs]) => {
        const all: Hit[] = (cc.results ?? cc) as Hit[];
        setHits(cid == null ? all : all.filter((h) => h.cases.some((c) => String(c.id) === String(cid))));
        setById(new Map(cs.results.map((c) => [c.id, c])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Cross-case links failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [cid]);

  const linkedIds = Array.from(
    new Set(hits.flatMap((h) => h.cases.map((c) => c.id)))
  ).filter((id) => String(id) !== String(cid));
  const signals = hits
    .filter((h) => /phone|locat|address|vehic/i.test(h.node_type) && h.case_count > 1)
    .slice(0, 12);

  return (
    <div className="space-y-[18px]">
      <Panel title={`Linked cases${linkedIds.length ? ` · ${linkedIds.length}` : ""}`} flush>
        {loading ? (
          <TableSkeleton rows={4} />
        ) : error ? (
          <div className="p-[14px]">
            <Notice variant="warn" action={<Button variant="ghost" small onClick={refresh}>Retry</Button>}>
              {error}
            </Notice>
          </div>
        ) : linkedIds.length === 0 ? (
          <div className="p-[14px]">
            <Empty icon={Link2} title="No linked cases" body="Cases sharing entities with this one will appear here." />
          </div>
        ) : (
          <Table<{ id: number }>
            columns={[
              {
                key: "case",
                head: "Case",
                width: "40%",
                render: (r) => {
                  const c = byId.get(r.id);
                  return (
                    <span>
                      <b className="block text-[12.5px] font-medium text-fg">{c?.title ?? `Case ${r.id}`}</b>
                      <span className="font-mono text-[10.5px] text-fg-4">{caseId(r.id)}</span>
                    </span>
                  );
                },
              },
              {
                key: "fir",
                head: "FIR",
                render: (r) => <span className="font-mono text-[11.5px]">{byId.get(r.id)?.fir_no ?? "—"}</span>,
              },
              {
                key: "risk",
                head: "Risk",
                render: (r) => <StatusTag status={byId.get(r.id)?.risk_level ?? "—"} />,
              },
              {
                key: "status",
                head: "Status",
                render: (r) => <StatusTag status={byId.get(r.id)?.status ?? "—"} />,
              },
            ]}
            rows={linkedIds.map((id) => ({ id }))}
            onRowClick={(r) => router.push(`/cases/${r.id}`)}
          />
        )}
      </Panel>

      <Panel title="Shared entity signals" flush>
        {loading ? (
          <TableSkeleton rows={3} />
        ) : signals.length === 0 ? (
          <div className="p-[14px]">
            <Empty icon={Link2} title="No shared signals" body="Phones, addresses and vehicles appearing in multiple cases surface here." />
          </div>
        ) : (
          <Table<Hit & { id: string }>
            columns={[
              {
                key: "entity",
                head: "Entity",
                width: "50%",
                render: (h) => (
                  <span>
                    <b className="block font-mono text-[11.5px] font-medium text-fg">{h.value}</b>
                    <span className="font-mono text-[10.5px] uppercase text-fg-4">{h.node_type}</span>
                  </span>
                ),
              },
              {
                key: "cases",
                head: "Cases",
                numeric: true,
                render: (h) => <span>{h.case_count} cases</span>,
              },
            ]}
            rows={signals.map((h) => ({ ...h, id: `${h.node_type}:${h.normalized}` }))}
          />
        )}
      </Panel>
    </div>
  );
}
