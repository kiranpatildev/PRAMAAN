import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LangProvider } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { OnlineBanner } from "@/components/online-status";

export const metadata: Metadata = {
  title: "PRAMAAN — Criminal Network Analysis",
  description: "Evidence-backed temporal knowledge graph for investigations.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0b0f17",
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <LangProvider>
          <AppShell>
            <OnlineBanner />
            {children}
          </AppShell>
        </LangProvider>
      </body>
    </html>
  );
}
