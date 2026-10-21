/**
 * Single source of staged-task configuration for the quality gate
 * (tech design §7.D). The coordinator invokes lint-staged with exactly this
 * file; filenames are appended by lint-staged as ARRAY arguments to the
 * runner (no shell word splitting, AC-07), and its default backup +
 * hidden-partially-staged isolation guarantees the runner sees the STAGED
 * versions of staged files even when unstaged edits exist (AC-04/05).
 */

export default {
  // Only the supported source extensions are gated; everything else
  // (docs, config, assets) never starts the lint engine via this task.
  '*.{js,jsx,cjs,mjs,ts,tsx,vue}': 'node scripts/quality/lint-files.mjs',
};
