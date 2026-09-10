"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || "dark");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("pramaan_theme", next);
  }

  return (
    <button
      className="rounded-lg border border-ink-700 px-2 py-1 text-sm hover:border-accent"
      title={theme === "dark" ? "Light theme" : "Dark theme"}
      onClick={toggle}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
