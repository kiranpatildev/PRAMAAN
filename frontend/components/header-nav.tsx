"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";

/** Translated header nav (progressive: falls back to English per string). */
export function HeaderNav() {
  const { t } = useI18n();
  const links: [string, string, string][] = [
    ["/dashboard", "nav.dashboard", "Dashboard"],
    ["/cases", "nav.cases", "Cases"],
    ["/alerts", "nav.alerts", "Alerts"],
    ["/login", "nav.login", "Login"],
  ];
  return (
    <>
      {links.map(([href, key, fb]) => (
        <a key={href} href={href} className="hover:text-accent">
          {t(key, fb)}
        </a>
      ))}
    </>
  );
}

/** Compact global search for the top bar (full results live on /search). */
export function TopSearch() {
  const [q, setQ] = useState("");
  const router = useRouter();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
      className="hidden items-center md:flex"
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search…"
        aria-label="Global search"
        className="input !w-40 !py-1 text-xs"
      />
    </form>
  );
}
