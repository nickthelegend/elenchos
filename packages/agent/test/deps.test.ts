// Dependency recovery: which imports count as missing, and the remappings the repo already declares. (Fetching is
// exercised by the live ecosystem runs; this checks the decisions without the network.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declaredRemappings, recoverDeps } from '../src/deps.ts';

test('declared remappings come from foundry.toml and remappings.txt', () => {
  const root = mkdtempSync(join(tmpdir(), 'deps-'));
  writeFileSync(join(root, 'foundry.toml'), '[profile.default]\nremappings = ["@oz/=lib/openzeppelin-contracts/contracts/", "solady/=lib/solady/src/"]\n');
  writeFileSync(join(root, 'remappings.txt'), 'forge-std/=lib/forge-std/src/\n');
  assert.deepEqual(declaredRemappings(root).map(([p]) => p).sort(), ['@oz/', 'forge-std/', 'solady/']);
});

test('nothing is fetched when every import resolves, or for libraries not on the list', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deps-'));
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'lib', 'forge-std', 'src'), { recursive: true });
  writeFileSync(join(root, 'lib', 'forge-std', 'src', 'Test.sol'), '');
  writeFileSync(join(root, 'src', 'A.sol'), 'import {Test} from "forge-std/Test.sol";\nimport {X} from "some-unknown-lib/X.sol";\nimport "./B.sol";\n');
  assert.deepEqual(await recoverDeps(root), []);
});

test('a missing forge-std is restored from the bundled copy with a remapping', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deps-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'A.t.sol'), 'import {Test} from "forge-std/Test.sol";\n');
  const done = await recoverDeps(root);
  assert.ok(done.some((d) => d.startsWith('forge-std')), done.join('; '));
  assert.match(done.join(' '), /forge-std\/=lib\/forge-std\/src\//);
});
