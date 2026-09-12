"use client";

import type { TimelineEvent } from "@/lib/types";

export type TEvent = TimelineEvent & { _id: string; _type: string };

export function classify(label?: string | null): "COMMUNICATION" | "TRANSACTION" | "LOCATION" | "VEHICLE" | "REPORT" {
  const up = (label ?? "").toUpperCase();
  if (/CALL|CONTACT|MESSAGE|USE/.test(up)) return "COMMUNICATION";
  if (/PAID|TRANSFER|MONEY|AMOUNT/.test(up)) return "TRANSACTION";
  if (/PRESENT|VISIT|TRAVEL|LOCATION|ADDRESS/.test(up)) return "LOCATION";
  if (/VEHICLE|OWNS|CAR|BIKE|TRUCK/.test(up)) return "VEHICLE";
  return "REPORT";
}

export function TimelineDetailPanel({ event, onSelectEntity }: {
  event: TEvent | null;
  onSelectEntity: (label: string) => void;
}) {
  if (!event) {
    return (
      <div className="p-[14px]">
        <p className="micro-label">Event detail</p>
        <p className="mt-2 text-[12.5px] text-fg-3">Select an event on the left to inspect it.</p>
      </div>
    );
  }
  const names = [event.from, event.to].filter(Boolean) as string[];
  return (
    <div className="p-[14px]">
      <p className="flex items-center gap-2">
        <span className="micro-label">Event</span>
        <span className="rounded-[3px] border border-line-2 px-[5px] py-px font-mono text-[10px] text-fg-3">
          {event._id}
        </span>
      </p>
      <h3 className="mt-[6px] text-[15px] font-medium text-fg">{event.title ?? `${event.from ?? ""} — ${event.to ?? ""}`}</h3>
      <p className="mt-2 text-[12.5px] leading-[1.6] text-fg-2">{event.desc ?? event.snippet ?? "—"}</p>

      <p className="micro-label mb-2 mt-4">Highlighted entities</p>
      <div className="space-y-2">
        {names.length === 0 && <p className="text-[12px] text-fg-3">None linked.</p>}
        {names.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onSelectEntity(n)}
            className="flex w-full items-center gap-[10px] rounded border border-line bg-panel px-[10px] py-[8px] text-left transition-colors duration-120 hover:border-line-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-fg">{n}</span>
              <span className="block truncate font-mono text-[10.5px] text-fg-4">{n}</span>
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-fg-3">entity</span>
          </button>
        ))}
      </div>

      <p className="micro-label mb-2 mt-4">Source</p>
      <div className="rounded border border-line bg-panel px-[10px] py-[8px]">
        <p className="text-[12.5px] text-fg-2">{event.source ?? "Case evidence"}</p>
        {event.source_evidence_id != null && (
          <p className="mt-1 font-mono text-[10.5px] text-fg-4">EVT-{event.source_evidence_id}</p>
        )}
      </div>

      <p className="mt-4 text-[11.5px] leading-relaxed text-fg-3">
        Selecting an event highlights its entities in the network view. Event confidence reflects source
        reliability only.
      </p>
    </div>
  );
}

export function eventRangeLabel(events: TEvent[]): string {
  const ds = events.map((e) => e.valid_from ?? "").filter(Boolean).sort();
  if (!ds.length) return `${events.length} events`;
  const a = new Date(ds[0]);
  const b = new Date(ds[ds.length - 1]);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const sameDay = ds[0].slice(0, 10) === ds[ds.length - 1].slice(0, 10);
  const left = `${String(a.getDate()).padStart(2, "0")}`;
  const right = `${String(b.getDate()).padStart(2, "0")} ${months[b.getMonth()]} ${b.getFullYear()}`;
  return `${events.length} events · ${sameDay ? right : `${left}–${right}`}`;
}
