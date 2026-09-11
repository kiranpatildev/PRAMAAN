"use client";

/** Shared PRAMAAN UI primitives: outline icon set + panels, cards, states.
 *  Import from here in every redesigned screen so styling never drifts. */
import React from "react";
import { statusStyle, SECTION_LABEL } from "@/lib/theme";

/* ---------------- outline icon set (stroke = currentColor) ---------------- */

const PATHS: Record<string, React.ReactNode> = {
  dashboard: (<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>),
  cases: (<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></>),
  user: (<><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1.2-3.2 3.9-5 7-5s5.8 1.8 7 5" /></>),
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>),
  spark: (<><path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" /></>),
  bell: (<><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 20a2 2 0 0 0 4 0" /></>),
  logout: (<><path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M10 8l-4 4 4 4M6 12h11" /></>),
  shield: (<><path d="M12 3 5 6v5c0 5 3.4 8.4 7 10 3.6-1.6 7-5 7-10V6l-7-3Z" /><path d="m9.5 12 2 2 3.5-4" /></>),
  doc: (<><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>),
  network: (<><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8 7.5 10.5 16M16 7.5 13.5 16M8.5 6h7" /></>),
  warn: (<><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4M12 17.5v.5" /></>),
  check: (<path d="m5 13 4 4L19 7" />),
  x: (<path d="M6 6l12 12M18 6 6 18" />),
  chevR: (<path d="m9 6 6 6-6 6" />),
  chevD: (<path d="m6 9 6 6 6-6" />),
  plus: (<path d="M12 5v14M5 12h14" />),
  minus: (<path d="M5 12h14" />),
  fit: (<><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></>),
  focus: (<><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /><path d="M12 1v3M12 20v3M1 12h3M20 12h3" /></>),
  expand: (<><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" /><circle cx="12" cy="12" r="2" /></>),
  filter: (<path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" />),
  reset: (<><path d="M4 10a8 8 0 1 1 2 6" /><path d="M4 4v6h6" /></>),
  clock: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>),
  pin: (<><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></>),
  link: (<><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1.5 1.5M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1.5-1.5" /></>),
  note: (<><path d="M5 4h14v12H9l-4 4V4Z" /><path d="M9 9h6M9 12.5h4" /></>),
  eye: (<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: (<><path d="M4 4l16 16M9.9 6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 3.9M6 8.5A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.1 0 2.2-.2 3.1-.6" /></>),
  lock: (<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>),
  idcard: (<><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="11" r="2" /><path d="M5.5 16.5c.6-1.6 1.7-2.5 3-2.5s2.4.9 3 2.5M14 9.5h4M14 13h4" /></>),
  arrowR: (<path d="M4 12h15m-6-7 7 7-7 7" />),
  refresh: (<><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 3v5h-5" /></>),
  dot: (<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />),
  route: (<><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" strokeDasharray="3 2" /></>),
  download: (<><path d="M12 4v11m-5-4 5 5 5-5M4 20h16" /></>),
  tag: (<><path d="M3.5 12V4.5A1 1 0 0 1 4.5 3.5H12L20.5 12a1.4 1.4 0 0 1 0 2L14 20.5a1.4 1.4 0 0 1-2 0L3.5 12Z" /><circle cx="8.5" cy="8.5" r="1.2" /></>),
};

export function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof PATHS | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      {PATHS[name] ?? PATHS.dot}
    </svg>
  );
}

/* ---------------- primitives ---------------- */

export function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`${SECTION_LABEL} ${className}`}>{children}</p>;
}

export function Panel({ title, count, right, children, className = "" }: {
  title?: React.ReactNode; count?: number | string; right?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-lg border border-[#1F2733] bg-[#121826] p-5 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#E5E7EB]">
            {title}
            {count !== undefined && (
              <span className="ml-2 font-mono text-xs font-normal text-[#8B93A1]">({count})</span>
            )}
          </h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, sub, icon, tone = "#E5E7EB" }: {
  label: string; value: React.ReactNode; sub?: string; icon?: string; tone?: string;
}) {
  return (
    <div className="rounded-lg border border-[#1F2733] bg-[#121826] p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]">{label}</p>
        {icon && <Icon name={icon} className="h-4 w-4 text-[#8B93A1]" />}
      </div>
      <p className="mt-2 font-mono text-3xl font-bold" style={{ color: tone }}>{value}</p>
      {sub && <p className="mt-1 text-xs text-[#8B93A1]">{sub}</p>}
    </div>
  );
}

export function Pill({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold ${className}`}>
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <Pill className={statusStyle(status)}>{String(status).replace(/_/g, " ").toUpperCase()}</Pill>;
}

export function RiskText({ level }: { level: string }) {
  const color = level === "high" ? "#EF4444" : level === "medium" ? "#F59E0B" : "#8B93A1";
  return <span className="font-mono text-xs font-bold" style={{ color }}>{level.toUpperCase()}</span>;
}

export function Avatar({ name, size = "h-8 w-8 text-xs" }: { name: string; size?: string }) {
  const initials = name.replace(/[^a-zA-Z ]/g, "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${size}`}
      style={{ background: `linear-gradient(135deg, hsl(${h} 45% 38%), hsl(${(h + 40) % 360} 45% 30%))` }}>
      {initials}
    </span>
  );
}

export function RoleChip({ role }: { role?: string }) {
  const isInv = role === "investigator";
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${isInv ? "border-[#14B8A6]/50 text-[#14B8A6]" : "border-[#F59E0B]/50 text-[#F59E0B]"}`}>
      {isInv ? "Investigator" : role === "admin" ? "Admin" : "SHO"}
    </span>
  );
}

export function ProgressBar({ pct, color = "#3B82F6", className = "" }: { pct: number; color?: string; className?: string }) {
  return (
    <span className={`block h-1.5 overflow-hidden rounded-full bg-[#1F2733] ${className}`}>
      <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </span>
  );
}

/** Calm expected-state panel — never a raw error string. */
export function EmptyState({ icon = "search", title, hint, action }: {
  icon?: string; title: string; hint?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-[#1F2733] px-4 py-8 text-center">
      <Icon name={icon} className="h-6 w-6 text-[#8B93A1]" />
      <p className="text-sm font-medium text-[#E5E7EB]">{title}</p>
      {hint && <p className="max-w-md text-xs leading-relaxed text-[#8B93A1]">{hint}</p>}
      {action}
    </div>
  );
}

/** Error panel with retry — used for genuine failures (never auth expiry). */
export function ErrorState({ title = "Couldn't load this panel", detail, onRetry }: {
  title?: string; detail?: string; onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/5 px-4 py-8 text-center">
      <Icon name="warn" className="h-6 w-6 text-[#EF4444]" />
      <p className="text-sm font-medium text-[#E5E7EB]">{title}</p>
      {detail && <p className="max-w-md font-mono text-[11px] leading-relaxed text-[#8B93A1]">{detail}</p>}
      {onRetry && (
        <button onClick={onRetry} className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-[#1F2733] px-3 py-1.5 text-xs font-semibold text-[#E5E7EB] hover:border-[#3B82F6]">
          <Icon name="refresh" className="h-3.5 w-3.5" /> Retry
        </button>
      )}
    </div>
  );
}

/** Friendly fetch-error classifier: session issues are already handled by the
 *  api layer (redirect); anything reaching here is a real failure. */
export function friendlyError(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/session expired|sign in again/i.test(msg)) return "Session expired — please sign in again.";
  if (/failed to fetch|network|load failed/i.test(msg)) return `${fallback} (network unreachable — retry in a moment)`;
  return msg.length > 220 ? `${fallback}.` : msg;
}

/** 4-segment pipeline bar: Upload → Extract → Verify → Network ready. */
export function PipelineMini({ evidence, entities, relations, status }: {
  evidence: number; entities: number; relations: number; status: string;
}) {
  const steps = [evidence > 0, entities > 0, relations > 0, status !== "pending_review" && relations > 0];
  const labels = ["Upload", "Extract", "Verify", "Network ready"];
  return (
    <span className="inline-flex items-center gap-1" title={labels.map((l, i) => `${l}: ${steps[i] ? "done" : "pending"}`).join(" · ")}>
      {steps.map((done, i) => (
        <span key={i} className="h-1.5 w-8 rounded-full" style={{ background: done ? "#10B981" : "#1F2733" }} />
      ))}
    </span>
  );
}

/** Confidence bar with labeled percentage. */
export function ConfidenceBar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.round((value ?? 0) * 100);
  const color = pct >= 80 ? "#10B981" : pct >= 60 ? "#3B82F6" : pct >= 40 ? "#F59E0B" : "#EF4444";
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1F2733]">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="font-mono text-xs font-bold" style={{ color }}>{pct}%</span>
    </span>
  );
}
