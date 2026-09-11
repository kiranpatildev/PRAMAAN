"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** Small role badge tinted with the login-door accent (amber SHO, teal investigator). */
export function RoleBadge() {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    api.me().then((m) => setRole(m.role ?? null)).catch(() => {});
  }, []);

  if (!role) return null;
  const isInv = role === "investigator";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${isInv ? "border-teal-300 text-teal-300" : "border-amber-400 text-amber-400"}`}>
      {isInv ? "Investigator" : "Supervisor"}
    </span>
  );
}
