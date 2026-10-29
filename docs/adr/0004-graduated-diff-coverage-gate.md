# ADR-0004: Graduated diff-coverage gate, not blanket 80%

- **Status:** Accepted
- **Workstream:** WS-2 (R2.4)
- **Date:** 2026-07-10

## Context

The project mandates ≥80% coverage, but CI previously ran **zero** tests and
there is no coverage tooling. A blanket 80% gate applied to legacy code would
block almost every PR (much of `src/` is untested scrapers) and incentivize
gaming.

## Decision

1. **Add coverage tooling** (`@vitest/coverage-v8`) and a unified `yarn test:ci`
   (mocha + vitest) that emits `lcov`.
2. **Measure a baseline** per directory (`docs/test-coverage-baseline.md`).
3. **Gate changed-line (diff) coverage at 80%** on new/changed lines, not a
   blanket floor on all of `src/`.
4. **Ratchet a global floor** at baseline − 2% to prevent silent regression;
   raise it quarterly toward the measured median.
5. Preserve the existing `tsc --noEmit` type-check gate (CI must not use
   `AIFETCHLY_SKIP_TSC`).

The CI test job ships with `continue-on-error: true` initially, then hardens
once the suite is reliably green (the PRD anticipates day-1 flakiness).

## Consequences

- + New/changed code is held to 80%; legacy can be refactored without a coverage
  cliff.
- + A measurable, ratcheting signal replaces "unmeasurable."
- − Diff-coverage tooling still needs wiring (a diff-aware reporter comparing
  coverage to the PR diff); the lcov artifact is produced now, the diff gate is
  the next step.

## Alternatives considered

- **Blanket 80% on `src/`:** rejected — blocks legacy refactors immediately,
  encourages gaming.
- **No floor, diff-coverage only:** rejected — no protection against whole-file
  regressions outside the diff.
