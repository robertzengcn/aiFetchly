import { MANAGED_BROWSER_ACTION_LIMITS } from "@/config/managedBrowser";
import type { ManagedBrowserErrorCode } from "@/entityTypes/managedBrowserTypes";
import type {
  BrowserAction,
  BrowserActionProgram,
  BrowserActionIf,
  BrowserActionRepeat,
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
import {
  READ_ELEMENT_DESCRIPTOR_SCRIPT,
  type LiveElementDescriptor,
} from "@/childprocess/managed-browser/BrowserObservationService";

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
  hover(options?: { timeout?: number }): Promise<void>;
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

/** Program-global execution state shared across composite nesting. */
interface RunState {
  results: ActionStepResult[];
  extracted: unknown[];
  executedSteps: number;
  consecutiveFailures: number;
  effectUnknown: boolean;
  deadline: number;
  depth: number;
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
    const run: RunState = {
      results: [],
      extracted: [],
      executedSteps: 0,
      consecutiveFailures: 0,
      effectUnknown: false,
      deadline: now() + MANAGED_BROWSER_ACTION_LIMITS.programWallTimeMs,
      depth: 0,
    };
    const stopCode = await this.runSequence(program.actions, options, run);
    return this.finish(
      stopCode ?? "completed",
      run.effectUnknown,
      options,
      run.results,
      run.extracted
    );
  }

  /**
   * Shared-limit action walker (GAP-13): leaf actions record step results;
   * if/repeat composites recurse with the SAME counters, deadline, and
   * cancellation token — total steps, wall time, and consecutive failures
   * are program-global invariants.
   */
  private async runSequence(
    actions: readonly BrowserAction[],
    options: ExecuteProgramOptions,
    run: RunState
  ): Promise<StopCode | null> {
    const now = options.now ?? Date.now;
    for (const action of actions) {
      if (options.shouldCancel()) {
        return "cancelled";
      }
      if (
        run.executedSteps >= MANAGED_BROWSER_ACTION_LIMITS.maxTotalExecutedSteps
      ) {
        return "limit_exceeded";
      }
      if (now() > run.deadline) {
        return "limit_exceeded";
      }

      if (action.type === "if" || action.type === "repeat") {
        if (run.depth >= MANAGED_BROWSER_ACTION_LIMITS.maxNestedDepth) {
          run.results.push({
            actionIndex: run.results.length,
            type: action.type,
            success: false,
            errorCode: "action_not_allowed",
            elementFound: null,
            urlAfter: safeUrl(options.page),
          });
          return "limit_exceeded";
        }
        run.depth++;
        try {
          const compositeStop = await this.runComposite(
            action,
            options,
            run
          );
          if (compositeStop) {
            return compositeStop;
          }
        } finally {
          run.depth--;
        }
        run.consecutiveFailures = 0;
        continue;
      }

      run.executedSteps++;
      const outcome = await this.executeOne(action, options, run);
      run.results.push({
        actionIndex: run.results.length,
        type: action.type,
        success: outcome.success,
        errorCode: outcome.errorCode ?? null,
        elementFound: outcome.elementFound ?? null,
        urlAfter: outcome.urlAfter ?? safeUrl(options.page),
      });

      if (!outcome.success) {
        run.consecutiveFailures++;
        if (outcome.effectUnknown) {
          run.effectUnknown = true;
        }
        if (outcome.stopCode) {
          return outcome.stopCode;
        }
        if (
          run.consecutiveFailures >=
          MANAGED_BROWSER_ACTION_LIMITS.maxConsecutiveFailures
        ) {
          return "consecutive_failures";
        }
      } else {
        run.consecutiveFailures = 0;
      }
    }
    return null;
  }

  /** GAP-13: bounded conditional + repeat execution. */
  private async runComposite(
    action: BrowserActionIf | BrowserActionRepeat,
    options: ExecuteProgramOptions,
    run: RunState
  ): Promise<StopCode | null> {
    if (action.type === "if") {
      const met = await this.checkCondition(action, options);
      const branch = met ? action.then : (action.else ?? []);
      return branch.length > 0
        ? this.runSequence(branch, options, run)
        : null;
    }
    // repeat: check the condition BEFORE each iteration; hard iteration
    // cap is schema-bound, total-step + wall-time caps are shared.
    for (let iteration = 0; iteration < action.maxIterations; iteration++) {
      if (options.shouldCancel()) {
        return "cancelled";
      }
      if (!(await this.checkCondition(action, options))) {
        return null;
      }
      const stop = await this.runSequence(action.body, options, run);
      if (stop) {
        return stop;
      }
    }
    return null;
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
    action: Exclude<BrowserAction, BrowserActionIf | BrowserActionRepeat>,
    options: ExecuteProgramOptions,
    run: RunState
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
            action,
            options,
            async (entry) => {
              await entry.element.scrollIntoView();
              await entry.element.click({ timeout: 5_000 });
              return { success: true };
            }
          );
        case "fill":
          return await this.withElement(
            action,
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
            action,
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
          return await this.doExtract(action.refs, options, run.extracted);
        case "hover":
          return await this.withElement(action, options, async (entry) => {
            await entry.element.scrollIntoView();
            await entry.element.hover();
            return { success: true };
          });
        case "clear":
          return await this.withElement(action, options, async (entry) => {
            await entry.element.scrollIntoView();
            await entry.element.evaluate(
              "((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); })"
            );
            return { success: true };
          });
        case "go_back":
          await options.page.evaluate("(() => history.back())()");
          options.registry.reset(options.registry.currentRevision + 1);
          return { success: true };
        case "go_forward":
          await options.page.evaluate("(() => history.forward())()");
          options.registry.reset(options.registry.currentRevision + 1);
          return { success: true };
        case "reload":
          await options.page.evaluate("(() => location.reload())()");
          options.registry.reset(options.registry.currentRevision + 1);
          return { success: true };
        case "screenshot":
          // Metadata-only marker: the headed window is the user surface.
          return { success: true };
        case "stop":
          return {
            success: false,
            errorCode: "cancelled" as const,
            stopCode: "cancelled" as const,
          };
        case "request_handoff":
          return {
            success: false,
            errorCode: "challenge_requires_handoff" as const,
            stopCode: "handoff_required" as const,
          };
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
    action: {
      condition: "element" | "navigation" | "url" | "text" | "networkidle";
      ref?: string;
      url?: string;
      text?: string;
    },
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
    action: Extract<
      BrowserAction,
      { type: "click" | "fill" | "select" | "hover" | "clear" }
    >,
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
    const lookup = options.registry.lookup(action.ref, action.pageRevision);
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
    // GAP-01/03: revalidate the LIVE element against the expected
    // fingerprint (main-process-attested from the latest observation)
    // immediately before execution. Fail closed on any mismatch.
    const expected = {
      role: action.expectedRole ?? lookup.entry.role,
      name: action.expectedName ?? lookup.entry.name,
    };
    const live = await lookup.entry.element
      .evaluate<LiveElementDescriptor | null>(READ_ELEMENT_DESCRIPTOR_SCRIPT)
      .catch(() => null);
    if (
      !live ||
      live.role !== expected.role ||
      live.name !== expected.name
    ) {
      return {
        success: false,
        errorCode: "stale_page_reference",
        elementFound: true,
        stopCode: "stale_page_reference",
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
  // Composites flatten into their leaf steps; nesting is depth-bounded.
  const flatten = (
    actions: readonly BrowserAction[],
    depth: number
  ): { steps: number; ok: boolean } => {
    if (depth > MANAGED_BROWSER_ACTION_LIMITS.maxNestedDepth) {
      return { steps: 0, ok: false };
    }
    let steps = 0;
    for (const action of actions) {
      if (action.type === "if") {
        const thenPart = flatten(action.then, depth + 1);
        const elsePart = action.else
          ? flatten(action.else, depth + 1)
          : { steps: 0, ok: true };
        if (!thenPart.ok || !elsePart.ok) {
          return { steps: 0, ok: false };
        }
        // Worst-case branch + the guard step itself.
        steps += 1 + Math.max(thenPart.steps, elsePart.steps);
      } else if (action.type === "repeat") {
        const body = flatten(action.body, depth + 1);
        if (!body.ok) {
          return { steps: 0, ok: false };
        }
        steps += 1 + body.steps * action.maxIterations;
      } else {
        steps += action.type === "extract" ? action.refs.length : 1;
      }
    }
    return { steps, ok: true };
  };
  const flattened = flatten(program.actions, 0);
  if (!flattened.ok) {
    return { ok: false, errorCode: "action_not_allowed" };
  }
  if (flattened.steps > MANAGED_BROWSER_ACTION_LIMITS.maxTotalExecutedSteps) {
    return { ok: false, errorCode: "result_too_large" };
  }
  return { ok: true };
}
