"use client";

export function Segmented<T extends string>({ options, value, onChange, className = "" }: {
  options: readonly T[] | { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const norm = options.map((o) => (typeof o === "string" ? { value: o as T, label: o } : o));
  return (
    <span className={`inline-flex h-8 items-center overflow-hidden rounded border border-line-2 bg-panel-2 ${className}`}>
      {norm.map((o, i) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`h-full px-3 font-mono text-[11.5px] uppercase tracking-[0.02em] transition-colors duration-120 ${
            i > 0 ? "border-l border-line-2" : ""
          } ${value === o.value ? "bg-panel-3 text-cyan" : "text-fg-3 hover:bg-panel-3 hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
