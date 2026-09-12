"use client";

import React from "react";

type Tone = "green" | "muted" | "red" | "amber" | "cyan" | "violet" | "orange" | "magenta";

const BY_TONE: Record<Tone, string> = {
  green: "border-green-br bg-green-bg text-green",
  muted: "border-line-2 bg-panel-2 text-fg-3",
  red: "border-red-br bg-red-bg text-red",
  amber: "border-amber-br bg-amber-bg text-amber",
  cyan: "border-cyan-br bg-cyan-bg text-cyan",
  violet: "border-violet/40 bg-violet/10 text-violet",
  orange: "border-orange/40 bg-orange/10 text-orange",
  magenta: "border-magenta/40 bg-magenta/10 text-magenta",
};

/** 18px mono uppercase tag with a 4px currentColor dot. */
export function Tag({ tone = "muted", className = "", children }: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-[18px] items-center gap-[5px] rounded-[3px] border px-[6px] font-mono text-[10px] font-medium uppercase tracking-[0.05em] ${BY_TONE[tone]} ${className}`}
    >
      <span className="h-1 w-1 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

/** Status/risk shorthands used across tables. */
export function StatusTag({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase();
  if (["active", "open", "confirmed", "verified", "done"].includes(s)) return <Tag tone="green">{status}</Tag>;
  if (["closed", "muted", "rejected", "todo"].includes(s)) return <Tag tone="muted">{status}</Tag>;
  if (["high", "critical"].includes(s)) return <Tag tone="red">{status}</Tag>;
  if (["medium", "pending", "pending_review", "doing", "processing", "queued"].includes(s))
    return <Tag tone="amber">{status}</Tag>;
  if (["low"].includes(s)) return <Tag tone="green">{status}</Tag>;
  return <Tag tone="muted">{status ?? "—"}</Tag>;
}
