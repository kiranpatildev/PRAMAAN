"use client";

/** Evidence tab: batch intake table (Quick/Bulk upload, type/status/uploader
 *  rows expandable per file) + Evidence Drawer with the chain-of-custody box.
 *  Pipeline runs async in Celery; list refreshes after uploads and polls
 *  every 5s while items are still pending. Offline uploads queue locally. */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dropQueued, listQueued, queueUpload, type QueuedUpload } from "@/lib/outbox";
import { Panel, EmptyState, ErrorState, friendlyError, Icon } from "@/components/ui";
import { timeAgo } from "@/lib/format";

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

function ocrColor(status: string) {
  const map: Record<string, string> = {
    done: "#10B981",
    processing: "#F59E0B",
    pending: "#8B93A1",
    unavailable: "#F59E0B",
    skipped: "#8B93A1",
    failed: "#EF4444",
  };
  return map[status] ?? "#8B93A1";
}

function fmtBytes(n: number) {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function relOffset(first: number, ts: string): string {
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.round((t - first) / 60000);
  if (m <= 0) return "start";
  if (m < 60) return `+${m} min`;
  return `+${Math.floor(m / 60)}h ${m % 60}m`;
}

function Drawer({ item, entries, onClose, onDownload, onReprocess }: {
  item: EvidenceItem; entries: CustodyEntry[] | null;
  onClose: () => void; onDownload: () => void; onReprocess: () => void;
}) {
  const sorted = [...(entries ?? [])].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const first = sorted.length ? new Date(sorted[0].timestamp).getTime() : Date.now();
  const sealedBy = sorted.find((e) => /upload|seal|ingest/i.test(e.action))?.actor
    ?? sorted[0]?.actor ?? "—";
  const source = (sorted[0]?.details?.source as string)
    ?? item.classification ?? item.file_type ?? "—";

  return (
    <aside className="rounded-lg border border-[#1F2733] bg-[#121826] p-4 lg:sticky lg:top-24" aria-label="Evidence drawer">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0">
          <span className="block truncate text-sm font-bold" title={item.file_name}>{item.file_name}</span>
          <span className="font-mono text-[11px] text-[#8B93A1]">sha256 {item.sha256.slice(0, 16)}… · {fmtBytes(item.size_bytes)}</span>
        </p>
        <button onClick={onClose} className="rounded-md p-1 text-[#8B93A1] hover:text-[#E5E7EB]" aria-label="Close drawer">
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 rounded-md border border-[#3B82F6]/40 bg-[#3B82F6]/[0.06] p-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#3B82F6]">
          Chain of Custody
        </p>
        <dl className="mt-2 space-y-1.5 text-xs">
          {[
            ["File name", item.file_name],
            ["Sealed by", sealedBy],
            ["Source", source],
            ["Status", item.ocr_status],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="shrink-0 text-[#8B93A1]">{k}</dt>
              <dd className="min-w-0 truncate text-right font-medium" title={String(v)}>{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="mb-1.5 mt-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]">
        Timestamps
      </p>
      {!entries ? (
        <div className="skeleton h-16 w-full" />
      ) : sorted.length === 0 ? (
        <p className="text-xs text-[#8B93A1]">No custody events recorded yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
              <span><b>{e.action}</b> <span className="text-[#8B93A1]">· {e.actor ?? "pipeline"}</span></span>
              <span className="shrink-0 font-mono text-[11px] text-[#3B82F6]">{relOffset(first, e.timestamp)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex gap-2">
        <button onClick={onDownload} className="btn-ghost flex-1 !py-1.5 text-xs">
          <Icon name="download" className="h-3.5 w-3.5" /> Download
        </button>
        <button onClick={onReprocess} className="btn-ghost flex-1 !py-1.5 text-xs">
          <Icon name="refresh" className="h-3.5 w-3.5" /> Reprocess
        </button>
      </div>
    </aside>
  );
}

export function EvidenceManager({ caseId }: { caseId: string }) {
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [custody, setCustody] = useState<Record<number, CustodyEntry[]>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [outbox, setOutbox] = useState<QueuedUpload[]>([]);

  const refresh = useCallback(async () => {
    try {
      const d = await api.caseEvidence(caseId);
      setItems(d.results ?? d);
      setError("");
    } catch (e) {
      setError(friendlyError(e, "Failed to load evidence"));
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

  async function ensureCustody(id: number) {
    if (custody[id]) return;
    try {
      const entries = await api.evidenceCustody(caseId, id);
      setCustody((c) => ({ ...c, [id]: entries }));
    } catch (e) {
      setError(friendlyError(e, "Failed to load custody log"));
    }
  }

  function select(id: number) {
    setSelected((s) => (s === id ? null : id));
    ensureCustody(id);
  }

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
      setError(friendlyError(e, "Upload failed"));
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
      setError(friendlyError(e, "Retry failed — still offline?"));
      setOutbox(await listQueued().then((qq) => qq.filter((x) => x.caseId === caseId)).catch(() => outbox));
    } finally {
      setBusy(false);
    }
  }

  async function download(id: number) {
    try {
      const d = await api.evidenceDownload(caseId, id);
      window.open(d.url, "_blank", "noopener");
      await refresh(); // custody log gained a DOWNLOADED entry
    } catch (e) {
      setError(friendlyError(e, "Download failed"));
    }
  }

  async function reprocess(id: number) {
    try {
      await api.reprocessEvidence(caseId, id);
      await refresh();
    } catch (e) {
      setError(friendlyError(e, "Reprocess failed"));
    }
  }

  const selItem = items.find((i) => i.id === selected) ?? null;

  return (
    <div className={`grid items-start gap-4 ${selItem ? "xl:grid-cols-[1fr_340px]" : ""}`}>
      <Panel
        title="Evidence intake"
        count={items.length}
        right={<span className="font-mono text-[11px] text-[#8B93A1]">sha256 hashed on upload</span>}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={`cursor-pointer rounded-lg border border-[#3B82F6]/50 bg-[#3B82F6]/[0.07] p-3 text-center text-sm hover:bg-[#3B82F6]/[0.12] ${busy ? "pointer-events-none opacity-50" : ""}`}>
            <Icon name="plus" className="mx-auto h-4 w-4 text-[#3B82F6]" />
            <span className="mt-1 block font-semibold">Quick Upload</span>
            <span className="block text-xs font-normal text-[#8B93A1]">single file, starts pipeline</span>
            <input type="file" className="hidden" disabled={busy}
              onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
          </label>
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-3 text-center text-sm ${dragOver ? "border-[#3B82F6] bg-[#1A2233]" : "border-[#1F2733] text-[#8B93A1]"} ${busy ? "pointer-events-none opacity-50" : ""}`}
          >
            <Icon name="doc" className="mx-auto h-4 w-4" />
            <span className="mt-1 block font-semibold text-[#E5E7EB]">Bulk Upload</span>
            <span className="block text-xs font-normal">{busy ? "Uploading…" : "drop files here or browse"}</span>
            <input type="file" multiple className="hidden" disabled={busy}
              onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
          </label>
        </div>

        {error && <div className="mt-3"><ErrorState detail={error} onRetry={refresh} /></div>}

        {outbox.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#F59E0B]/50 p-2.5 text-sm">
            <span>⛁ {outbox.length} file(s) queued offline: {outbox.map((q) => q.name).join(", ")}</span>
            <button className="btn !px-3 !py-1 text-xs" disabled={busy} onClick={flushOutbox}>
              Retry upload
            </button>
          </div>
        )}

        <div className="mt-2 divide-y divide-[#1F2733]">
          {items.map((it) => (
            <div key={it.id} className={`py-2.5 ${selected === it.id ? "-mx-2 rounded-md bg-[#3B82F6]/[0.05] px-2" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <button onClick={() => select(it.id)} className="min-w-0 text-left hover:text-[#3B82F6]" title={`${it.sha256}\nClick to open the evidence drawer`}>
                  <b className="break-all">{it.file_name}</b>{" "}
                  <span className="font-mono text-[11px] text-[#8B93A1]">· {fmtBytes(it.size_bytes)}</span>
                </button>
                <span className="flex shrink-0 gap-2 font-mono text-[11px]">
                  <button className="text-[#3B82F6] hover:underline" onClick={() => select(it.id)}>drawer</button>
                  <button className="text-[#3B82F6] hover:underline" onClick={() => download(it.id)}>download</button>
                  <button className="text-[#3B82F6] hover:underline" onClick={() => reprocess(it.id)}>reprocess</button>
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-[#8B93A1]">
                <span>type: <b className="text-[#E5E7EB]">{it.classification || it.file_type || "…"}</b>
                  {it.classification_confidence > 0 && ` (${(it.classification_confidence * 100).toFixed(0)}%)`}</span>
                <span>status: <b style={{ color: ocrColor(it.ocr_status) }}>{it.ocr_status}</b>
                  {it.ocr_engine && ` via ${it.ocr_engine}`}{it.ocr_pages > 0 && ` · ${it.ocr_pages}p`}</span>
                <span>uploaded {it.created_at ? timeAgo(it.created_at) : "—"}</span>
              </div>
              {it.processing_error && <p className="mt-1 text-xs text-[#F59E0B]">⚠ {it.processing_error}</p>}
            </div>
          ))}
          {items.length === 0 && (
            <div className="py-2"><EmptyState icon="doc" title="No evidence yet" hint="Upload FIRs, CDRs, statements, or photos — Quick for one file, Bulk for many." /></div>
          )}
        </div>
      </Panel>

      {selItem && (
        <Drawer
          item={selItem}
          entries={custody[selItem.id] ?? null}
          onClose={() => setSelected(null)}
          onDownload={() => download(selItem.id)}
          onReprocess={() => reprocess(selItem.id)}
        />
      )}
    </div>
  );
}
