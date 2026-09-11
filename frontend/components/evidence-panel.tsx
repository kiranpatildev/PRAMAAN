"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { entityColor } from "@/lib/theme";

export type EvidenceRef = {
  edgeId: string;
  label: string;
  confidence: number;
  sourceEvidenceId: string;
  snippet: string;
  extractedOn?: string;
  extractedBy?: string;
  validFrom?: string | null;
  nodeKey?: string;
  isEdge?: boolean;
  // Inspector enrichment (computed by the page from data it already holds).
  nodeType?: string;
  degree?: number;
  community?: string | null;
  relations?: { id: string; label: string; other: string; otherId: string; confidence: number }[];
};

type SourceFile = {
  file_name: string;
  classification: string;
  mime_type: string;
  sha256: string;
  created_at: string;
  uploaded_by: string | null;
};

type TimelineEvent = { from: string; to: string; label: string; valid_from: string };

type Tab = "overview" | "relations" | "events" | "evidence";

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <span className="inline-flex min-w-28 items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-700">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
      <b className="text-xs text-slate-200">{pct.toFixed(0)}%</b>
    </span>
  );
}

/** Entity inspector: tabbed Overview / Relationships / Events / Evidence.
 *  Every AI claim keeps its confidence bar and evidence trail inline. */
export function EvidencePanel({
  ref_,
  caseId,
  onClose,
  onExpand,
  onSelectNode,
}: {
  ref_: EvidenceRef | null;
  caseId: string;
  onClose: () => void;
  onExpand: (nodeKey: string, depth: number) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const [file, setFile] = useState<SourceFile | null>(null);
  const [depth, setDepth] = useState(1);
  const [tab, setTab] = useState<Tab>("overview");
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  useEffect(() => {
    setFile(null);
    setTab("overview");
    const id = ref_?.sourceEvidenceId;
    if (!id || !/^\d+$/.test(id)) return;
    api.evidenceDetail(caseId, id).then(setFile).catch(() => {});
  }, [ref_, caseId]);

  useEffect(() => {
    if (!ref_ || ref_.isEdge) {
      setEvents([]);
      return;
    }
    api.caseTimeline(caseId)
      .then((d) => {
        const all: TimelineEvent[] = d.events ?? [];
        setEvents(all.filter((e) => e.from === ref_.label || e.to === ref_.label));
      })
      .catch(() => setEvents([]));
  }, [ref_, caseId]);

  if (!ref_) {
    return (
      <div className="card text-sm">
        <b className="text-slate-200">Inspector</b>
        <ul className="mt-2 space-y-1.5 text-slate-400">
          <li>· Click a <b className="text-slate-200">node</b> to inspect an entity — type, confidence, connections, events, evidence.</li>
          <li>· Click an <b className="text-slate-200">edge</b> to see <i>why, when, how strongly, on what evidence</i>.</li>
          <li>· Hover any node for its label; zoom in to reveal all labels.</li>
        </ul>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = ref_.isEdge
    ? [
        { id: "overview", label: "Overview" },
        { id: "evidence", label: "Evidence" },
      ]
    : [
        { id: "overview", label: "Overview" },
        { id: "relations", label: `Relationships (${ref_.relations?.length ?? 0})` },
        { id: "events", label: `Events (${events.length})` },
        { id: "evidence", label: "Evidence" },
      ];

  return (
    <div className="card text-sm">
      <div className="flex items-start justify-between gap-2">
        <b className="flex min-w-0 items-center gap-2 truncate" title={ref_.label}>
          {!ref_.isEdge && ref_.nodeType && (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entityColor(ref_.nodeType) }} />
          )}
          <span className="truncate">{ref_.isEdge ? "Why this link?" : ref_.label}</span>
        </b>
        <span className="flex shrink-0 items-center gap-1.5">
          {/* The explorer only ever renders confirmed rows — the build task
              writes CONFIRMED review-queue rows into Neo4j and nothing else. */}
          <span className="rounded-full border border-[#10B981]/40 bg-[#10B981]/10 px-2 py-0.5 font-mono text-[10px] font-bold text-[#10B981]">
            {ref_.isEdge ? "CONFIRMED LINK" : "CONFIRMED"}
          </span>
          <button className="shrink-0 text-slate-400 hover:text-white" onClick={onClose}>✕</button>
        </span>
      </div>
      {!ref_.isEdge && ref_.nodeType && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-[#1F2733] bg-[#0B0F17] p-2.5 font-mono text-[11px]">
          <div><dt className="text-[#8B93A1]">ENTITY TYPE</dt><dd className="font-bold" style={{ color: entityColor(ref_.nodeType) }}>{ref_.nodeType.toUpperCase()}</dd></div>
          <div><dt className="text-[#8B93A1]">IDENTIFIER</dt><dd className="truncate" title={ref_.label}>{ref_.label}</dd></div>
          <div><dt className="text-[#8B93A1]">CONNECTED</dt><dd>{typeof ref_.degree === "number" ? `${ref_.degree} entities` : "—"}</dd></div>
          <div><dt className="text-[#8B93A1]">CLUSTER</dt><dd className="truncate">{ref_.community ?? "—"}</dd></div>
        </dl>
      )}

      <div className="mt-2 flex gap-1 border-b border-ink-700">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-2 py-1 text-xs ${
              tab === t.id ? "border-accent text-accent" : "border-transparent text-slate-500 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-2">
        {tab === "overview" && (
          <dl className="space-y-1.5 text-slate-300">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500">Confidence</dt>
              <dd><ConfidenceBar value={ref_.confidence} /></dd>
            </div>
            {ref_.validFrom && <div className="flex justify-between gap-2"><dt className="text-slate-500">Valid from</dt><dd>{ref_.validFrom}</dd></div>}
            {ref_.extractedOn && <div className="flex justify-between gap-2"><dt className="text-slate-500">Extracted</dt><dd className="text-right">{new Date(ref_.extractedOn).toLocaleString()}{ref_.extractedBy ? ` · ${ref_.extractedBy}` : ""}</dd></div>}
            <div><dt className="text-slate-500">Summary</dt><dd className="italic text-slate-400">“{ref_.snippet}”</dd></div>
            {!ref_.isEdge && (
              <div className="rounded-md border border-[#1F2733] bg-[#0B0F17] p-2.5">
                <dt className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]">Observed summary</dt>
                <dd className="mt-1 text-[13px] not-italic leading-relaxed text-slate-300">
                  {ref_.label} appears in authorized case files with {ref_.degree ?? 0} observed relationship
                  {(ref_.degree ?? 0) === 1 ? "" : "s"}
                  {ref_.community ? `, clustered in ${ref_.community}` : ""}. All associations below are
                  derived from lawfully obtained case records and require investigator review.
                </dd>
              </div>
            )}
          </dl>
        )}

        {tab === "overview" && !ref_.isEdge && (ref_.relations ?? []).length > 0 && (
          <div className="mt-2">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]">
              Strongest observed relationships
            </p>
            <ul className="mt-1 divide-y divide-ink-700">
              {[...(ref_.relations ?? [])].sort((a, b) => b.confidence - a.confidence).slice(0, 3).map((r) => (
                <li key={r.id}>
                  <button onClick={() => onSelectNode(r.otherId)} className="flex w-full items-center justify-between py-1.5 text-left text-[13px] hover:text-white">
                    <span><b>{r.other}</b> <span className="font-mono text-[11px] text-accent">—[{r.label}]</span></span>
                    <span className="font-mono text-[11px] text-slate-400">{(r.confidence * 100).toFixed(0)}%</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === "relations" && !ref_.isEdge && (
          <ul className="divide-y divide-ink-700">
            {(ref_.relations ?? []).map((r) => (
              <li key={r.id}>
                <button onClick={() => onSelectNode(r.otherId)} className="flex w-full items-center justify-between py-1.5 text-left hover:text-white">
                  <span><b>{r.other}</b> <span className="text-xs text-accent">—[{r.label}]</span></span>
                  <span className="text-xs text-slate-500">{(r.confidence * 100).toFixed(0)}%</span>
                </button>
              </li>
            ))}
            {(ref_.relations ?? []).length === 0 && (
              <li className="py-1 text-slate-500">No connections in the current view.</li>
            )}
          </ul>
        )}

        {tab === "events" && !ref_.isEdge && (
          <ul className="space-y-2">
            {events.map((e, i) => (
              <li key={i} className="text-xs">
                <span className="text-accent">{e.valid_from}</span>{" "}
                <b className="text-slate-200">{e.from}</b> <span className="text-slate-500">—[{e.label}]→</span>{" "}
                <b className="text-slate-200">{e.to}</b>
              </li>
            ))}
            {events.length === 0 && <li className="text-slate-500">No dated events mention this entity.</li>}
          </ul>
        )}

        {tab === "evidence" && (
          <dl className="space-y-1.5 text-slate-300">
            <div><dt className="text-slate-500">Snippet</dt><dd className="italic text-slate-400">“{ref_.snippet}”</dd></div>
            <div>
              <dt className="text-slate-500">Source document</dt>
              <dd className="text-accent">
                {file ? `${file.file_name} (${file.classification || "unclassified"})` : `#${ref_.sourceEvidenceId}`}
              </dd>
              {file && (
                <dd className="mt-1 text-xs text-slate-500">
                  sha256 {file.sha256.slice(0, 16)}… · {file.mime_type || "unknown type"} ·{" "}
                  {new Date(file.created_at).toLocaleDateString()}
                  {file.uploaded_by ? ` · by ${file.uploaded_by}` : ""}
                </dd>
              )}
            </div>
          </dl>
        )}
      </div>

      {ref_.nodeKey && (
        <div className="mt-3 flex items-center gap-2 border-t border-ink-700 pt-3">
          <select className="input !w-auto !py-1 text-xs" value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
            <option value={1}>1-degree</option>
            <option value={2}>2-degree</option>
            <option value={3}>3-degree</option>
          </select>
          <button className="btn !px-3 !py-1 text-xs" onClick={() => ref_.nodeKey && onExpand(ref_.nodeKey, depth)}>
            Expand node
          </button>
        </div>
      )}
    </div>
  );
}
