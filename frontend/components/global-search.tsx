"use client";

import { useState } from "react";
import { api } from "@/lib/api";

type Results = {
  query: string;
  entities: { id: number; value: string; node_type: string; status: string; confidence: number; case_id: number; case_fir: string; evidence_id: number | null }[];
  evidence: { id: number; file_name: string; classification: string; ocr_status: string; case_id: number; case_fir: string; snippet: string }[];
  cases: { id: number; fir_no: string; title: string; status: string; risk_level: string }[];
};

/** Global search page: entities + evidence + cases, typo-tolerant, scoped. */
export function GlobalSearch({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const [res, setRes] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(query: string) {
    if (query.trim().length < 2 || busy) return;
    setBusy(true);
    try {
      setRes(await api.globalSearch(query.trim()));
    } catch {
      /* session errors surface on the page level */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(q); }}>
        <input className="input" placeholder="Search entities, evidence, cases… (typo-tolerant)" value={q}
          onChange={(e) => setQ(e.target.value)} />
        <button className="btn" type="submit" disabled={busy}>{busy ? "…" : "Search"}</button>
      </form>
      {res && (
        <>
          <p className="text-sm text-slate-400">
            “{res.query}” — {res.entities.length} entities · {res.evidence.length} evidence · {res.cases.length} cases
          </p>
          {res.cases.length > 0 && (
            <div className="card">
              <h2 className="font-semibold">Cases</h2>
              {res.cases.map((c) => (
                <a key={c.id} href={`/cases/${c.id}`} className="block py-1 text-sm text-accent hover:underline">
                  {c.fir_no} — {c.title} <span className="text-slate-500">[{c.status}]</span>
                </a>
              ))}
            </div>
          )}
          {res.entities.length > 0 && (
            <div className="card">
              <h2 className="font-semibold">Entities</h2>
              <div className="divide-y divide-ink-700 text-sm">
                {res.entities.map((e) => (
                  <div key={e.id} className="flex items-center justify-between py-1.5">
                    <span>
                      <span className="rounded bg-ink-700 px-1.5 py-0.5 text-xs text-accent">{e.node_type}</span>{" "}
                      <b>{e.value}</b> <span className="text-xs text-slate-500">{e.status} · {(e.confidence * 100).toFixed(0)}%</span>
                    </span>
                    <a className="text-xs text-accent hover:underline" href={`/cases/${e.case_id}`}>{e.case_fir}</a>
                  </div>
                ))}
              </div>
            </div>
          )}
          {res.evidence.length > 0 && (
            <div className="card">
              <h2 className="font-semibold">Evidence</h2>
              <div className="divide-y divide-ink-700 text-sm">
                {res.evidence.map((e) => (
                  <div key={e.id} className="py-1.5">
                    <a className="text-accent hover:underline" href={`/cases/${e.case_id}`}>{e.file_name}</a>{" "}
                    <span className="text-xs text-slate-500">{e.classification} · {e.ocr_status} · {e.case_fir}</span>
                    {e.snippet && <p className="text-xs italic text-slate-500">“{e.snippet}…”</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
