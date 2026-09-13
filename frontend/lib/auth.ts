"use client";

/** Client-side role helpers mirroring the backend RBAC (the API is the
 *  real gate; these only decide what to render). */
import type { Role, User } from "./types";

export function isSho(role?: string | null): boolean {
  return role === "sho" || role === "admin";
}

export function roleLabel(role?: string | null): string {
  if (role === "sho") return "SHO";
  if (role === "admin") return "ADMIN";
  return "INVESTIGATOR";
}

export function displayName(u?: Partial<User> | null): string {
  if (!u) return "—";
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return u.name || full || u.username || "—";
}
