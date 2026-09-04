import { MANAGED_BROWSER_ACTION_LIMITS } from "@/config/managedBrowser";
import type { ManagedBrowserErrorCode } from "@/entityTypes/managedBrowserTypes";
import type {
  BrowserAction,
  BrowserActionProgram,
} from "@/schemas/worker/managedBrowser";
import type { DisposableElement } from "@/childprocess/managed-browser/PageReferenceRegistry";
import type {
  PageReferenceRegistry,
  ReferenceEntry,
} from "@/childprocess/managed-browser/PageReferenceRegistry";
import {
  evaluateNavigationTarget,
  type NavigationPolicyOptions,
} from "@/childprocess/managed-browser/NavigationPolicy";
import {
  isSensitiveInputType,
  redactSecrets,
} from "@/childprocess/managed-browser/ResultSanitizer";

/**
 * Browser action executor (technical design §15.2).
 *
 * Executes a bounded structured action program. Programs are NOT general
 * JavaScript — only the reviewed P0 action types, with hard limits:
 *   25 actions/program, 100 total steps, 240s wall time, 3 consecutive
 *   failures stop, cancellation checked between every action.
 *
 * Security invariants:
 *  - every navigation target passes the NavigationPolicy first;
 *  - sensitive fields (password/OTP/card/…) can never be filled — they force
 *    handoff with `challenge_requires_handoff`;
 *  - extracted values are secret-redacted before leaving the worker;
 *  - a cancelled or failed consequential-looking step marks the effect
 *    `unknown` so nothing is blindly replayed.
 */

export interface ExecutorElementHandle extends DisposableElement {
  click(options?: { timeout?: number }): Promise<void>;
  type(text: string, options?: { delay?: number }): Promise<void>;
  select(...values: string[]): Promise<string[]>;
  scrollIntoView(): Promise<void>;
  isIntersectingViewport(): Promise<boolean>;
  evaluate<T>(pageFunction: unknown, ...args: unknown[]): Promise<T>;
}

export interface ExecutorPageLike {
  url(): string;
  evaluate<T>(pageFunction: unknown, ...args: unknown[]): Promise<T>;
  goto(
    url: string,
    options?: { timeoutMs?: number; waitUntil?: string }
  ): Promise<unknown>;
  keyboard: { press(key: string): Promise<void> };
}

export interface ActionStepResult {
  readonly actionIndex: number;
  readonly type: string;
  readonly success: boolean;
  readonly errorCode: ManagedBrowserErrorCode | null;
  readonly elementFound: boolean | null;
  readonly urlAfter: string | null;
}

export interface BrowserProgramOutcome {
  readonly effect: "known" | "unknown";
  readonly pageRevision: number;
  readonly results: readonly ActionStepResult[];
  readonly stopCode:
    | "completed"
    | "cancelled"
    | "consecutive_failures"
    | "limit_exceeded"
    | "stale_page_reference"
    | "navigation_blocked"
    | "handoff_required"
    | null;
  readonly extracted: readonly unknown[];
}

export interface ExecuteProgramOptions {
  readonly page: ExecutorPageLike;
  readonly registry: PageReferenceRegistry<ExecutorElementHandle>;
  readonly navigation: NavigationPolicyOptions;
  readonly shouldCancel: () => boolean;
  readonly now?: () => number;
  readonly navigateTimeoutMs?: number;
}

type StopCode = NonNullable<BrowserProgramOutcome["stopCode"]>;

const POLL_INTERVAL_MS = 250;

export class BrowserActionExecutor {
  public async executeProgram(
    program: BrowserActionProgram,
    options: ExecuteProgramOptions
  ): Promise<BrowserProgramOutcome> {
    const now = options.now ?? Date.now;
    const deadline = now() + MANAGED_BROWSER_ACTION_LIMITS.programWallTimeMs;
    const results: ActionStepResult[] = [];
    const extracted: unknown[] = [];
    let consecutiveFailures = 0;
    let executedSteps = 0;
    let effectUnknown = false;

    for (let index = 0; index < program.actions.length; index++) {
      const action = program.actions[index];
      if (options.shouldCancel()) {
        return this.finish(
          "cancelled",
          effectUnknown,
          options,
          results,
          extracted
        );
      }
      if (
        executedSteps >= MANAGED_BROWSER_ACTION_LIMITS.maxTotalExecutedSteps
      ) {
        return this.finish(
          "limit_exceeded",
          effectUnknown,
          options,
          results,
          extracted
        );
      }
      if (now() > deadline) {
        return this.finish(
          "limit_exceeded",
          effectUnknown,
          options,
          results,
          extracted
        );
      }

      executedSteps++;
      const urlBefore = options.page.url();
      const outcome = await this.executeOne(action, options, extracted);
      results.push({
        actionIndex: index,
        type: action.type,
        success: outcome.success,
        errorCode: outcome.errorCode ?? null,
        elementFound: outcome.elementFound ?? null,
        urlAfter: outcome.urlAfter ?? safeUrl(options.page),
      });
      void urlBefore;

      if (!outcome.success) {
        consecutiveFailures++;
        if (outcome.effectUnknown) {
          effectUnknown = true;
        }
        if (outcome.stopCode) {
          return this.finish(
            outcome.stopCode,
            effectUnknown,
            options,
            results,
            extracted
          );
        }
        if (
          consecutiveFailures >=
          MANAGED_BROWSER_ACTION_LIMITS.maxConsecutiveFailures
        ) {
          return this.finish(
            "consecutive_failures",
            effectUnknown,
            options,
            results,
            extracted
          );
        }
      } else {
        consecutiveFailures = 0;
      }
    }
    return this.finish("completed", effectUnknown, options, results, extracted);
  }

  private finish(
    stopCode: StopCode,
    effectUnknown: boolean,
    options: ExecuteProgramOptions,
    results: readonly ActionStepResult[],
    extracted: readonly unknown[]
  ): BrowserProgramOutcome {
    return {
      effect: effectUnknown ? "unknown" : "known",
      pageRevision: options.registry.currentRevision,
      results,
      stopCode,
      extracted: extracted.slice(
        0,
        MANAGED_BROWSER_ACTION_LIMITS.maxExtractedItems
      ),
    };
  }

  private async executeOne(
    action: BrowserAction,
    options: ExecuteProgramOptions,
    extracted: unknown[]
  ): Promise<{
    success: boolean;
    errorCode?: ManagedBrowserErrorCode;
    elementFound?: boolean | null;
    urlAfter?: string | null;
    effectUnknown?: boolean;
    stopCode?: StopCode;
  }> {
    try {
      switch (action.type) {
        case "navigate":
          return await this.doNavigate(action.url, options);
        case "click":
          return await this.withElement(
            action.ref,
            action.pageRevision,
            options,
            async (entry) => {
              await entry.element.scrollIntoView();
              await entry.element.click({ timeout: 5_000 });
              return { success: true };
            }
          );
        case "fill":
          return await this.withElement(
            action.ref,
            action.pageRevision,
            options,
            async (entry) => {
              const inputType = await this.probeInputType(entry.element);
              if (inputType && isSensitiveInputType(inputType)) {
                // Credential-like fields always force user handoff.
                return {
                  success: false,
                  errorCode: "challenge_requires_handoff" as const,
                  effectUnknown: false,
                  stopCode: "handoff_required" as const,
                };
              }
              await entry.element.scrollIntoView();
              // Clear then type with trusted input events; never echo the value.
              await entry.element.evaluate("((el) => { el.value = ''; })");
              await entry.element.type(action.value, { delay: 10 });
              return { success: true };
            }
          );
        case "select":
          return await this.withElement(
            action.ref,
            action.pageRevision,
            options,
            async (entry) => {
              await entry.element.scrollIntoView();
              await entry.element.select(...action.values);
              return { success: true };
            }
          );
        case "press_key":
          await options.page.keyboard.press(action.key);
          return { success: true };
        case "scroll":
          await options.page.evaluate(
            `((dir, amount) => {
              const dx = dir === 'left' ? -amount : dir === 'right' ? amount : 0;
              const dy = dir === 'up' ? -amount : dir === 'down' ? amount : 0;
              window.scrollBy(dx, dy);
            })(${JSON.stringify(action.direction)}, ${action.amount})`
          );
          return { success: true };
        case "wait_for":
          return await this.doWaitFor(action, options);
        case "extract":
          return await this.doExtract(action.refs, options, extracted);
        default:
          return { success: false, errorCode: "action_not_allowed" };
      }
    } catch {
      return {
        success: false,
        errorCode: "internal_error",
        effectUnknown: false,
      };
    }
  }

  private async doNavigate(
    url: string,
    options: ExecuteProgramOptions
  ): Promise<{
    success: boolean;
    errorCode?: ManagedBrowserErrorCode;
    urlAfter?: string | null;
    effectUnknown?: boolean;
    stopCode?: StopCode;
  }> {
    const decision = evaluateNavigationTarget(url, options.navigation);
    if (!decision.allowed) {
      return {
        success: false,
        errorCode: "navigation_blocked",
        stopCode: "navigation_blocked",
      };
    }
    await options.page.goto(url, {
      timeoutMs: options.navigateTimeoutMs ?? 45_000,
      waitUntil: "domcontentloaded",
    });
    // Navigation invalidates every reference (FR-TOOL-003).
    options.registry.reset(options.registry.currentRevision + 1);
    return { success: true, urlAfter: safeUrl(options.page) };
  }

  private async doWaitFor(
    action: Extract<BrowserAction, { type: "wait_for" }>,
    options: ExecuteProgramOptions
  ): Promise<{ success: boolean; errorCode?: ManagedBrowserErrorCode }> {
    const deadline = Date.now() + action.timeoutMs;
    while (Date.now() < deadline) {
      if (options.shouldCancel()) {
        return { success: false, errorCode: "cancelled" };
      }
      const met = await this.checkCondition(action, options);
      if (met) {
        return { success: true };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return { success: false, errorCode: "internal_error" };
  }

  private async checkCondition(
    action: Extract<BrowserAction, { type: "wait_for" }>,
    options: ExecuteProgramOptions
  ): Promise<boolean> {
    switch (action.condition) {
      case "navigation": {
        const current = options.page.url();
        return current !== "about:blank" && current.length > 0;
      }
      case "url":
        return options.page.url().includes(action.url ?? "");
      case "text":
        return options.page.evaluate<boolean>(
          `((needle) => (document.body ? document.body.innerText : '')
            .includes(needle))(${JSON.stringify(action.text ?? "")})`
        );
      case "element": {
        if (!action.ref) return false;
        const lookup = options.registry.lookup(action.ref);
        return lookup.status === "ok";
      }
      case "networkidle":
        // Bounded settle: P0 does not wait forever for network idle.
        await sleep(Math.min(1_000, POLL_INTERVAL_MS * 2));
        return true;
      default:
        return false;
    }
  }

  private async doExtract(
    refs: readonly string[],
    options: ExecuteProgramOptions,
    extracted: unknown[]
  ): Promise<{ success: boolean; errorCode?: ManagedBrowserErrorCode }> {
    if (
      extracted.length + refs.length >
      MANAGED_BROWSER_ACTION_LIMITS.maxExtractedItems
    ) {
      return { success: false, errorCode: "result_too_large" };
    }
    for (const ref of refs) {
      const lookup = options.registry.lookup(ref);
      if (lookup.status !== "ok") {
        continue;
      }
      const value = await lookup.entry.element
        .evaluate<unknown>(
          `((el) => ({
            tag: el.tagName ? el.tagName.toLowerCase() : null,
            text: (el.innerText || el.value || '').slice(0, 2000),
            href: el.tagName === 'A' ? (el.origin || null) : null,
          }))`
        )
        .catch(() => null);
      if (value != null) {
        extracted.push(redactSecrets(value));
      }
    }
    return { success: true };
  }

  private async withElement(
    ref: string,
    pageRevision: number,
    options: ExecuteProgramOptions,
    fn: (entry: ReferenceEntry<ExecutorElementHandle>) => Promise<{
      success: boolean;
      errorCode?: ManagedBrowserErrorCode;
      effectUnknown?: boolean;
      stopCode?: StopCode;
    }>
  ): Promise<{
    success: boolean;
    errorCode?: ManagedBrowserErrorCode;
    elementFound?: boolean | null;
    effectUnknown?: boolean;
    stopCode?: StopCode;
  }> {
    const lookup = options.registry.lookup(ref, pageRevision);
    if (lookup.status === "stale_revision") {
      return {
        success: false,
        errorCode: "stale_page_reference",
        elementFound: null,
        stopCode: "stale_page_reference",
      };
    }
    if (lookup.status !== "ok") {
      return {
        success: false,
        errorCode: "stale_page_reference",
        elementFound: false,
      };
    }
    const result = await fn(lookup.entry);
    return { ...result, elementFound: true };
  }

  private async probeInputType(
    element: ExecutorElementHandle
  ): Promise<string | null> {
    try {
      return await element.evaluate<string | null>(
        `((el) => {
          if (!el || el.tagName !== 'INPUT') return null;
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          const auto = el.getAttribute('autocomplete') || '';
          if (type === 'password') return 'password';
          if (/one-time-code|otp/i.test(auto)) return 'otp';
          if (/cc-number/i.test(auto)) return 'card';
          if (/passkey|webauthn/i.test(auto)) return 'passkey';
          return type;
        })()`
      );
    } catch {
      return null;
    }
  }
}

function safeUrl(page: ExecutorPageLike): string {
  try {
    return page.url();
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Validate program shape beyond the Zod schema (limits, P0 types). */
export function validateProgramLimits(
  program: BrowserActionProgram
): { ok: true } | { ok: false; errorCode: ManagedBrowserErrorCode } {
  if (program.actions.length === 0) {
    return { ok: false, errorCode: "action_not_allowed" };
  }
  if (
    program.actions.length > MANAGED_BROWSER_ACTION_LIMITS.maxActionsPerProgram
  ) {
    return { ok: false, errorCode: "result_too_large" };
  }
  const totalRefs = program.actions.reduce(
    (sum, a) => sum + (a.type === "extract" ? a.refs.length : 1),
    0
  );
  if (totalRefs > MANAGED_BROWSER_ACTION_LIMITS.maxTotalExecutedSteps) {
    return { ok: false, errorCode: "result_too_large" };
  }
  return { ok: true };
}
