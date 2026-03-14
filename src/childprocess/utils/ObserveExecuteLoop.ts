/**
 * Shared observe-execute loop: capture state -> observe -> execute actions -> repeat
 * until goal_achieved / give_up / max iterations.
 * Used by YellowPagesScraper and search engine scrapers.
 */

import type {
  AiExecutableAction,
  AiObserveActionResult,
} from "@/modules/interface/BackgroundProcessMessages";
import type { ActionResult } from "./ObserveExecuteExecutor";
import { AI_RECOVERY_CONFIG } from "@/config/aiRecoveryConfig";

export interface ObserveExecuteParams {
  goal: string;
  pageUrl: string;
  pageContent: string;
  screenshot?: string;
  selectorsAvailable?: Record<string, string>;
  maxIterations?: number;
  goalContext?: string;
  stepContext?: string;
  errorInfo?: string;
}

/** Result from one observe request (observe_execute response data). */
export interface ObserveExecuteRoundResult {
  success: boolean;
  data?: {
    session_id?: string;
    status?: "actions_needed" | "goal_achieved" | "give_up";
    actions?: AiExecutableAction[];
  };
  requestType: "observe_execute";
  errorMessage?: string;
}

/** Full result of the observe-execute loop. */
export interface ObserveExecuteResult {
  success: boolean;
  requestType: "observe_execute";
  data?: {
    session_id?: string;
    status?: "actions_needed" | "goal_achieved" | "give_up";
    actions?: AiExecutableAction[];
  };
  errorMessage?: string;
}

export interface ObserveExecuteDeps {
  /** Request AI support (observe_execute); returns result with status and optional actions. */
  requestAiSupport: (request: {
    requestType: "observe_execute";
    pageUrl: string;
    goal: string;
    sessionId: string | null;
    previousActionResults: AiObserveActionResult[];
    iteration: number;
    selectorsAvailable: Record<string, string>;
    maxIterations: number;
    goalContext?: string;
    stepContext?: string;
    errorInfo?: string;
    pageContent: string;
    screenshot?: string;
  }) => Promise<ObserveExecuteRoundResult>;
  /** Execute one action and return result. */
  executeAction: (action: AiExecutableAction) => Promise<ActionResult>;
  /**
   * Capture the latest page state (recommended).
   * If provided, the loop will refresh pageUrl/pageContent/screenshot before each observe request,
   * so the LLM can verify whether previous actions achieved the goal.
   */
  captureState?: () => Promise<{
    pageUrl: string;
    pageContent: string;
    screenshot?: string;
  }>;
}

/**
 * Run observe-execute loop: call requestAiSupport -> if actions_needed, execute each action -> repeat.
 */
export async function runObserveExecuteLoop(
  params: ObserveExecuteParams,
  deps: ObserveExecuteDeps
): Promise<ObserveExecuteResult> {
  const {
    goal,
    pageUrl,
    pageContent,
    screenshot,
    selectorsAvailable = {},
    maxIterations = AI_RECOVERY_CONFIG.MAX_OBSERVE_ITERATIONS,
    goalContext,
    stepContext,
    errorInfo,
  } = params;

  let sessionId: string | null = null;
  let previousActionResults: AiObserveActionResult[] = [];
  let currentPageUrl = pageUrl;
  let currentPageContent = pageContent;
  let currentScreenshot = screenshot;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (
      deps.captureState &&
      (iteration > 0 || previousActionResults.length > 0)
    ) {
      try {
        const state = await deps.captureState();
        currentPageUrl = state.pageUrl;
        currentPageContent = state.pageContent;
        currentScreenshot = state.screenshot;
      } catch (err) {
        console.warn(
          "⚠️ Failed to capture fresh page state for observe-execute:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    const result = await deps.requestAiSupport({
      requestType: "observe_execute",
      pageUrl: currentPageUrl,
      goal,
      sessionId,
      previousActionResults,
      iteration,
      selectorsAvailable,
      maxIterations,
      goalContext,
      stepContext: iteration === 0 ? stepContext : undefined,
      errorInfo: iteration === 0 ? errorInfo : undefined,
      pageContent: currentPageContent,
      screenshot: currentScreenshot,
    });
    console.log(`ai request result: ${JSON.stringify(result)}`);
    if (!result.success || !result.data) {
      return {
        success: result.success,
        requestType: "observe_execute",
        errorMessage: result.errorMessage,
      };
    }

    const status = result.data.status;
    sessionId = result.data.session_id ?? null;
    console.log(`run observer status: ${status}`);
    if (status === "goal_achieved" || status === "give_up") {
      return {
        success: true,
        requestType: "observe_execute",
        data: result.data,
      };
    }

    if (status !== "actions_needed" || !result.data.actions?.length) {
      return {
        success: true,
        requestType: "observe_execute",
        data: result.data,
      };
    }

    previousActionResults = [];
    for (const act of result.data.actions) {
      const actionResult = await deps.executeAction(act);
      previousActionResults.push({
        action_id: actionResult.action_id,
        success: actionResult.success,
        error: actionResult.error,
        element_found: actionResult.element_found,
        screenshot_after: actionResult.screenshot_after,
        url_before: actionResult.url_before,
        url_after: actionResult.url_after,
        title_before: actionResult.title_before,
        title_after: actionResult.title_after,
        selector_count_after: actionResult.selector_count_after,
      });
    }
  }
  console.log(`max iterations reached`);
  return {
    success: false,
    requestType: "observe_execute",
    errorMessage: "Max observe-execute iterations reached",
  };
}
