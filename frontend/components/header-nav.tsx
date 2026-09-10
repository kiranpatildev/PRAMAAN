"use client";

import { useI18n } from "@/lib/i18n";

/** Translated header nav (progressive: falls back to English per string). */
export function HeaderNav() {
  const { t } = useI18n();
  const links: [string, string, string][] = [
    ["/dashboard", "nav.dashboard", "Dashboard"],
    ["/cases", "nav.cases", "Cases"],
    ["/search", "nav.search", "Search"],
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
