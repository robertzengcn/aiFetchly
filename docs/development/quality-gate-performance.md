# Local Commit Quality Gate — Performance Report

Date: 2026-10-23
Measured on the branch: `worktree-local-commit-quality-gate` (gate as of commit `c93dc1812`)

## Methodology (PRD §10)

- 20 measured runs per workload through a REAL `git commit` (hook fully
  wired: husky shim → coordinator → lint-staged → fast ESLint), in a
  disposable repo sharing this checkout's node_modules.
- p95 = sorted[⌈n×0.95⌉] over the 20 runs; median and min reported for
  context. Cold start reported separately below.
- Timing includes git's own commit bookkeeping (~25–30 ms floor observable
  in the docs-only workload, which never starts the engine).

## Results

| Workload | Runs | Median | p95 | PRD budget (p95) | Verdict |
|---|---|---|---|---|---|
| Documentation-only (no policy change) | 20 | 32 ms | 34 ms | < 1 s | PASS |
| 10 staged source files, ~5,000 lines | 20 | 842 ms | 862 ms | < 5 s | PASS |
| 50 staged source files, ~25,000 lines | 20 | 1,442 ms | 1,513 ms | < 15 s | PASS |

All three release budgets are met with wide margin.

## Cold start

Cold start = first engine invocation in a fresh process after a quiet
period (OS page cache for node_modules not guaranteed warm). The first
engine run of each measurement block (a fresh `node` process every commit —
the gate deliberately uses no cache) showed `min` within ~3% of the median
(see min column in a full run: 31 ms / 826 ms / 1,418 ms), i.e. cold vs
warm difference is noise at these sizes because every commit already pays
full process startup. There is no cross-commit cache to warm.

## Environment

| Item | Value |
|---|---|
| OS | WSL2 (Linux 6.18.54.1-microsoft-standard-WSL2) |
| CPU | 28 vCPU (host class) |
| RAM | (not restricted; node RSS during measurement ≈ 55 MB) |
| Node | v22.19.0 |
| eslint | 8.57.1 |
| eslint-plugin-sonarjs | 1.0.4 (exact) |
| typescript-eslint parser | 7.18.0 |
| vue-eslint-parser | 9.4.3 |
| lint-staged | 16.2.7 |
| File sizes | 10×500-line and 50×500-line TS fixtures, valid content |

## Scaling note

`sonarjs/no-identical-functions` is the most expensive enabled rule (O(file
set) comparisons); it is included in the measurements above. If a future
budget miss appears, profile per-rule time before changing the threshold:
the numbers above include it with ~10× headroom. macOS/Windows were not
measured (see the platform note in `local-quality-gate.md`).
