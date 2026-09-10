import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Command-center tokens: deep navy/charcoal + risk accents
        ink: { 950: "#0a0f1e", 900: "#0f172a", 800: "#1e293b", 700: "#334155" },
        risk: { low: "#22c55e", medium: "#f59e0b", high: "#ef4444" },
        accent: "#38bdf8",
      },
    },
  },
  plugins: [],
};

export default config;
