// Shareable audit reports. The server builds every report itself, from the source it was given: it scans the file,
// runs the exploit test, and, if a fix is attached, verifies the fix and runs the same exploit test against it. Nothing
// the browser claims is stored, so a report link shows only results this server produced on that exact source.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Finding } from '@elenchos/core/src/scan.ts';
import type { AttackResult, Forgery } from './exploit.ts';

export type Report = {
  id: string; createdAt: string; title: string; source: string; sha256: string;
  repo: { repo: string; sha: string; path: string } | null;
  findings: Finding[]; compileError: string | null;
  attack: AttackResult | null; forgery: Forgery | null;
  fix: null | { source: string; sha256: string; verified: boolean; compiles: boolean; reason: string; remaining: string[]; evaded: string[]; attack: AttackResult | null };
  engine: string;
};

const DIR = () => join(process.env.ELENCHOS_DATA ?? join(process.cwd(), '.data'), 'reports');
const MAX_REPORTS = 5000;
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function saveReport(r: Omit<Report, 'id' | 'createdAt'>): Promise<Report> {
  await mkdir(DIR(), { recursive: true });
  if (readdirSync(DIR()).length >= MAX_REPORTS) throw new Error('The report store is full on this server.');
  const report: Report = { id: randomBytes(6).toString('base64url'), createdAt: new Date().toISOString(), ...r };
  await writeFile(join(DIR(), `${report.id}.json`), JSON.stringify(report));
  return report;
}

export function getReport(id: string): Report | null {
  if (!/^[A-Za-z0-9_-]{8}$/.test(id)) return null;
  const f = join(DIR(), `${id}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

/** The report's headline, used by the page and the badge. */
export function headline(r: Report): { label: string; color: string } {
  if (r.fix?.verified && r.fix.attack?.status !== 'exploitable') return { label: 'fix verified', color: '#2ea44f' };
  if (r.attack?.status === 'exploitable') return { label: 'exploit proven', color: '#d73a49' };
  const crit = r.findings.filter((f) => f.severity === 'critical').length;
  if (crit) return { label: `${crit} critical`, color: '#d73a49' };
  if (r.findings.length) return { label: `${r.findings.length} to fix`, color: '#dbab09' };
  if (r.compileError) return { label: 'does not compile', color: '#6a737d' };
  return { label: 'no holes found', color: '#2ea44f' };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** A shields-style SVG badge for a README. */
export function badge(r: Report | null): string {
  const left = 'elenchos';
  const { label, color } = r ? headline(r) : { label: 'report not found', color: '#6a737d' };
  const w = (t: string) => Math.round(t.length * 6.6 + 12);
  const lw = w(left); const rw = w(label);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="20" role="img" aria-label="${esc(`${left}: ${label}`)}">
<title>${esc(`${left}: ${label}`)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${lw + rw}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#2b3150"/><rect x="${lw}" width="${rw}" height="20" fill="${color}"/><rect width="${lw + rw}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${left}</text><text x="${lw / 2}" y="14">${left}</text>
<text x="${lw + rw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(label)}</text><text x="${lw + rw / 2}" y="14">${esc(label)}</text>
</g></svg>`;
}
