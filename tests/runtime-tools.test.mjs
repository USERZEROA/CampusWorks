import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNpmCli } from '../scripts/runtime-tools.mjs';

test('npm launch uses an existing package-manager path without shell interpolation', () => {
  const executable = 'C:\\Program Files\\nodejs\\node.exe';
  const manager = 'C:\\Tools With Spaces\\npm-cli.js';
  assert.equal(resolveNpmCli({ executable, platform: 'win32', environment: { npm_execpath: manager }, exists: candidate => candidate === manager }), manager);
});

test('direct Node commands locate Windows, Unix distribution and system package layouts', () => {
  for (const [platform, executable, expected] of [
    ['win32', 'C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'],
    ['linux', '/usr/local/bin/node', '/usr/local/lib/node_modules/npm/bin/npm-cli.js'],
    ['darwin', '/opt/homebrew/Cellar/node/24.21.0/bin/node', '/opt/homebrew/Cellar/node/24.21.0/lib/node_modules/npm/bin/npm-cli.js'],
    ['linux', '/usr/bin/node', '/usr/share/nodejs/npm/bin/npm-cli.js'],
  ]) assert.equal(resolveNpmCli({ executable, platform, environment: {}, exists: candidate => candidate === expected }), expected);
});

test('stale package-manager paths do not hide a valid installed npm', () => {
  const expected = '/usr/local/lib/node_modules/npm/bin/npm-cli.js';
  assert.equal(resolveNpmCli({ executable: '/usr/local/bin/node', platform: 'linux', environment: { npm_execpath: '/missing/npm-cli.js' }, exists: candidate => candidate === expected }), expected);
  assert.throws(() => resolveNpmCli({ environment: {}, exists: () => false }), /npm could not be located/);
});
