"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

function crumbsFor(pathname: string): { label: string; href?: string }[] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "cases" && parts[1]) {
    return [
      { label: "Console", href: "/dashboard" },
      { label: "Cases", href: "/cases" },
      { label: `C-${parts[1]}` },
    ];
  }
  const single: Record<string, string> = {
    dashboard: "Console",
    cases: "Cases",
    "my-cases": "My Cases",
    team: "Team",
    search: "Search",
    assistant: "AI Assistant",
    alerts: "Alerts",
    login: "Sign in",
  };
  const first = parts[0] ?? "dashboard";
  if (first === "dashboard") return [{ label: "Console" }];
  return [{ label: "Console", href: "/dashboard" }, { label: single[first] ?? first }];
}

export function Crumbs() {
  const pathname = usePathname();
  const crumbs = crumbsFor(pathname ?? "/dashboard");
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-[7px] text-[12.5px] text-fg-3">
      {crumbs.map((c, i) => (
        <Fragment key={`${c.label}-${i}`}>
          {i > 0 && <span className="text-fg-4">/</span>}
          {c.href && i < crumbs.length - 1 ? (
            <Link href={c.href} className="transition-colors duration-120 hover:text-fg">
              {c.label}
            </Link>
          ) : (
            <span className={i === crumbs.length - 1 ? "font-medium text-fg" : ""}>{c.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
