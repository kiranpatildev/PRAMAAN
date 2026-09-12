import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0e14",
        "bg-2": "#0d1117",
        panel: "#0d1117",
        "panel-2": "#111820",
        "panel-3": "#161d26",
        line: "#1a222d",
        "line-2": "#232d3a",
        "line-3": "#2f3b4d",
        fg: "#e6edf3",
        "fg-2": "#a3b1c2",
        "fg-3": "#6b7a8f",
        "fg-4": "#48546a",
        cyan: "#00d9ff",
        "cyan-2": "#4de6ff",
        "cyan-bg": "rgba(0,217,255,.09)",
        "cyan-br": "rgba(0,217,255,.32)",
        green: "#4ade80",
        "green-bg": "rgba(74,222,128,.10)",
        "green-br": "rgba(74,222,128,.32)",
        amber: "#fbbf24",
        "amber-bg": "rgba(251,191,36,.10)",
        "amber-br": "rgba(251,191,36,.32)",
        red: "#f87171",
        "red-bg": "rgba(248,113,113,.10)",
        "red-br": "rgba(248,113,113,.32)",
        violet: "#a78bfa",
        orange: "#fb923c",
        magenta: "#e879f9",
      },
      fontFamily: {
        ui: ["var(--font-ui)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xs: "3px",
        sm: "4px",
        md: "6px",
      },
      height: {
        btn: "30px",
        "btn-sm": "26px",
        input: "32px",
        nav: "30px",
        topbar: "52px",
      },
      width: {
        sidebar: "216px",
      },
    },
  },
  plugins: [],
};

export default config;
