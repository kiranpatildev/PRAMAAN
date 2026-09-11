import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Legacy command-center tokens (kept: many components still use them).
        ink: { 950: "#0a0f1e", 900: "#0f172a", 800: "#1e293b", 700: "#334155" },
        risk: { low: "#22c55e", medium: "#f59e0b", high: "#ef4444" },
        // PRAMAAN intelligence-workspace system (lib/theme.ts is source of truth).
        base: "#0B0F17",
        surface: "#121826",
        surface2: "#1A2233",
        edge: "#1F2733",
        accent: "#3B82F6",
        verified: "#10B981",
        pending: "#F59E0B",
        critical: "#EF4444",
        body: "#E5E7EB",
        muted: "#8B93A1",
        entity: {
          person: "#3B82F6",
          phone: "#14B8A6",
          vehicle: "#F59E0B",
          location: "#22C55E",
          org: "#A855F7",
          txn: "#F97316",
          case: "#9CA3AF",
        },
      },
      fontFamily: {
        sans: ["Inter", '"IBM Plex Sans"', "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
