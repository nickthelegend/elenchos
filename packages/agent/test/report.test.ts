// Report headline and README badge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badge, headline, type Report } from '../src/report.ts';

const base = { id: 'abcdefgh', createdAt: '', title: 'X.sol', source: '', sha256: '', repo: null, findings: [], compileError: null, attack: null, forgery: null, fix: null, engine: '' } as Report;
const crit = { rule: 'E1', severity: 'critical', title: 't', contract: 'X', function: 'claim', file: 'X.sol', line: 1, evidence: '', fix: '' } as Report['findings'][number];

test('the headline follows the strongest evidence', () => {
  assert.equal(headline(base).label, 'no holes found');
  assert.equal(headline({ ...base, findings: [crit] }).label, '1 critical');
  assert.equal(headline({ ...base, findings: [crit], attack: { status: 'exploitable' } as Report['attack'] }).label, 'exploit proven');
  const fix = { verified: true, attack: { status: 'blocked' } } as Report['fix'];
  assert.equal(headline({ ...base, findings: [crit], attack: { status: 'exploitable' } as Report['attack'], fix }).label, 'fix verified');
  assert.equal(headline({ ...base, fix: { ...fix!, attack: { status: 'exploitable' } } as Report['fix'] }).label, 'no holes found');
});

test('the badge is an SVG that names the result, and an unknown id says so', () => {
  assert.match(badge({ ...base, findings: [crit] }), /<svg[\s\S]*1 critical/);
  assert.match(badge(null), /report not found/);
});
