// Connecting an untrusted GitHub checkout: the URL parser and the foundry.toml sanitizer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRepo, safeFoundryToml } from '../src/project.ts';

test('repository URLs: full, short, tree/branch/folder; anything else is refused', () => {
  assert.deepEqual(parseRepo('https://github.com/acme/vault'), { owner: 'acme', repo: 'vault', ref: null, subdir: null });
  assert.deepEqual(parseRepo('acme/vault'), { owner: 'acme', repo: 'vault', ref: null, subdir: null });
  assert.deepEqual(parseRepo('github.com/acme/vault.git'), { owner: 'acme', repo: 'vault', ref: null, subdir: null });
  assert.deepEqual(parseRepo('https://github.com/acme/vault/tree/main/contracts'), { owner: 'acme', repo: 'vault', ref: 'main', subdir: 'contracts' });
  assert.equal(parseRepo('https://gitlab.com/acme/vault'), null);
  assert.equal(parseRepo('https://github.com/acme/vault/tree/main/../../etc'), null);
  assert.equal(parseRepo('acme/vault; rm -rf /'), null);
  assert.equal(parseRepo(42), null);
});

test('foundry.toml: ffi, fs_permissions, a solc binary path and output paths are removed; versions and remappings stay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elenchos-toml-'));
  writeFileSync(join(dir, 'foundry.toml'), `[profile.default]
src = "src"
solc = "./bin/evil-solc"
ffi = true
fs_permissions = [
  { access = "read-write", path = "/" },
]
out = "/tmp/elsewhere"
remappings = ["@oz/=lib/openzeppelin-contracts/"]
optimizer = true
`);
  const out = safeFoundryToml(dir);
  assert.doesNotMatch(out, /evil-solc|read-write|elsewhere|^\s*(ffi|fs_permissions|solc|out)\s*=/m);
  assert.match(out, /src = "src"/);
  assert.match(out, /@oz\/=lib\/openzeppelin-contracts\//);
  assert.match(out, /optimizer = true/);
  writeFileSync(join(dir, 'foundry.toml'), '[profile.default]\nsolc_version = "0.8.24"\n');
  assert.match(safeFoundryToml(dir), /solc_version = "0.8.24"/);
});

test('a checkout without foundry.toml gets a minimal one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elenchos-toml-'));
  assert.match(safeFoundryToml(dir), /\[profile\.default\][\s\S]*auto_detect_solc = true/);
});
