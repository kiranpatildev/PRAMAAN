"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Note = {
  id: number;
  alert: { kind: string; severity: string; message: string; case_id: number | null };
  channel: string;
  read: boolean;
  created_at: string;
};

function wsUrl(): string | null {
  if (typeof window === "undefined") return null;
  let token: string | null = null;
  try {
    token = window.localStorage.getItem("pramaan_access") ?? window.sessionStorage.getItem("pramaan_access");
  } catch { /* ignore */ }
  if (!token) return null;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws/alerts/?token=${token}`;
}

/** Realtime alerts bell: unread count, dropdown, live WS pushes + toasts. */
export function AlertsBell() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await api.notifications(true);
      setNotes(d.results ?? d);
    } catch {
      /* logged out — bell stays empty */
    }
  }, []);

  useEffect(() => {
    refresh();
    const url = wsUrl();
    if (!url) return;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          // Import progress frames share this socket but are rendered by the
          // ICJS panel itself — the bell only shows real alert notifications.
          if (msg.type === "alert" && msg.kind !== "icjs_import_progress") {
            setNotes((n) => [{ id: msg.notification_id, alert: msg, channel: "inapp", read: false, created_at: msg.created_at }, ...n]);
            setToast(`[${msg.severity}] ${msg.message}`);
            setTimeout(() => setToast(null), 6000);
          }
        } catch {
          /* ignore malformed frames */
        }
      };
    } catch {
      /* WS unavailable (runserver dev) — polling fallback below */
    }
    const t = setInterval(refresh, 60000);
    return () => {
      clearInterval(t);
      ws?.close();
      wsRef.current = null;
    };
  }, [refresh]);

  async function markAll() {
    await api.markAllNotifications().catch(() => {});
    setNotes([]);
  }

  return (
    <div className="relative">
      <button className="relative rounded-lg border border-ink-700 px-2.5 py-1 text-sm hover:border-accent"
        onClick={() => setOpen((o) => !o)} title="Alerts">
        🔔
        {notes.length > 0 && (
          <span className="absolute -right-1.5 -top-1.5 rounded-full bg-risk-high px-1.5 text-[10px] font-bold text-white">
            {notes.length}
          </span>
        )}
      </button>
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-accent bg-ink-900 p-3 text-sm shadow-xl">
          {toast}
        </div>
      )}
      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-96 w-[calc(100vw-2rem)] max-w-96 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 p-2 shadow-xl">
          <div className="flex items-center justify-between px-1 py-1 text-sm">
            <b>Notifications ({notes.length} unread)</b>
            <span className="flex gap-2 text-xs">
              <button className="text-accent hover:underline" onClick={markAll}>mark all read</button>
              <a className="text-accent hover:underline" href="/alerts">all alerts</a>
            </span>
          </div>
          {notes.map((n) => (
            <div key={n.id} className="border-t border-ink-700 px-1 py-2 text-sm">
              <span className="text-xs text-slate-500">[{n.alert.severity}] {n.alert.kind}</span>
              <p>{n.alert.message}</p>
            </div>
          ))}
          {notes.length === 0 && <p className="px-1 py-3 text-sm text-slate-500">All caught up.</p>}
        </div>
      )}
    </div>
  );
}
