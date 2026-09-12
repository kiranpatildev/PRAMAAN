"use client";

export interface Kpi {
  label: string;
  dot: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  monoValue?: boolean;
  valueClass?: string;
}

export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <div className="flex rounded-md border border-line bg-panel">
      {items.map((k, i) => (
        <div
          key={k.label}
          className={`flex-1 px-4 py-[14px] ${i > 0 ? "border-l border-line" : ""}`}
        >
          <p className="flex items-center gap-[7px] font-mono text-[9.5px] uppercase tracking-[0.12em] text-fg-4">
            <span className="h-[5px] w-[5px] rounded-full" style={{ background: k.dot }} aria-hidden />
            {k.label}
          </p>
          <p
            className={`mt-[6px] text-[22px] font-medium leading-none tracking-[-0.02em] text-fg ${
              k.monoValue === false ? "" : "font-mono"
            } ${k.valueClass ?? ""}`}
          >
            {k.value}
          </p>
          {k.sub != null && <p className="mt-[5px] text-[11.5px] text-fg-3">{k.sub}</p>}
        </div>
      ))}
    </div>
  );
}
