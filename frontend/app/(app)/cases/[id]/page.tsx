"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FolderOpen, ShieldAlert } from "lucide-react";
import { CaseHeader, type CaseAction } from "@/components/case/CaseHeader";
import { CaseTabs, type CaseTabId, type TabDef } from "@/components/case/CaseTabs";
import { OverviewTab } from "@/components/case/OverviewTab";
import { TeamTab } from "@/components/case/TeamTab";
import { EvidenceTab } from "@/components/case/EvidenceTab";
import { EntitiesTab } from "@/components/case/EntitiesTab";
import { NetworkTab } from "@/components/case/NetworkTab";
import { TimelineTab } from "@/components/case/TimelineTab";
import { CrossCaseTab } from "@/components/case/CrossCaseTab";
import { NotesTasksTab } from "@/components/case/NotesTasksTab";
import { AuditTab } from "@/components/case/AuditTab";
import { ReportsTab } from "@/components/case/ReportsTab";
import { AnalyticsTab } from "@/components/case/AnalyticsTab";
import { Empty } from "@/components/ui/Empty";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TableSkeleton } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import {
  getCase, getMe, caseTimeline,
  closeCase, reopenCase, deleteCase,
  generatePackage, reportDownloadBlob,
} from "@/lib/endpoints";
import { isSho } from "@/lib/auth";
import type { CaseItem } from "@/lib/types";

const VALID_TABS = new Set([
  "overview", "team", "evidence", "entities", "network", "timeline",
  "cross", "analytics", "notes", "audit", "reports",
]);

export default function CaseWorkspacePage({ params }: { params: { id: string } }) {
  return (
    <Suspense>
      <CaseWorkspaceBody params={params} />
    </Suspense>
  );
}

function CaseWorkspaceBody({ params }: { params: { id: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const isolateParam = searchParams.get("isolate") ?? "";
  const toast = useToast();
  const [kase, setKase] = useState<CaseItem | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [meId, setMeId] = useState<number | null>(null);
  const [tab, setTab] = useState<CaseTabId>(
    initialTab && VALID_TABS.has(initialTab) ? (initialTab as CaseTabId) : "overview"
  );
  // Copilot handoff (?tab=network&isolate=key1,key2): node keys to focus on
  // the canvas once it loads. Unknown keys are ignored by the Network tab.
  const [isolateKeys] = useState<string[]>(
    isolateParam.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 100)
  );
  const [timelineCount, setTimelineCount] = useState(0);
  const [status, setStatus] = useState<"loading" | "ok" | "forbidden" | "missing" | "error">("loading");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [highlightLabels, setHighlightLabels] = useState<string[]>([]);

  const refresh = useCallback(() => {
    getCase(params.id)
      .then((c) => {
        setKase(c);
        setStatus("ok");
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "";
        if (/404/.test(msg)) setStatus("missing");
        else if (/403|Forbidden/.test(msg)) setStatus("forbidden");
        else setStatus("error");
      });
    caseTimeline(params.id)
      .then((d) => setTimelineCount((d.events ?? []).length))
      .catch(() => {});
  }, [params.id]);

  useEffect(() => {
    getMe()
      .then((m) => {
        setRole(m.role ?? null);
        setMeId(m.id);
      })
      .catch(() => {});
    refresh();
  }, [refresh]);

  if (status === "loading") {
    return (
      <div>
        <TableSkeleton rows={2} />
        <div className="mt-[18px]">
          <TableSkeleton rows={6} />
        </div>
      </div>
    );
  }

  if (status === "missing") {
    return (
      <Empty
        icon={FolderOpen}
        title="Case not found"
        body={`No case C-${params.id} exists or it was deleted.`}
        action={<Button variant="ghost" onClick={() => router.push("/cases")}>Back to cases</Button>}
      />
    );
  }

  if (status === "forbidden") {
    return <Empty icon={ShieldAlert} title="403 — Forbidden" body="You cannot access this case." />;
  }

  if (!kase) {
    return (
      <div>
        <TableSkeleton rows={6} />
      </div>
    );
  }

  const sho = isSho(role);
  const assigned = new Map((kase.assignments ?? []).map((a) => [a.user.id, a.permission]));
  const canContribute =
    role === "investigator" && meId != null && (assigned.has(meId) || kase.owner?.id === meId);

  async function act(a: CaseAction) {
    const k = kase;
    if (!k) return;
    if (a === "add-evidence") {
      setTab("evidence");
      return;
    }
    if (a === "export") {
      setBusy(true);
      try {
        const pkg = await generatePackage(k.id);
        if (pkg.download_url) window.open(pkg.download_url, "_blank", "noopener");
        else {
          const blob = await reportDownloadBlob(pkg.id);
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank", "noopener");
        }
        toast({ kind: "ok", title: "Report exported", body: "Court-ready package generated." });
      } catch (err) {
        toast({ kind: "warn", title: "Export failed", body: err instanceof Error ? err.message : undefined });
      } finally {
        setBusy(false);
      }
      return;
    }
    if (a === "delete") {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      if (a === "close") {
        await closeCase(k.id);
        toast({ kind: "ok", title: "Case closed" });
      } else if (a === "reopen") {
        await reopenCase(k.id);
        toast({ kind: "ok", title: "Case reopened" });
      }
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Action failed", body: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  const tabs: TabDef[] = [
    { id: "overview", label: "Overview" },
    ...(sho ? [{ id: "team", label: "Team" } as TabDef] : []),
    { id: "evidence", label: "Evidence", count: kase.evidence_count ?? 0 },
    { id: "entities", label: "Entities", count: kase.entities_count ?? 0 },
    { id: "network", label: "Network" },
    { id: "timeline", label: "Timeline", count: timelineCount },
    { id: "cross", label: "Cross-Case Links" },
    { id: "analytics", label: "Analytics" },
    { id: "notes", label: "Notes & Tasks" },
    { id: "audit", label: "Audit Log" },
    { id: "reports", label: "Reports" },
  ];

  return (
    <div>
      <CaseHeader kase={kase} sho={sho} canContribute={canContribute} onAction={act} busy={busy} />
      <CaseTabs tabs={tabs} active={tab} onChange={setTab} />

      {confirmDelete && (
        <Modal title="Delete case" onClose={() => setConfirmDelete(false)}>
          <p className="text-[12.5px] text-fg-2">
            Delete <b className="text-fg">{kase.title}</b> ({kase.fir_no}) and all its evidence, entities and
            history? This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await deleteCase(kase.id);
                  router.push("/cases");
                } catch (err) {
                  toast({ kind: "warn", title: "Delete failed", body: err instanceof Error ? err.message : undefined });
                  setConfirmDelete(false);
                }
              }}
            >
              Delete case
            </Button>
          </div>
        </Modal>
      )}

      <div key={tab} className="route-in">
        {tab === "overview" && <OverviewTab caseId={kase.id} kase={kase} onManageTeam={() => setTab("team")} />}
        {tab === "team" && sho && <TeamTab caseId={kase.id} assigned={assigned} onChanged={refresh} />}
        {tab === "evidence" && <EvidenceTab caseId={kase.id} sho={sho} canContribute={canContribute} />}
        {tab === "entities" && <EntitiesTab caseId={kase.id} sho={sho} canVerify={canContribute} />}
        {tab === "network" && <NetworkTab caseId={kase.id} highlightLabels={highlightLabels} isolateKeys={isolateKeys} canEdit={sho || canContribute} />}
        {tab === "timeline" && (
          <TimelineTab
            caseId={kase.id}
            onSelectEntity={(label) => {
              setHighlightLabels([label]);
              setTab("network");
            }}
          />
        )}
        {tab === "cross" && <CrossCaseTab caseId={kase.id} />}
        {tab === "notes" && <NotesTasksTab caseId={kase.id} sho={sho} />}
        {tab === "audit" && <AuditTab caseId={kase.id} />}
        {tab === "analytics" && <AnalyticsTab caseId={kase.id} />}
        {tab === "reports" && <ReportsTab caseId={kase.id} canExport={sho || canContribute} />}
      </div>
    </div>
  );
}
