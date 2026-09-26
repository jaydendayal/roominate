/** Roominate's mark: a room drawn in plan, with its door swung open and one piece of furniture placed. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M9 28H4V4h24v24H18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" />
      <path d="M9 28V19" stroke="currentColor" strokeWidth="2.6" />
      <path d="M18 28A9 9 0 0 0 9 19" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
      <rect x="18" y="9" width="6" height="6" className="brand-mark-fill" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand${compact ? " compact" : ""}`}>
      <BrandMark size={compact ? 24 : 28} />
      <span>roominate</span>
    </span>
  );
}
