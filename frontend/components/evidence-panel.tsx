"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type EvidenceRef = {
  edgeId: string;
  label: string;
  confidence: number;
  sourceEvidenceId: string;
  snippet: string;
  extractedOn?: string;
  extractedBy?: string;
  validFrom?: string | null;
  nodeKey?: string;
  isEdge?: boolean;
};

type SourceFile = {
  file_name: string;
  classification: string;
  mime_type: string;
  sha256: string;
  created_at: string;
  uploaded_by: string | null;
};

/** "Why?" affordance: every AI claim opens this panel with source document,
 *  extracted snippet, confidence, and extraction provenance. Nodes can be
 *  expanded to reveal N-degree connections. */
export function EvidencePanel({
  ref_,
  caseId,
  onClose,
  onExpand,
}: {
  ref_: EvidenceRef | null;
  caseId: string;
  onClose: () => void;
  onExpand: (nodeKey: string, depth: number) => void;
}) {
  const [file, setFile] = useState<SourceFile | null>(null);
  const [depth, setDepth] = useState(1);

  useEffect(() => {
    setFile(null);
    const id = ref_?.sourceEvidenceId;
    if (!id || !/^\d+$/.test(id)) return;
    api.evidenceDetail(caseId, id).then(setFile).catch(() => {});
  }, [ref_, caseId]);

  if (!ref_) {
    return (
      <div className="card text-sm text-slate-400">
        <b className="text-slate-200">Evidence panel</b>
        <p className="mt-1">Click any node or edge in the graph to see <i>why, when, how strongly, on what evidence</i>.</p>
      </div>
    );
  }
  return (
    <div className="card text-sm">
      <div className="flex items-center justify-between">
        <b>Why? — {ref_.label}</b>
        <button className="text-slate-400 hover:text-white" onClick={onClose}>✕</button>
      </div>
      <dl className="mt-2 space-y-1 text-slate-300">
        <div><dt className="text-slate-500">Confidence</dt><dd>{(ref_.confidence * 100).toFixed(1)}%</dd></div>
        {ref_.validFrom && <div><dt className="text-slate-500">Valid from</dt><dd>{ref_.validFrom}</dd></div>}
        {ref_.extractedOn && <div><dt className="text-slate-500">Extracted</dt><dd>{new Date(ref_.extractedOn).toLocaleString()}{ref_.extractedBy ? ` · ${ref_.extractedBy}` : ""}</dd></div>}
        <div><dt className="text-slate-500">Snippet</dt><dd className="italic text-slate-400">“{ref_.snippet}”</dd></div>
        <div>
          <dt className="text-slate-500">Source document</dt>
          <dd className="text-accent">
            {file ? `${file.file_name} (${file.classification || "unclassified"})` : `#${ref_.sourceEvidenceId}`}
          </dd>
          {file && (
            <dd className="mt-1 text-xs text-slate-500">
              sha256 {file.sha256.slice(0, 16)}… · {file.mime_type || "unknown type"} ·{" "}
              {new Date(file.created_at).toLocaleDateString()}
              {file.uploaded_by ? ` · by ${file.uploaded_by}` : ""}
            </dd>
          )}
        </div>
      </dl>
      {ref_.nodeKey && (
        <div className="mt-3 flex items-center gap-2 border-t border-ink-700 pt-3">
          <select className="input !w-auto !py-1 text-xs" value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
            <option value={1}>1-degree</option>
            <option value={2}>2-degree</option>
            <option value={3}>3-degree</option>
          </select>
          <button className="btn !px-3 !py-1 text-xs" onClick={() => ref_.nodeKey && onExpand(ref_.nodeKey, depth)}>
            Expand node
          </button>
        </div>
      )}
    </div>
  );
}
