"use client";

import React from "react";

/** Standard page header: eyebrow + H1 + sub left, actions right. */
export function PageHeader({ eyebrow, title, sub, actions }: {
  eyebrow: string;
  title: string;
  sub?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="ph">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="ph-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {sub && <p className="ph-sub">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
