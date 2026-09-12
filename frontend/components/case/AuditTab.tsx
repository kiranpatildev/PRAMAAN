"use client";

import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { Panel } from "../ui/Panel";
import { TableSkeleton } from "../ui/Table";
import { Avatar } from "../ui/Avatar";
import { Empty } from "../ui/Empty";
import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { auditLog } from "@/lib/endpoints";
import { auditDate } from "@/lib/format";
import type { AuditEntry } from "@/lib/types";

function actionOf(a: AuditEntry): string {
  return a.action ?? a.kind ?? "update";
}

function whoOf(a: AuditEntry): string {
  return a.actor ?? a.who ?? "?";
}

function atOf(a: AuditEntry): string {
  return a.at ?? a.ts ?? a.timestamp ?? "";
}

export function AuditTab({ caseId: cid }: { caseId: string | number }) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = () => {
    setLoading(true);
    setError("");
    auditLog()
      .then((d) => {
        // Backend scopes investigators to their own actions already.
        const re = new RegExp(`\\/cases\\/${cid}([\\/\\?]|$)`);
        setRows((d.results ?? []).filter((a) => re.test(a.object_type ?? a.target_type ?? "")));
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
            <li key={a.id ?? i} className="grid grid-cols-[180px_1fr_auto] items-center gap-3 px-[14px] py-[10px] max-[700px]:grid-cols-[1fr_auto]">
              <span className="flex min-w-0 items-center gap-2">
                <Avatar name={whoOf(a)} />
                <span className="truncate text-[12.5px] text-fg-2">{whoOf(a)}</span>
              </span>
              <span className="truncate font-mono text-[11.5px] text-fg-3">{actionOf(a)}</span>
              <span className="font-mono text-[10.5px] text-fg-4">{auditDate(atOf(a))}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
