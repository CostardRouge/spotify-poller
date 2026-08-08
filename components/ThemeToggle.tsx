"use client";

import { useEffect, useState } from "react";
import { applyTheme, getTheme, ThemeChoice } from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    setChoice(getTheme());
    // Stay in sync when the theme is changed elsewhere (palette's cycle-theme).
    const onChange = () => setChoice(getTheme());
    window.addEventListener("sp:theme-changed", onChange);
    return () => window.removeEventListener("sp:theme-changed", onChange);
  }, []);

  function apply(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
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
