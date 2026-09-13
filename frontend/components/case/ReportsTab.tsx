"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { Panel } from "../ui/Panel";
import { Table, TableSkeleton } from "../ui/Table";
import { Empty } from "../ui/Empty";
import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { listReports, generatePackage, reportDownloadBlob, type ReportRow } from "@/lib/endpoints";
import { fmtBytes, longDate } from "@/lib/format";
import { useToast } from "../ui/Toast";

export function ReportsTab({ caseId: cid, canExport }: {
  caseId: string | number;
  canExport: boolean;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setLoading(true);
    listReports(cid)
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [cid]);

  async function download(r: ReportRow) {
    try {
      const blob = await reportDownloadBlob(r.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast({ kind: "warn", title: "Download failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function generate() {
    setBusy(true);
    try {
      const pkg = await generatePackage(cid);
      toast({ kind: "ok", title: "Report generated", body: "Court-ready package stored." });
      if (pkg.download_url) window.open(pkg.download_url, "_blank", "noopener");
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Export failed", body: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-[18px]">
      {canExport && (
        <Panel title="Generate">
          <div className="flex flex-wrap items-center gap-[10px]">
            <p className="flex-1 text-[12.5px] text-fg-3">
              Build a court-ready evidence package PDF from confirmed rows. Every
              generation is stored and listed below with its hash.
            </p>
            <Button variant="primary" small disabled={busy} onClick={generate}>
              {busy ? "Generating…" : "Generate package"}
            </Button>
          </div>
        </Panel>
      )}

      <Panel title={`History${rows.length ? ` · ${rows.length}` : ""}`} flush>
        {loading ? (
          <TableSkeleton rows={4} />
        ) : (
          <Table<ReportRow>
            columns={[
              { key: "kind", head: "Kind", render: (r) => <span className="font-mono text-[11.5px]">{r.kind}</span> },
              { key: "sha", head: "SHA-256", render: (r) => <span className="font-mono text-[10.5px] text-fg-3">{r.sha256.slice(0, 16)}…</span> },
              { key: "size", head: "Size", numeric: true, render: (r) => <span>{fmtBytes(r.size_bytes)}</span> },
              { key: "by", head: "By", render: (r) => <span>{r.created_by ?? "—"}</span> },
              { key: "at", head: "Created", numeric: true, render: (r) => <span>{longDate(r.created_at)}</span> },
            ]}
            rows={rows}
            actionFor={(r) => (
              <Button variant="ghost" small onClick={() => download(r)}>
                Download
              </Button>
            )}
            empty={
              <div className="p-[14px]">
                <Empty icon={FileText} title="No reports yet" body="Generated packages will be listed here." />
              </div>
            }
          />
        )}
      </Panel>
      {!canExport && (
        <Notice variant="lock">Generating packages needs edit permission on this case.</Notice>
      )}
    </div>
  );
}
