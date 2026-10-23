/**
 * Legacy exception manifest: validation + allowance application (§9).
 *
 * The manifest (`scripts/quality/exceptions.json`) is the ONLY debt
 * mechanism. Rules:
 *  - Ordinary rules: an entry allows at most `maxCount` CURRENT findings for
 *    its (path, ruleId) pair. More findings than the ceiling → the excess
 *    blocks. Fewer is fine (debt may shrink).
 *  - Cognitive complexity: BOTH the finding count and the maximum observed
 *    complexity must stay ≤ the ceilings (`maxCount`, `maxComplexity`).
 *    The numeric value is extracted by a version-specific adapter isolated
 *    in `parseComplexity`; unknown message formats FAIL CLOSED for
 *    exceptional files (never a silent regex fallback).
 *  - Expired entries (today > expiresOn) do not apply when their file is
 *    touched; the finding blocks.
 *  - Fatal/parse errors and unknown-rule operational noise can never be
 *    excepted.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MANIFEST_PATH = path.join(repoRoot, 'scripts', 'quality', 'exceptions.json');
const COMPLEXITY_RULE = 'sonarjs/cognitive-complexity';

/**
 * Extract the numeric cognitive complexity from a SonarJS message.
 * SonarJS 1.0.4 emits: "Refactor this function to reduce its Cognitive
 * Complexity from 36 to the 15 allowed." Isolated here so a pinned-plugin
 * upgrade only changes this adapter. Unknown format → null (fail closed).
 */
export function parseComplexity(message) {
  const m = /Cognitive Complexity from (\d+)/i.exec(String(message));
  return m ? Number(m[1]) : null;
}

/** Load + validate the manifest. Returns { exceptions, errors } . */
export function loadManifest(manifestPath = MANIFEST_PATH) {
  let raw;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    return { exceptions: [], errors: ['manifest file is missing or unreadable'] };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { exceptions: [], errors: [`manifest is not valid JSON: ${e.message}`] };
  }
  const errors = [];
  if (parsed.schemaVersion !== 1) {
    errors.push(`unsupported schemaVersion: ${parsed.schemaVersion}`);
  }
  if (!Array.isArray(parsed.exceptions)) {
    errors.push('exceptions must be an array');
    return { exceptions: [], errors };
  }
  const seen = new Set();
  // LOCAL calendar date, not UTC: expiry dates are written in the
  // maintainer's local frame; toISOString would flip a day early/late near
  // midnight (BUG-18).
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const exceptions = [];
  for (const entry of parsed.exceptions) {
    const label = `${entry.path}::${entry.ruleId}`;
    if (seen.has(label)) {
      errors.push(`duplicate (path, ruleId) pair: ${label}`);
      continue;
    }
    seen.add(label);
    validateEntry(entry, label, errors);
    exceptions.push({ ...entry, expired: String(entry.expiresOn) < today });
  }
  return { exceptions, errors };
}

/** Per-entry manifest validation (schema §9). Mutates `errors`. */
function validateEntry(entry, label, errors) {
  if (typeof entry.path !== 'string' || entry.path.startsWith('/') || entry.path.includes('..')) {
    errors.push(`invalid path in ${label}: must be an exact repo-relative path`);
  }
  if (typeof entry.ruleId !== 'string' || entry.ruleId.includes('*')) {
    errors.push(`invalid ruleId in ${label}: wildcards are forbidden`);
  }
  if (!Number.isInteger(entry.maxCount) || entry.maxCount < 0) {
    errors.push(`invalid maxCount in ${label}: must be a nonnegative integer`);
  }
  if (entry.ruleId === COMPLEXITY_RULE) {
    validateComplexityCeilings(entry, label, errors);
  }
  if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0) {
    errors.push(`empty reason in ${label}`);
  }
  if (typeof entry.owner !== 'string' || entry.owner.trim().length === 0) {
    errors.push(`empty owner in ${label}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.expiresOn))) {
    errors.push(`invalid expiresOn in ${label}: expected YYYY-MM-DD`);
  }
}

/**
 * Complexity-specific ceilings (BUG-3): per-function maxComplexity is
 * required; the aggregate maxTotalComplexity bounds total growth across
 * the file's functions (absent on legacy entries, drafted by the audit).
 * Mutates `errors`.
 */
function validateComplexityCeilings(entry, label, errors) {
  if (!Number.isInteger(entry.maxComplexity) || entry.maxComplexity < 0) {
    errors.push(`complexity entry ${label} requires a nonnegative integer maxComplexity`);
  }
  if (
    entry.maxTotalComplexity !== undefined &&
    (!Number.isInteger(entry.maxTotalComplexity) || entry.maxTotalComplexity < 0)
  ) {
    errors.push(`complexity entry ${label} has an invalid maxTotalComplexity`);
  }
}

/**
 * Apply allowances to ESLint results (mutating copies, never the engine's
 * result objects). Returns { results, acceptedDebt, errors }.
 */
export function applyExceptions(results, manifestPath = MANIFEST_PATH) {
  const { exceptions, errors } = loadManifest(manifestPath);
  if (errors.length > 0) {
    return { results, acceptedDebt: 0, errors };
  }
  const byKey = new Map(exceptions.map((e) => [`${e.path}::${e.ruleId}`, e]));

  let acceptedDebt = 0;
  const out = results.map((result) => {
    const rel = path.relative(repoRoot, result.filePath).split(path.sep).join('/');
    const kept = [];
    // Count blockers per rule for this file AFTER exception filtering.
    for (const message of result.messages) {
      if (message.fatal) {
        // Parse errors are never exceptable.
        kept.push(message);
        continue;
      }
      if (message.severity !== 2) {
        kept.push(message);
        continue;
      }
      const key = `${rel}::${message.ruleId}`;
      const entry = byKey.get(key);
      if (!entry) {
        kept.push(message);
        continue;
      }
      if (entry.expired) {
        // Expired allowance: finding blocks (audit catches untouched files).
        kept.push(message);
        continue;
      }
      // Both ordinary and complexity findings are counted in the second
      // pass; complexity findings additionally face the numeric ceiling.
      kept.push(message);
      message.__qgExceptionKey = key;
    }
    return { ...result, messages: kept };
  });

  // Second pass: enforce ceilings per (path, rule) among stashed findings.
  // AC-08: at most maxCount findings may be accepted — debt never grows.
  // AC-09: a complexity finding blocks when (a) its observed value exceeds
  // maxComplexity, (b) the message format is unknown (fail closed), or
  // (c) the file's AGGREGATE complexity sum would exceed maxTotalComplexity
  // — the sum ceiling is what catches "a lesser function rises while the
  // count stays the same" on multi-function files (BUG-3).
  const counts = new Map();
  const complexitySums = new Map(); // "path::rule" -> running accepted sum
  for (const result of out) {
    result.messages = result.messages.filter((message) => {
      if (!message.__qgExceptionKey) return true;
      const entry = byKey.get(message.__qgExceptionKey);
      const used = counts.get(message.__qgExceptionKey) || 0;
      const accepted = acceptFinding(message, entry, used, complexitySums);
      if (accepted) {
        counts.set(message.__qgExceptionKey, used + 1);
        acceptedDebt += 1;
        return false; // within allowance: accepted debt
      }
      delete message.__qgExceptionKey;
      return true; // over allowance, over ceiling, or over aggregate: blocks
    });
  }
  return { results: out, acceptedDebt, errors: [] };
}

/**
 * Complexity-acceptance decision for one finding (BUG-3): within count,
 * within per-function ceiling (fail-closed on unknown format), and within
 * the file's AGGREGATE sum ceiling. Mutates `complexitySums` on acceptance.
 */
function acceptFinding(message, entry, used, complexitySums) {
  if (used >= entry.maxCount) return false;
  if (entry.ruleId !== COMPLEXITY_RULE) return true;
  const observed = parseComplexity(message.message);
  if (observed == null || observed > entry.maxComplexity) return false;
  if (entry.maxTotalComplexity !== undefined) {
    const running = complexitySums.get(message.__qgExceptionKey) || 0;
    if (running + observed > entry.maxTotalComplexity) return false;
  }
  complexitySums.set(
    message.__qgExceptionKey,
    (complexitySums.get(message.__qgExceptionKey) || 0) + observed
  );
  return true;
}

export const _internals = { repoRoot, MANIFEST_PATH };
