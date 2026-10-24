#!/usr/bin/env node
/**
 * Repeatable performance harness (PRD §10; V05) for the three budget
 * workloads, measured through REAL `git commit` runs with the hook fully
 * wired (husky shim → coordinator → lint-staged → fast ESLint) inside a
 * disposable repo sharing this checkout's node_modules.
 *
 * Workloads (PRD §10 acceptance budgets):
 *   A. documentation-only commit (no policy change)          p95 < 1 s
 *   B. 10 staged source files, ~5,000 total lines            p95 < 5 s
 *   C. 50 staged source files, ~25,000 total lines           p95 < 15 s
 *
 * Method notes (kept honest):
 *  - Timing is wall-clock around the whole `git commit` invocation, so it
 *    includes git's own bookkeeping (~25–30 ms floor visible in workload A,
 *    which never starts the engine).
 *  - p95 uses ONE-BASED rank r = ceil(0.95 × n) over the ascending sorted
 *    samples, i.e. the element at ZERO-BASED index r − 1. p50 likewise.
 *  - Cold start: the FIRST run of each workload happens in a brand-new
 *    disposable repo before any other engine activity in that repo, and is
 *    recorded separately (coldStartSample). The gate uses no caches, so
 *    every commit pays full process startup; OS page-cache state beyond
 *    that cannot be controlled and is not claimed.
 *  - The corpus is deterministic (index-seeded content; no randomness), so
 *    runs are comparable across machines and over time.
 *
 * Usage: node scripts/quality/benchmark.mjs [runs-per-workload=20]
 *        [--json-out <path>]  (default: print JSON to stdout footer)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { createDisposableGateRepo, removeDisposableGateRepo } = await import(
  './disposable-gate.mjs'
);

const args = process.argv.slice(2);
const runs = Number.parseInt(args.find((a) => /^\d+$/.test(a)) ?? '20', 10);
const jsonOutIdx = args.indexOf('--json-out');
const jsonOut = jsonOutIdx >= 0 ? args[jsonOutIdx + 1] : null;

/** Deterministic, lint-clean 500-line TS corpus for one file. */
function corpusFor(fileIndex) {
  const lines = [];
  for (let i = 0; i < 500; i += 1) {
    const n = fileIndex * 1000 + i;
    lines.push(
      `export function computeValue${n}(param: number): number { return param * ${n} + ${n % 7}; }`
    );
  }
  return lines.join('\n') + '\n';
}

function timeCommit(repo, message) {
  const start = process.hrtime.bigint();
  const res = repo.run(['commit', '-m', message]);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  return { status: res.status, elapsedMs };
}

/** One workload: (label, prepare) — prepare stages the run's files. */
function measureWorkload(label, budgets, prepare) {
  const repo = createDisposableGateRepo(repoRoot, `bench-${label}`);
  const samples = [];
  let coldStartSample = null;
  try {
    for (let i = 0; i < runs; i += 1) {
      prepare(repo, i);
      const { status, elapsedMs } = timeCommit(repo, `bench ${label} run ${i}`);
      if (status !== 0) throw new Error(`${label} run ${i} failed to commit (exit ${status})`);
      if (i === 0) coldStartSample = elapsedMs; // first engine run in this repo
      samples.push(elapsedMs);
      // Drop the commit so every run starts from the same baseline state.
      repo.run(['reset', '-q', '--hard', 'HEAD~1']);
    }
    return { label, runs, samples, coldStartSample, budgetP95Ms: budgets };
  } finally {
    removeDisposableGateRepo(repo.root);
  }
}

/** One-based rank percentile over ascending samples (see header). */
function percentile(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length); // one-based
  return sorted[rank - 1]; // zero-based index
}

function summarizeEnvironment() {
  const cpus = os.cpus();
  const pkg = (name) => {
    try {
      return require(`${name}/package.json`, { paths: [repoRoot] }).version;
    } catch {
      return 'unknown';
    }
  };
  return {
    os: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
    cpuModel: cpus.length > 0 ? cpus[0].model : 'unknown',
    cpuCount: cpus.length,
    workstationTotalRamBytes: os.totalmem(),
    workstationFreeRamBytes: os.freemem(),
    node: process.versions.node,
    packages: {
      eslint: pkg('eslint'),
      'eslint-plugin-sonarjs': pkg('eslint-plugin-sonarjs'),
      '@typescript-eslint/parser': pkg('@typescript-eslint/parser'),
      'vue-eslint-parser': pkg('vue-eslint-parser'),
      'lint-staged': pkg('lint-staged'),
    },
  };
}

process.stdout.write(`quality benchmark: ${runs} run(s) per workload, real git commits\n`);

const docsWorkload = measureWorkload('docs-only', 1000, (repo) => {
  writeFileSync(
    path.join(repo.root, 'README.md'),
    `# benchmark ${Date.now()}\n\nDocumentation-only commit workload.\n`
  );
  repo.run(['add', 'README.md']);
});

const smallCorpus = [];
const mediumWorkload = measureWorkload('10-files-5k-lines', 5000, (repo, i) => {
  // Re-created every run: `git reset --hard` removes the committed files
  // and prunes the empty directory.
  mkdirSync(path.join(repo.root, 'bench'), { recursive: true });
  const files = [];
  for (let f = 0; f < 10; f += 1) {
    const rel = `bench/small${f}.ts`;
    writeFileSync(path.join(repo.root, rel), corpusFor(f));
    files.push(rel);
    if (i === 0) smallCorpus.push({ path: rel, lines: 500 });
  }
  repo.run(['add', ...files]);
});

const largeCorpus = [];
const largeWorkload = measureWorkload('50-files-25k-lines', 15000, (repo, i) => {
  mkdirSync(path.join(repo.root, 'bench'), { recursive: true });
  const files = [];
  for (let f = 0; f < 50; f += 1) {
    const rel = `bench/large${f}.ts`;
    writeFileSync(path.join(repo.root, rel), corpusFor(100 + f));
    files.push(rel);
    if (i === 0) largeCorpus.push({ path: rel, lines: 500 });
  }
  repo.run(['add', ...files]);
});

const workloads = [docsWorkload, mediumWorkload, largeWorkload].map((w) => ({
  label: w.label,
  runs: w.runs,
  budgetP95Ms: w.budgetP95Ms,
  coldStartSampleMs: round(w.coldStartSample),
  medianMs: round(percentile(w.samples, 0.5)),
  minMs: round(Math.min(...w.samples)),
  maxMs: round(Math.max(...w.samples)),
  p95Ms: round(percentile(w.samples, 0.95)),
  verdict: percentile(w.samples, 0.95) < w.budgetP95Ms ? 'PASS' : 'MISS',
  rawSamplesMs: w.samples.map(round),
}));

function round(n) {
  return Math.round(n * 100) / 100;
}

const corpus = {
  small: { files: smallCorpus.length, linesPerFile: 500, bytesPerFile: Buffer.byteLength(corpusFor(0)) },
  large: { files: largeCorpus.length, linesPerFile: 500, bytesPerFile: Buffer.byteLength(corpusFor(100)) },
};

const document = {
  schema: 'quality-gate-benchmark/1',
  date: new Date().toISOString().slice(0, 10),
  runsPerWorkload: runs,
  percentileDefinition:
    'one-based rank r = ceil(p * n) over ascending samples; element at zero-based index r-1',
  timingScope: 'wall clock around the whole `git commit` invocation (hook fully wired)',
  coldStartMethod:
    'first run of the workload in a brand-new disposable repo, recorded separately from the warm series; the gate uses no caches',
  environment: summarizeEnvironment(),
  corpus,
  workloads,
};

const human = workloads
  .map(
    (w) =>
      `${w.label}: median ${w.medianMs} ms, p95 ${w.p95Ms} ms (budget ${w.budgetP95Ms} ms -> ${w.verdict}), cold ${w.coldStartSampleMs} ms`
  )
  .join('\n');
process.stdout.write(`\n${human}\n`);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(document, null, 2) + '\n');
  process.stdout.write(`raw samples written to ${jsonOut}\n`);
} else {
  process.stdout.write(JSON.stringify(document) + '\n');
}
process.exit(workloads.every((w) => w.verdict === 'PASS') ? 0 : 1);
