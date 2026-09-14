"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { KpiStrip } from "@/components/ui/KpiStrip";
import { Panel } from "@/components/ui/Panel";
import { Table, TableSkeleton } from "@/components/ui/Table";
import { Empty } from "@/components/ui/Empty";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";
import { districts, districtsGeo, districtOverview, type DistrictGeo, type DistrictOverview } from "@/lib/endpoints";
import { DistrictMap } from "@/components/district/DistrictMap";

export default function DistrictsPage() {
  const [names, setNames] = useState<string[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [ov, setOv] = useState<DistrictOverview | null>(null);
  const [geo, setGeo] = useState<DistrictGeo[]>([]);
  const [unlocated, setUnlocated] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      districts(),
      districtsGeo().catch(() => ({ districts: [] as DistrictGeo[], unlocated_districts: 0 })),
    ])
      .then(([d, g]) => {
        setNames(d.districts ?? []);
        if ((d.districts ?? []).length > 0) setSel(d.districts[0]);
        else setLoading(false);
        setGeo(g.districts ?? []);
        setUnlocated(g.unlocated_districts ?? 0);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Districts failed to load");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!sel) return;
    setLoading(true);
    setError("");
    districtOverview(sel)
      .then(setOv)
      .catch((e) => setError(e instanceof Error ? e.message : "District overview failed"))
      .finally(() => setLoading(false));
  }, [sel]);

  const open = ov?.cases.by_status
    ? Object.entries(ov.cases.by_status).filter(([k]) => k !== "closed").reduce((a, [, n]) => a + n, 0)
    : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Oversight"
        title="Districts"
        sub="Caseload, workload and shared-signal aggregates across your visible cases."
      />

      {error && (
        <div className="mb-[14px]">
          <Notice variant="warn" action={<Button variant="ghost" small onClick={() => window.location.reload()}>Retry</Button>}>
            {error}
          </Notice>
        </div>
      )}

      {names.length === 0 && !loading ? (
        <Empty icon={MapPin} title="No districts" body="District aggregates appear once cases carry a district." />
      ) : (
        <>
          <div className="mb-[18px]">
            <DistrictMap districts={geo} selected={sel} onSelect={setSel} />
            {unlocated > 0 && (
              <p className="mt-2 font-mono text-[10.5px] text-fg-4">
                {unlocated} district{unlocated === 1 ? "" : "s"} without map coordinates — listed below, not plotted.
              </p>
            )}
          </div>
          <div className="mb-[14px] flex flex-wrap gap-[6px]">
            {names.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSel(n)}
                className={`rounded-[3px] border px-2 py-1 font-mono text-[11px] transition-colors duration-120 ${
                  sel === n
                    ? "border-cyan-br text-cyan"
                    : "border-line-2 bg-panel-2 text-fg-2 hover:border-cyan-br hover:text-cyan"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          {loading || !ov ? (
            <TableSkeleton rows={3} />
          ) : (
            <>
              <KpiStrip
                items={[
                  { label: "Cases", dot: "#00d9ff", value: ov.cases.total, sub: `${open} active` },
                  { label: "Statuses", dot: "#a3b1c2", value: Object.keys(ov.cases.by_status).length, sub: Object.entries(ov.cases.by_status).map(([k, v]) => `${k} ${v}`).join(" · ").slice(0, 60) || "—" },
                  { label: "Workload rows", dot: "#a78bfa", value: ov.workload.length, sub: "active investigators" },
                  { label: "Shared signals", dot: "#fbbf24", value: ov.cross_case_top.length, sub: "entities in ≥2 cases" },
                ]}
              />

              <div className="mt-[18px] grid grid-cols-[1.6fr_1fr] gap-[18px] max-[1100px]:grid-cols-1">
                <Panel title={`Workload · ${ov.district}`} flush>
                  <Table<{ username: string; role: string; active_cases: number; pending_reviews: number } & { id: string }>
                    columns={[
                      { key: "user", head: "Investigator", width: "40%", render: (w) => <b className="text-[12.5px] font-medium text-fg">{w.username}</b> },
                      { key: "role", head: "Role", render: (w) => <span className="font-mono text-[11px] text-fg-3">{w.role}</span> },
                      { key: "active", head: "Active", numeric: true, render: (w) => <span>{w.active_cases}</span> },
                      { key: "pending", head: "Pending", numeric: true, render: (w) => <span>{w.pending_reviews}</span> },
                    ]}
                    rows={ov.workload.map((w) => ({ ...w, id: w.username }))}
                    empty={
                      <div className="p-[14px]">
                        <Empty icon={MapPin} title="No active workload" body="Nobody holds an open case in this district." />
                      </div>
                    }
                  />
                </Panel>

                <Panel title="Top shared signals">
                  {ov.cross_case_top.length === 0 ? (
                    <p className="text-[12.5px] text-fg-3">No entity spans two or more cases here yet.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {ov.cross_case_top.map((c, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 py-[9px]">
                          <span className="min-w-0">
                            <span className="block truncate text-[12.5px] text-fg">{c.normalized}</span>
                            <span className="block font-mono text-[10.5px] text-fg-4">{c.node_type}</span>
                          </span>
                          <span className="font-mono text-[11px] text-fg-3">{c.cases} cases</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
