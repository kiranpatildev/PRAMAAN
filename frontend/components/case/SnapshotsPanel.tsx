"use client";

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { Panel } from "../ui/Panel";
import { Table, TableSkeleton } from "../ui/Table";
import { Empty } from "../ui/Empty";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import {
  listSnapshots, createSnapshot, snapshotDiff, deleteSnapshot,
  type SnapshotSummary,
} from "@/lib/endpoints";
import { longDate } from "@/lib/format";
import { useToast } from "../ui/Toast";

interface DiffResult {
  a: { id: number; label: string };
  b: { id: number; label: string };
  nodes: { added: { id: string; label?: string }[]; removed: { id: string; label?: string }[] };
  edges: { added: { id: string; label?: string }[]; removed: { id: string; label?: string }[] };
}

export function SnapshotsPanel({ caseId: cid, canEdit }: {
  caseId: string | number;
  canEdit: boolean;
}) {
  const toast = useToast();
  const [snaps, setSnaps] = useState<SnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [selA, setSelA] = useState<number | null>(null);
  const [selB, setSelB] = useState<number | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);

  const refresh = () => {
    setLoading(true);
    listSnapshots(cid)
      .then(setSnaps)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [cid]);

  async function save() {
    if (!label.trim()) return;
    try {
      await createSnapshot(cid, label.trim());
      toast({ kind: "ok", title: "Snapshot saved", body: label.trim() });
      setLabel("");
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Save failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function compare() {
    if (selA == null || selB == null || selA === selB) return;
    try {
      setDiff(await snapshotDiff(cid, selA, selB));
    } catch (err) {
      toast({ kind: "warn", title: "Diff failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function remove(id: number) {
    try {
      await deleteSnapshot(cid, id);
      toast({ kind: "ok", title: "Snapshot deleted" });
      if (selA === id) setSelA(null);
      if (selB === id) setSelB(null);
      setDiff(null);
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Delete failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <Panel title={`Snapshots${snaps.length ? ` · ${snaps.length}` : ""}`}>
      {canEdit && (
        <div className="mb-[12px] flex gap-[8px]">
          <Input
            className="!h-[32px] flex-1"
            placeholder="Snapshot label, e.g. pre-merge baseline"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button variant="primary" small disabled={!label.trim()} onClick={save}>
            Save view
          </Button>
        </div>
      )}
      {loading ? (
        <TableSkeleton rows={3} />
      ) : (
        <Table<SnapshotSummary>
          columns={[
            {
              key: "pick",
              head: "A/B",
              width: "90px",
              render: (s) => (
                <span className="flex gap-[6px] font-mono text-[11px]">
                  <label className="flex items-center gap-1 text-fg-3">
                    <input type="radio" name="snap-a" checked={selA === s.id} onChange={() => setSelA(s.id)} /> A
                  </label>
                  <label className="flex items-center gap-1 text-fg-3">
                    <input type="radio" name="snap-b" checked={selB === s.id} onChange={() => setSelB(s.id)} /> B
                  </label>
                </span>
              ),
            },
            { key: "label", head: "Label", width: "30%", render: (s) => <b className="text-[12.5px] font-medium text-fg">{s.label}</b> },
            { key: "nodes", head: "Nodes", numeric: true, render: (s) => <span>{s.node_count}</span> },
            { key: "edges", head: "Edges", numeric: true, render: (s) => <span>{s.edge_count}</span> },
            { key: "at", head: "Saved", numeric: true, render: (s) => <span>{longDate(s.created_at)}</span> },
          ]}
          rows={snaps}
          actionFor={(s) => (
            <span className="flex justify-end gap-[6px]">
              {canEdit && (
                <Button variant="danger" small onClick={() => remove(s.id)}>
                  Delete
                </Button>
              )}
            </span>
          )}
          empty={
            <div className="p-[14px]">
              <Empty icon={Camera} title="No snapshots" body="Freeze the live graph before merges to compare later." />
            </div>
          }
        />
      )}
      {snaps.length >= 2 && (
        <div className="mt-[12px]">
          <Button variant="ghost" small disabled={selA == null || selB == null || selA === selB} onClick={compare}>
            Compare A → B
          </Button>
        </div>
      )}
      {diff && (
        <dl className="mt-[12px] grid grid-cols-2 gap-x-3 gap-y-[8px] text-[12.5px]">
          {[
            ["Nodes added", diff.nodes.added.length],
            ["Nodes removed", diff.nodes.removed.length],
            ["Edges added", diff.edges.added.length],
            ["Edges removed", diff.edges.removed.length],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded border border-line bg-panel-2 px-[10px] py-[8px]">
              <dt className="micro-label">{k}</dt>
              <dd className="mt-[2px] font-mono text-[13px] text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}
