"use client";

import { useEffect, useState } from "react";
import { BellOff } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { Table, TableSkeleton } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { Empty } from "@/components/ui/Empty";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";
import { alertsFeed, dismissAlert } from "@/lib/endpoints";
import { timeAgo } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import type { AlertItem } from "@/lib/types";

export default function AlertsPage() {
  const toast = useToast();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = () => {
    setLoading(true);
    setError("");
    alertsFeed()
      .then(setAlerts)
      .catch((e) => setError(e instanceof Error ? e.message : "Alerts failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  async function dismiss(id: number) {
    await dismissAlert(id);
    setAlerts((a) => a.filter((x) => x.id !== id));
    toast({ kind: "ok", title: "Alert dismissed" });
  }

  return (
    <div>
      <PageHeader eyebrow="Signals" title="Alerts" sub="Risk changes and high-confidence links across your visible cases." />

      {error && (
        <div className="mb-[14px]">
          <Notice variant="warn" action={<Button variant="ghost" small onClick={refresh}>Retry</Button>}>
            {error}
          </Notice>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={6} />
      ) : (
        <Table<AlertItem>
          columns={[
            {
              key: "level",
              head: "Level",
              width: "110px",
              render: (a) => (
                <Tag tone={a.severity === "high" ? "red" : a.severity === "medium" ? "amber" : "muted"}>
                  {a.severity}
                </Tag>
              ),
            },
            {
              key: "title",
              head: "Title",
              width: "28%",
              render: (a) => <b className="text-[12.5px] font-medium text-fg">{a.title ?? a.kind.replace(/_/g, " ")}</b>,
            },
            {
              key: "detail",
              head: "Detail",
              render: (a) => <span className="line-clamp-2 text-fg-3">{a.message}</span>,
            },
            {
              key: "age",
              head: "Age",
              numeric: true,
              render: (a) => <span>{timeAgo(a.created_at)}</span>,
            },
          ]}
          rows={alerts}
          actionFor={(a) => (
            <Button variant="ghost" small onClick={() => dismiss(a.id)}>
              Dismiss
            </Button>
          )}
          empty={
            <div className="p-[14px]">
              <Empty icon={BellOff} title="No alerts" body="New signals will appear here." />
            </div>
          }
        />
      )}
    </div>
  );
}
