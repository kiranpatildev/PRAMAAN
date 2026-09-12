"use client";

/** Case progress derivation + entity-type presentation meta. */
import { User, Phone, Car, MapPin, Building2, ArrowLeftRight, Folder } from "lucide-react";
import type { CaseItem } from "./types";

export interface Progress {
  upload: boolean;
  extract: boolean;
  verify: boolean;
  network: boolean;
  done: number;
}

/** Progress derives from the list annotations (zero extra queries). */
export function progressOf(c: CaseItem): Progress {
  const upload = (c.evidence_count ?? 0) > 0;
  const extract = (c.entities_count ?? 0) > 0;
  const verify = (c.relations_count ?? 0) > 0;
  const network = verify && c.status !== "pending_review";
  const done = [upload, extract, verify, network].filter(Boolean).length;
  return { upload, extract, verify, network, done };
}

export type EntityKind = "person" | "phone" | "vehicle" | "location" | "organization" | "transaction" | "case";

export function entityKind(t?: string | null): EntityKind {
  const s = (t ?? "").toLowerCase();
  if (s.includes("phone")) return "phone";
  if (s.includes("vehic")) return "vehicle";
  if (s.includes("locat") || s.includes("address")) return "location";
  if (s.includes("org")) return "organization";
  if (s.includes("trans") || s.includes("bank")) return "transaction";
  if (s.includes("case") || s.includes("event")) return "case";
  return "person";
}

export const ENTITY_META: Record<EntityKind, { icon: typeof User; color: string; label: string }> = {
  person: { icon: User, color: "#a3b1c2", label: "Person" },
  phone: { icon: Phone, color: "#a3b1c2", label: "Phone" },
  vehicle: { icon: Car, color: "#a3b1c2", label: "Vehicle" },
  location: { icon: MapPin, color: "#a78bfa", label: "Location" },
  organization: { icon: Building2, color: "#fb923c", label: "Organization" },
  transaction: { icon: ArrowLeftRight, color: "#e879f9", label: "Transaction" },
  case: { icon: Folder, color: "#00d9ff", label: "Case" },
};

/** 24px entity icon chip in the type colour. */
export function EntityChip({ type, size = 24 }: { type?: string | null; size?: number }) {
  const meta = ENTITY_META[entityKind(type)];
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[3px] border border-line-2 bg-panel-2"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Icon size={13} strokeWidth={1.6} style={{ color: meta.color }} />
    </span>
  );
}

/** 3px stage progress bar + mono n/4. */
export function StageBar({ done, total = 4 }: { done: number; total?: number }) {
  const pct = Math.round((done / total) * 100);
  return (
    <span className="block w-full">
      <span className="block h-[3px] w-full overflow-hidden rounded-[2px] bg-line">
        <span
          className="block h-full rounded-[2px]"
          style={{ width: `${pct}%`, background: done === total ? "#4ade80" : "#00d9ff" }}
        />
      </span>
      <span className="mt-1 block font-mono text-[10.5px] text-fg-3">{done}/{total}</span>
    </span>
  );
}
