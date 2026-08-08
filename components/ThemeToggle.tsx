"use client";

import { useEffect, useState } from "react";
import { applyTheme, getTheme, ThemeChoice } from "@/lib/theme";
import Icon, { IconName } from "./Icon";

const OPTIONS: { value: ThemeChoice; label: string; icon: IconName }[] = [
  { value: "auto", label: "Auto", icon: "auto" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

/** The Auto/Light/Dark segmented control from the old sidebar and settings dialog. */
export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("auto");

  useEffect(() => {
    setChoice(getTheme());
    // Stay in sync when the theme is changed elsewhere (palette's cycle-theme).
    const onChange = () => setChoice(getTheme());
    window.addEventListener("sp:theme-changed", onChange);
    return () => window.removeEventListener("sp:theme-changed", onChange);
  }, []);

  return (
    <div role="group" aria-label="Colour theme" className="seg w-full">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={choice === opt.value}
          onClick={() => {
            setChoice(opt.value);
            applyTheme(opt.value);
          }}
        >
          <Icon name={opt.icon} className="h-3.5 w-3.5" />
          {opt.label}
        </button>
      ))}
    </div>
  );
}
