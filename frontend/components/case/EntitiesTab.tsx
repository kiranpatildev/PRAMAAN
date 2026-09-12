"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel } from "../ui/Panel";
import { Table, TableSkeleton } from "../ui/Table";
import { SearchInput } from "../ui/Input";
import { Segmented } from "../ui/Segmented";
import { Tag } from "../ui/Tag";
import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { EntityChip, entityKind } from "@/lib/case";
import { longDate } from "@/lib/format";
import { useToast } from "../ui/Toast";
import {
  reviewEntities, reviewRelations, reviewMerges,
  confirmEntity, rejectEntity, decideMerge, caseTimeline,
} from "@/lib/endpoints";
import { EntityDetailPanel, type EntityRow, type RelCardData } from "./EntityDetailPanel";
import type { MergeSuggestion, TimelineEvent } from "@/lib/types";

const TYPE_FILTERS = ["all", "person", "phone", "vehicle", "location", "organization", "transaction"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

function confColor(v: number): string {
  if (v >= 0.9) return "#4ade80";
  if (v >= 0.7) return "#00d9ff";
  return "#fbbf24";
}

export function EntitiesTab({ caseId: cid, sho, canVerify }: {
  caseId: string | number;
  sho: boolean;
  canVerify: boolean;
}) {
  const toast = useToast();
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [relations, setRelations] = useState<RelCardData[]>([]);
  const [rawRels, setRawRels] = useState<{ id: number; src: number; dst: number }[]>([]);
  const [merges, setMerges] = useState<MergeSuggestion[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [selected, setSelected] = useState<number | null>(null);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      reviewEntities(cid, "", 500),
      reviewRelations(cid, "", 500),
      reviewMerges(cid, "pending", 200),
      caseTimeline(cid).catch(() => ({ events: [] })),
    ])
      .then(([ents, rels, mgs, tl]) => {
        const rows = ((ents as { results?: unknown }).results ?? ents) as unknown as EntityRow[];
        setEntities(rows);
        setRawRels(rels.map((r) => ({ id: r.id, src: Number(r.src), dst: Number(r.dst) })));
        const byId = new Map(rows.map((e) => [Number(e.id), e]));
        setRelations(
          rels.map((r) => {
            const sid = Number(r.src);
            const did = Number(r.dst);
            const other = byId.get(did) ?? byId.get(sid);
            const otherId = byId.get(did) ? did : sid;
            return {
              id: r.id,
              srcId: sid,
              dstId: did,
              otherId,
              other: other?.value ?? (otherId === sid ? r.src_value : r.dst_value),
              otherType: other?.node_type,
              edge: r.edge_type,
              confidence: r.confidence,
              snippet: r.snippet,
            } as RelCardData & { srcId: number; dstId: number };
          })
        );
        setMerges(mgs);
        setEvents(((tl.events ?? []) as TimelineEvent[]));
        if (selected != null && !rows.some((e) => Number(e.id) === selected)) setSelected(null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [cid]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entities.filter((e) => {
      if (type !== "all" && entityKind(e.node_type) !== type) return false;
      if (needle && !`${e.value} ${e.normalized ?? ""} ${e.id}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [entities, q, type]);

  const degree = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rawRels) {
      m.set(r.src, (m.get(r.src) ?? 0) + 1);
      m.set(r.dst, (m.get(r.dst) ?? 0) + 1);
    }
    return m;
  }, [rawRels]);

  const pendingCount = entities.filter((e) => e.status.toLowerCase() === "pending").length;
  const sel = entities.find((e) => Number(e.id) === selected) ?? null;
  const selRels = sel
    ? relations.filter((r) => {
        const x = r as RelCardData & { srcId: number; dstId: number };
        return x.srcId === Number(sel.id) || x.dstId === Number(sel.id);
      })
    : [];
  const selEvents = sel
    ? events.filter((e) => `${e.title ?? ""} ${e.from ?? ""} ${e.to ?? ""}`.toLowerCase().includes(sel.value.toLowerCase()))
    : [];

  async function decide(e: EntityRow, ok: boolean) {
    try {
      if (ok) await confirmEntity(cid, e.id);
      else await rejectEntity(cid, e.id);
      toast({ kind: "ok", title: ok ? "Confirmed" : "Rejected", body: e.value });
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Decision failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function decideM(id: number, ok: boolean) {
    try {
      await decideMerge(id, ok ? "approve" : "reject");
      toast({ kind: "ok", title: ok ? "Merge approved" : "Merge dismissed" });
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Merge decision failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <div className="space-y-[18px]">
      {canVerify && !sho ? (
        <Notice variant="info">
          {pendingCount} entit{pendingCount === 1 ? "y" : "ies"} awaiting your confirm or reject. Confirmed rows build the network graph.
        </Notice>
      ) : (
        <Notice variant="lock">
          Confirm and reject are investigator-only. {sho ? "SHO sees every row read-only; merge approvals remain below." : "Ask the SHO for a team assignment to verify."}
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-[10px]">
        <span className="w-full max-w-[340px]">
          <SearchInput placeholder="Search entities…" value={q} onChange={(e) => setQ(e.target.value)} />
        </span>
        <Segmented<TypeFilter>
          options={TYPE_FILTERS.map((t) => ({ value: t, label: t === "all" ? "All" : t[0].toUpperCase() + t.slice(1) }))}
          value={type}
          onChange={setType}
        />
      </div>

      <div className="grid min-h-[600px] grid-cols-[minmax(0,1fr)_340px] overflow-hidden rounded-md border border-line bg-panel max-[1100px]:grid-cols-1">
        <div className="max-h-[720px] min-w-0 overflow-auto">
          {loading ? (
            <TableSkeleton rows={8} />
          ) : (
            <Table<EntityRow & { id: number }>
              columns={[
                {
                  key: "entity",
                  head: "Entity",
                  width: "36%",
                  render: (e) => (
                    <span className="flex items-center gap-[10px]">
                      <EntityChip type={e.node_type} size={28} />
                      <span className="min-w-0">
                        <b className="block truncate text-[12.5px] font-medium text-fg">{e.value}</b>
                        <span className="block truncate font-mono text-[10.5px] text-fg-4">{e.normalized ?? `#${e.id}`}</span>
                      </span>
                    </span>
                  ),
                },
                { key: "type", head: "Type", render: (e) => <span className="font-mono text-[11.5px]">{e.node_type}</span> },
                { key: "conn", head: "Connections", numeric: true, render: (e) => <span>{degree.get(Number(e.id)) ?? 0}</span> },
                { key: "cases", head: "Cases", numeric: true, render: () => <span>1</span> },
                {
                  key: "conf",
                  head: "Confidence",
                  render: (e) => (
                    <span className="flex max-w-[80px] items-center gap-2">
                      <span className="h-[3px] flex-1 overflow-hidden rounded-[2px] bg-line">
                        <span className="block h-full rounded-[2px]" style={{ width: `${Math.round(e.confidence * 100)}%`, background: confColor(e.confidence) }} />
                      </span>
                      <span className="font-mono text-[11px] text-fg-3">{Math.round(e.confidence * 100)}%</span>
                    </span>
                  ),
                },
                { key: "obs", head: "Last observed", numeric: true, render: (e) => <span>{e.updated_at ? longDate(e.updated_at) : "—"}</span> },
              ]}
              rows={filtered.map((e) => ({ ...e, id: Number(e.id) }))}
              onRowClick={(e) => setSelected(Number(e.id))}
              selectedId={selected}
            />
          )}
        </div>
        <aside className="sticky top-0 max-h-[720px] overflow-y-auto border-l border-line bg-panel-2 max-[1100px]:border-l-0 max-[1100px]:border-t">
          <EntityDetailPanel
            entity={sel}
            relations={selRels}
            events={selEvents}
            canVerify={canVerify && !sho}
            onConfirm={() => sel && decide(sel, true)}
            onReject={() => sel && decide(sel, false)}
            onSelect={(id) => {
              const n = Number(id);
              if (entities.some((e) => Number(e.id) === n)) setSelected(n);
            }}
          />
        </aside>
      </div>

      <Panel title={`Merge suggestions${merges.length ? ` · ${merges.length}` : ""}`}>
        {merges.length === 0 ? (
          <p className="text-[12.5px] text-fg-3">No duplicates suspected right now — resolution runs after every upload.</p>
        ) : (
          <ul className="divide-y divide-line">
            {merges.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-[10px]">
                <span className="text-[12.5px] text-fg-2">
                  <b className="font-medium text-fg">{m.a_value}</b> ≈ <b className="font-medium text-fg">{m.b_value}</b>{" "}
                  <span className="font-mono text-[11px] text-fg-4">
                    {m.node_type} · {Math.round(m.score * 100)}% · {m.reason}
                  </span>
                </span>
                <span className="flex gap-2">
                  {sho && (
                    <Button variant="success" small onClick={() => decideM(m.id, true)}>
                      Approve
                    </Button>
                  )}
                  <Button variant="danger" small onClick={() => decideM(m.id, false)}>
                    Reject
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {!sho && merges.length > 0 && (
          <p className="mt-2 font-mono text-[10.5px] text-fg-4">Approving merges needs the SHO role.</p>
        )}
      </Panel>
    </div>
  );
}
