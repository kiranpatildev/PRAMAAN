"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";

export function Modal({ title, onClose, children, wide = false }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(4,6,11,.75)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="modal-in w-full rounded-md border border-line-2 bg-panel p-[22px]"
        style={{ maxWidth: wide ? 640 : 480, boxShadow: "0 24px 48px -20px rgba(0,0,0,.9)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-medium tracking-[-0.015em] text-fg">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-fg-3 transition-colors duration-120 hover:bg-panel-2 hover:text-fg"
            aria-label="Close"
          >
            <X size={14} strokeWidth={1.6} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
