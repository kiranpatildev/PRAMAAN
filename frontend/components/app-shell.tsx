"use client";

/** Persistent PRAMAAN app shell: collapsible sidebar + global topbar.
 *  The login route renders bare (full-bleed split screen, no chrome). */
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Icon, Avatar, RoleChip, SectionLabel } from "@/components/ui";
import { AlertsBell } from "@/components/alerts-bell";
import { LangToggle } from "@/lib/i18n";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/cases", label: "Cases", icon: "cases" },
  { href: "/my-cases", label: "My Cases", icon: "user" },
  { href: "/search", label: "Search", icon: "search" },
  { href: "/copilot", label: "AI Copilot", icon: "spark" },
  { href: "/alerts", label: "Alerts", icon: "bell" },
];

function useMe() {
  const [me, setMe] = useState<{ username?: string; role?: string } | null>(null);
  useEffect(() => {
    api.ensureFreshToken().finally(() => {
      api.me().then(setMe).catch(() => {});
    });
  }, []);
  return me;
}

function useUnreadCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    api.notifications(true).then((d) => setN((d.results ?? d).length ?? 0)).catch(() => {});
    const t = setInterval(() => {
      api.notifications(true).then((d) => setN((d.results ?? d).length ?? 0)).catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, []);
  return n;
}

function TopSearch() {
  const [q, setQ] = useState("");
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
      className="relative hidden min-w-0 flex-1 items-center sm:flex"
      style={{ maxWidth: 420 }}
    >
      <Icon name="search" className="pointer-events-none absolute left-3 h-4 w-4 text-[#8B93A1]" />
      <input
        id="global-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search entities, evidence, cases…"
        aria-label="Global search"
        className="input !py-1.5 !pl-9 !pr-12 text-xs"
      />
      <kbd className="pointer-events-none absolute right-3 rounded border border-[#1F2733] px-1.5 py-0.5 font-mono text-[10px] text-[#8B93A1]">
        ⌘K
      </kbd>
    </form>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const unread = useUnreadCount();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem("pramaan_sidebar") === "collapsed");
    } catch { /* ignore */ }
  }, []);

  function toggleCollapse() {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem("pramaan_sidebar", c ? "expanded" : "collapsed");
      } catch { /* ignore */ }
      return !c;
    });
  }

  if (pathname === "/login" || pathname?.startsWith("/login")) {
    return <>{children}</>;
  }

  const inCase = pathname?.startsWith("/cases/");
  const isActive = (href: string) =>
    href === "/cases" ? pathname === "/cases" : pathname === href || pathname?.startsWith(href + "/");

  return (
    <div className="flex min-h-screen bg-[#0B0F17]">
      {/* ---------- sidebar ---------- */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-[#1F2733] bg-[#0D1117] transition-all md:flex ${collapsed ? "w-16" : "w-60"}`}
      >
        <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#3B82F6]/15 text-[#3B82F6]">
            <Icon name="shield" className="h-5 w-5" />
          </span>
          {!collapsed && (
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[15px] font-bold tracking-[0.12em]">PRAMAAN</span>
              <span className="font-mono text-[10px] text-[#8B93A1]">IIP V2.4</span>
            </span>
          )}
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5" aria-label="Primary">
          {!collapsed && <SectionLabel className="px-2 pb-1.5 pt-1">{inCase ? "Workspace" : "Navigation"}</SectionLabel>}
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                isActive(item.href)
                  ? "bg-[#3B82F6]/12 font-semibold text-[#3B82F6]"
                  : "text-[#8B93A1] hover:bg-[#1A2233] hover:text-[#E5E7EB]"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <Icon name={item.icon} className="h-[18px] w-[18px]" />
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {!collapsed && item.href === "/alerts" && unread > 0 && (
                <span className="rounded-full bg-[#EF4444] px-1.5 font-mono text-[10px] font-bold text-white">
                  {unread}
                </span>
              )}
              {collapsed && item.href === "/alerts" && unread > 0 && (
                <span className="absolute ml-6 mt-[-18px] rounded-full bg-[#EF4444] px-1 font-mono text-[9px] font-bold text-white">
                  {unread}
                </span>
              )}
            </a>
          ))}
        </nav>

        <div className="border-t border-[#1F2733] p-2.5">
          <button
            onClick={toggleCollapse}
            className="mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-[#8B93A1] hover:bg-[#1A2233] hover:text-[#E5E7EB]"
            title={collapsed ? "Expand sidebar" : "Collapse to icons"}
          >
            <Icon name={collapsed ? "chevR" : "logout"} className={`h-4 w-4 ${collapsed ? "" : "rotate-180"}`} />
            {!collapsed && <span>Collapse</span>}
          </button>
          {me?.username ? (
            <div className={`flex items-center gap-2.5 rounded-lg bg-[#121826] p-2.5 ${collapsed ? "justify-center" : ""}`}>
              <Avatar name={me.username} />
              {!collapsed && (
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13px] font-semibold">{me.username}</span>
                  <span className="mt-0.5 block"><RoleChip role={me.role} /></span>
                </span>
              )}
              {!collapsed && (
                <button
                  onClick={() => { api.logout(); router.push("/login"); }}
                  className="rounded-md p-1.5 text-[#8B93A1] hover:bg-[#1A2233] hover:text-[#E5E7EB]"
                  title="Sign out"
                >
                  <Icon name="logout" className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : (
            !collapsed && (
              <a href="/login" className="btn-ghost w-full !py-1.5 text-xs">Sign in</a>
            )
          )}
        </div>
      </aside>

      {/* ---------- right column ---------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-[#1F2733] bg-[#0B0F17]/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2.5 lg:px-6">
            <TopSearch />
            <span className="flex-1 sm:hidden" />
            <span className="hidden items-center gap-1.5 text-xs text-[#10B981] xl:inline-flex" title="All data shown comes from authorized investigation records">
              <Icon name="shield" className="h-3.5 w-3.5" />
              Authorized investigation data only
            </span>
            <span className="hidden rounded border border-[#1F2733] px-2 py-1 font-mono text-[10px] font-semibold tracking-wider text-[#8B93A1] md:inline-block"
              title="Every mutating action is written to the immutable audit log">
              SESSION · AUDITED
            </span>
            <span className="flex items-center gap-1 border-l border-[#1F2733] pl-2">
              <LangToggle />
              <ThemeToggle />
            </span>
            <AlertsBell />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-6">
          <nav className="mb-4 flex gap-1 overflow-x-auto pb-1 md:hidden" aria-label="Primary">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold ${isActive(item.href) ? "border-[#3B82F6] text-[#3B82F6]" : "border-[#1F2733] text-[#8B93A1]"}`}
              >
                {item.label}
              </a>
            ))}
          </nav>
          {children}
        </main>
      </div>
    </div>
  );
}
