"use client";

/**
 * The persisted theme override. "system" = no override: the data-theme
 * attribute is removed and prefers-color-scheme decides (see the inline
 * script in app/layout.tsx that replays this before first paint).
 */
export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "sp-theme";
export const THEME_ORDER: ThemeChoice[] = ["system", "light", "dark"];

export function getTheme(): ThemeChoice {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function applyTheme(next: ThemeChoice): void {
  if (next === "system") {
    localStorage.removeItem(STORAGE_KEY);
    document.documentElement.removeAttribute("data-theme");
  } else {
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.setAttribute("data-theme", next);
  }
}

export function cycleTheme(): ThemeChoice {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(getTheme()) + 1) % THEME_ORDER.length];
  applyTheme(next);
  return next;
}
