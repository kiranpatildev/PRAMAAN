import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AlertsBell } from "@/components/alerts-bell";
import { LangProvider } from "@/lib/i18n";
import { ThemeToggle } from "@/components/theme-toggle";
import { LangToggle } from "@/lib/i18n";
import { HeaderNav } from "@/components/header-nav";
import { OnlineBanner } from "@/components/online-status";

export const metadata: Metadata = {
  title: "PRAMAAN — Criminal Network Analysis",
  description: "Evidence-backed temporal knowledge graph for investigations.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0a0f1e",
  width: "device-width",
  initialScale: 1,
};

// Pre-hydration theme: avoids a dark-flash for light-theme users.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("pramaan_theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <LangProvider>
          <div className="min-h-screen bg-ink-950">
            <header className="border-b border-ink-700 bg-ink-900/80">
              <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="text-lg font-bold tracking-wide">
                  PRAMAAN <span className="text-accent text-sm font-normal">· network analysis</span>
                </span>
                <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-300">
                  <HeaderNav />
                  <span className="flex items-center gap-2">
                    <LangToggle />
                    <ThemeToggle />
                    <AlertsBell />
                  </span>
                </nav>
              </div>
            </header>
            <OnlineBanner />
            <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
          </div>
        </LangProvider>
      </body>
    </html>
  );
}
