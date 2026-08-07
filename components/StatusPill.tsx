const TONES = {
  ok: "bg-[color:var(--accent-wash)] text-[color:var(--ok)]",
  warn: "bg-[color:var(--accent-wash)] text-[color:var(--warn)]",
  danger: "bg-[color:var(--accent-wash)] text-[color:var(--danger)]",
  neutral: "bg-[color:var(--panel-2)] text-[color:var(--muted)]",
} as const;

/** Status is never color alone — every pill carries the word too (PRODUCT.md). */
export default function StatusPill({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}
