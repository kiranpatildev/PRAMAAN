"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, FileText, Sheet, AudioLines, Image as ImageIcon, File as FileIcon } from "lucide-react";
import { Panel } from "../ui/Panel";
import { Table, TableSkeleton } from "../ui/Table";
import { Tag } from "../ui/Tag";
import { Empty } from "../ui/Empty";
import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import {
  listEvidence, uploadEvidence, deleteEvidence, evidenceCustody,
  evidenceDownload, reprocessEvidence,
} from "@/lib/endpoints";
import { auditDate, fmtBytes, longDate } from "@/lib/format";
import { useToast } from "../ui/Toast";
import type { Evidence } from "@/lib/types";

interface CustodyEntry {
  id?: number;
  action: string;
  actor?: string;
  details?: Record<string, unknown>;
  ip?: string;
  timestamp: string;
}

const TYPE_META: Record<string, { icon: typeof FileText; color: string }> = {
  pdf: { icon: FileText, color: "#f87171" },
  csv: { icon: Sheet, color: "#4ade80" },
  audio: { icon: AudioLines, color: "#00d9ff" },
  img: { icon: ImageIcon, color: "#fbbf24" },
  ocr: { icon: FileIcon, color: "#a3b1c2" },
};

function statusOf(e: Evidence): { label: string; tone: "green" | "amber" | "red" | "muted" } {
  if (e.processing_error) return { label: "failed", tone: "red" };
  if (e.ocr_status === "done") return { label: "verified", tone: "green" };
  if (e.ocr_status === "processing") return { label: "processing", tone: "amber" };
  return { label: "queued", tone: "muted" };
}

export function EvidenceTab({ caseId: cid, sho, canContribute }: {
  caseId: string | number;
  sho: boolean;
  canContribute: boolean;
}) {
  const toast = useToast();
  const [items, setItems] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [custodyFor, setCustodyFor] = useState<Evidence | null>(null);
  const [custodyRows, setCustodyRows] = useState<CustodyEntry[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<Evidence | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canEdit = sho || canContribute;

  const refresh = useCallback(() => {
    setLoading(true);
    listEvidence(cid)
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [cid]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      setItems((xs) => {
        if (xs.some((e) => e.ocr_status === "pending" || e.ocr_status === "processing")) refresh();
        return xs;
      });
    }, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  async function openCustody(e: Evidence) {
    setCustodyFor(e);
    setCustodyRows([]);
    try {
      setCustodyRows(await evidenceCustody(cid, e.id));
    } catch (err) {
      toast({ kind: "warn", title: "Custody failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function download(e: Evidence) {
    try {
      const { url } = await evidenceDownload(cid, e.id);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast({ kind: "warn", title: "Download failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function reprocess(e: Evidence) {
    try {
      await reprocessEvidence(cid, e.id);
      toast({ kind: "ok", title: "Reprocess queued", body: e.file_name });
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Reprocess failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function remove(e: Evidence) {
    try {
      await deleteEvidence(cid, e.id);
      toast({ kind: "ok", title: "Evidence deleted", body: e.file_name });
      setConfirmDelete(null);
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Delete failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length || busy) return;
    setBusy(true);
    try {
      for (const f of list) await uploadEvidence(cid, f);
      toast({ kind: "ok", title: `${list.length} file${list.length === 1 ? "" : "s"} uploaded`, body: "Pipeline started." });
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Upload failed", body: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-[18px]">
      {sho && (
        <Notice variant="warn">
          Upload is blocked for SHO/Admin. user_can_contribute_case() explicitly excludes SHO — oversight, not evidence handling.
        </Notice>
      )}
      {!sho && !canContribute && (
        <Notice variant="lock">You are not on this case team. Ask the SHO for an assignment to upload or verify.</Notice>
      )}
      {!sho && canContribute && (
        <Panel title="Upload evidence">
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload files"
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
            }}
            className={`cursor-pointer rounded border border-dashed px-5 py-7 text-center transition-colors duration-120 ${
              drag ? "border-cyan bg-cyan-bg" : "border-line-2 hover:border-line-3"
            }`}
          >
            <Upload size={22} strokeWidth={1.6} className="mx-auto text-fg-3" aria-hidden />
            <p className="mt-2 text-[12.5px] text-fg-2">Drop a file or click to browse</p>
            <p className="mt-1 font-mono text-[10.5px] text-fg-4">PDF · CSV · MP3 · WAV · PNG · JPG · max 100 MB</p>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                if (e.target.files?.length) upload(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </Panel>
      )}

      <Panel title={`Evidence${items.length ? ` · ${items.length}` : ""}`} flush>
        {loading ? (
          <TableSkeleton rows={6} />
        ) : (
          <Table<Evidence>
            columns={[
              {
                key: "file",
                head: "File",
                width: "36%",
                render: (e) => {
                  const meta = TYPE_META[e.file_type] ?? TYPE_META.ocr;
                  const Icon = meta.icon;
                  return (
                    <span className="flex items-center gap-[10px]">
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] border border-line-2 bg-panel-2"
                        aria-hidden
                      >
                        <Icon size={14} strokeWidth={1.6} style={{ color: meta.color }} />
                      </span>
                      <span className="min-w-0">
                        <b className="block truncate text-[12.5px] font-medium text-fg">{e.file_name}</b>
                        <span className="block font-mono text-[10.5px] text-fg-4">EVT-{e.id}</span>
                      </span>
                    </span>
                  );
                },
              },
              { key: "type", head: "Type", render: (e) => <span className="font-mono text-[11.5px]">{e.classification || e.file_type}</span> },
              { key: "size", head: "Size", numeric: true, render: (e) => <span>{fmtBytes(e.size_bytes)}</span> },
              { key: "source", head: "Source", render: (e) => <span>{e.source ?? "upload"}</span> },
              { key: "by", head: "Uploaded by", render: (e) => <span>{e.uploaded_by ?? e.by ?? "—"}</span> },
              { key: "date", head: "Date", numeric: true, render: (e) => <span>{longDate(e.created_at)}</span> },
              {
                key: "status",
                head: "Status",
                render: (e) => {
                  const s = statusOf(e);
                  return <Tag tone={s.tone}>{s.label}</Tag>;
                },
              },
            ]}
            rows={items}
            actionFor={(e) => (
              <span className="flex justify-end gap-[6px]">
                <Button variant="ghost" small onClick={() => openCustody(e)}>
                  Custody
                </Button>
                <Button variant="ghost" small onClick={() => download(e)}>
                  Download
                </Button>
                {canEdit && (
                  <>
                    <Button variant="ghost" small onClick={() => reprocess(e)}>
                      Reprocess
                    </Button>
                    <Button variant="danger" small onClick={() => setConfirmDelete(e)}>
                      Delete
                    </Button>
                  </>
                )}
              </span>
            )}
            empty={
              <div className="p-[14px]">
                <Empty icon={FileText} title="No evidence yet" body="Upload the first file to start the pipeline." />
              </div>
            }
          />
        )}
      </Panel>
      <div className="flex justify-end">
        <Button variant="ghost" small onClick={refresh}>
          Refresh
        </Button>
      </div>

      {custodyFor && (
        <Modal title={`Chain of custody · ${custodyFor.file_name}`} onClose={() => setCustodyFor(null)}>
          {custodyRows.length === 0 ? (
            <p className="text-[12.5px] text-fg-3">Loading custody ledger…</p>
          ) : (
            <ul className="divide-y divide-line">
              {custodyRows.map((c, i) => (
                <li key={c.id ?? i} className="flex items-center justify-between gap-3 py-[9px]">
                  <span>
                    <b className="block text-[12.5px] font-medium text-fg">{c.action}</b>
                    <span className="block font-mono text-[10.5px] text-fg-4">
                      {c.actor ?? "system"}{c.ip ? ` · ${c.ip}` : ""}
                    </span>
                  </span>
                  <span className="font-mono text-[10.5px] text-fg-4">{auditDate(c.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Delete evidence" onClose={() => setConfirmDelete(null)}>
          <p className="text-[12.5px] text-fg-2">
            Delete <b className="text-fg">{confirmDelete.file_name}</b>? The custody ledger
            survives; the file and its extracted rows do not. This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => remove(confirmDelete)}>
              Delete
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
