export const Logo = () => (
  <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="7" fill="#121418" stroke="#23272e"/><path d="M10 10h12M10 16h8M10 22h12" stroke="#c6f24e" strokeWidth="2.2" strokeLinecap="round"/><circle cx="23.5" cy="20.5" r="4" fill="none" stroke="#c6f24e" strokeWidth="2"/><path d="M26.5 23.5 29 26" stroke="#c6f24e" strokeWidth="2.2" strokeLinecap="round"/></svg>
);
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
export const ToolIcon = ({ name }: { name: string }) => {
  if (name === 'scan') return <svg viewBox="0 0 24 24" {...S} style={{ color: 'var(--lime)' }}><circle cx="11" cy="11" r="6"/><path d="m20 20-3.5-3.5"/></svg>;
  if (name === 'forge') return <svg viewBox="0 0 24 24" {...S} style={{ color: 'var(--red)' }}><path d="M12 3v4M12 17v4M5 12H3M21 12h-2M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/><circle cx="12" cy="12" r="3"/></svg>;
  if (name === 'replay') return <svg viewBox="0 0 24 24" {...S} style={{ color: 'var(--cyan)' }}><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4"/></svg>;
  if (name === 'patch') return <svg viewBox="0 0 24 24" {...S} style={{ color: 'var(--lime)' }}><path d="M20 6 9 17l-5-5"/></svg>;
  return null;
};
