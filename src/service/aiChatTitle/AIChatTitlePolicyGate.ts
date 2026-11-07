/**
 * Titles audit B08 (design §5.4): serialize the short policy-check/commit
 * decision with settings mutation.
 *
 * Settings changes (provider mode/config/key, title-model, auto-titles
 * toggle) bump this epoch SYNCHRONOUSLY before their own first await. The
 * generated-title commit re-checks the epoch in the SAME synchronous block
 * as its SQLite UPDATE (raw better-sqlite3, no awaits) — a settings change
 * can therefore never interleave between the check and the commit.
 */
let titlePolicyEpoch = 0;

export function currentTitlePolicyEpoch(): number {
  return titlePolicyEpoch;
}

/** Settings mutations call this synchronously, before any await. */
export function bumpTitlePolicyEpoch(): void {
  titlePolicyEpoch += 1;
}
