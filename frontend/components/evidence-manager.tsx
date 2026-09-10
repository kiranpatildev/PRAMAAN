"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dropQueued, listQueued, queueUpload, type QueuedUpload } from "@/lib/outbox";
import { IcjsImportPanel } from "@/components/icjs-import";

export type EvidenceItem = {
  id: number;
  file_name: string;
  file_type: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  classification: string;
  classification_confidence: number;
  ocr_status: string;
  ocr_engine: string;
  ocr_pages: number;
  processing_error: string;
  created_at: string;
};

type CustodyEntry = {
  id: number;
  action: string;
  actor: string | null;
  details: Record<string, unknown>;
  timestamp: string;
};

function ocrBadge(status: string) {
  const map: Record<string, string> = {
    done: "text-risk-low",
    processing: "text-risk-medium",
    pending: "text-slate-400",
    unavailable: "text-risk-medium",
    skipped: "text-slate-500",
    failed: "text-risk-high",
  };
  return map[status] ?? "text-slate-400";
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Bulk evidence intake: drag-and-drop upload + classification/OCR status +
 *  per-file chain-of-custody viewer. Pipeline runs async in Celery; the list
 *  refreshes after each upload and every 5s while items are still pending. */
export function EvidenceManager({ caseId }: { caseId: string }) {
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [custody, setCustody] = useState<Record<number, CustodyEntry[]>>({});
  const [openCustody, setOpenCustody] = useState<number | null>(null);
  const [outbox, setOutbox] = useState<QueuedUpload[]>([]);

  const refresh = useCallback(async () => {
    try {
      const d = await api.caseEvidence(caseId);
      setItems(d.results ?? d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load evidence");
    }
  }, [caseId]);

  useEffect(() => {
    refresh();
    listQueued().then((q) => setOutbox(q.filter((x) => x.caseId === caseId))).catch(() => {});
  }, [refresh, caseId]);

  // Poll while the async pipeline still has work to do.
  useEffect(() => {
    if (!items.some((i) => i.ocr_status === "pending" || i.ocr_status === "processing")) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [items, refresh]);

  function isOfflineError(e: unknown) {
    return (
      typeof navigator !== "undefined" && !navigator.onLine
    ) || (e instanceof TypeError); // fetch network failure
  }

  async function upload(files: FileList | File[]) {
    setBusy(true);
    setError("");
    try {
      for (const f of Array.from(files)) {
        try {
          await api.uploadEvidence(caseId, f);
        } catch (e) {
          if (isOfflineError(e)) {
            // Field capture queue: stash bytes locally, retry on reconnect.
            await queueUpload({ caseId, name: f.name, type: f.type, blob: f });
            setOutbox(await listQueued().then((q) => q.filter((x) => x.caseId === caseId)));
          } else {
            throw e;
          }
        }
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function flushOutbox() {
    setBusy(true);
    setError("");
    try {
      for (const q of outbox) {
        await api.uploadEvidence(caseId, new File([q.blob], q.name, { type: q.type }));
        await dropQueued(q.id!);
      }
      setOutbox([]);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed — still offline?");
      setOutbox(await listQueued().then((qq) => qq.filter((x) => x.caseId === caseId)).catch(() => outbox));
    } finally {
      setBusy(false);
    }
  }

  async function toggleCustody(id: number) {
    if (openCustody === id) {
      setOpenCustody(null);
      return;
    }
    setOpenCustody(id);
    if (!custody[id]) {
      try {
        const entries = await api.evidenceCustody(caseId, id);
        setCustody((c) => ({ ...c, [id]: entries }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load custody log");
      }
    }
  }

  async function download(id: number) {
    try {
      const d = await api.evidenceDownload(caseId, id);
      window.open(d.url, "_blank", "noopener");
      await refresh(); // custody log gained a DOWNLOADED entry
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }

  async function reprocess(id: number) {
    try {
      await api.reprocessEvidence(caseId, id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reprocess failed");
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Evidence intake ({items.length})</h2>
        <span className="text-xs text-slate-400">sha256 hashed on upload</span>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}
        className={`mt-3 rounded-lg border-2 border-dashed p-6 text-center text-sm ${
          dragOver ? "border-accent bg-ink-800" : "border-ink-700 text-slate-400"
        }`}
      >
        <p>{busy ? "Uploading…" : "Drag & drop files here, or"}</p>
        <label className="btn mt-2 cursor-pointer">
          Browse files
          <input type="file" multiple className="hidden" disabled={busy}
            onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
        </label>
      </div>

      <IcjsImportPanel caseId={caseId} onImported={refresh} />

      {error && <p className="mt-2 text-sm text-risk-high">{error}</p>}

      {outbox.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-risk-medium p-2 text-sm">
          <span>📥 {outbox.length} file(s) queued offline: {outbox.map((q) => q.name).join(", ")}</span>
          <button className="btn !px-3 !py-1 text-xs" disabled={busy} onClick={flushOutbox}>
            Retry upload
          </button>
        </div>
      )}

      <div className="mt-3 divide-y divide-ink-700">
        {items.map((it) => (
          <div key={it.id} className="py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span title={it.sha256}><b>{it.file_name}</b> <span className="text-slate-500">· {fmtBytes(it.size_bytes)}</span></span>
              <span className="flex gap-2 text-xs">
                <button className="text-accent hover:underline" onClick={() => toggleCustody(it.id)}>custody</button>
                <button className="text-accent hover:underline" onClick={() => download(it.id)}>download</button>
                <button className="text-accent hover:underline" onClick={() => reprocess(it.id)}>reprocess</button>
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              <span>class: <b className="text-slate-200">{it.classification || it.file_type || "…"}</b>
                {it.classification_confidence > 0 && ` (${(it.classification_confidence * 100).toFixed(0)}%)`}</span>
              <span>ocr: <b className={ocrBadge(it.ocr_status)}>{it.ocr_status}</b>
                {it.ocr_engine && ` via ${it.ocr_engine}`}{it.ocr_pages > 0 && ` · ${it.ocr_pages}p`}</span>
            </div>
            {it.processing_error && <p className="mt-1 text-xs text-risk-medium">⚠ {it.processing_error}</p>}
            {openCustody === it.id && (
              <ul className="mt-2 space-y-1 rounded-lg bg-ink-950 p-2 text-xs text-slate-400">
                {(custody[it.id] ?? []).map((c) => (
                  <li key={c.id}>• <b className="text-slate-200">{c.action}</b> by {c.actor ?? "pipeline"} · {new Date(c.timestamp).toLocaleString()}</li>
                ))}
                {!(custody[it.id] ?? []).length && <li>Loading custody trail…</li>}
              </ul>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="py-4 text-sm text-slate-400">No evidence yet. Upload FIRs, CDRs, statements, or photos.</p>}
      </div>
    </div>
  );
}
