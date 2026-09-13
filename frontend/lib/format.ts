/** Formatting helpers: dates, case ids, phones, files, relative time. */

export function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "1d ago" : `${d}d ago`;
}

/** "2026-08-12" -> "12 AUG". */
export function dayLabel(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(t.getDate()).padStart(2, "0")} ${months[t.getMonth()]}`;
}

/** "2026-08-12T09:14:00" -> "09:14". */
export function timeLabel(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

/** ISO date -> "18 Aug 2026". */
export function longDate(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${t.getDate()} ${months[t.getMonth()]} ${t.getFullYear()}`;
}

/** "2026-08-07 09:12" audit style. */
export function auditDate(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

/** Numeric db id -> display case id "C-1002". */
export function caseId(id: number | string): string {
  return `C-${id}`;
}

export function fmtBytes(n?: number | null): string {
  if (n === undefined || n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "Rahul Sharma" / "inv_demo" -> "RS" / "ID". */
export function initials(name?: string | null): string {
  if (!name) return "?";
  const clean = name.replace(/[^a-zA-Z ]/g, " ").trim();
  if (!clean) return name.slice(0, 2).toUpperCase();
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "HH:MM" session clock for the sidebar footer. */
export function sessionClock(): string {
  const t = new Date();
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}
