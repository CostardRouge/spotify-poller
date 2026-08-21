"use client";

import { useEffect, useRef } from "react";
import Icon from "./Icon";

const SHORTCUTS: { what: string; keys: string[] }[] = [
  { what: "Command palette", keys: ["⌘", "K"] },
  { what: "Jump to section", keys: ["1", "…", "8"] },
  { what: "Search events", keys: ["/"] },
  { what: "Cycle theme", keys: ["T"] },
  { what: "Refresh current view", keys: ["R"] },
  { what: "This dialog", keys: ["?"] },
  { what: "Close any overlay", keys: ["Esc"] },
];

/**
 * The old UI's dedicated keyboard-shortcuts dialog (dlg-keys): one row per
 * shortcut, keycap-styled keys pushed to the right. Opened from anywhere via
 * the `sp:open-shortcuts` window event (settings, ⌘K palette, the ? key).
 */
export default function ShortcutsDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const open = () => dialogRef.current?.showModal();
    window.addEventListener("sp:open-shortcuts", open);
    return () => window.removeEventListener("sp:open-shortcuts", open);
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="m-auto w-full max-w-sm rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] p-0 text-[color:var(--ink)]"
      aria-labelledby="shortcuts-title"
    >
      <div className="p-5">
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-lg">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="btn ghost icon-only"
            aria-label="Close"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="keys mt-4">
          {SHORTCUTS.map((s) => (
            <div key={s.what}>
              {s.what}
              <span className="k">
                {s.keys.map((k, i) =>
                  k === "…" ? (
                    <span key={i} className="text-[color:var(--ink-3)]">…</span>
                  ) : (
                    <span key={i} className="kbd">{k}</span>
                  )
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </dialog>
  );
}
