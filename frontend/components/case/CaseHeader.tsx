"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, Download, Upload, Trash2, FolderInput } from "lucide-react";
import { Button } from "../ui/Button";
import { Tag, StatusTag } from "../ui/Tag";
import { caseId } from "@/lib/format";
import type { CaseItem } from "@/lib/types";

export type CaseAction = "export" | "add-evidence" | "close" | "reopen" | "delete";

export function CaseHeader({ kase, sho, canContribute, onAction, busy }: {
  kase: CaseItem;
  sho: boolean;
  canContribute: boolean;
  onAction: (a: CaseAction) => void;
  busy?: boolean;
}) {
  const router = useRouter();
  const closed = kase.status === "closed";

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            onClick={() => router.push("/cases")}
            aria-label="Back to cases"
            className="mt-[2px] flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded border border-line text-fg-3 transition-colors duration-120 hover:border-line-2 hover:text-fg"
          >
            <ChevronLeft size={14} strokeWidth={1.6} aria-hidden />
          </button>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-[7px]">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-cyan">
                {caseId(kase.id)}
              </span>
              <StatusTag status={kase.status} />
              <StatusTag status={kase.risk_level} />
            </p>
            <h1 className="mt-[6px] text-[19px] font-medium leading-snug tracking-[-0.02em] text-fg">
              {kase.title}
            </h1>
            {(kase.summary || kase.description) && (
              <p className="mt-[6px] max-w-[720px] text-[12.5px] leading-relaxed text-fg-3">
                {kase.summary ?? kase.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="ghost" small onClick={() => onAction("export")} disabled={busy}>
            <Download size={14} strokeWidth={1.6} aria-hidden /> Export Report
          </Button>
          {!sho && canContribute && (
            <Button variant="ghost" small onClick={() => onAction("add-evidence")} disabled={busy}>
              <Upload size={14} strokeWidth={1.6} aria-hidden /> Add Evidence
            </Button>
          )}
          {sho && !closed && (
            <>
              <Button variant="ghost" small onClick={() => onAction("close")} disabled={busy}>
                <FolderInput size={14} strokeWidth={1.6} aria-hidden /> Close
              </Button>
              <Button variant="danger" small onClick={() => onAction("delete")} disabled={busy}>
                <Trash2 size={14} strokeWidth={1.6} aria-hidden /> Delete
              </Button>
            </>
          )}
          {sho && closed && (
            <Button variant="success" small onClick={() => onAction("reopen")} disabled={busy}>
              <FolderInput size={14} strokeWidth={1.6} aria-hidden /> Reopen
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
