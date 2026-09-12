"use client";

import { useRouter } from "next/navigation";
import { Search, Bell } from "lucide-react";
import { Crumbs } from "./Crumbs";
import { Avatar } from "../ui/Avatar";
import { useSession } from "./useSession";
import { displayName, roleLabel } from "@/lib/auth";

export function BrandMark({ size = 11 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 bg-cyan"
      style={{ width: size, height: size, clipPath: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" }}
    />
  );
}

export function Topbar() {
  const router = useRouter();
  const { user, unread } = useSession();

  return (
    <header className="sticky top-0 z-40 flex h-[52px] items-center gap-3 border-b border-line bg-bg-2 px-4">
      <span className="flex items-center gap-2">
        <BrandMark />
        <span className="text-[13.5px] font-semibold text-fg">Pramaan</span>
      </span>
      <span className="h-5 w-px bg-line-2" aria-hidden />
      <span className="min-w-0 flex-1">
        <Crumbs />
      </span>

      <button
        type="button"
        onClick={() => router.push("/search")}
        className="flex h-7 items-center gap-2 rounded border border-line bg-panel-2 px-[10px] text-fg-3 transition-colors duration-120 hover:border-line-2 hover:text-fg"
      >
        <Search size={13} strokeWidth={1.6} aria-hidden />
        <span className="text-[12px]">Search</span>
        <kbd className="rounded-[3px] border border-line-2 px-1 font-mono text-[10px] text-fg-4">⌘K</kbd>
      </button>

      <button
        type="button"
        onClick={() => router.push("/alerts")}
        aria-label="Alerts"
        className="relative flex h-7 w-7 items-center justify-center rounded border border-line bg-panel-2 text-fg-3 transition-colors duration-120 hover:border-line-2 hover:text-fg"
      >
        <Bell size={14} strokeWidth={1.6} aria-hidden />
        {unread > 0 && (
          <span
            className="absolute right-[6px] top-[5px] h-[5px] w-[5px] rounded-full bg-red"
            style={{ border: "1.5px solid #0d1117" }}
            aria-label={`${unread} unread`}
          />
        )}
      </button>

      <span className="h-5 w-px bg-line-2" aria-hidden />

      <span className="flex items-center gap-2">
        <Avatar name={user ? displayName(user) : "?"} />
        <span className="leading-tight">
          <span className="block text-[12.5px] font-medium text-fg">{user ? displayName(user) : "…"}</span>
          <span className="block font-mono text-[10px] uppercase text-fg-3">{roleLabel(user?.role)}</span>
        </span>
      </span>
    </header>
  );
}
