"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Hit = {
  node_type: string; normalized: string; value: string; confidence: number;
  cases: { id: number; fir_no: string; title: string }[];
  case_count: number; strength: number;
};

/** Cross-case connection flags (strictly limited to mutually-visible cases). */
export function CrossCasePanel() {
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.crossCase().then((d) => setHits(d.results ?? [])).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Cross-case search failed");
    });
  }, []);

  return (
    <div className="card">
      <h2 className="font-semibold">Cross-case connections ({hits.length})</h2>
      <p className="text-xs text-slate-500">Shared entities across cases you can access. Hidden cases never leak.</p>
      {error && <p className="mt-1 text-sm text-risk-high">{error}</p>}
      <div className="mt-2 divide-y divide-ink-700 text-sm">
        {hits.map((h) => (
          <div key={`${h.node_type}:${h.normalized}`} className="py-2">
            <span className="rounded bg-ink-700 px-1.5 py-0.5 text-xs text-accent">{h.node_type}</span>{" "}
            <b>{h.value}</b>{" "}
            <span className="text-xs text-slate-400">in {h.case_count} cases · strength {(h.strength * 100).toFixed(0)}%</span>
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              {h.cases.map((c) => (
                <a key={c.id} className="text-accent hover:underline" href={`/cases/${c.id}`}>{c.fir_no}</a>
              ))}
            </div>
          </div>
        ))}
        {hits.length === 0 && !error && <p className="py-2 text-sm text-slate-400">No shared entities across your cases.</p>}
      </div>
    </div>
  );
}
