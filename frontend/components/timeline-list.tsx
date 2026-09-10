"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Event = {
  from: string; to: string; label: string; valid_from: string;
  snippet: string; source_evidence_id: number | string | null; confidence: number;
};

/** Temporal playback list: how the network evolved as evidence was added. */
export function TimelineList({ caseId }: { caseId: string }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.caseTimeline(caseId).then((d) => setEvents(d.events ?? [])).catch((e) => {
      setError(e instanceof Error ? e.message : "Failed to load timeline");
    });
  }, [caseId]);

  return (
    <div className="card">
      <h2 className="font-semibold">Event timeline ({events.length})</h2>
      {error && <p className="mt-1 text-sm text-risk-high">{error}</p>}
      <ol className="mt-2 max-h-64 space-y-2 overflow-y-auto text-sm">
        {events.map((e, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-24 shrink-0 text-xs text-accent">{e.valid_from}</span>
            <div>
              <b>{e.from}</b> <span className="text-slate-400">—[{e.label}]→</span> <b>{e.to}</b>
              <p className="text-xs italic text-slate-500">“{e.snippet}”</p>
            </div>
          </li>
        ))}
        {events.length === 0 && (
          <li className="text-sm text-slate-500">No dated events yet — relations with explicit dates appear here.</li>
        )}
      </ol>
    </div>
  );
}
