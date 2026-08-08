"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cycleTheme } from "@/lib/theme";

interface Command {
  label: string;
  group: "Go to" | "Action" | "View";
  run: () => void;
}

/**
 * ⌘K palette plus the global shortcuts the old debug UI (and PRODUCT.md)
 * promise: 1…7 jump to a section, / focuses the events search, T cycles the
 * theme, R refreshes the current view, ? opens the shortcut list. All of them
 * stand down while an input, textarea or dialog has focus.
 */
const SECTIONS = [
  { label: "Overview", href: "/" },
  { label: "Events", href: "/events" },
  { label: "Runs", href: "/runs" },
  { label: "Gaps", href: "/gaps" },
  { label: "Stats", href: "/stats" },
  { label: "Accounts", href: "/accounts" },
  { label: "Playback", href: "/playback" },
];

export default function CommandPalette() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const sections = SECTIONS;

  const commands: Command[] = useMemo(() => {
    const go = (href: string) => () => {
      close();
      router.push(href);
    };
    const runCollector = (collector: string) => async () => {
      close();
      setNotice(`running ${collector}…`);
      const res = await fetch(`/api/run?collector=${collector}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setNotice(
        res.ok
          ? `${collector}: ${body.status} — ${body.inserted ?? 0} new`
          : `${collector}: ${body.error ?? "failed"}`
      );
      setTimeout(() => setNotice(null), 5000);
      router.refresh();
    };
    return [
      ...sections.map((s) => ({ label: s.label, group: "Go to" as const, run: go(s.href) })),
      { label: "Run played collector", group: "Action", run: runCollector("played") },
      { label: "Run liked collector", group: "Action", run: runCollector("liked") },
      {
        label: "Export events as NDJSON",
        group: "Action",
        run: () => {
          close();
          window.location.href = "/api/export";
        },
      },
      {
        label: "Connect or reconnect Spotify",
        group: "Action",
        run: () => {
          close();
          window.location.href = "/api/spotify/login";
        },
      },
      {
        label: "Search events",
        group: "Action",
        run: () => {
          close();
          router.push("/events");
          setTimeout(() => document.getElementById("event-search")?.focus(), 150);
        },
      },
      {
        label: "Cycle theme",
        group: "View",
        run: () => {
          const next = cycleTheme();
          window.dispatchEvent(new Event("sp:theme-changed"));
          setNotice(`theme: ${next}`);
          setTimeout(() => setNotice(null), 2000);
          close();
        },
      },
      {
        label: "Open settings",
        group: "View",
        run: () => {
          close();
          window.dispatchEvent(new Event("sp:open-settings"));
        },
      },
      {
        label: "Keyboard shortcuts",
        group: "View",
        run: () => {
          close();
          window.dispatchEvent(new Event("sp:open-shortcuts"));
        },
      },
    ];
     
  }, [router, sections]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(needle));
  }, [commands, query]);

  function open() {
    setQuery("");
    setIndex(0);
    dialogRef.current?.showModal();
    setTimeout(() => inputRef.current?.focus(), 0);
  }
  function close() {
    dialogRef.current?.close();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialogRef.current?.open) close();
        else open();
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (typing || e.altKey || e.metaKey || e.ctrlKey) return;
      if (document.querySelector("dialog[open]")) return;

      const jump = ["/", "/events", "/runs", "/gaps", "/stats", "/accounts", "/playback"];
      if (/^[1-7]$/.test(e.key)) {
        router.push(jump[Number(e.key) - 1]);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        router.push("/events");
        setTimeout(() => document.getElementById("event-search")?.focus(), 150);
        return;
      }
      if (e.key.toLowerCase() === "t") {
        cycleTheme();
        window.dispatchEvent(new Event("sp:theme-changed"));
        return;
      }
      if (e.key.toLowerCase() === "r") {
        router.refresh();
        return;
      }
      if (e.key === "?") {
        window.dispatchEvent(new Event("sp:open-shortcuts"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
     
  }, [router]);

  let lastGroup = "";

  return (
    <>
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        className="mx-auto mt-24 w-full max-w-md rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] p-0 text-[color:var(--text)]"
        aria-label="Command palette"
      >
        <div className="border-b border-[color:var(--line-soft)] px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            placeholder="Search sections and actions…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                filtered[index]?.run();
              }
            }}
            className="w-full bg-transparent text-sm text-[color:var(--text)] outline-none placeholder:text-[color:var(--faint)]"
          />
        </div>
        <ul id="palette-list" role="listbox" aria-label="Commands" className="max-h-72 overflow-y-auto p-2">
          {filtered.map((c, i) => {
            const showGroup = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <li key={c.label} role="option" aria-selected={i === index}>
                {showGroup && (
                  <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-[color:var(--faint)]">
                    {c.group}
                  </p>
                )}
                <button
                  type="button"
                  onClick={c.run}
                  onMouseEnter={() => setIndex(i)}
                  className={
                    "w-full rounded-md px-2 py-1.5 text-left text-sm " +
                    (i === index
                      ? "bg-[color:var(--accent-wash)] text-[color:var(--text)]"
                      : "text-[color:var(--muted)]")
                  }
                >
                  {c.label}
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-2 py-4 text-center text-sm text-[color:var(--muted)]">No matching command.</li>
          )}
        </ul>
      </dialog>
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-md border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-1.5 text-sm text-[color:var(--text)] shadow-md md:bottom-6"
        >
          {notice}
        </div>
      )}
    </>
  );
}
