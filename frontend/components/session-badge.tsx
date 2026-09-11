"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** Session/audit indicator: who you are, and that every action is logged. */
export function SessionBadge() {
  const [me, setMe] = useState<{ username?: string; role?: string } | null>(null);

  useEffect(() => {
    api.me().then(setMe).catch(() => {});
  }, []);

  if (!me?.username) return null;
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-ink-700 px-2.5 py-0.5 text-xs text-slate-400 sm:inline-flex"
      title={`Signed in as ${me.username} (${me.role}) — every mutating action is written to the immutable audit log`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-risk-low" />
      {me.username} · audited
    </span>
  );
}
