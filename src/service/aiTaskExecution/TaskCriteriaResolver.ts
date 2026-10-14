/**
 * Structural criteria compiler (T01, FR-19).
 *
 * Derives a readonly set of `TaskCriterion` from an ordinary manual user
 * message so the completion policy can freeze a source-anchored contract
 * BEFORE the first task action dispatches. Pure structural parsing — no LLM,
 * no authorization broadening (design §5.1: "a model's extraction alone
 * never enables additional actions").
 *
 * The compiler only restates explicit request content as verifiable criteria:
 *   - count/target      → `record_count`  ("save 100 contacts to camp-1",
 *     qualifiers retained: "save 100 qualifying contacts")
 *   - operation/send    → `operation_receipt` ("send an email to the list")
 *   - observation       → `observation`  ("check the deployment status" —
 *     retrieval only; "report ..." is a deliverable, see below)
 *   - report            → `qualitative`  ("report it to me" → "Report:
 *     <prior topic>"; pronouns resolve against the previous clause)
 *   - text deliverable   → `qualitative`  ("write a blog post about X")
 *   - conjunction       → one criterion per clause, with the governing verb
 *     carried into verbless continuations ("write a blog post and a tweet"
 *     keeps both); uncompilable clauses become required fallbacks, never
 *     silent drops.
 *
 * Ambiguous scope (action verb, no extractable target/count/text) emits a
 * `qualitative` fallback criterion spanning the whole message so the
 * controller has unmet work to continue on (AC-02/18) — but it can never pass
 * without a checker, so the request stays explicitly unverified (AC-21,
 * NFR-12). The compiler never invents targets, recipients, or actions.
 *
 * Every criterion carries `sourceRefs` anchored to real character spans of
 * the user message; `freeze()` validates those offsets against
 * `approvedSourceContents` (T17's offset-validation gap closed here).
 */
import type {
  TaskCriterion,
  TaskExecutionRoute,
} from "@/entityTypes/aiTaskExecutionTypes";

export interface CompileInput {
  readonly userMessage: string;
  readonly sourceUserMessageId: string;
  readonly route: TaskExecutionRoute;
  readonly approvedSourceMessageIds: readonly string[];
}

export interface CompileResult {
  readonly criteria: readonly TaskCriterion[];
  readonly ambiguityReason: string | null;
}

interface Clause {
  readonly text: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

/**
 * Verbs that imply collecting/saving a count of records. When followed by a
 * number, the clause becomes a `record_count` criterion. Aligned with
 * `TaskRequestResolver.ACTION_VERBS` so the compiler and router agree on
 * what counts as an actionable collection verb.
 */
const COLLECTION_VERBS = [
  "save",
  "collect",
  "gather",
  "add",
  "import",
  "export",
  "extract",
  "scrape",
  "fetch",
  "find",
  "search",
] as const;

/**
 * Verbs that imply a consequential operation with a target state. The clause
 * becomes an `operation_receipt` criterion requiring `completed` state.
 */
const OPERATION_VERBS = [
  "send",
  "post",
  "publish",
  "deploy",
  "start",
  "finish",
] as const;

/**
 * Verbs that imply retrieving/observing a current state. The clause becomes
 * an `observation` criterion. Aligned with `TaskRequestResolver.RETRIEVAL_VERBS`.
 * NOTE: "report" is intentionally absent — reporting (produce + deliver a
 * report on a topic, B02) is a deliverable, not a retrieval; REPORT_VERBS
 * below handles it before this list is consulted.
 */
const OBSERVATION_VERBS = [
  "check",
  "monitor",
  "verify",
] as const;

/**
 * B02 (FR-01/02/03/18/19): report verbs. "Report <topic> [to me]" produces
 * and delivers a report — a qualitative deliverable on the topic, never an
 * observation for a literal "it-to-me" target. Pronouns (it/this/that) resolve
 * against the previous clause's topic; unresolvable topics fall back to an
 * ambiguous required fallback (never a fabricated target).
 */
const REPORT_VERBS = [
  "report",
] as const;

/**
 * B02: single-word noun qualifiers retained in count descriptions ("Save
 * 100 qualifying contacts" must not lose "qualifying"). Closed adjective
 * list on purpose: an open `(\w+)` group would eat the noun itself ("100
 * contacts to camp" → qualifier "contacts", noun "to"), while adjectives
 * in this list are never the clause noun in grammatical requests. Unknown
 * adjectives behave exactly as before (first word becomes the noun).
 */
const COUNT_QUALIFIERS = [
  "qualifying",
  "qualified",
  "new",
  "active",
  "recent",
  "verified",
  "targeted",
  "potential",
  "matching",
  "filtered",
] as const;

/**
 * Verbs that imply producing a text/artifact deliverable. The clause becomes
 * a `qualitative` criterion (no count to verify — checker LLM evaluates).
 */
const DELIVERABLE_VERBS = [
  "write",
  "draft",
  "compose",
  "generate",
  "create",
  "summarize",
] as const;

/**
 * Leading politeness prefixes to strip before verb matching — mirrors
 * `TaskRequestResolver.POLITE_PREFIXES` so the compiler and router agree on
 * what counts as the imperative lead. "Please save 100 contacts" must match
 * the count pattern even though the clause starts with "please".
 */
const POLITE_PREFIXES = [
  "please ",
  "could you ",
  "can you ",
  "would you ",
  "kindly ",
  "i need you to ",
  "i want you to ",
] as const;

/**
 * CJK (Chinese/Japanese) polite-request prefixes — mirrors
 * `TaskRequestResolver.CJK_POLITE_PREFIXES` so the compiler and router agree
 * on the CJK imperative lead. "请保存100个联系人" strips to
 * "保存100个联系人" so the CJK count pattern matches (T18, FR-17).
 */
const CJK_POLITE_PREFIXES = [
  "请",
  "麻烦你",
  "麻烦",
  "请帮我",
  "请你",
  "帮我",
] as const;

/**
 * CJK collection verbs (Chinese simplified + Japanese kanji forms) — mirrors
 * `TaskRequestResolver.CJK_ACTION_VERBS` for the count pattern. Aligned so
 * the compiler and router agree on CJK collection verbs (T18, FR-19).
 */
const CJK_COLLECTION_VERBS = [
  "保存",
  "收集",
  "采集",
  "抓取",
  "提取",
  "导入",
  "导出",
  "查找",
  "搜索",
  "获取",
  "寻找",
] as const;

/**
 * CJK operation verbs (Chinese simplified + Japanese kanji forms) — mirrors
 * `TaskRequestResolver.CJK_ACTION_VERBS` for the operation pattern.
 * "发送5封邮件" → `operation_receipt` requiring completed state (T18, FR-19).
 */
const CJK_OPERATION_VERBS = [
  "发送",
  "发布",
  "部署",
  "启动",
  "完成",
] as const;

/**
 * CJK measure words that follow a number ("<N>个/件/名/条/位/家/封") — the
 * CJK count pattern's noun anchor. CJK has no word spaces, so the count is
 * "<N><measure><noun>" with no separators (T18, FR-19).
 */
const CJK_MEASURE_WORDS = "个|件|名|条|只|位|家|封" as const;

/**
 * Strip leading politeness prefixes from a clause for verb matching. Returns
 * the stripped text — the clause's sourceRef offsets stay anchored to the
 * full clause (including the prefix), so the span still slices back to real
 * content that contains the matched verb. T18: also strips CJK polite
 * prefixes ("请保存100个联系人" → "保存100个联系人").
 */
function stripPolitePrefix(text: string): string {
  let stripped = text.trimStart();
  for (let i = 0; i < 2; i++) {
    const lower = stripped.toLowerCase();
    const prefix = POLITE_PREFIXES.find((p) => lower.startsWith(p));
    if (prefix) {
      stripped = stripped.slice(prefix.length).trimStart();
      continue;
    }
    const cjkPrefix = CJK_POLITE_PREFIXES.find((p) => stripped.startsWith(p));
    if (!cjkPrefix) break;
    stripped = stripped.slice(cjkPrefix.length).trimStart();
  }
  return stripped;
}

const ID_PREFIX = "crit";

/**
 * Split a message into clauses on `,` and ` and `, preserving each clause's
 * trimmed start/end offsets in the original message. "Find 20 leads, save
 * them, and draft an email" → 3 clauses. A single-clause message returns one
 * clause spanning the trimmed message. T18: the CJK conjunction 和
 * ("保存100个联系人和发送5封邮件") also splits — CJK has no spaces, so 和
 * appears unspaced between clauses.
 */
function splitClauses(message: string): readonly Clause[] {
  const clauses: Clause[] = [];
  // Order matters: ", and " must be tried before ", " and " and " so it
  // consumes the conjunction in one match instead of leaving a dangling
  // "and ..." clause. "Find 20 leads, save them, and draft an email" → 3
  // clauses, not "and draft an email". The CJK 和 alternative is unspaced.
  const delimiter = /\s*(?:,\s*and\s+|,\s*|\s+and\s+|和)/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = delimiter.exec(message)) !== null) {
    const start = lastEnd;
    const end = match.index;
    // noop if the segment trims to empty
    pushTrimmed(clauses, message, start, end);
    lastEnd = match.index + match[0].length;
  }
  pushTrimmed(clauses, message, lastEnd, message.length);
  return clauses;
}

function pushTrimmed(
  clauses: Clause[],
  message: string,
  start: number,
  end: number
): boolean {
  const raw = message.slice(start, end);
  const leading = raw.match(/^\s*/);
  const trailing = raw.match(/\s*$/);
  const trimStart = start + (leading ? leading[0].length : 0);
  const trimEnd = end - (trailing ? trailing[0].length : 0);
  if (trimEnd <= trimStart) return false;
  clauses.push({
    text: message.slice(trimStart, trimEnd),
    startOffset: trimStart,
    endOffset: trimEnd,
  });
  return true;
}

/**
 * Derive a stable target identifier slug from a noun phrase, capped to the
 * schema max (200). Lowercase, alphanumeric+dash only. Never invents content
 * — falls back to "target" if the phrase is empty. T18: CJK characters are
 * preserved as-is (the [a-z0-9] strip would otherwise reduce a CJK noun like
 * "合格联系人" to the generic "target"); CJK identifiers are stable in the
 * schema's 200-char cap.
 */
function slugifyTarget(phrase: string): string {
  const slug = phrase
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿぀-ヿ]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
  return slug.length > 0 ? slug : "target";
}

function makeSourceRef(
  clause: Clause,
  messageId: string
): { messageId: string; startOffset: number; endOffset: number } {
  return {
    messageId,
    startOffset: clause.startOffset,
    endOffset: clause.endOffset,
  };
}

/**
 * Try to match a single clause to a criterion. Returns the criterion or null
 * (null → fallback). Patterns are ordered: count → operation → observation →
 * report → deliverable. First match wins.
 *
 * B02: each match also yields its governing verb + topic so the compile loop
 * can carry them across conjunctions (verbless continuations inherit the
 * governing verb; "report it" resolves against the previous topic).
 */
function matchClause(
  clause: Clause,
  messageId: string,
  indexByKind: Map<string, number>,
  context?: { readonly lastTopic: string | null }
): { criterion: TaskCriterion; ambiguous: boolean; governingVerb: string; topic: string } | null {
  const text = clause.text;
  // Match against the polite-prefix-stripped text so "Please save 100
  // contacts" hits the count pattern. The criterion's sourceRef stays
  // anchored to the full clause (including the prefix) — the span still
  // slices back to real content containing the matched verb.
  const stripped = stripPolitePrefix(text);
  const lower = stripped.toLowerCase();

  // 0. CJK count/target: "<CJK collection verb><N><measure><noun>" — CJK has
  // no word spaces, so the count/noun are unspaced ("保存100个联系人").
  // Mirrors the English count pattern's record_count output (T18, FR-19).
  for (const verb of CJK_COLLECTION_VERBS) {
    if (!stripped.startsWith(verb)) continue;
    const cjkCountRe = new RegExp(
      `^${verb}\\s*(\\d+)\\s*(?:${CJK_MEASURE_WORDS})\\s*([^，。,.\\s]+)`,
      "i"
    );
    const m = cjkCountRe.exec(stripped);
    if (m) {
      const minimum = parseInt(m[1], 10);
      const noun = m[2];
      const id = nextId(indexByKind, "record_count");
      return {
        criterion: {
          id,
          required: true,
          kind: "record_count",
          description: `${verb}至少${minimum}个${noun}`.slice(0, 2000),
          adapterKey: "record_count",
          targetId: slugifyTarget(noun),
          scope: "execution",
          minimum,
          sourceRefs: [makeSourceRef(clause, messageId)],
        },
        ambiguous: false,
        governingVerb: verb,
        topic: noun,
      };
    }
  }

  // 1. Count/target: "<collection verb> <N> [qualifier] <things> [to <target>]"
  for (const verb of COLLECTION_VERBS) {
    const qualifierAlt = COUNT_QUALIFIERS.join("|");
    const verbRe = new RegExp(
      `^${verb}\\s+(\\d+)\\s+(?:(${qualifierAlt})\\s+)?([a-zA-Z][a-zA-Z0-9_-]*)(?:.*?\\bto\\s+(?:campaign|list|group)\\s+([\\S]+))?`,
      "i"
    );
    const m = verbRe.exec(stripped);
    if (m) {
      const minimum = parseInt(m[1], 10);
      const qualifier = m[2] ?? "";
      const noun = m[3];
      const target = m[4] ? slugifyTarget(m[4]) : slugifyTarget(noun);
      const id = nextId(indexByKind, "record_count");
      // B02: retain the qualifier in the description ("Save at least 100
      // qualifying contacts") — dropping it silently narrows the request.
      const qualifiedNoun = qualifier ? `${qualifier} ${noun}` : noun;
      return {
        criterion: {
          id,
          required: true,
          kind: "record_count",
          description: `Save at least ${minimum} ${qualifiedNoun}${m[4] ? ` to ${m[4]}` : ""}`.slice(0, 2000),
          adapterKey: "record_count",
          targetId: target,
          scope: "execution",
          minimum,
          sourceRefs: [makeSourceRef(clause, messageId)],
        },
        ambiguous: false,
        governingVerb: verb,
        topic: noun,
      };
    }
  }

  // 2. Observation/report: "<retrieval verb> ... status ..."
  for (const verb of OBSERVATION_VERBS) {
    const verbRe = new RegExp(`^${verb}\\b(.*)$`, "i");
    const m = verbRe.exec(stripped);
    if (m) {
      const targetPhrase = m[1].replace(/\s+status.*$/i, "").trim();
      const id = nextId(indexByKind, "observation");
      return {
        criterion: {
          id,
          required: true,
          kind: "observation",
          description: `Observe ${targetPhrase || text}`.slice(0, 2000),
          adapterKey: "observation",
          targetId: slugifyTarget(targetPhrase || clause.text),
          sourceRefs: [makeSourceRef(clause, messageId)],
        },
        ambiguous: false,
        governingVerb: verb,
        topic: targetPhrase || text,
      };
    }
  }

  // 2b. Report delivery (B02): "<report verb> <topic> [to me]" produces and
  // delivers a report — a qualitative deliverable on the topic, never an
  // observation for a literal "it-to-me" target. Retrieval (check/monitor/
  // verify) stays an observation; report/draft/start/completion are distinct
  // request shapes with distinct verification.
  for (const verb of REPORT_VERBS) {
    const verbRe = new RegExp(`^${verb}\\b\\s*(.*)$`, "i");
    const m = verbRe.exec(stripped);
    if (m) {
      // Strip a trailing delivery suffix ("to me", "for me", "back") before
      // resolving the topic — it is provenance, not subject matter.
      const rest = m[1]
        .replace(/\s+(to\s+me|for\s+me|back)\s*$/i, "")
        .trim();
      const pronounRe = /^(it|this|that|these|those|them|the\s+results?|the\s+status)\b/i;
      const lastTopic = context?.lastTopic ?? null;
      let topic = rest;
      if (rest.length === 0 || pronounRe.test(rest)) {
        // "Report it to me" / bare "report": the topic must come from the
        // previous clause. No resolvable topic → ambiguous required
        // fallback (never a fabricated "it-to-me" target).
        if (!lastTopic) {
          break;
        }
        topic = pronounRe.test(rest) && rest.length > 0
          ? rest.replace(pronounRe, lastTopic)
          : lastTopic;
      }
      const id = nextId(indexByKind, "qualitative");
      return {
        criterion: {
          id,
          required: true,
          kind: "qualitative",
          description: `Report: ${topic}`.slice(0, 2000),
          sourceSelectorKeys: [],
          sourceRefs: [makeSourceRef(clause, messageId)],
        },
        ambiguous: false,
        governingVerb: verb,
        topic,
      };
    }
  }

  // 3. Text deliverable: "<deliverable verb> ..."
  for (const verb of DELIVERABLE_VERBS) {
    const verbRe = new RegExp(`^${verb}\\b\\s*(?:an?\\s+)?(.*)$`, "i");
    const m = verbRe.exec(stripped);
    if (m) {
      const deliverable = m[1].trim();
      const id = nextId(indexByKind, "qualitative");
      return {
        criterion: {
          id,
          required: true,
          kind: "qualitative",
          description: `Deliverable: ${deliverable || text}`.slice(0, 2000),
          sourceSelectorKeys: [],
          sourceRefs: [makeSourceRef(clause, messageId)],
        },
        ambiguous: false,
        governingVerb: verb,
        topic: deliverable || text,
      };
    }
  }

  // 4. Operation/send: "<operation verb> ..."
  for (const verb of OPERATION_VERBS) {
    const verbRe = new RegExp(`^${verb}\\b\\s*(?:an?\\s+)?(.*)$`, "i");
    const m = verbRe.exec(stripped);
    if (m) {
      const opTarget = m[1].trim();
      const id = nextId(indexByKind, "operation_receipt");
      // B19 (§10.3 start-vs-completion): an explicit start request ("start
      // the email send") is satisfied by an accepted (job-started) receipt;
      // only a finish request needs confirmed completion. Every other
      // operation verb keeps requiring "completed".
      const isStartIntent = verb === "start";
      const requiredState: "accepted" | "completed" = isStartIntent
        ? "accepted"
        : "completed";
      return {
        criterion: {
          id,
          required: true,
          kind: "operation_receipt",
          description: `${verb} ${opTarget} ${isStartIntent ? "started" : "completed"}`.slice(0, 2000),
          adapterKey: "operation_receipt",
          targetId: slugifyTarget(opTarget || verb),
          requiredState,
          sourceRefs: [makeSourceRef(clause, messageId)],
        },
        ambiguous: false,
        governingVerb: verb,
        topic: opTarget || verb,
      };
    }
  }

  // 4b. CJK operation/send: "<CJK operation verb><N?><measure><noun>" —
  // mirrors the English operation pattern (T18, FR-19). "发送5封邮件"
  // requires "completed" state.
  for (const verb of CJK_OPERATION_VERBS) {
    if (!stripped.startsWith(verb)) continue;
    const cjkOpRe = new RegExp(
      `^${verb}\\s*(\\d+)?\\s*(?:${CJK_MEASURE_WORDS})?\\s*([^，。,.\\s]*)`,
      "i"
    );
    const m = cjkOpRe.exec(stripped);
    if (m) {
      const opTarget = (m[2] ?? "").trim();
      const id = nextId(indexByKind, "operation_receipt");
      // B19 (§10.3): CJK 启动 ("start/boot") is a start request → accepted;
      // every other CJK operation verb requires completed completion.
      const isStartIntent = verb === "启动";
      const requiredState: "accepted" | "completed" = isStartIntent
        ? "accepted"
        : "completed";
      return {
        criterion: {
          id,
          required: true,
          kind: "operation_receipt",
          description: `${verb}${opTarget}${isStartIntent ? "已开始" : "完成"}`.slice(0, 2000),
          adapterKey: "operation_receipt",
          targetId: slugifyTarget(opTarget || verb),
          requiredState,
          sourceRefs: [makeSourceRef(clause, messageId)],
        },
        ambiguous: false,
        governingVerb: verb,
        topic: opTarget || verb,
      };
    }
  }

  // 5. Ambiguous: an action verb we recognize but no extractable target.
  // This is reachable for messages the router classified as best_effort
  // because of a recipient/quantity signal the router's heuristic accepted
  // but this compiler's patterns didn't pin down. Emit qualitative fallback
  // for the clause so the controller has unmet work (AC-02/18) but the
  // criterion can never pass without a checker (AC-21).
  const allActionVerbs = [
    ...COLLECTION_VERBS,
    ...OPERATION_VERBS,
    ...OBSERVATION_VERBS,
    ...REPORT_VERBS,
    ...DELIVERABLE_VERBS,
  ];
  const startsWithActionVerb = allActionVerbs.some(
    (v) =>
      lower === v ||
      lower.startsWith(v + " ") ||
      lower.startsWith(v + ",") ||
      lower.startsWith(v + ".")
  );
  if (startsWithActionVerb) {
    const id = nextId(indexByKind, "qualitative");
    // B02 chaining: a later verbless clause can inherit this verb.
    const leadingVerb = lower.split(/[\s,.]/, 1)[0];
    return {
      criterion: {
        id,
        required: true,
        kind: "qualitative",
        description: `User request: ${text}`.slice(0, 2000),
        sourceSelectorKeys: [],
        sourceRefs: [makeSourceRef(clause, messageId)],
      },
      ambiguous: true,
      governingVerb: leadingVerb,
      topic: text,
    };
  }

  return null;
}

function nextId(
  indexByKind: Map<string, number>,
  kind: string
): string {
  const idx = indexByKind.get(kind) ?? 0;
  indexByKind.set(kind, idx + 1);
  return `${ID_PREFIX}-${kind}-${idx}`;
}

/**
 * B02: true when a clause carries no leading action verb of its own (after
 * polite-prefix stripping) — a conjunction continuation ("a tweet about our
 * launch") rather than a fresh imperative. Only such clauses inherit the
 * governing verb; verb-led clauses match (or fall back) on their own text.
 */
function isVerblessContinuation(clauseText: string): boolean {
  const lower = stripPolitePrefix(clauseText).toLowerCase();
  if (lower.length === 0) return false;
  const verbs: readonly string[] = [
    ...COLLECTION_VERBS,
    ...OPERATION_VERBS,
    ...OBSERVATION_VERBS,
    ...REPORT_VERBS,
    ...DELIVERABLE_VERBS,
    ...CJK_COLLECTION_VERBS,
    ...CJK_OPERATION_VERBS,
  ];
  return !verbs.some(
    (v) =>
      lower === v ||
      lower.startsWith(v + " ") ||
      lower.startsWith(v + ",") ||
      lower.startsWith(v + ".") ||
      lower.startsWith(v)
  );
}

/**
 * Compile criteria from a user message. Pure function: no side effects, no
 * LLM, no I/O. Returns a readonly criteria array + an ambiguity flag.
 *
 * - `response_only` / `preparation` routes return empty criteria (the engine
 *   never enrolls these, but the compiler is defensive).
 * - Actionable routes (`task_best_effort`, `task_verified`) derive at least
 *   one criterion so the controller has unmet work to continue on.
 */
export function compileCriteria(input: CompileInput): CompileResult {
  if (
    input.route === "response_only" ||
    input.route === "preparation"
  ) {
    return { criteria: [], ambiguityReason: null };
  }

  const message = input.userMessage ?? "";
  if (message.trim().length === 0) {
    return { criteria: [], ambiguityReason: "empty user message" };
  }

  const indexByKind = new Map<string, number>();
  const criteria: TaskCriterion[] = [];
  let ambiguityReason: string | null = null;
  let anyAmbiguous = false;
  // B02: governing verb + topic carried across conjunction clauses. A
  // verbless continuation ("a tweet about our launch") inherits the
  // governing verb; "report it" resolves against the previous topic.
  let governingVerb: string | null = null;
  let lastTopic: string | null = null;

  for (const clause of splitClauses(message)) {
    let matched = matchClause(clause, input.sourceUserMessageId, indexByKind, { lastTopic });
    if (!matched && governingVerb && isVerblessContinuation(clause.text)) {
      // B02: retry with the governing verb prepended ("a tweet about our
      // launch" → "write a tweet about our launch"), anchored to the REAL
      // clause span. Only structured (non-ambiguous) inheritances are kept —
      // anything else becomes the per-clause fallback below with the real
      // clause text (never a description containing an invented verb).
      const synthetic: Clause = {
        text: `${governingVerb} ${stripPolitePrefix(clause.text)}`,
        startOffset: clause.startOffset,
        endOffset: clause.endOffset,
      };
      const inherited = matchClause(synthetic, input.sourceUserMessageId, indexByKind, { lastTopic });
      if (inherited && !inherited.ambiguous) {
        matched = inherited;
      }
    }
    if (!matched) {
      // B02: an uncompilable clause becomes a required qualitative fallback
      // spanning THAT clause (ambiguous) — never a silent drop. Coverage is
      // then honestly partial: the fallback stays unmet without a checker
      // (AC-21) and blocks best-effort promotion (B01), so the request
      // clarifies instead of passing on a subset.
      const id = nextId(indexByKind, "qualitative");
      matched = {
        criterion: {
          id,
          required: true,
          kind: "qualitative",
          description: `User request: ${clause.text}`.slice(0, 2000),
          sourceSelectorKeys: [],
          sourceRefs: [makeSourceRef(clause, input.sourceUserMessageId)],
        },
        ambiguous: true,
        governingVerb: governingVerb ?? "",
        topic: clause.text,
      };
      // A verbless unknown keeps the prior governing verb for later clauses
      // ("write blog and blah and tweet" — tweet still inherits write).
      anyAmbiguous = true;
      criteria.push(matched.criterion);
      if (matched.topic) lastTopic = matched.topic;
      continue;
    }
    criteria.push(matched.criterion);
    if (matched.ambiguous) anyAmbiguous = true;
    if (matched.governingVerb) governingVerb = matched.governingVerb;
    if (matched.topic) lastTopic = matched.topic;
  }

  if (criteria.length === 0) {
    // No clause matched any pattern. Emit one qualitative criterion spanning
    // the whole message so the controller has unmet work (AC-02/18). This is
    // the "first response announces work with no tool" path: the qualitative
    // criterion can never pass without a checker, so the request stays
    // explicitly unverified (AC-21, NFR-12).
    const id = nextId(indexByKind, "qualitative");
    criteria.push({
      id,
      required: true,
      kind: "qualitative",
      description: `User request: ${message}`.slice(0, 2000),
      sourceSelectorKeys: [],
      sourceRefs: [
        {
          messageId: input.sourceUserMessageId,
          startOffset: 0,
          endOffset: message.length,
        },
      ],
    });
    anyAmbiguous = true;
  }

  if (anyAmbiguous) {
    ambiguityReason =
      "request scope could not be fully structured; emitted qualitative fallback criteria (stays unverified without a checker)";
  }

  // Return a fresh readonly array — callers must not mutate. The criteria
  // objects themselves are frozen downstream by `freeze()`'s
  // `structuredClone` + schema parse.
  return {
    criteria: [...criteria],
    ambiguityReason,
  };
}
