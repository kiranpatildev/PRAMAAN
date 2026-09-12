"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutGrid, Folder, ClipboardCheck, Users, Search, Sparkles, Bell, LogOut,
} from "lucide-react";
import { useSession, refreshSession } from "./useSession";
import { isSho, roleLabel } from "@/lib/auth";
import { sessionClock } from "@/lib/format";
import { Button } from "../ui/Button";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid, count: null as null | "cases" },
  { href: "/cases", label: "Cases", icon: Folder, count: "cases" as const },
  { href: "/my-cases", label: "My Cases", icon: ClipboardCheck, count: null },
  { href: "/team", label: "Team", icon: Users, count: null, sho: true },
  { href: "/search", label: "Search", icon: Search, count: null },
  { href: "/assistant", label: "AI Assistant", icon: Sparkles, count: null },
  { href: "/alerts", label: "Alerts", icon: Bell, count: "alerts" as const },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, casesCount, alertsCount } = useSession();
  const sho = isSho(user?.role);
  // Session clock is client-only: server/client timezones differ.
  const [clock, setClock] = useState("--:--");
  useEffect(() => {
    setClock(sessionClock());
    const t = setInterval(() => setClock(sessionClock()), 30000);
    return () => clearInterval(t);
  }, []);

  const items = NAV.filter((n) => (!n.sho || sho)).map((n) => ({
    ...n,
    label: n.href === "/cases" ? (sho ? "All Cases" : "Cases") : n.label,
    count: n.count === "cases" ? casesCount : n.count === "alerts" ? alertsCount : null,
  }));

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname?.startsWith(href + "/");

  async function signOut() {
    const { api } = await import("@/lib/api");
    api.logout();
    refreshSession();
    router.push("/login");
  }

  return (
    <aside className="sticky top-[52px] flex h-[calc(100vh-52px)] w-[216px] shrink-0 flex-col border-r border-line bg-bg-2 max-[980px]:hidden">
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Workspace">
        <p className="micro-label px-[9px] pb-2 pt-[6px]">Workspace</p>
        <ul className="space-y-[2px]">
          {items.map((n) => {
            const active = isActive(n.href);
            const Icon = n.icon;
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex h-[30px] items-center gap-[9px] rounded px-[9px] text-[12.5px] transition-colors duration-120 ${
                    active ? "bg-panel-2 text-fg" : "text-fg-2 hover:bg-panel-2 hover:text-fg"
                  }`}
                >
                  {active && (
                    <span className="absolute bottom-[7px] left-0 top-[7px] w-[2px] rounded-[1px] bg-cyan" aria-hidden />
                  )}
                  <Icon size={14} strokeWidth={1.6} className={active ? "text-cyan" : ""} aria-hidden />
                  <span className="flex-1">{n.label}</span>
                  {n.count != null && <span className="font-mono text-[10.5px] text-fg-3">{n.count}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-line p-3 pt-3">
        <dl className="space-y-[5px] font-mono text-[10.5px]">
          <div className="flex justify-between">
            <dt className="uppercase text-fg-4">Zone</dt>
            <dd className="text-fg-3">{user?.zone ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="uppercase text-fg-4">Role</dt>
            <dd className="uppercase text-fg-3">{roleLabel(user?.role)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="uppercase text-fg-4">Session</dt>
            <dd className="text-fg-3">{clock}</dd>
          </div>
        </dl>
        <Button variant="ghost" className="mt-3 w-full" onClick={signOut}>
          <LogOut size={14} strokeWidth={1.6} aria-hidden /> Sign out
        </Button>
      </div>
    </aside>
  );
}
