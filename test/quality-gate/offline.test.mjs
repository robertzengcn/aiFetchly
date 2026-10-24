/**
 * Offline evidence (AC-13, V02): the hook makes no network calls.
 *
 *  1. STATIC: no network-capable module/API appears anywhere in the hook's
 *     execution graph (scripts/quality/**) — hint strings are neutralized
 *     by removing COMMENT lines and backtick SPANS (the old scan dropped
 *     whole lines containing a backtick, over-suppressing real code).
 *  2. DYNAMIC (real commit): a real `git commit` through the full hook
 *     chain — coordinator, lint-staged, lint runner, and every child
 *     process — runs with outbound sockets poisoned via
 *     NODE_OPTIONS="--require <block-net.cjs>", which propagates through
 *     git, sh, and every spawned node process. An invalid fixture is
 *     rejected and a valid one commits; if anything in the chain dialed
 *     out, the poison would crash it.
 *  3. NEGATIVE CONTROL: the same poison demonstrably BLOCKS networking —
 *     a loopback connect under the preload throws, without it succeeds
 *     (loopback only; no external network is used by this test).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const { createDisposableGateRepo } = await import(
  pathToFileURL(path.join(repoRoot, 'scripts', 'quality', 'disposable-gate.mjs')).href
);

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

/**
 * Explicitly excluded from the offline scan: SETUP-TIME tools that are
 * never part of the hook's execution graph (not referenced by pre-commit,
 * lint-staged, or any gate command) and are documented as requiring
 * network — the fresh-checkout drill's whole purpose is a real
 * `yarn install --frozen-lockfile` on a clean clone.
 */
const SETUP_TIME_TOOLS = new Set(['fresh-checkout-drill.mjs']);

/** Strip comments and backtick SPANS (hint strings) — never whole lines. */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/`[^`]*`/g, '``') // template-literal contents (hint text)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** Scan gate script files for network-capable APIs (skipping setup tools). */
function scanQualityScripts(files, offenders) {
  for (const file of files) {
    if (SETUP_TIME_TOOLS.has(path.basename(file))) continue;
    const code = codeOnly(readFileSync(file, 'utf8'));
    for (const pattern of NETWORK_PATTERNS) {
      if (pattern.test(code)) offenders.push(`${path.relative(repoRoot, file)} matched ${pattern}`);
    }
  }
}

describe('offline hook (AC-13)', () => {
  test('static: no network-capable API in the hook execution graph', () => {
    const files = listQualityScripts(path.join(repoRoot, 'scripts', 'quality'));
    assert.ok(files.length >= 10, 'sanity: gate scripts found');
    const offenders = [];
    scanQualityScripts(files, offenders);
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

  test('negative control: the socket poison blocks loopback, and only the poison does', async () => {
    const preload = path.join(os.tmpdir(), `qg-offline-nc-${process.pid}.cjs`);
    writeFileSync(
      preload,
      [
        'const net = require("node:net");',
        'const tls = require("node:tls");',
        'const poison = () => { throw new Error("OFFLINE-TEST: outbound socket blocked"); };',
        'net.connect = poison; net.createConnection = poison;',
        'tls.connect = poison;',
        'if (typeof globalThis.fetch === "function") globalThis.fetch = poison;',
        '',
      ].join('\n')
    );
    const server = createServer((socket) => socket.end());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const probe = `
      const net = require('node:net');
      const socket = net.connect(${port}, '127.0.0.1');
      socket.on('connect', () => { socket.end(); process.exit(0); });
      socket.on('error', () => process.exit(3));
      setTimeout(() => process.exit(4), 5000);
    `;
    try {
      const plain = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
      assert.equal(plain.status, 0, 'without the poison, loopback connect works');
      const poisoned = spawnSync(process.execPath, ['--require', preload, '-e', probe], {
        encoding: 'utf8',
      });
      assert.notEqual(poisoned.status, 0, 'with the poison, the connect attempt crashes');
      assert.match(poisoned.stderr, /OFFLINE-TEST/);
    } finally {
      server.close();
      rmSync(preload, { force: true });
    }
  });

  test('dynamic (V02): real commits run the full hook chain with sockets poisoned', () => {
    const preload = path.join(os.tmpdir(), `qg-offline-real-${process.pid}.cjs`);
    writeFileSync(
      preload,
      [
        'const net = require("node:net");',
        'const tls = require("node:tls");',
        'const poison = () => { throw new Error("OFFLINE-TEST: outbound socket blocked"); };',
        'net.connect = poison; net.createConnection = poison;',
        'tls.connect = poison;',
        'if (typeof globalThis.fetch === "function") globalThis.fetch = poison;',
        '',
      ].join('\n')
    );
    const repo = createDisposableGateRepo(repoRoot, 'offline');
    try {
      // NODE_OPTIONS propagates: git (sh) -> node coordinator -> lint-staged
      // -> lint runner -> every spawned child node process.
      const env = { ...process.env, NODE_OPTIONS: `--require ${JSON.stringify(preload)}` };
      const commit = (file, content, message) => {
        writeFileSync(path.join(repo.root, file), content);
        repo.run(['add', file]);
        const res = spawnSync('git', ['commit', '-m', message], {
          cwd: repo.root,
          encoding: 'utf8',
          env,
        });
        return res;
      };
      const bad = commit('Bad.ts', 'export const v: any = 1;\n', 'offline: invalid');
      assert.notEqual(bad.status, 0, 'invalid fixture must be rejected offline');
      assert.ok(
        (bad.stdout + bad.stderr).includes('OFFLINE-TEST') === false,
        'rejection must come from the gate, not from the poison tripping'
      );
      repo.run(['reset', '-q']);
      rmSync(path.join(repo.root, 'Bad.ts'), { force: true });
      const good = commit('Good.ts', 'export const two = 1 + 1;\n', 'offline: valid');
      assert.equal(good.status, 0, `valid fixture must commit offline:\n${good.stdout}${good.stderr}`);
      const combined = good.stdout + good.stderr;
      assert.ok(
        combined.includes('lint-staged') || combined.includes('quality:'),
        `the gate actually ran (not a bypass):\n${combined.slice(0, 400)}`
      );
    } finally {
      rmSync(preload, { force: true });
      rmSync(repo.root, { recursive: true, force: true });
    }
  });

});
