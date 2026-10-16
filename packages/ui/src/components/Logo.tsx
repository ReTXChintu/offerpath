/**
 * The Offerpath mark (assets/logo.svg): a path rising from where you are to
 * the offer, the gold dot. Drawn inline so it needs no asset pipeline.
 */
export function Logo({ size = 28, title = 'Offerpath' }: { size?: number; title?: string | null }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      role={title ? 'img' : undefined}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
    >
      <rect width="1024" height="1024" rx="224" fill="#1f4fd8" />
      <path
        d="M232 760 C 392 760, 400 520, 552 520 S 712 300, 792 264"
        fill="none"
        stroke="#ffffff"
        strokeWidth="72"
        strokeLinecap="round"
      />
      <circle cx="232" cy="760" r="56" fill="#ffffff" />
      <circle cx="792" cy="264" r="96" fill="#ffd34d" />
    </svg>
  );
}
