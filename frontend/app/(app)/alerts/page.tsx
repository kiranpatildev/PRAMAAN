"use client";

import { useEffect, useState } from "react";
import { BellOff } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { Table, TableSkeleton } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { Empty } from "@/components/ui/Empty";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";
import { alertsFeed, dismissAlert, alertRules, createAlertRule, patchAlertRule, deleteAlertRule, type AlertRule } from "@/lib/endpoints";
import { timeAgo } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { Panel } from "@/components/ui/Panel";
import type { AlertItem } from "@/lib/types";

const RULE_KINDS = ["any", "connection", "risk", "cross_case", "anomaly", "system"];
const SEVERITIES = ["low", "medium", "high"];

export default function AlertsPage() {
  const toast = useToast();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [kind, setKind] = useState("any");
  const [sev, setSev] = useState("low");

  const refresh = () => {
    setLoading(true);
    setError("");
    Promise.all([alertsFeed().then(setAlerts), alertRules().then(setRules).catch(() => setRules([]))])
      .catch((e) => setError(e instanceof Error ? e.message : "Alerts failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  async function dismiss(id: number) {
    await dismissAlert(id);
    setAlerts((a) => a.filter((x) => x.id !== id));
    toast({ kind: "ok", title: "Alert dismissed" });
  }

  async function addRule() {
    try {
      const r = await createAlertRule({ kind, min_severity: sev });
      setRules((rs) => [...rs, r]);
      toast({ kind: "ok", title: "Rule added", body: `${r.kind} · ${r.min_severity}+` });
    } catch (err) {
      toast({ kind: "warn", title: "Rule failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function toggleRule(r: AlertRule) {
    try {
      const upd = await patchAlertRule(r.id, { enabled: !r.enabled });
      setRules((rs) => rs.map((x) => (x.id === r.id ? upd : x)));
    } catch (err) {
      toast({ kind: "warn", title: "Update failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function removeRule(r: AlertRule) {
    try {
      await deleteAlertRule(r.id);
      setRules((rs) => rs.filter((x) => x.id !== r.id));
    } catch (err) {
      toast({ kind: "warn", title: "Delete failed", body: err instanceof Error ? err.message : undefined });
    }
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

      <div className="mt-[18px]">
        <Panel title={`Delivery rules${rules.length ? ` · ${rules.length}` : ""}`}>
          <div className="mb-[12px] flex flex-wrap items-center gap-[8px]">
            <label className="font-mono text-[11px] text-fg-3">
              Kind{" "}
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded border border-line-2 bg-panel-2 px-2 py-1 font-mono text-[11px] text-fg">
                {RULE_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="font-mono text-[11px] text-fg-3">
              Min severity{" "}
              <select value={sev} onChange={(e) => setSev(e.target.value)} className="rounded border border-line-2 bg-panel-2 px-2 py-1 font-mono text-[11px] text-fg">
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <Button variant="primary" small onClick={addRule}>
              Add rule
            </Button>
          </div>
          {rules.length === 0 ? (
            <p className="text-[12.5px] text-fg-3">No personal rules — every signal reaches your feed. Add one to filter by kind and severity.</p>
          ) : (
            <ul className="divide-y divide-line">
              {rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-[9px]">
                  <span className="font-mono text-[11.5px] text-fg-2">
                    {r.kind} · {r.min_severity}+{r.case_fir ? ` · ${r.case_fir}` : " · all cases"}
                    {!r.enabled && <span className="ml-2 text-fg-4">(off)</span>}
                  </span>
                  <span className="flex gap-2">
                    <Button variant="ghost" small onClick={() => toggleRule(r)}>
                      {r.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button variant="danger" small onClick={() => removeRule(r)}>
                      Delete
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
