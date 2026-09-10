"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function CasesPage() {
  const [cases, setCases] = useState<{ id: number; fir_no: string; title: string }[]>([]);

  useEffect(() => {
    api.cases().then((d) => setCases(d.results ?? d)).catch(() => {});
  }, []);

  return (
    <div className="card">
      <h1 className="text-xl font-bold">Cases</h1>
      <ul className="mt-3 space-y-2">
        {cases.map((c) => (
          <li key={c.id}>
            <a className="text-accent hover:underline" href={`/cases/${c.id}`}>
              {c.fir_no} — {c.title}
            </a>
          </li>
        ))}
        {cases.length === 0 && <li className="text-sm text-slate-400">No cases. Log in first.</li>}
      </ul>
    </div>
  );
}
