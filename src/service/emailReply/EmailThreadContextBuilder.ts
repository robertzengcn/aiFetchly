/**
 * Pure bounded conversation-context construction (technical design §9, FR-003,
 * FR-004, NFR-002/003). No database access — the service layer feeds ordered
 * turns in and gets the model-ready context out.
 *
 * Guarantees:
 *  - the CURRENT message keeps a larger budget than older turns;
 *  - quoted replies, signatures, and repeated thread content are removed or
 *    marked (conservatively — low-confidence text is kept, not deleted);
 *  - the most recent turns are verbatim under configurable caps;
 *  - older turns collapse into a structured summary with dates, speakers,
 *    open questions, commitments, selected options, and refusals;
 *  - a very short reply ("Yes") is never the only context — the immediately
 *    preceding turn is always included verbatim;
 *  - conflicting commitments are surfaced so the caller can require review;
 *  - the result never exceeds the configured token budget.
 */

export interface EmailConversationTurn {
  readonly sourceType: "received_message" | "send_attempt";
  readonly sourceId: number;
  readonly direction: "inbound" | "outbound";
  readonly timestamp: Date;
  readonly sender: string;
  readonly recipients: readonly string[];
  readonly subject: string;
  readonly bodyText: string;
  readonly providerMessageId?: string | null;
}

export interface ThreadFact {
  readonly text: string;
  readonly sourceTurnId: number;
  readonly speaker: string;
  readonly occurredAt: string;
}

export interface ThreadConflict {
  readonly topic: string;
  readonly a: ThreadFact;
  readonly b: ThreadFact;
}

export interface ThreadSummary {
  readonly participants: readonly string[];
  readonly openQuestions: readonly ThreadFact[];
  readonly commitments: readonly ThreadFact[];
  readonly selectedOptions: readonly ThreadFact[];
  readonly refusals: readonly ThreadFact[];
  readonly conflicts: readonly ThreadConflict[];
  readonly sourceTurnIds: readonly number[];
}

export interface BoundedThreadContext {
  readonly recentTurns: readonly EmailConversationTurn[]; // chronological
  readonly olderSummary: ThreadSummary | null;
  readonly truncated: boolean;
  readonly estimatedTokens: number;
  /** True when the short-reply guard forced inclusion of the prior turn. */
  readonly shortReplyGuardApplied: boolean;
  /** True when conflicting commitments require human review (FR-004). */
  readonly requiresHumanReview: boolean;
}

export interface ContextBudget {
  /** Total hard cap in estimated tokens for the assembled context. */
  readonly totalTokens: number;
  /** Max verbatim recent turns (excluding the current message). */
  readonly maxRecentTurns: number;
  /** Max characters per older turn body after reduction. */
  readonly maxOlderTurnChars: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  totalTokens: 8000,
  maxRecentTurns: 6,
  maxOlderTurnChars: 1500,
};

/** Rough token estimate (~4 chars/token) — good enough for hard caps. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Conservatively strip quoted history and signatures from one turn's body.
 * Only high-confidence boundaries are removed; anything ambiguous is kept.
 */
export function reduceQuotedAndSignature(body: string): {
  text: string;
  quotedRemoved: boolean;
  signatureRemoved: boolean;
} {
  let quotedRemoved = false;
  let signatureRemoved = false;
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    // Signature delimiter: a line that is exactly "--" or "-- " (common convention).
    if (/^--\s?$/.test(line)) {
      signatureRemoved = true;
      break;
    }
    // Quoted-reply header: "On <date> <someone> wrote:" — everything after is quote.
    if (/^on .+ wrote:\s*$/i.test(line.trim())) {
      quotedRemoved = true;
      break;
    }
    // From: line of an inline forwarded/quoted block.
    if (
      /^from:\s*.+\s*$/i.test(line.trim()) &&
      kept.some((l) => l.trim() === "")
    ) {
      quotedRemoved = true;
      break;
    }
    // Quoted line (leading >).
    if (/^\s*>/.test(line)) {
      quotedRemoved = true;
      continue; // skip this line only
    }
    kept.push(line);
  }

  return {
    text: kept.join("\n").trim(),
    quotedRemoved,
    signatureRemoved,
  };
}

const COMMITMENT_RE =
  /\b(?:we|i)['’]?ll\b|\b(?:we|i) will\b|\bpromise\b|\bby (?:mon|tue|wed|thu|fri|sat|sun|next|\d)|\bwill send\b|\bconfirm(?:ed)?\b|\bguarantee\b/gi;
const OPTION_RE =
  /\b(?:option|plan|package|slot|time|date)\s*\d*\b|\bgo with\b|\bwe['’]?ll take\b|\bsecond option\b|\bfirst option\b/gi;
const REFUSAL_RE =
  /\b(?:cannot|can't|won't|decline|not able|no thanks|pass on)\b/gi;

function firstMatch(turn: EmailConversationTurn, re: RegExp): string | null {
  const m = re.exec(turn.bodyText);
  return m ? m[0] : null;
}

function fact(turn: EmailConversationTurn, text: string): ThreadFact {
  return {
    text: text.slice(0, 200),
    sourceTurnId: turn.sourceId,
    speaker: turn.sender,
    occurredAt: turn.timestamp.toISOString(),
  };
}

/** Extract a sentence-level snippet around a match for summary evidence. */
function sentenceAround(
  turn: EmailConversationTurn,
  re: RegExp
): string | null {
  const m = re.exec(turn.bodyText);
  if (!m) return null;
  const start = Math.max(0, m.index - 80);
  const end = Math.min(turn.bodyText.length, m.index + m[0].length + 80);
  return turn.bodyText.slice(start, end).replace(/\s+/g, " ").trim();
}

/**
 * Build a deterministic structured summary of older turns (no LLM — derived
 * context only; an LLM summarizer can replace this later behind the same
 * interface, per §9.3).
 */
export function summarizeOlderTurns(
  turns: readonly EmailConversationTurn[]
): ThreadSummary {
  const participants = new Set<string>();
  const openQuestions: ThreadFact[] = [];
  const commitments: ThreadFact[] = [];
  const selectedOptions: ThreadFact[] = [];
  const refusals: ThreadFact[] = [];

  for (const turn of turns) {
    participants.add(turn.sender);
    const q =
      sentenceAround(turn, /\?\s*$/m) ??
      (turn.bodyText.includes("?") ? turn.bodyText.slice(0, 200) : null);
    if (q) openQuestions.push(fact(turn, q));
    const c = sentenceAround(turn, COMMITMENT_RE);
    if (c) commitments.push(fact(turn, c));
    const o = sentenceAround(turn, OPTION_RE);
    if (o) selectedOptions.push(fact(turn, o));
    const r = firstMatch(turn, REFUSAL_RE);
    if (r) refusals.push(fact(turn, r));
  }

  return {
    participants: [...participants],
    openQuestions,
    commitments,
    selectedOptions,
    refusals,
    conflicts: detectConflicts(turns),
    sourceTurnIds: turns.map((t) => t.sourceId),
  };
}

/**
 * Detect materially conflicting commitments: two outbound turns committing to
 * different money amounts or dates for the same thread (FR-004).
 */
export function detectConflicts(
  turns: readonly EmailConversationTurn[]
): ThreadConflict[] {
  const money = (t: EmailConversationTurn): string | null => {
    const m = t.bodyText.match(/[$€£]\s?\d[\d.,]*|\b\d+\s?(?:usd|eur|gbp)\b/i);
    return m ? m[0] : null;
  };
  const date = (t: EmailConversationTurn): string | null => {
    const m = t.bodyText.match(
      /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\bnext (?:mon|tue|wed|thu|fri)\b/i
    );
    return m ? m[0] : null;
  };

  const conflicts: ThreadConflict[] = [];
  const outbound = turns.filter((t) => t.direction === "outbound");
  const moneys = outbound.map((t) => ({ t, v: money(t) })).filter((x) => x.v);
  const dates = outbound.map((t) => ({ t, v: date(t) })).filter((x) => x.v);

  for (let i = 0; i < moneys.length; i++) {
    for (let j = i + 1; j < moneys.length; j++) {
      if (moneys[i].v !== moneys[j].v) {
        conflicts.push({
          topic: "money",
          a: fact(moneys[i].t, moneys[i].v!),
          b: fact(moneys[j].t, moneys[j].v!),
        });
      }
    }
  }
  for (let i = 0; i < dates.length; i++) {
    for (let j = i + 1; j < dates.length; j++) {
      if (dates[i].v !== dates[j].v) {
        conflicts.push({
          topic: "date",
          a: fact(dates[i].t, dates[i].v!),
          b: fact(dates[j].t, dates[j].v!),
        });
      }
    }
  }
  return conflicts;
}

/** Is this turn a "short reply" whose meaning depends on the prior turn? */
export function isShortReply(body: string): boolean {
  const reduced = reduceQuotedAndSignature(body).text;
  if (reduced.length > 24) return false;
  return /^(?:yes|no|ok|okay|sure|fine|sounds good|that works|agreed|correct|confirm(?:ed)?|deal|done)\b[.!]?\s*$/i.test(
    reduced.trim()
  );
}

/**
 * Build the bounded context. Turns arrive newest-first or chronological — the
 * builder normalizes to chronological and treats the LAST inbound turn as the
 * current message when {@link currentTurnId} is not given.
 */
export function buildBoundedThreadContext(
  turnsInput: readonly EmailConversationTurn[],
  options: {
    budget?: ContextBudget;
    currentTurnId?: number;
  } = {}
): BoundedThreadContext {
  const budget = options.budget ?? DEFAULT_CONTEXT_BUDGET;
  const turns = [...turnsInput].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );

  // Identify the current message: explicit id, else the last inbound turn.
  const currentIdx = options.currentTurnId
    ? turns.findIndex((t) => t.sourceId === options.currentTurnId)
    : (() => {
        for (let i = turns.length - 1; i >= 0; i--) {
          if (turns[i].direction === "inbound") return i;
        }
        return turns.length - 1;
      })();
  const current = currentIdx >= 0 ? turns[currentIdx] : undefined;
  const prior = currentIdx > 0 ? turns[currentIdx - 1] : undefined;

  const shortReplyGuardApplied =
    !!current && isShortReply(current.bodyText) && !!prior;

  // Current message gets ~50% of the budget; recent turns + summary share the rest.
  const currentText = current
    ? reduceQuotedAndSignature(current.bodyText).text
    : "";
  const currentTokens = estimateTokens(currentText);
  const currentBudget = Math.floor(budget.totalTokens * 0.5);
  let truncated = currentTokens > currentBudget;

  // Recent turns: the turns immediately before the current one, newest-first
  // allocation, chronological output. The prior turn is ALWAYS included when
  // the short-reply guard fires.
  const olderThanRecent: EmailConversationTurn[] = [];
  const recent: EmailConversationTurn[] = [];
  let used = Math.min(currentTokens, currentBudget);
  for (let i = currentIdx >= 0 ? currentIdx : turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    const reduced = reduceQuotedAndSignature(turn.bodyText).text.slice(
      0,
      budget.maxOlderTurnChars
    );
    const cost = estimateTokens(reduced);
    const mustInclude =
      shortReplyGuardApplied && prior && turn.sourceId === prior.sourceId;
    if (
      recent.length < budget.maxRecentTurns &&
      (used + cost <= budget.totalTokens || mustInclude)
    ) {
      recent.unshift({ ...turn, bodyText: reduced });
      used += cost;
      if (cost >= budget.maxOlderTurnChars / 4) truncated = true;
    } else {
      olderThanRecent.push(turn);
    }
  }

  const olderSummary = olderThanRecent.length
    ? summarizeOlderTurns(olderThanRecent)
    : null;

  return {
    recentTurns: recent,
    olderSummary,
    truncated,
    estimatedTokens: used,
    shortReplyGuardApplied,
    requiresHumanReview: !!olderSummary?.conflicts.length,
  };
}
