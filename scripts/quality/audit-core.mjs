/**
 * Pure audit-report computation (F11) — shared by the audit command and
 * its tests. No I/O: the command feeds tallied findings, the loaded
 * manifest, and the inventory; this module derives stale entries,
 * tightening candidates, ceiling breaches, unmanifested pairs, code
 * defects that can never be excepted, and reviewable draft entries.
 */

import { parseComplexity, isExceptableRuleId } from './check-exceptions.mjs';

const COMPLEXITY_RULE = 'sonarjs/cognitive-complexity';

/**
 * @param {Array<{path:string, ruleId:string|null, severity:number, fatal?:boolean, line?:number, column?:number, message:string}>} findings
 * @param {{exceptions: Array<object>}} manifest loaded manifest (validated)
 * @param {Set<string>} inventory audited paths (for stale-reason precision)
 */
export function buildAuditReport(findings, manifest, inventory) {
  const tallies = tallyFindings(findings);
  const entryAnalysis = analyzeManifestEntries(manifest.exceptions, tallies, inventory);
  const draft = draftUnmanifested(tallies, entryAnalysis.manifestKeys, tallies.codeDefects);
  return {
    totalBlockers: tallies.blockerCount,
    distinctPairs: tallies.pairCounts.size,
    byRule: summarizeByRule(tallies.pairCounts),
    stale: entryAnalysis.stale,
    expired: entryAnalysis.expired,
    tightening: entryAnalysis.tightening,
    ceilingExceeded: entryAnalysis.ceilingExceeded,
    codeDefects: tallies.codeDefects,
    draft,
  };
}

/** Count blockers per (path, rule), complexity positions, and code defects. */
function tallyFindings(findings) {
  const blockers = findings.filter((f) => f.fatal === true || f.severity === 2);
  const pairCounts = new Map();
  const complexityByPath = new Map();
  const codeDefects = [];
  for (const f of blockers) {
    if (f.fatal === true || f.ruleId == null) {
      codeDefects.push(f); // fatal/no-rule: fixes, never allowances
      continue;
    }
    const key = `${f.path}::${f.ruleId}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    if (f.ruleId !== COMPLEXITY_RULE) continue;
    const keep = tallyComplexityFinding(f, key, pairCounts, complexityByPath);
    if (!keep) codeDefects.push({ ...f, message: `unparseable complexity message: ${f.message}` });
  }
  return { blockerCount: blockers.length, pairCounts, complexityByPath, codeDefects };
}

/** Record one complexity finding's position; false when unparseable. */
function tallyComplexityFinding(f, key, pairCounts, complexityByPath) {
  const value = parseComplexity(f.message);
  if (value == null) {
    pairCounts.set(key, pairCounts.get(key) - 1); // do not count the defect
    return false;
  }
  if (!complexityByPath.has(f.path)) complexityByPath.set(f.path, []);
  complexityByPath.get(f.path).push({ line: f.line, column: f.column, value });
  return true;
}

function summarizeByRule(pairCounts) {
  const byRule = new Map();
  for (const [key, count] of pairCounts) {
    const rule = key.split('::')[1];
    if (!byRule.has(rule)) byRule.set(rule, { files: 0, findings: 0 });
    byRule.get(rule).files += 1;
    byRule.get(rule).findings += count;
  }
  return [...byRule.entries()]
    .map(([rule, { files, findings }]) => ({ rule, files, findings }))
    .sort((a, b) => b.findings - a.findings);
}

/** Compare every manifest entry against observed reality. */
function analyzeManifestEntries(exceptions, tallies, inventory) {
  const out = { stale: [], expired: [], tightening: [], ceilingExceeded: [], manifestKeys: new Set() };
  for (const entry of exceptions) {
    out.manifestKeys.add(`${entry.path}::${entry.ruleId}`);
    if (entry.expired) {
      out.expired.push({ path: entry.path, ruleId: entry.ruleId, expiresOn: entry.expiresOn });
    }
    if (entry.ruleId === COMPLEXITY_RULE) {
      analyzeComplexityEntry(entry, tallies, inventory, out);
    } else {
      analyzeOrdinaryEntry(entry, tallies, inventory, out);
    }
  }
  return out;
}

/** Distinguish a deleted/excluded file from a rule that stopped firing. */
function pushStale(entry, inventory, out) {
  const reason = inventory.has(entry.path)
    ? 'rule no longer fires on this file'
    : 'file is not in the audited inventory (deleted or excluded)';
  out.stale.push({ path: entry.path, reason });
}

function analyzeOrdinaryEntry(entry, tallies, inventory, out) {
  const current = tallies.pairCounts.get(`${entry.path}::${entry.ruleId}`) ?? 0;
  if (current === 0) {
    pushStale(entry, inventory, out);
  } else if (current < entry.maxCount) {
    // F11: nonzero reductions are tightening candidates, not only
    // complete disappearance.
    out.tightening.push({
      path: entry.path, ruleId: entry.ruleId, kind: 'count',
      detail: `finding count ${entry.maxCount} -> ${current}`,
    });
  }
}

function analyzeComplexityEntry(entry, tallies, inventory, out) {
  const observed = tallies.complexityByPath.get(entry.path) ?? [];
  if (observed.length === 0 && !tallies.pairCounts.has(`${entry.path}::${entry.ruleId}`)) {
    pushStale(entry, inventory, out);
    return;
  }
  for (const fn of entry.functions ?? []) {
    const at = observed.find((o) => o.line === fn.line && o.column === fn.column);
    if (at === undefined) {
      out.tightening.push({
        path: entry.path, ruleId: entry.ruleId, kind: 'function-gone',
        detail: `baselined function at ${fn.line}:${fn.column} no longer exists — remove its identity`,
      });
    } else if (at.value > fn.maxComplexity) {
      out.ceilingExceeded.push({
        path: entry.path, ruleId: entry.ruleId,
        detail: `function at ${fn.line}:${fn.column} observed ${at.value} > allowed ${fn.maxComplexity} (would block when touched)`,
      });
    } else if (at.value < fn.maxComplexity) {
      out.tightening.push({
        path: entry.path, ruleId: entry.ruleId, kind: 'function-ceiling',
        detail: `function at ${fn.line}:${fn.column} eased ${fn.maxComplexity} -> ${at.value}`,
      });
    }
  }
  if (observed.length < entry.maxCount) {
    out.tightening.push({
      path: entry.path, ruleId: entry.ruleId, kind: 'count',
      detail: `over-threshold functions ${entry.maxCount} -> ${observed.length}`,
    });
  }
  const observedSum = observed.reduce((n, o) => n + o.value, 0);
  if (entry.maxTotalComplexity !== undefined && observedSum < entry.maxTotalComplexity) {
    out.tightening.push({
      path: entry.path, ruleId: entry.ruleId, kind: 'aggregate',
      detail: `total complexity ${entry.maxTotalComplexity} -> ${observedSum}`,
    });
  }
}

/** Draft entries ONLY for exceptable, resolved rules with no entry yet. */
function draftUnmanifested(tallies, manifestKeys, codeDefects) {
  const draft = [];
  for (const [key, count] of [...tallies.pairCounts.entries()].sort()) {
    const [file, rule] = key.split('::');
    if (manifestKeys.has(key)) continue;
    if (!isExceptableRuleId(rule)) {
      codeDefects.push({ path: file, ruleId: rule, message: 'unexceptable rule fired — fix the code' });
      continue;
    }
    draft.push(draftEntryFor(file, rule, count, tallies.complexityByPath));
  }
  return draft;
}

function draftEntryFor(file, rule, count, complexityByPath) {
  const entry = {
    path: file,
    ruleId: rule,
    maxCount: count,
    reason: 'REVIEW BEFORE ADOPTING: legacy baseline from quality audit',
    owner: 'maintainer',
    expiresOn: '2027-01-31',
  };
  if (rule !== COMPLEXITY_RULE) return entry;
  const fns = (complexityByPath.get(file) ?? [])
    .sort((a, b) => a.line - b.line || a.column - b.column)
    .map((o) => ({ line: o.line, column: o.column, maxComplexity: o.value }));
  entry.functions = fns;
  entry.maxCount = fns.length;
  entry.maxComplexity = Math.max(0, ...fns.map((fn) => fn.maxComplexity));
  entry.maxTotalComplexity = fns.reduce((n, fn) => n + fn.maxComplexity, 0);
  return entry;
}
