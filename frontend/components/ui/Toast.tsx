"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";

type ToastKind = "ok" | "warn" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
}

const ToastCtx = createContext<(t: Omit<ToastItem, "id">) => void>(() => {});

export const useToast = () => useContext(ToastCtx);

const ICON = {
  ok: <CheckCircle2 size={14} strokeWidth={1.6} className="text-green" />,
  warn: <AlertTriangle size={14} strokeWidth={1.6} className="text-amber" />,
  info: <Info size={14} strokeWidth={1.6} className="text-cyan" />,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-[18px] right-[18px] z-50 flex flex-col gap-[6px]" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className="toast-in flex w-[300px] items-start gap-[10px] rounded border border-line-2 bg-panel-2 px-[13px] py-[11px]"
          >
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[3px] border border-line">
              {ICON[t.kind]}
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium text-fg">{t.title}</span>
              {t.body && <span className="mt-[2px] block text-[11.5px] text-fg-3">{t.body}</span>}
            </span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
