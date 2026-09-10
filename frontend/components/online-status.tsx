"use client";

import { useEffect, useState } from "react";

/** Offline banner: field users on flaky networks see capture state upfront. */
export function OnlineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  if (online) return null;
  return (
    <div className="bg-risk-medium px-4 py-1.5 text-center text-xs font-semibold text-ink-950">
      Offline — new uploads will queue on this device and can be retried when you reconnect.
    </div>
  );
}
