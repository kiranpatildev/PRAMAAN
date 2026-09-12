"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Segmented } from "../ui/Segmented";
import { Tag } from "../ui/Tag";
import { Empty } from "../ui/Empty";
import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { TimelineDetailPanel, classify, eventRangeLabel, type TEvent } from "./TimelineDetailPanel";
import { caseTimeline } from "@/lib/endpoints";
import { dayLabel, timeLabel } from "@/lib/format";
import type { TimelineEvent } from "@/lib/types";

const FILTERS = ["all", "communications", "transactions", "locations", "vehicles", "reports"] as const;
type Filter = (typeof FILTERS)[number];

export function TimelineTab({ caseId: cid, onSelectEntity }: {
  caseId: string | number;
  onSelectEntity: (label: string) => void;
}) {
  const [events, setEvents] = useState<TEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    setError("");
    caseTimeline(cid)
      .then((d) => {
        const list = ((d.events ?? []) as TimelineEvent[]).map((e, i) => ({
          ...e,
          _id: `E-${i + 1}`,
          _type: classify(e.type ?? e.label),
        })) as TEvent[];
        setEvents(list);
        if (selected && !list.some((e) => e._id === selected)) setSelected(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Timeline failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [cid]);

  const shown = useMemo(
    () => events.filter((e) => filter === "all" || e._type.toLowerCase() === filter),
    [events, filter]
  );
  const sel = shown.find((e) => e._id === selected) ?? null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] overflow-hidden rounded-md border border-line bg-panel max-[1100px]:grid-cols-1">
      <div className="min-w-0 border-r border-line max-[1100px]:border-r-0 max-[1100px]:border-b">
        <div className="flex flex-wrap items-center justify-between gap-[10px] border-b border-line px-[14px] py-[10px]">
          <Segmented<Filter>
            options={FILTERS.map((f) => ({ value: f, label: f === "all" ? "All" : f[0].toUpperCase() + f.slice(1) }))}
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setSelected(null);
            }}
          />
          <span className="micro-label">{shown.length ? eventRangeLabel(shown) : "0 events"}</span>
        </div>

        <div className="max-h-[640px] overflow-y-auto p-[14px]">
          {error && (
            <Notice variant="warn" action={<Button variant="ghost" small onClick={refresh}>Retry</Button>}>
              {error}
            </Notice>
          )}
          {!loading && shown.length === 0 && !error && (
            <Empty icon={CalendarDays} title="No events yet" body="Dated relationships appear here as the queue gets confirmed." />
          )}
          <ol>
            {shown.map((e) => {
              const on = selected === e._id;
              const names = [e.from, e.to].filter(Boolean) as string[];
              return (
                <li key={e._id}>
                  <button
                    type="button"
                    onClick={() => setSelected(on ? null : e._id)}
                    className={`grid w-full grid-cols-[70px_14px_1fr] gap-[10px] rounded-[3px] px-2 py-[10px] text-left transition-colors duration-120 ${
                      on ? "bg-panel-2" : "hover:bg-panel-2"
                    }`}
                    style={on ? { boxShadow: "inset 2px 0 0 #00d9ff" } : undefined}
                  >
                    <span className="font-mono text-[11px]">
                      <span className="block font-medium text-fg-2">{dayLabel(e.valid_from ?? "")}</span>
                      <span className="block text-fg-3">{timeLabel(e.valid_from ?? "")}</span>
                    </span>
                    <span className="flex justify-center pt-[3px]" aria-hidden>
                      <span
                        className="h-[7px] w-[7px] rounded-full"
                        style={
                          on
                            ? { background: "#00d9ff" }
                            : { background: "transparent", border: "1px solid #2f3b4d" }
                        }
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="text-[13px] font-medium text-fg">
                        {e.title ?? `${e.from ?? ""} — ${e.to ?? ""}`}{" "}
                        <Tag tone="muted">{e._type}</Tag>
                      </span>
                      {(e.desc ?? e.snippet) && (
                        <span className="mt-[3px] block text-[12.5px] text-fg-3">{e.desc ?? e.snippet}</span>
                      )}
                      {names.length > 0 && (
                        <span className="mt-[6px] flex flex-wrap gap-[6px]">
                          {names.map((n) => (
                            <span
                              key={n}
                              className="rounded-[3px] border border-line-2 px-[6px] py-px font-mono text-[10.5px] text-fg-3 transition-colors duration-120 hover:border-cyan-br hover:text-cyan"
                            >
                              {n}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <aside className="bg-panel-2">
        <TimelineDetailPanel event={sel} onSelectEntity={onSelectEntity} />
      </aside>
    </div>
  );
}
