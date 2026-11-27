/**
 * The Témoin mark, inline: the same drawing as public/icons/icon.svg (the ink
 * sheet, the trace in paper colour, the blue pen where it writes now), so the
 * sidebar and the sign-in card show exactly the home-screen icon without an
 * extra request. Decorative: the wordmark beside it carries the name.
 */
export default function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className="flex-none">
      <rect width="32" height="32" rx="7" fill="#141613" />
      <path
        d="M5.5 16h3.6l2.4-6.2 3.7 12.4 2.9-8.4 1.7 2.2H22"
        fill="none"
        stroke="#f2eee4"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="25.2" cy="16" r="2.4" fill="#8ea2ff" />
    </svg>
  );
}
