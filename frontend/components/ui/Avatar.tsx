"use client";

import { initials } from "@/lib/format";

export function Avatar({ name, lg = false, className = "" }: {
  name?: string | null;
  lg?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center border border-line-2 bg-panel-3 font-mono font-semibold text-fg-2 ${
        lg ? "h-[30px] w-[30px] rounded text-[11px]" : "h-[22px] w-[22px] rounded-[3px] text-[10px]"
      } ${className}`}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ names, max = 4 }: { names: (string | undefined | null)[]; max?: number }) {
  const shown = names.filter(Boolean).slice(0, max) as string[];
  const extra = names.length - shown.length;
  return (
    <span className="inline-flex items-center">
      {shown.map((n, i) => (
        <span key={`${n}-${i}`} style={{ marginLeft: i === 0 ? 0 : -6 }} className={i > 0 ? "[&>span]:bg-panel-2" : ""}>
          <Avatar name={n} />
        </span>
      ))}
      {extra > 0 && (
        <span
          style={{ marginLeft: -6 }}
          className="inline-flex h-[22px] items-center justify-center rounded-[3px] border border-line-2 bg-panel-2 px-1 font-mono text-[10px] text-fg-3"
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
