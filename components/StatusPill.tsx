const TONES = {
  ok: "bg-[color:var(--ok-soft)] text-[color:var(--ok)]",
  warn: "bg-[color:var(--warn-soft)] text-[color:var(--warn)]",
  danger: "bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
  neutral: "bg-[color:var(--surface-2)] text-[color:var(--ink-2)]",
} as const;

/** Status is never color alone — every pill carries the word too (PRODUCT.md). */
export default function StatusPill({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}
