"use client";

import { useEffect, useState } from "react";

type ThemeChoice = "system" | "light" | "dark";
const STORAGE_KEY = "sp-theme";
const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") setChoice(stored);
  }, []);

  function apply(next: ThemeChoice) {
    setChoice(next);
    if (next === "system") {
      localStorage.removeItem(STORAGE_KEY);
      document.documentElement.removeAttribute("data-theme");
    } else {
      localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.setAttribute("data-theme", next);
    }
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex overflow-hidden rounded-md border border-[color:var(--line)] text-xs"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={choice === opt.value}
          onClick={() => apply(opt.value)}
          className={
            "px-2.5 py-1.5 transition-colors " +
            (choice === opt.value
              ? "bg-[color:var(--accent)] text-[color:var(--on-accent)]"
              : "bg-[color:var(--panel)] text-[color:var(--muted)] hover:bg-[color:var(--panel-2)]")
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
