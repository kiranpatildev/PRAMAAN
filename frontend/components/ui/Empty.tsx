"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";

export function Empty({ icon: Icon, title, body, action }: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-line-2 px-6 py-[60px] text-center">
      <Icon size={24} strokeWidth={1.6} className="mx-auto text-fg-4" aria-hidden />
      <p className="mx-auto mt-3 max-w-[400px] text-[13.5px] font-medium text-fg">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-[400px] text-[12.5px] text-fg-3">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
