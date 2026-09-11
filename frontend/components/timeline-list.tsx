"use client";

/** Case timeline: filter chips, vertical event spine, and a detail panel
 *  for the selected event with highlighted entities + source trail. */
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Panel, EmptyState, ErrorState, friendlyError, Icon } from "@/components/ui";

type Event = {
  from: string; to: string; label: string; valid_from: string;
  snippet: string; source_evidence_id: number | string | null; confidence: number;
};

const FILTERS = ["All", "Communications", "Transactions", "Locations", "Vehicles", "Reports"] as const;

const TYPE_BADGE: Record<string, string> = {
  COMMUNICATION: "text-[#14B8A6] border-[#14B8A6]/40 bg-[#14B8A6]/10",
  REPORT: "text-[#8B93A1] border-[#8B93A1]/40 bg-[#8B93A1]/10",
  VEHICLE: "text-[#F59E0B] border-[#F59E0B]/40 bg-[#F59E0B]/10",
  LOCATION: "text-[#22C55E] border-[#22C55E]/40 bg-[#22C55E]/10",
  TRANSACTION: "text-[#F97316] border-[#F97316]/40 bg-[#F97316]/10",
};

function badgeFor(label: string): string {
  const up = label.toUpperCase();
  for (const [k, v] of Object.entries(TYPE_BADGE)) {
    if (up.includes(k.slice(0, 6))) return v;
  }
  return "text-[#8B93A1] border-[#8B93A1]/40 bg-[#8B93A1]/10";
}

function chipFor(filter: string, label: string): boolean {
  if (filter === "All") return true;
  const K: Record<string, string> = {
    Communications: "COMMUNIC", Transactions: "TRANS", Locations: "LOCAT",
    Vehicles: "VEHIC", Reports: "REPORT",
  };
  return label.toUpperCase().includes(K[filter] ?? filter.toUpperCase());
}

export function TimelineList({ caseId, onSelectEntity }: {
  caseId: string; onSelectEntity?: (name: string) => void;
}) {
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [sel, setSel] = useState<number | null>(null);

  useEffect(() => {
    api.caseTimeline(caseId).then((d) => {
      setEvents(d.events ?? []);
      setError("");
    }).catch((e) => {
      setError(friendlyError(e, "Failed to load timeline"));
    });
  }, [caseId]);

  const shown = useMemo(() => events.filter((e) => chipFor(filter, e.label)), [events, filter]);
  useEffect(() => { setSel(null); }, [filter, caseId]);

  const range = useMemo(() => {
    const ds = shown.map((e) => e.valid_from).filter(Boolean).sort();
    return ds.length ? `${ds[0]} → ${ds[ds.length - 1]}` : "";
  }, [shown]);

  const current = sel != null ? shown[sel] : null;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[1fr_320px]">
      <Panel
        title="Event timeline"
        count={shown.length}
        right={<span className="font-mono text-[11px] text-[#8B93A1]">{shown.length} EVENTS{range ? ` · ${range}` : ""}</span>}
      >
        <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Event filters">
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 font-mono text-[11px] font-semibold ${filter === f ? "border-[#3B82F6] bg-[#3B82F6]/12 text-[#3B82F6]" : "border-[#1F2733] text-[#8B93A1] hover:text-[#E5E7EB]"}`}>
              {f}
            </button>
          ))}
        </div>

        {error && <div className="mb-3"><ErrorState detail={error} onRetry={() => window.location.reload()} /></div>}

        {shown.length === 0 && !error ? (
          <EmptyState icon="clock" title="No dated events yet" hint="Relations with explicit dates appear here as the queue gets confirmed." />
        ) : (
          <ol className="relative max-h-[480px] space-y-1 overflow-y-auto border-l border-[#1F2733] pl-0">
            {shown.map((e, i) => (
              <li key={i} className="relative pl-5">
                <span className={`absolute -left-[5px] top-3 h-2.5 w-2.5 rounded-full border-2 ${sel === i ? "border-[#3B82F6] bg-[#3B82F6]" : "border-[#1F2733] bg-[#0B0F17]"}`} />
                <button
                  onClick={() => setSel(i)}
                  className={`block w-full rounded-md border p-2.5 text-left transition-colors ${sel === i ? "border-[#3B82F6]/60 bg-[#3B82F6]/[0.06]" : "border-transparent hover:border-[#1F2733] hover:bg-[#1A2233]/50"}`}
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-[11px] text-[#3B82F6]">{e.valid_from || "undated"}</span>
                    <span className={`rounded border px-1.5 py-px font-mono text-[10px] font-bold ${badgeFor(e.label)}`}>
                      {e.label.replace(/_/g, " ").toUpperCase().slice(0, 14)}
                    </span>
                  </span>
                  <span className="mt-1 block text-sm"><b>{e.from}</b> <span className="text-[#8B93A1]">—[{e.label}]→</span> <b>{e.to}</b></span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {[e.from, e.to].map((n) => (
                      <span key={n} className="rounded bg-[#1A2233] px-1.5 py-0.5 font-mono text-[10px] text-[#8B93A1]">{n}</span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Event detail">
        {!current ? (
          <EmptyState icon="eye" title="Select an event" hint="Pick any row on the timeline to see its entities and source." />
        ) : (
          <div className="text-sm">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#8B93A1]">Event</p>
            <p className="mt-1 font-bold">{current.from} <span className="font-normal text-[#8B93A1]">—[{current.label}]→</span> {current.to}</p>
            <p className="mt-0.5 font-mono text-xs text-[#3B82F6]">{current.valid_from || "undated"}</p>
            {current.snippet && <p className="mt-2 text-[13px] italic leading-relaxed text-[#8B93A1]">“{current.snippet}”</p>}

            <p className="mb-1.5 mt-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]">
              Highlighted entities
            </p>
            <ul className="space-y-1.5">
              {[current.from, current.to].map((n) => (
                <li key={n}>
                  <button onClick={() => onSelectEntity?.(n)}
                    className="flex w-full items-center gap-2 rounded-md border border-[#1F2733] px-2.5 py-1.5 text-left text-[13px] hover:border-[#3B82F6]"
                    title="Highlight in network view">
                    <Icon name="focus" className="h-3.5 w-3.5 text-[#3B82F6]" />
                    <span className="font-semibold">{n}</span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-4 rounded-md border border-[#1F2733] bg-[#0B0F17] p-2.5">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]">Source</p>
              <p className="mt-1 font-mono text-xs text-[#E5E7EB]">
                {current.source_evidence_id ? `Evidence #${current.source_evidence_id}` : "Source pending"}
                {typeof current.confidence === "number" ? ` · ${(current.confidence * 100).toFixed(0)}%` : ""}
              </p>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[#8B93A1]">
              Selecting an event highlights its corresponding entities in the network view.
              Event confidence reflects source reliability only.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
