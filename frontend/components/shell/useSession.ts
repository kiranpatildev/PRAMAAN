"use client";

import { useEffect, useState } from "react";
import { getMe } from "@/lib/endpoints";
import { listCases } from "@/lib/endpoints";
import { alertsFeed, notifications } from "@/lib/endpoints";
import type { User } from "@/lib/types";

export interface Session {
  user: User | null;
  casesCount: number;
  alertsCount: number;
  unread: number;
}

let cache: Promise<Session> | null = null;

function load(): Promise<Session> {
  if (!cache) {
    cache = (async () => {
      const [user, cases, alerts, notes] = await Promise.all([
        getMe().catch(() => null),
        listCases({ limit: 1 }).catch(() => ({ count: 0, results: [] })),
        alertsFeed().catch(() => []),
        notifications(true).catch(() => []),
      ]);
      return {
        user,
        casesCount: cases.count ?? 0,
        alertsCount: alerts.length ?? 0,
        unread: (notes as unknown[]).length ?? 0,
      };
    })();
  }
  return cache;
}

export function refreshSession() {
  cache = null;
}

export function useSession(): Session & { loading: boolean } {
  const [s, setS] = useState<Session>({ user: null, casesCount: 0, alertsCount: 0, unread: 0 });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    load()
      .then(setS)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  return { ...s, loading };
}
