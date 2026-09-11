"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Panel, EmptyState, ErrorState, friendlyError } from "@/components/ui";
import { entityColor } from "@/lib/theme";

type Hit = {
  node_type: string; normalized: string; value: string; confidence: number;
  cases: { id: number; fir_no: string; title: string }[];
  case_count: number; strength: number;
};

/** Cross-case connection flags (strictly limited to mutually-visible cases).
 *  Pass caseId to show only links involving that case (workspace section);
 *  omit it for the global view (dashboard). */
export function CrossCasePanel({ caseId }: { caseId?: string | number }) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.crossCase().then((d) => {
      const all: Hit[] = d.results ?? [];
      setHits(caseId == null ? all : all.filter((h) => h.cases.some((c) => String(c.id) === String(caseId))));
      setError("");
    }).catch((e: unknown) => {
      // Raw auth failures never surface: the api layer refreshes or redirects.
      setError(friendlyError(e, "Cross-case search failed"));
    });
  }, [caseId]);

  function reload() {
    setError("");
    api.crossCase().then((d) => {
      const all: Hit[] = d.results ?? [];
      setHits(caseId == null ? all : all.filter((h) => h.cases.some((c) => String(c.id) === String(caseId))));
    }).catch((e: unknown) => {
      setError(friendlyError(e, "Cross-case search failed"));
    });
  }

  return (
    <Panel
      title="Cross-case connections"
      count={hits.length}
      right={<span className="max-w-[220px] text-right font-mono text-[10px] leading-snug text-[#8B93A1]">Shared entities across cases you can access. Hidden cases never leak.</span>}
    >
      {error && <div className="mb-3"><ErrorState detail={error} onRetry={reload} /></div>}
      <div className="divide-y divide-[#1F2733] text-sm">
        {hits.map((h) => (
          <div key={`${h.node_type}:${h.normalized}`} className="py-2.5">
            <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider"
              style={{
                color: entityColor(h.node_type),
                borderColor: `${entityColor(h.node_type)}66`,
                background: `${entityColor(h.node_type)}14`,
              }}>
              {h.node_type}
            </span>{" "}
            <b>{h.value}</b>{" "}
            <span className="font-mono text-[11px] text-[#8B93A1]">in {h.case_count} cases · strength {(h.strength * 100).toFixed(0)}%</span>
            <div className="mt-1 flex flex-wrap gap-2 font-mono text-xs">
              {h.cases.map((c) => (
                <a key={c.id} className="text-[#3B82F6] hover:underline" href={`/cases/${c.id}`}>{c.fir_no}</a>
              ))}
            </div>
          </div>
        ))}
        {hits.length === 0 && !error && (
          <div className="py-1">
            <EmptyState icon="link" title="No shared entities yet" hint="When the same person, phone, or vehicle appears across cases you can access, the link surfaces here." />
          </div>
        )}
      </div>
    </Panel>
  );
}
