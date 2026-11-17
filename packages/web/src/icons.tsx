// The Elenchos mark: the examiner's lens with one eye in it. Drawn in SVG so it is crisp at 16 px.
export const Mark = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
    <defs>
      <linearGradient id="mk-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8ea4ff" /><stop offset="1" stopColor="#3b55e6" /></linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill="#101733" />
    <rect x=".5" y=".5" width="31" height="31" rx="8.5" fill="none" stroke="rgba(169,184,255,.28)" />
    <circle cx="14" cy="14" r="7.2" fill="none" stroke="url(#mk-g)" strokeWidth="2.6" />
    <path d="M19.4 19.4 25 25" stroke="url(#mk-g)" strokeWidth="3" strokeLinecap="round" />
    <circle cx="14" cy="14" r="2.4" fill="#e9edf7" />
  </svg>
);
