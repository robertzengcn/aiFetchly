/**
 * Pure parser for the `/loop` command in AI Chat V2.
 *
 * It classifies input into one of:
 *   - goal_loop            : `/loop <maxIterations>` (backward compatible)
 *   - scheduled_loop       : `/loop <duration> <prompt>` or canonical form
 *   - scheduled_loop_control: `/loop status|pause|resume|stop`
 *   - invalid_loop         : recognized but malformed `/loop` input
 *   - none                 : not a `/loop` command
 *
 * The parser performs NO IPC, database, scheduling, or AI work. It is safe to
 * call from the renderer for immediate UX and from the main process; the main
 * process must re-validate the structured request at the IPC boundary
 * (renderer parsing is not a trust boundary).
 *
 * Source: PRD §8, technical-design §6.
 */

import {
  SCHEDULED_LOOP_DEFAULT_MAX_LIFETIME_MS,
  SCHEDULED_LOOP_DEFAULT_MAX_RUNS,
  SCHEDULED_LOOP_MAX_LIFETIME_MS,
  SCHEDULED_LOOP_MAX_RUNS,
  SCHEDULED_LOOP_MIN_INTERVAL_MS,
  SCHEDULED_LOOP_MIN_RUNS,
  checkedMultiply,
  isValidIntervalMs,
  isValidMaxLifetimeMs,
  isValidMaxRuns,
} from "@/config/aiChatScheduledLoopConfig";
import type {
  AiLoopCommand,
  ParsedDuration,
  ScheduledLoopControlOperation,
  ScheduledLoopParseErrorCode,
} from "@/entityTypes/aiChatScheduledLoopTypes";

const CONTROL_OPERATIONS: ReadonlySet<ScheduledLoopControlOperation> = new Set([
  "status",
  "pause",
  "resume",
  "stop",
]);

const UNIT_TO_MS: Readonly<Record<"m" | "h", number>> = {
  m: 60_000,
  h: 3_600_000,
};

/**
 * Parse a single duration token such as `5m` or `2h`.
 *
 * Accepts positive base-10 integers followed by `m` or `h` (case-insensitive).
 * Performs checked integer arithmetic so very large values cannot silently
 * overflow. Does NOT check min/max bounds — the caller validates bounds via the
 * config helpers so a malformed token can be distinguished from an out-of-bounds
 * one. Returns null for decimals, signs, unknown units, zero, or overflow.
 */
export function parseScheduledLoopDuration(
  token: string
): ParsedDuration | null {
  const match = /^(\d+)([mMhH])$/.exec(token);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  const unit = match[2].toLowerCase() === "m" ? "m" : "h";
  const milliseconds = checkedMultiply(value, UNIT_TO_MS[unit]);
  if (milliseconds === null) return null;
  return { value, unit, milliseconds };
}

/** True when a token plausibly attempts to be a duration (used to pick the
 * right error code: INVALID_INTERVAL vs INVALID_LOOP_SYNTAX). */
function looksLikeDurationAttempt(token: string): boolean {
  return /^[+-]?\d/.test(token);
}

/** Split a trimmed string into its first whitespace-delimited token and the
 * remainder, preserving the remainder's internal whitespace and newlines. */
function splitFirst(text: string): { first: string; rest: string } {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) return { first: "", rest: "" };
  return { first: match[1], rest: match[2] ?? "" };
}

/** Find the first standalone `--` separator (whitespace-delimited) and split the
 * string into the option prefix and the prompt. Accepts whitespace OR
 * end-of-string after the dashes so an empty prompt (`/loop every 5m --`) is
 * still recognized as a valid separator with a missing prompt. Returns null
 * when no separator is present. */
function splitOnSeparator(
  text: string
): { prefix: string; prompt: string } | null {
  const match = /\s--(?:\s|$)/.exec(text);
  if (!match) return null;
  return {
    prefix: text.slice(0, match.index),
    prompt: text.slice(match.index + match[0].length),
  };
}

function invalid(code: ScheduledLoopParseErrorCode): AiLoopCommand {
  return { type: "invalid_loop", code };
}

function parseCanonical(rest: string): AiLoopCommand {
  const split = splitOnSeparator(rest);
  if (!split) {
    // Canonical form requires the `--` separator before the prompt.
    return invalid("INVALID_LOOP_SYNTAX");
  }
  const { prefix, prompt } = split;

  const prefixTokens = prefix.match(/\S+/g) ?? [];
  const firstToken = prefixTokens[0];
  if (!firstToken) {
    return invalid("INVALID_LOOP_SYNTAX");
  }

  const duration = parseScheduledLoopDuration(firstToken);
  if (!duration) {
    return invalid(
      looksLikeDurationAttempt(firstToken)
        ? "INVALID_INTERVAL"
        : "INVALID_LOOP_SYNTAX"
    );
  }
  if (!isValidIntervalMs(duration.milliseconds)) {
    return invalid("INVALID_INTERVAL");
  }
  const intervalMs = duration.milliseconds;

  let maxRuns: number | null = null;
  let maxLifetimeMs: number | null = null;

  const flagTokens = prefixTokens.slice(1);
  let i = 0;
  while (i < flagTokens.length) {
    const flag = flagTokens[i];
    if (flag === "--times") {
      const valueToken = flagTokens[i + 1];
      if (valueToken === undefined || !/^\d+$/.test(valueToken)) {
        return invalid("INVALID_LOOP_LIMIT");
      }
      const count = Number.parseInt(valueToken, 10);
      if (!Number.isSafeInteger(count) || !isValidMaxRuns(count)) {
        return invalid("INVALID_LOOP_LIMIT");
      }
      maxRuns = count;
      i += 2;
    } else if (flag === "--for") {
      const valueToken = flagTokens[i + 1];
      if (valueToken === undefined) {
        return invalid("INVALID_LOOP_LIMIT");
      }
      const forDuration = parseScheduledLoopDuration(valueToken);
      if (!forDuration || !isValidMaxLifetimeMs(forDuration.milliseconds)) {
        return invalid("INVALID_LOOP_LIMIT");
      }
      maxLifetimeMs = forDuration.milliseconds;
      i += 2;
    } else {
      // Unknown flag or stray token among the options.
      return invalid("INVALID_LOOP_SYNTAX");
    }
  }

  if (prompt.trim() === "") {
    return invalid("PROMPT_REQUIRED");
  }

  return {
    type: "scheduled_loop",
    intervalMs,
    prompt: prompt.trim(),
    maxRuns: maxRuns ?? SCHEDULED_LOOP_DEFAULT_MAX_RUNS,
    maxLifetimeMs: maxLifetimeMs ?? SCHEDULED_LOOP_DEFAULT_MAX_LIFETIME_MS,
  };
}

function parseShorthand(firstToken: string, remainder: string): AiLoopCommand {
  const duration = parseScheduledLoopDuration(firstToken);
  if (!duration) {
    return invalid(
      looksLikeDurationAttempt(firstToken)
        ? "INVALID_INTERVAL"
        : "INVALID_LOOP_SYNTAX"
    );
  }
  if (!isValidIntervalMs(duration.milliseconds)) {
    return invalid("INVALID_INTERVAL");
  }
  if (remainder.trim() === "") {
    return invalid("PROMPT_REQUIRED");
  }
  return {
    type: "scheduled_loop",
    intervalMs: duration.milliseconds,
    prompt: remainder.trim(),
    maxRuns: SCHEDULED_LOOP_DEFAULT_MAX_RUNS,
    maxLifetimeMs: SCHEDULED_LOOP_DEFAULT_MAX_LIFETIME_MS,
  };
}

/**
 * Classify a `/loop` command. Returns the structured action or `none` when the
 * input is not a `/loop` command.
 */
export function parseAiLoopCommand(input: string): AiLoopCommand {
  const text = input.trim();
  if (!text) return { type: "none" };

  const commandMatch = /^\/loop(?:\s+([\s\S]*))?$/i.exec(text);
  if (!commandMatch) return { type: "none" };

  const rest = (commandMatch[1] ?? "").trim();
  if (rest === "") {
    // Bare `/loop` selects the goal loop with its default iteration count.
    return { type: "goal_loop", maxIterations: null };
  }

  const lowered = rest.toLowerCase();
  if (CONTROL_OPERATIONS.has(lowered as ScheduledLoopControlOperation)) {
    return {
      type: "scheduled_loop_control",
      operation: lowered as ScheduledLoopControlOperation,
    };
  }

  const { first, rest: remainder } = splitFirst(rest);

  // Bare integer → legacy goal loop. Trailing text is not allowed in goal mode.
  if (/^\d+$/.test(first)) {
    if (remainder !== "") {
      return invalid("INVALID_LOOP_SYNTAX");
    }
    const maxIterations = Number.parseInt(first, 10);
    if (!Number.isSafeInteger(maxIterations)) {
      return invalid("INVALID_LOOP_SYNTAX");
    }
    return { type: "goal_loop", maxIterations };
  }

  if (first.toLowerCase() === "every") {
    return parseCanonical(remainder);
  }

  return parseShorthand(first, remainder);
}

// Re-export bounds for callers (parser tests, IPC decoders) that need them.
export {
  SCHEDULED_LOOP_MAX_LIFETIME_MS,
  SCHEDULED_LOOP_MAX_RUNS,
  SCHEDULED_LOOP_MIN_INTERVAL_MS,
  SCHEDULED_LOOP_MIN_RUNS,
};
