"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Download, FolderOpen } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { Table, TableSkeleton } from "@/components/ui/Table";
import { SearchInput } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Segmented";
import { StatusTag } from "@/components/ui/Tag";
import { AvatarStack } from "@/components/ui/Avatar";
import { Empty } from "@/components/ui/Empty";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";
import { listCases } from "@/lib/endpoints";
import { isSho, displayName } from "@/lib/auth";
import { caseId, longDate } from "@/lib/format";
import { progressOf, StageBar } from "@/lib/case";
import { useCaseModals } from "@/components/case/CaseModals";
import { useSession } from "@/components/shell/useSession";
import type { CaseItem } from "@/lib/types";

type StatusFilter = "all" | "open" | "closed";

export default function CasesPage() {
  const router = useRouter();
  const { user } = useSession();
  const sho = isSho(user?.role);
  const { openNew, openImport, nodes: modals } = useCaseModals();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    const t = setTimeout(() => {
      listCases({
        q: q.trim() || undefined,
        status: status === "closed" ? "closed" : undefined,
        ordering: "-created_at",
        limit: 50,
      })
        .then((d) => {
          let rows = d.results;
          if (status === "open") rows = rows.filter((c) => c.status !== "closed");
          setCases(rows);
          setCount(d.count);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Cases failed to load"))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, status]);

  return (
    <div>
      <PageHeader
        eyebrow="Caseload"
        title={sho ? "All Cases" : "Cases"}
        sub={sho ? "Every case in the zone. Create, import, close and delete from here." : "Cases you own or are assigned to."}
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

      <div className="mb-[14px] flex flex-wrap items-center gap-[10px]">
        <span className="w-full max-w-[360px]">
          <SearchInput placeholder="Filter by title, ID or FIR…" value={q} onChange={(e) => setQ(e.target.value)} />
        </span>
        <Segmented<StatusFilter>
          options={[{ value: "all", label: "All" }, { value: "open", label: "Open" }, { value: "closed", label: "Closed" }]}
          value={status}
          onChange={setStatus}
        />
        <span className="ml-auto font-mono text-[10.5px] text-fg-4">{loading ? "…" : `${count} result${count === 1 ? "" : "s"}`}</span>
      </div>

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
            { key: "fir", head: "FIR", render: (c) => <span className="font-mono text-[11.5px]">{c.fir_no}</span> },
            { key: "status", head: "Status", render: (c) => <StatusTag status={c.status} /> },
            { key: "risk", head: "Risk", render: (c) => <StatusTag status={c.risk_level} /> },
            {
              key: "stage",
              head: "Stage",
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
              key: "team",
              head: "Team",
              render: (c) => <AvatarStack names={(c.assignments ?? []).map((a) => displayName(a.user))} />,
            },
            {
              key: "opened",
              head: "Opened",
              numeric: true,
              render: (c) => <span>{c.created_at ? longDate(c.created_at) : "—"}</span>,
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
              <Empty icon={FolderOpen} title="No cases match" body="Try a different filter or clear the search box." />
            </div>
          }
        />
      )}
    </div>
  );
}
