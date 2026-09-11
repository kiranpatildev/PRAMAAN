/** PRAMAAN design tokens — single source of truth for the dark
 *  intelligence-workspace system. Tailwind classes derive from
 *  tailwind.config.ts (same hexes); import these maps when a component
 *  needs a color in JS (cytoscape, maplibre, inline styles). */

export const COLOR = {
  bg: "#0B0F17",
  surface: "#121826",
  surface2: "#1A2233",
  border: "#1F2733",
  accent: "#3B82F6",
  verified: "#10B981",
  pending: "#F59E0B",
  critical: "#EF4444",
  text: "#E5E7EB",
  muted: "#8B93A1",
} as const;

/** Entity-type palette — consistent in graph nodes, badges, tags, map. */
export const ENTITY_COLOR: Record<string, string> = {
  Person: "#3B82F6",
  Phone: "#14B8A6",
  PhoneNumber: "#14B8A6",
  Vehicle: "#F59E0B",
  Location: "#22C55E",
  Address: "#22C55E",
  Organization: "#A855F7",
  Transaction: "#F97316",
  Bank: "#F97316",
  Case: "#9CA3AF",
  Event: "#9CA3AF",
};

export function entityColor(type: string): string {
  return ENTITY_COLOR[type] ?? "#9CA3AF";
}

/** Relationship-type colors for the graph control panel. */
export const REL_COLOR: Record<string, string> = {
  USES: "#3B82F6",
  CONTACTED: "#14B8A6",
  OWNS: "#F59E0B",
  VISITED: "#22C55E",
  ASSOCIATED_WITH: "#A855F7",
  TRANSFERRED_TO: "#F97316",
  MENTIONED_IN: "#9CA3AF",
};

export function relColor(type: string): string {
  return REL_COLOR[type] ?? "#8B93A1";
}

export const RISK_COLOR: Record<string, string> = {
  high: COLOR.critical,
  medium: COLOR.pending,
  low: COLOR.muted,
};

export const STATUS_STYLE: Record<string, string> = {
  active: "text-[#3B82F6] border-[#3B82F6]/40 bg-[#3B82F6]/10",
  pending_review: "text-[#F59E0B] border-[#F59E0B]/40 bg-[#F59E0B]/10",
  closed: "text-[#8B93A1] border-[#8B93A1]/40 bg-[#8B93A1]/10",
  confirmed: "text-[#10B981] border-[#10B981]/40 bg-[#10B981]/10",
  CONFIRMED: "text-[#10B981] border-[#10B981]/40 bg-[#10B981]/10",
  rejected: "text-[#EF4444] border-[#EF4444]/40 bg-[#EF4444]/10",
  REJECTED: "text-[#EF4444] border-[#EF4444]/40 bg-[#EF4444]/10",
  pending: "text-[#F59E0B] border-[#F59E0B]/40 bg-[#F59E0B]/10",
  PENDING: "text-[#F59E0B] border-[#F59E0B]/40 bg-[#F59E0B]/10",
};

export function statusStyle(status: string): string {
  return STATUS_STYLE[status] ?? "text-[#8B93A1] border-[#8B93A1]/40 bg-[#8B93A1]/10";
}

/** Uppercase muted section label, e.g. "WORKSPACE", "NAVIGATE". */
export const SECTION_LABEL = "font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]";

export const FONT = {
  sans: 'Inter, "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;
