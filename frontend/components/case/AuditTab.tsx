"use client";

import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { Panel } from "../ui/Panel";
import { TableSkeleton } from "../ui/Table";
import { Avatar } from "../ui/Avatar";
import { Empty } from "../ui/Empty";
import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { caseActivity } from "@/lib/endpoints";
import { auditDate } from "@/lib/format";

interface ActivityRow {
  ts: string;
  kind: string;
  actor: string;
  text: string;
}

export function AuditTab({ caseId: cid }: { caseId: string | number }) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = () => {
    setLoading(true);
    setError("");
    caseActivity(cid)
      .then((d) => {
        setRows(((d as { activity?: ActivityRow[] }).activity ?? []) as ActivityRow[]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Audit log failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [cid]);

  return (
    <Panel title={`Audit log${rows.length ? ` · ${rows.length}` : ""}`} flush>
      {loading ? (
        <TableSkeleton rows={6} />
      ) : error ? (
        <div className="p-[14px]">
          <Notice variant="warn" action={<Button variant="ghost" small onClick={refresh}>Retry</Button>}>
            {error}
          </Notice>
        </div>
      ) : rows.length === 0 ? (
        <div className="p-[14px]">
          <Empty icon={ScrollText} title="No audit entries" body="Every mutation on this case is recorded here." />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((a, i) => (
            <li key={i} className="grid grid-cols-[180px_1fr_auto] items-center gap-3 px-[14px] py-[10px] max-[700px]:grid-cols-[1fr_auto]">
              <span className="flex min-w-0 items-center gap-2">
                <Avatar name={a.actor ?? "?"} />
                <span className="truncate text-[12.5px] text-fg-2">{a.actor ?? "?"}</span>
              </span>
              <span className="truncate font-mono text-[11.5px] text-fg-3">
                {a.kind ? `${a.kind} — ` : ""}{a.text ?? ""}
              </span>
              <span className="font-mono text-[10.5px] text-fg-4">{a.ts ? auditDate(a.ts) : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
