"use client";

import { useEffect, useState } from "react";
import { Panel } from "../ui/Panel";
import { Table, TableSkeleton } from "../ui/Table";
import { Tag } from "../ui/Tag";
import { Avatar } from "../ui/Avatar";
import { Notice } from "../ui/Notice";
import { listUsers, assignCase, unassignCase } from "@/lib/endpoints";
import { displayName } from "@/lib/auth";
import { useToast } from "../ui/Toast";
import type { User } from "@/lib/types";

export function TeamTab({ caseId: cid, assigned, onChanged }: {
  caseId: string | number;
  assigned: Map<number, string>;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listUsers()
      .then((u) => setUsers(u.filter((x) => x.role === "investigator")))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggle(u: User, on: boolean) {
    try {
      if (on) await unassignCase(cid, u.id);
      else await assignCase(cid, u.id, "edit");
      onChanged();
      toast({ kind: "ok", title: on ? "Unassigned" : "Assigned", body: displayName(u) });
    } catch (err) {
      toast({ kind: "warn", title: "Assignment failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <Panel title="Assign investigators" flush>
      {loading ? (
        <TableSkeleton rows={5} />
      ) : (
        <Table<User>
          columns={[
            {
              key: "who",
              head: "Investigator",
              width: "40%",
              render: (u) => (
                <span className="flex items-center gap-[10px]">
                  <Avatar name={displayName(u)} lg />
                  <span>
                    <b className="block text-[12.5px] font-medium text-fg">{displayName(u)}</b>
                    <span className="font-mono text-[10.5px] text-fg-4">#{u.id}</span>
                  </span>
                </span>
              ),
            },
            {
              key: "assign",
              head: "Assign",
              render: (u) => (
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-fg-2">
                  <input
                    type="checkbox"
                    checked={assigned.has(u.id)}
                    onChange={() => toggle(u, assigned.has(u.id))}
                    className="h-[14px] w-[14px] accent-[#00d9ff]"
                  />
                  Assign
                </label>
              ),
            },
            {
              key: "access",
              head: "Access",
              numeric: true,
              render: (u) => (
                <Tag tone={assigned.has(u.id) ? "cyan" : "muted"}>
                  {assigned.get(u.id) ?? "none"}
                </Tag>
              ),
            },
          ]}
          rows={users}
        />
      )}
      <div className="p-[14px] pt-0">
        <Notice variant="lock">Assignment changes are written to the audit log with actor and timestamp.</Notice>
      </div>
    </Panel>
  );
}
