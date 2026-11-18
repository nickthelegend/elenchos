// Proof of audit, checked against zkVerify's REAL verifier on Ethereum Sepolia. The fixture is a report this server
// anchored through Kurier (zkVerify testnet, aggregation 270049); nothing is mocked: the check recomputes the report's
// sha256, rebuilds the statement leaf and calls verifyProofAggregation on Sepolia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('../../../contracts/fixtures/anchored-report.json', import.meta.url));
const data = mkdtempSync(join(tmpdir(), 'elenchos-anchor-'));
mkdirSync(join(data, 'reports'));
const report = JSON.parse(readFileSync(fixture, 'utf8'));
cpSync(fixture, join(data, 'reports', `${report.id}.json`));
process.env.ELENCHOS_DATA = data;
const { canonical, checkAnchor, verdictOf } = await import('../src/anchor.ts');
const { sha256 } = await import('../src/report.ts');

test('the anchored digest is the sha256 of the report without its anchor', () => {
  assert.equal(sha256(canonical(report)), report.anchor.digest);
  assert.equal(verdictOf(report), report.anchor.verdict);
});

test('zkVerify\'s verifier on Sepolia accepts the anchored report', { timeout: 60_000 }, async () => {
  const c = await checkAnchor(report.id);
  assert.equal(c.digestMatches, true); assert.equal(c.leafMatches, true);
  assert.equal(c.accepted, true, 'verifyProofAggregation returned false');
});

test('a tampered report no longer matches its anchor on Sepolia', { timeout: 60_000 }, async () => {
  const t = { ...report, findings: report.findings.slice(1) }; // someone deletes a finding
  writeFileSync(join(data, 'reports', `${report.id}.json`), JSON.stringify(t));
  const c = await checkAnchor(report.id);
  assert.equal(c.digestMatches, false); assert.equal(c.accepted, false);
  cpSync(fixture, join(data, 'reports', `${report.id}.json`));
});
