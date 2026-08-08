"use client";

import { useRef, useState } from "react";

export interface EventRowData {
  id: string;
  when: string;
  type: string;
  title: string;
  subtitle: string;
  source: string;
  duration_s: number | null;
  ingested_at: string;
  payload: string;
}

function prettyPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

function formatDuration(s: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The browsing table plus the payload inspector the old debug UI had as
 * expandable rows — here a native <dialog> (PRODUCT.md: native dialogs, Esc
 * closes every overlay, keyboard-complete via the per-row button).
 */
export default function EventsTable({ items, timezone }: { items: EventRowData[]; timezone: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<EventRowData | null>(null);

  function open(ev: EventRowData) {
    setSelected(ev);
    dialogRef.current?.showModal();
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-[color:var(--line)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--panel-2)] text-xs uppercase tracking-wide text-[color:var(--muted)]">
            <tr>
              <th className="px-3 py-2">When ({timezone})</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Subtitle</th>
              <th className="px-3 py-2">Duration</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((ev) => (
              <tr key={ev.id} className="border-t border-[color:var(--line-soft)]">
                <td className="whitespace-nowrap px-3 py-2 text-[color:var(--muted)]">{ev.when}</td>
                <td className="px-3 py-2">{ev.type}</td>
                <td className="px-3 py-2 text-[color:var(--text)]">{ev.title}</td>
                <td className="px-3 py-2 text-[color:var(--muted)]">{ev.subtitle}</td>
                <td className="whitespace-nowrap px-3 py-2 text-[color:var(--muted)]">{formatDuration(ev.duration_s)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => open(ev)}
                    className="rounded-md border border-[color:var(--line)] px-2.5 py-1 text-xs text-[color:var(--muted)] hover:bg-[color:var(--accent-wash)] hover:text-[color:var(--text)]"
                  >
                    Payload
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[color:var(--muted)]">
                  No events match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <dialog
        ref={dialogRef}
        onClose={() => setSelected(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-auto w-full max-w-2xl rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] p-0 text-[color:var(--text)]"
      >
        {selected && (
          <div className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-[family-name:var(--serif)] text-lg">{selected.title}</h2>
                <p className="mt-0.5 text-sm text-[color:var(--muted)]">{selected.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                className="rounded-md border border-[color:var(--line)] px-2.5 py-1 text-xs text-[color:var(--muted)] hover:bg-[color:var(--panel-2)]"
              >
                Close (Esc)
              </button>
            </div>

            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-[color:var(--faint)]">id</dt>
              <dd className="font-[family-name:var(--mono)] break-all">{selected.id}</dd>
              <dt className="text-[color:var(--faint)]">when</dt>
              <dd>{selected.when} ({timezone})</dd>
              <dt className="text-[color:var(--faint)]">type / source</dt>
              <dd>{selected.type} / {selected.source}</dd>
              {selected.duration_s !== null && (
                <>
                  <dt className="text-[color:var(--faint)]">duration</dt>
                  <dd>{selected.duration_s}s</dd>
                </>
              )}
              <dt className="text-[color:var(--faint)]">ingested</dt>
              <dd>{selected.ingested_at}</dd>
            </dl>

            <pre className="mt-4 max-h-80 overflow-auto rounded-md border border-[color:var(--line-soft)] bg-[color:var(--panel-2)] p-3 text-xs leading-relaxed font-[family-name:var(--mono)]">
              {prettyPayload(selected.payload)}
            </pre>
          </div>
        )}
      </dialog>
    </>
  );
}
