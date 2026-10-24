# Local Commit Quality Gate — Performance Report

Date: 2026-10-24 · Branch `worktree-local-commit-quality-gate`

Produced by the COMMITTED repeatable harness
`scripts/quality/benchmark.mjs` (also `yarn quality:benchmark`). Raw
per-run sample series: [quality-gate-performance-samples.json](quality-gate-performance-samples.json)
(schema `quality-gate-benchmark/1`).

## Methodology (PRD §10)

- 20 measured runs per workload through a REAL `git commit` (hook fully
  wired: husky shim → coordinator → lint-staged → fast ESLint), in a
  disposable repo sharing this checkout's node_modules; after every run
  the commit is reset so each run starts from identical baseline state.
- **Percentile definition (unambiguous):** p95 uses the ONE-BASED rank
  r = ⌈0.95 × n⌉ over the ascending sorted samples and takes the element
  at ZERO-BASED index r − 1 (for n = 20: r = 19, index 18). p50 likewise.
- Timing is wall clock around the whole `git commit` invocation — it
  includes git's own bookkeeping (~30 ms floor visible in the docs-only
  workload, which never starts the engine).
- **Cold start** is measured separately: the FIRST run of each workload
  happens in a brand-new disposable repo before any other engine activity
  there, and is reported as `coldStartSampleMs` rather than mixed into the
  series. The gate uses no caches, so every commit pays full process
  startup; OS page-cache state beyond that cannot be controlled and is not
  claimed.
- The corpus is deterministic and index-seeded (500 exported, fully
  annotated functions per file — a near-worst-case shape for
  `sonarjs/no-identical-functions`'s O(file-set) comparisons), so runs are
  comparable across machines and over time. These numbers are therefore
  CONSERVATIVE relative to typical application code.

## Results (raw series in the JSON artifact)

| Workload | Runs | Cold start | Median | p95 | PRD budget (p95) | Verdict |
|---|---|---|---|---|---|---|
| Documentation-only (no policy change) | 20 | 37.25 ms | 33.03 ms | 35.57 ms | < 1 s | **PASS** |
| 10 staged source files, 5,000 lines (≈41 KB/file) | 20 | 1,334.75 ms | 1,336.2 ms | 1,440.42 ms | < 5 s | **PASS** |
| 50 staged source files, 25,000 lines (≈44 KB/file) | 20 | 3,086.95 ms | 3,061.34 ms | 3,125.66 ms | < 15 s | **PASS** |

All three release budgets are met — with a deliberately adversarial
corpus — at 3.5–28× headroom. Cold-start samples sit within ~2% of the
medians: because every commit spawns fresh processes and the gate keeps no
caches, there is no warm path whose loss could surprise later.

Historical note: the 2026-10-23 report quoted p95 34 / 862 / 1,513 ms from
an unversioned one-off script with an unspecified corpus; its samples were
not retained and its p95 indexing was not stated. This report supersedes
it with the committed harness, retained raw series, explicit percentile
definition, and a harsher corpus.

## Environment (from the JSON artifact)

| Item | Value |
|---|---|
| OS | Linux 6.18.54.1-microsoft-standard-WSL2 (linux/x64) |
| CPU | Intel(R) Core(TM) i7-14700KF, 28 logical cores |
| Workstation RAM | 25,197,391,872 bytes (≈23.5 GiB total; ≈12.2 GiB free at measurement) |
| Node | v22.19.0 |
| eslint / sonarjs / ts-parser / vue-parser / lint-staged | 8.57.1 / 1.0.4 / 7.18.0 / 9.4.3 / 16.2.7 |
| Corpus | deterministic; 500 lines and ≈41–44 KB per file (see JSON `corpus`) |

## Reproducing

```sh
yarn quality:benchmark 20 --json-out /tmp/samples.json
```

The harness exits nonzero if any workload misses its p95 budget, so it can
gate a release checklist. macOS/Windows were not measured (see the
platform status in quality-gate-compatibility.md).
