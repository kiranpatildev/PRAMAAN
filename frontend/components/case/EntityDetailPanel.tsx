"use client";

import { useState } from "react";
import { ScanSearch } from "lucide-react";
import { Tag } from "../ui/Tag";
import { Button } from "../ui/Button";
import { Empty } from "../ui/Empty";
import { EntityChip, entityKind } from "@/lib/case";
import { longDate } from "@/lib/format";
import { languageName } from "@/lib/language";
import type { ReviewRelation, TimelineEvent } from "@/lib/types";

export interface EntityRow {
  id: number | string;
  node_type: string;
  value: string;
  normalized?: string;
  confidence: number;
  engine?: string;
  status: string;
  mention_count?: number;
  evidence?: number | null;
  evidence_file?: string;
  native_snippet?: string;
  detected_language?: string;
  case_id?: number;
  case_fir?: string;
  updated_at?: string;
}

export interface RelCardData {
  id: number | string;
  otherId: number | string;
  other: string;
  otherType?: string;
  edge: string;
  confidence: number;
  snippet?: string;
}

function confColor(v: number): string {
  if (v >= 0.9) return "#4ade80";
  if (v >= 0.7) return "#00d9ff";
  return "#fbbf24";
}

function stateTone(s: string): "green" | "amber" | "red" | "muted" {
  const t = s.toLowerCase();
  if (t === "confirmed") return "green";
  if (t === "rejected") return "red";
  return "amber";
}

function RelCard({ rel, onSelect }: { rel: RelCardData; onSelect?: (id: number | string) => void }) {
  const body = (
    <>
      <EntityChip type={rel.otherType} size={22} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-fg-2">{rel.edge.toLowerCase()}</span>
        <span className="block truncate font-mono text-[10.5px] text-fg-4">
          {rel.snippet ? rel.snippet.slice(0, 90) : "—"}
        </span>
      </span>
      <span className="rounded-[3px] border border-line-2 px-[5px] py-px font-mono text-[10px] text-fg-3">
        {Math.round(rel.confidence * 100)}%
      </span>
    </>
  );
  return onSelect ? (
    <button
      type="button"
      onClick={() => onSelect(rel.otherId)}
      className="flex w-full items-center gap-[10px] rounded border border-line bg-panel px-[10px] py-[8px] text-left transition-colors duration-120 hover:border-line-2"
    >
      {body}
    </button>
  ) : (
    <span className="flex items-center gap-[10px] rounded border border-line bg-panel px-[10px] py-[8px]">{body}</span>
  );
}

export function EntityDetailPanel({ entity, relations, events, evidenceNote, canVerify, showActions = true, onConfirm, onReject, onSelect }: {
  entity: EntityRow | null;
  relations: RelCardData[];
  events: TimelineEvent[];
  evidenceNote?: string;
  canVerify: boolean;
  showActions?: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onSelect: (id: number | string) => void;
}) {
  const [sub, setSub] = useState<"overview" | "relationships" | "events" | "evidence">("overview");

  if (!entity) {
    return (
      <div className="p-[14px]">
        <Empty icon={ScanSearch} title="No entity selected" body="Click a row to inspect it here." />
      </div>
    );
  }

  const degree = relations.length;
  const top = [...relations].sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  const pending = entity.status.toLowerCase() === "pending";

  return (
    <div className="p-[14px]">
      <p className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-cyan">E-{entity.id}</span>
        <span className="flex items-center gap-[6px]">
          {entity.detected_language ? (
            <Tag tone="cyan">Detected: {languageName(entity.detected_language)}</Tag>
          ) : null}
          <Tag tone={stateTone(entity.status)}>{entity.status}</Tag>
        </span>
      </p>
      <h2 className="mt-[6px] text-[16px] font-medium tracking-[-0.015em] text-fg">{entity.value}</h2>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-[10px]">
        {[
          ["Entity type", ENTITY_META_LABEL(entity.node_type)],
          ["Identifier", `#${entity.id}`],
          ["Case", entity.case_fir ?? (entity.case_id != null ? `#${entity.case_id}` : "—")],
          ["Connected entities", String(degree)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="micro-label">{k}</dt>
            <dd className="mt-[3px] font-mono text-[11px] text-fg-2">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4">
        <p className="flex items-center justify-between">
          <span className="micro-label">Confidence</span>
          <span className="font-mono text-[11px] text-fg-2">{Math.round(entity.confidence * 100)}%</span>
        </p>
        <span className="mt-[6px] block h-1 w-full overflow-hidden rounded-[2px] bg-line">
          <span className="block h-full rounded-[2px]" style={{ width: `${Math.round(entity.confidence * 100)}%`, background: confColor(entity.confidence) }} />
        </span>
      </div>

      <div className="mt-4 flex border-b border-line" role="tablist" aria-label="Entity detail">
        {(["overview", "relationships", "events", "evidence"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={sub === t}
            onClick={() => setSub(t)}
            className={`relative px-2 py-[7px] text-[12px] capitalize transition-colors duration-120 ${sub === t ? "text-fg" : "text-fg-3 hover:text-fg"}`}
          >
            {t}
            {sub === t && <span className="absolute inset-x-0 bottom-[-1px] h-[1.5px] bg-cyan" aria-hidden />}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {sub === "overview" && (
          <div>
            <p className="micro-label mb-[6px]">Observed summary</p>
            <p className="text-[12.5px] leading-[1.6] text-fg-2">
              {entity.value} was extracted as {ENTITY_META_LABEL(entity.node_type).toLowerCase()} with{" "}
              {Math.round(entity.confidence * 100)}% confidence
              {entity.evidence_file ? (
                <> from {entity.evidence_file}</>
              ) : (
                " from case evidence"
              )}
              {entity.mention_count ? <> · mentioned {entity.mention_count}×</> : null}
              {entity.updated_at ? <> · last observed {longDate(entity.updated_at)}</> : null}.
            </p>
            {entity.native_snippet ? (
              <>
                <p className="micro-label mb-[6px] mt-4">Source excerpt (native script)</p>
                <p className="rounded border border-line bg-panel px-[10px] py-[8px] text-[12.5px] leading-[1.6] text-fg-2">
                  {entity.native_snippet}
                </p>
              </>
            ) : null}
            <p className="micro-label mb-[6px] mt-4">Strongest observed relationships</p>
            {top.length === 0 ? (
              <p className="text-[12.5px] text-fg-3">No confirmed links yet.</p>
            ) : (
              <div className="space-y-2">
                {top.map((r) => (
                  <RelCard key={r.id} rel={r} onSelect={onSelect} />
                ))}
              </div>
            )}
          </div>
        )}
        {sub === "relationships" && (
          <div className="space-y-2">
            {relations.length === 0 && <p className="text-[12.5px] text-fg-3">No relationships in this view.</p>}
            {relations.map((r) => (
              <RelCard key={r.id} rel={r} onSelect={onSelect} />
            ))}
          </div>
        )}
        {sub === "events" && (
          <div className="space-y-2">
            {events.length === 0 && <p className="text-[12.5px] text-fg-3">No dated events mention this entity.</p>}
            {events.map((e, i) => (
              <div key={i} className="rounded border border-line bg-panel px-[10px] py-[8px] text-[12.5px] text-fg-2">
                <span className="font-mono text-[10.5px] text-fg-4">{e.date ?? e.valid_from ?? ""}</span>
                <span className="mt-[2px] block">{e.title ?? `${e.from ?? ""} — ${e.to ?? ""}`}</span>
              </div>
            ))}
          </div>
        )}
        {sub === "evidence" && (
          <div className="space-y-2 text-[12.5px] text-fg-2">
            <p>
              <span className="micro-label mb-[4px] block">Source file</span>
              {entity.evidence_file ?? "—"}
            </p>
            <p>
              <span className="micro-label mb-[4px] block">Extractor</span>
              <span className="font-mono text-[11px]">{entity.engine ?? "—"}</span>
            </p>
            {evidenceNote && <p className="text-fg-3">{evidenceNote}</p>}
          </div>
        )}
      </div>

      {canVerify && showActions && pending && (
        <div className="mt-4 flex gap-2 border-t border-line pt-[14px]">
          <Button variant="success" className="flex-1" onClick={onConfirm}>
            Confirm
          </Button>
          <Button variant="danger" className="flex-1" onClick={onReject}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}

function ENTITY_META_LABEL(t?: string | null): string {
  const s = (t ?? "").toLowerCase();
  if (s.includes("phone")) return "Phone";
  if (s.includes("vehic")) return "Vehicle";
  if (s.includes("locat") || s.includes("address")) return "Location";
  if (s.includes("org")) return "Organization";
  if (s.includes("trans") || s.includes("bank")) return "Transaction";
  if (s.includes("case") || s.includes("event")) return "Case";
  return "Person";
}
