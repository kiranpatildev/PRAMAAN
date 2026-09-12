"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { Sidebar } from "@/components/shell/Sidebar";
import { ToastProvider } from "@/components/ui/Toast";

function MobileNav() {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line bg-bg-2 px-3 py-2 min-[981px]:hidden" aria-label="Workspace">
      {[
        ["Dashboard", "/dashboard"],
        ["Cases", "/cases"],
        ["My Cases", "/my-cases"],
        ["Search", "/search"],
        ["AI Assistant", "/assistant"],
        ["Alerts", "/alerts"],
      ].map(([label, href]) => (
        <a
          key={href}
          href={href}
          className="shrink-0 rounded border border-line px-2.5 py-1 text-[12px] text-fg-2"
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        router.push("/search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <ToastProvider>
      <Topbar />
      <div className="flex items-start">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <MobileNav />
          <main className="route-in mx-auto w-full max-w-[1400px] px-6 pb-[60px] pt-5">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
