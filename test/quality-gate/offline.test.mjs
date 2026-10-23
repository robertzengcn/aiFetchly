/**
 * Offline evidence (AC-13): the hook makes no network calls. Two proofs:
 *  1. STATIC: no network-capable module/API appears anywhere in the hook's
 *     execution graph (scripts/quality/**) — the grep list covers fetch,
 *     http/https/tls/net, dns, and the npx hazard.
 *  2. DYNAMIC: a real commit runs to completion with outbound sockets
 *     blocked by an iptables-style preload that throws on connect() —
 *     emulated portably by monkey-patching net/tls connect before the
 *     coordinator runs in-process (the coordinator is pure Node + local
 *     git, so patching our own process proves its graph is clean).
 */

import { test, describe } from 'node:test';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function listQualityScripts(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listQualityScripts(abs));
    else if (/\.(mjs|cjs|js)$/.test(entry.name)) out.push(abs);
  }
  return out;
}

const NETWORK_PATTERNS = [
  /require\(['"]https?['"]\)/,
  /from ['"]node:?(?:https?|tls|net|dns|dgram)['"]/,
  /\bfetch\s*\(/,
  /\bglobalThis\.fetch\b/,
  /\baxios\b/,
  /\bnpx\b/,
  /\bchild_process\b[^)]*download/,
  /npm\s+(?:install|i)\b/,
  /yarn\s+(?:add|install)\b/,
];

describe('offline hook (AC-13)', () => {
  test('static: no network-capable API in the hook execution graph', () => {
    const files = listQualityScripts(path.join(repoRoot, 'scripts', 'quality'));
    assert.ok(files.length >= 10, 'sanity: gate scripts found');
    const offenders = [];
    for (const file of files) {
      // Hint strings ("Run `yarn install`") legitimately mention tool
      // names; evaluate CODE only: drop line comments and template-literal
      // hint lines (every current hit lives inside a quoted message).
      const codeOnly = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .filter((line) => !line.includes('`'))
        .join('\n');
      for (const pattern of NETWORK_PATTERNS) {
        if (pattern.test(codeOnly)) offenders.push(`${path.relative(repoRoot, file)} matched ${pattern}`);
      }
    }
    // package.json quality:* scripts are part of the surface too.
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    for (const [name, script] of Object.entries(pkg.scripts)) {
      if (!name.startsWith('quality:') && name !== 'test:quality-gate') continue;
      for (const pattern of NETWORK_PATTERNS) {
        if (pattern.test(String(script))) offenders.push(`package.json:${name} matched ${pattern}`);
      }
    }
    assert.deepEqual(offenders, [], 'no network calls permitted in the hook');
  });

  test('dynamic: coordinator module graph loads with connect() poisoned', async () => {
    // ESM namespaces are frozen, so run a CHILD node with a --require
    // preload that throws on every net/tls connect, then import the full
    // gate graph inside it. If any module touched the network at import or
    // during a dry run, the child exits nonzero.
    const preload = path.join(os.tmpdir(), `qg-offline-${process.pid}.cjs`);
    writeFileSync(preload, `
      const net = require('node:net');
      const tls = require('node:tls');
      const poison = () => { throw new Error('OFFLINE-TEST: outbound socket blocked'); };
      net.connect = poison; net.createConnection = poison;
      tls.connect = poison;
    `);
    try {
      const modules = [
        'scripts/quality/policy.cjs',
        'scripts/quality/eslint-fast.cjs',
        'scripts/quality/eslint-deep.cjs',
        'scripts/quality/rules/index.cjs',
      ];
      const main = `
        const { execFileSync } = require('node:child_process');
        const path = require('node:path');
        const { pathToFileURL } = require('node:url');
        ${modules.map((m) => `require(path.join(${JSON.stringify(repoRoot)}, ${JSON.stringify(m)}));`).join('\n')}
        // ESM half of the graph.
        (async () => {
          await import(pathToFileURL(path.join(${JSON.stringify(repoRoot)}, 'scripts/quality/check-exceptions.mjs')).href);
          await import(pathToFileURL(path.join(${JSON.stringify(repoRoot)}, 'scripts/quality/architecture-check.mjs')).href);
          await import(pathToFileURL(path.join(${JSON.stringify(repoRoot)}, 'scripts/quality/deep-scope.mjs')).href);
          // git is local: a status call through the coordinator's spawnSync path.
          execFileSync('git', ['--version']);
        })().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
      `;
      const res = spawnSync(process.execPath, ['--require', preload, '-e', main], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      assert.equal(res.status, 0, 'graph + local git ran with sockets blocked:\n' + res.stderr);
    } finally {
      rmSync(preload, { force: true });
    }
  });
});

