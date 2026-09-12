"use client";

import React from "react";

export function Panel({ title, right, flush = false, className = "", children }: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`overflow-hidden rounded-md border border-line bg-panel ${className}`}>
      {title != null && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-[14px] py-3">
          <h3 className="text-[12.5px] font-medium text-fg">{title}</h3>
          {right}
        </div>
      )}
      <div className={flush ? "" : "p-[14px]"}>{children}</div>
    </section>
  );
}
