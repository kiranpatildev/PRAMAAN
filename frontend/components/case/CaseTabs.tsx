"use client";

export type CaseTabId =
  | "overview" | "team" | "evidence" | "entities" | "network"
  | "timeline" | "cross" | "notes" | "audit";

export interface TabDef {
  id: CaseTabId;
  label: string;
  count?: number;
  sho?: boolean;
}

export function CaseTabs({ tabs, active, onChange }: {
  tabs: TabDef[];
  active: CaseTabId;
  onChange: (t: CaseTabId) => void;
}) {
  return (
    <div className="mb-5 overflow-x-auto border-b border-line" role="tablist" aria-label="Case sections">
      <div className="flex min-w-max">
        {tabs.map((t) => {
          const on = active === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.id)}
              className={`relative flex items-center gap-[7px] px-[15px] py-[11px] text-[12.5px] transition-colors duration-120 ${
                on ? "text-fg" : "text-fg-3 hover:text-fg"
              }`}
            >
              {t.label}
              {t.count != null && (
                <span
                  className={`rounded-[3px] border px-[5px] py-px font-mono text-[10px] ${
                    on ? "border-cyan-br text-cyan" : "border-line-2 text-fg-4"
                  }`}
                >
                  {t.count}
                </span>
              )}
              {on && <span className="absolute inset-x-0 bottom-[-1px] h-[1.5px] bg-cyan" aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
