"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Report = {
  id: number; kind: string; sha256: string; size_bytes: number;
  created_by: string | null; created_at: string; download_url?: string;
};

/** Court-ready evidence packages: generate, download, history. */
export function ReportsCard({ caseId }: { caseId: string }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setReports(await api.reports(caseId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reports");
    }
  }, [caseId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const r = await api.generatePackage(caseId);
      if (r.download_url) window.open(r.download_url, "_blank", "noopener");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Package generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function download(id: number, name: string) {
    try {
      const blob = await api.reportDownload(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Evidence packages ({reports.length})</h2>
        <button className="btn !px-3 !py-1 text-xs" disabled={busy} onClick={generate}>
          {busy ? "Building PDF…" : "Generate court-ready package"}
        </button>
      </div>
      {error && <p className="mt-1 text-sm text-risk-high">{error}</p>}
      <p className="mt-1 text-xs text-slate-500">PDF bundle: manifest + SHA-256 hashes + custody ledger + findings.</p>
      <div className="mt-2 divide-y divide-ink-700 text-sm">
        {reports.map((r) => (
          <div key={r.id} className="flex items-center justify-between py-1.5">
            <span>
              <b>{r.kind}</b>{" "}
              <span className="text-xs text-slate-400">
                {(r.size_bytes / 1024).toFixed(1)} KB · sha {r.sha256.slice(0, 12)}… · {new Date(r.created_at).toLocaleString()}
              </span>
            </span>
            <button className="text-xs text-accent hover:underline" onClick={() => download(r.id, `evidence-package-${r.id}.pdf`)}>
              download
            </button>
          </div>
        ))}
        {reports.length === 0 && <p className="py-2 text-sm text-slate-500">No packages yet.</p>}
      </div>
    </div>
  );
}
