const TONE_CLASS = {
  ok: "chip ok",
  warn: "chip warn",
  danger: "chip bad",
  neutral: "chip",
} as const;

const DOT_CLASS = {
  ok: "dot ok",
  warn: "dot warn",
  danger: "dot bad",
  neutral: "dot",
} as const;

/**
 * The old UI's status chip: pill shape, tone-tinted border and wash, ink text,
 * and a leading dot. Status is never color alone — the chip always carries the
 * word (PRODUCT.md).
 */
export default function StatusPill({
  tone,
  children,
}: {
  tone: keyof typeof TONE_CLASS;
  children: React.ReactNode;
}) {
  return (
    <span className={TONE_CLASS[tone]}>
      <span aria-hidden className={DOT_CLASS[tone]} />
      {children}
    </span>
  );
}
