"use client";

import React from "react";
import { Info, AlertTriangle, Lock } from "lucide-react";

const BY_VARIANT = {
  info: { wrap: "border-cyan-br bg-cyan-bg", icon: <Info size={15} strokeWidth={1.6} className="text-cyan" /> },
  warn: { wrap: "border-amber-br bg-amber-bg", icon: <AlertTriangle size={15} strokeWidth={1.6} className="text-amber" /> },
  lock: { wrap: "border-line-2 bg-panel", icon: <Lock size={15} strokeWidth={1.6} className="text-fg-3" /> },
};

export function Notice({ variant = "info", children, action }: {
  variant?: keyof typeof BY_VARIANT;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const v = BY_VARIANT[variant];
  return (
    <div className={`flex items-start gap-3 rounded border p-[12px_14px] text-[12.5px] text-fg-2 ${v.wrap}`}>
      <span className="mt-[1px] shrink-0">{v.icon}</span>
      <span className="min-w-0 flex-1 leading-relaxed">{children}</span>
      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
}
