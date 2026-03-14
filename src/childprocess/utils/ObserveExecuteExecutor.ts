/**
 * Shared Puppeteer action executor for observe-execute loops.
 * Used by YellowPagesScraper and search engine scrapers (Google, Bing, Baidu, Yandex).
 * Action schema aligns with scrape_assist ExecutableAction and AiExecutableAction.
 */

import { Page, ElementHandle, Frame } from "puppeteer";
import { createLogger } from "./logger";
import { AI_RECOVERY_CONFIG } from "@/config/aiRecoveryConfig";

const logger = createLogger("ObserveExecuteExecutor");

export interface ExecutableActionInput {
  action_id: string;
  type: string;
  selector?: string;
  selector_type?: string;
  value?: string;
  key?: string;
  timeout?: number;
  description?: string;
}

export interface ActionResult {
  action_id: string;
  success: boolean;
  error?: string;
  element_found: boolean;
  screenshot_after?: string;
  url_before?: string;
  url_after?: string;
  title_before?: string;
  title_after?: string;
  /** For css selector actions, count of matching elements after the action */
  selector_count_after?: number;
}

function clampTimeout(ms: number | undefined): number {
  if (ms == null) return AI_RECOVERY_CONFIG.ACTION_DEFAULT_TIMEOUT_MS;
  return Math.min(
    AI_RECOVERY_CONFIG.ACTION_MAX_TIMEOUT_MS,
    Math.max(AI_RECOVERY_CONFIG.ACTION_MIN_TIMEOUT_MS, ms)
  );
}

function normalizeTextForIncludes(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function splitSelectorList(selector: string): string[] {
  // AI sometimes returns comma-separated selector lists. We do a simple split because
  // our AI-generated selectors do not include commas inside attribute values.
  return selector
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function extractContainsText(
  selector: string
): { baseSelector: string; textNeedle: string } | null {
  // Supports:
  // - .foo:contains('Next')
  // - .foo:contains("Next")
  // - a:has-text='Next'
  // - a:has-text("Next")
  // - a:has-text('Next')
  const containsMatch = selector.match(
    /^(.*?)(?::contains\((['"])(.*?)\2\))(.*)$/
  );
  if (containsMatch) {
    const baseSelector = `${containsMatch[1]}${containsMatch[4]}`.trim();
    const textNeedle = containsMatch[3];
    return {
      baseSelector: baseSelector.length > 0 ? baseSelector : "*",
      textNeedle,
    };
  }

  const hasTextFuncMatch = selector.match(
    /^(.*?)(?::has-text\((['"])(.*?)\2\))(.*)$/
  );
  if (hasTextFuncMatch) {
    const baseSelector = `${hasTextFuncMatch[1]}${hasTextFuncMatch[4]}`.trim();
    const textNeedle = hasTextFuncMatch[3];
    return {
      baseSelector: baseSelector.length > 0 ? baseSelector : "*",
      textNeedle,
    };
  }

  const hasTextEqMatch = selector.match(
    /^(.*?)(?::has-text\s*=\s*(['"])(.*?)\2)(.*)$/
  );
  if (hasTextEqMatch) {
    const baseSelector = `${hasTextEqMatch[1]}${hasTextEqMatch[4]}`.trim();
    const textNeedle = hasTextEqMatch[3];
    return {
      baseSelector: baseSelector.length > 0 ? baseSelector : "*",
      textNeedle,
    };
  }

  return null;
}

async function findElementByCssOrTextHint(
  frame: Frame & {
    $x?(expr: string): Promise<ElementHandle<Element>[]>;
    $?(sel: string): Promise<ElementHandle<Element> | null>;
    $$(sel: string): Promise<ElementHandle<Element>[]>;
  },
  selector: string
): Promise<ElementHandle<Element> | null> {
  const maybeContains = extractContainsText(selector);
  if (!maybeContains) {
    return await frame.$(selector);
  }

  const candidates = await frame.$$(maybeContains.baseSelector);
  if (!candidates.length) return null;

  const needle = normalizeTextForIncludes(maybeContains.textNeedle);
  for (const c of candidates) {
    try {
      const txt = await c.evaluate((el) => (el.textContent ?? "").toString());
      if (normalizeTextForIncludes(txt).includes(needle)) return c;
    } catch {
      // ignore detached/other evaluation errors
      continue;
    }
  }

  return null;
}

/**
 * Perform exponential backoff wait for element detection
 * More efficient than fixed polling intervals
 */
async function waitForElementWithBackoff<T>(
  finder: () => Promise<T>,
  timeoutMs: number
): Promise<{ found: boolean; result: T | null }> {
  const deadline = Date.now() + timeoutMs;
  const maxAttempts = 20;
  let attempt = 0;
  let currentDelayMs = Number(AI_RECOVERY_CONFIG.XPATH_POLL_INTERVAL_MS);
  const MAX_DELAY_MS = 1000;

  while (Date.now() < deadline && attempt < maxAttempts) {
    const result = await finder();
    if (result !== null && result !== undefined) {
      return { found: true, result };
    }
    // Exponential backoff with jitter to avoid thundering herd
    const jitter = Math.random() * 50; // ±25ms jitter
    const nextDelay = currentDelayMs + jitter;
    await new Promise((r) => setTimeout(r, nextDelay));
    // Ensure we don't exceed max delay
    currentDelayMs = Math.min(currentDelayMs * 2, MAX_DELAY_MS);
    attempt++;
  }

  return { found: false, result: null };
}

/**
 * Execute a single Puppeteer action (observe-execute schema).
 * Supports: click, type, waitForSelector, scroll, pressKey, navigate, wait.
 */
export async function executePuppeteerAction(
  page: Page,
  action: ExecutableActionInput
): Promise<ActionResult> {
  const timeout = clampTimeout(action.timeout);
  const result: ActionResult = {
    action_id: action.action_id,
    success: false,
    element_found: false,
  };

  if (!page) {
    result.error = "No page available";
    return result;
  }

  try {
    try {
      result.url_before = await page.url();
      result.title_before = await page.title();
    } catch {
      // ignore
    }

    let element: ElementHandle<Element> | null = null;
    if (action.selector) {
      const frames = page.frames();
      const selectorParts =
        action.selector_type === "xpath" || action.selector_type === "text"
          ? [action.selector]
          : splitSelectorList(action.selector);
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const f = frame as Frame & {
          $x?(expr: string): Promise<ElementHandle<Element>[]>;
          $?(sel: string): Promise<ElementHandle<Element> | null>;
          $$(sel: string): Promise<ElementHandle<Element>[]>;
        };
        try {
          if (action.selector_type === "xpath") {
            if (typeof f.$x !== "function") continue;
            const handles = await f.$x(action.selector);
            element = handles[0] ?? null;
          } else if (action.selector_type === "text") {
            if (typeof f.$x !== "function") continue;
            const xpath = `//*[contains(text(), ${JSON.stringify(
              action.selector
            )})]`;
            const handles = await f.$x(xpath);
            element = handles[0] ?? null;
          } else {
            if (typeof frame.$ !== "function") continue;
            for (const part of selectorParts) {
              try {
                element = await findElementByCssOrTextHint(f, part);
              } catch (err) {
                // invalid selector (e.g. :contains) or other DOM error; try next selector part
                continue;
              }
              if (element) break;
            }
          }
        } catch (err) {
          logger.debug(
            "Frame search error: %s",
            err instanceof Error ? err.message : String(err)
          );
          continue;
        }
        if (element) break;
      }
      result.element_found = element !== null;
    }

    switch (action.type) {
      case "click":
        if (!element) {
          result.error = "Element not found for click";
          break;
        }
        await element.click();
        result.success = true;
        break;
      case "type":
        if (!element) {
          result.error = "Element not found for type";
          break;
        }
        await element.type(action.value ?? "", { delay: 0 });
        result.success = true;
        break;
      case "waitForSelector":
        if (!action.selector) {
          result.error = "Selector required for waitForSelector";
          break;
        }
        if (action.selector_type === "xpath") {
          const frame = page.mainFrame() as Frame & {
            $x(expr: string): Promise<ElementHandle<Element>[]>;
          };
          const { found } = await waitForElementWithBackoff(async () => {
            const handles = await frame.$x(action.selector!);
            return handles.length > 0 ? handles[0] : null;
          }, timeout);
          result.element_found = found;
          result.success = found;
          if (!found) {
            result.error = "Timeout waiting for xpath selector";
          }
        } else {
          // Use the same robust, selector-list and :contains/:has-text aware
          // element finder that we use for click, instead of relying directly
          // on page.waitForSelector which cannot handle these syntaxes.
          const frames = page.frames();
          const selectorParts = splitSelectorList(action.selector);
          const { found } = await waitForElementWithBackoff(async () => {
            for (let i = 0; i < frames.length; i++) {
              const frame = frames[i] as Frame & {
                $x?(expr: string): Promise<ElementHandle<Element>[]>;
                $?(sel: string): Promise<ElementHandle<Element> | null>;
                $$(sel: string): Promise<ElementHandle<Element>[]>;
              };
              for (const part of selectorParts) {
                try {
                  const el = await findElementByCssOrTextHint(frame, part);
                  if (el) return el;
                } catch {
                  // ignore and try next selector/frame
                  continue;
                }
              }
            }
            return null;
          }, timeout);
          result.element_found = found;
          result.success = found;
          if (!found) {
            result.error = "Timeout waiting for selector (css/text emulation)";
          }
        }
        break;
      case "scroll":
        if (element) {
          await element.evaluate((el) => el.scrollIntoView());
        } else {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        }
        result.success = true;
        break;
      case "pressKey":
        await page.keyboard.press(
          (action.key ?? "Enter") as import("puppeteer").KeyInput
        );
        result.success = true;
        break;
      case "navigate": {
        const url = action.value ?? "about:blank";
        await page.goto(url, { waitUntil: "domcontentloaded", timeout });
        result.success = true;
        break;
      }
      case "wait": {
        const seconds = Math.min(
          60,
          Math.max(1, parseInt(action.value ?? "5", 10) || 5)
        );
        await new Promise((r) => setTimeout(r, seconds * 1000));
        result.success = true;
        break;
      }
      default:
        result.error = `Unknown action type: ${action.type}`;
    }

    if (result.success && page) {
      try {
        try {
          result.url_after = await page.url();
          result.title_after = await page.title();
        } catch {
          // ignore
        }

        if (action.selector && (action.selector_type ?? "css") === "css") {
          const sel = splitSelectorList(action.selector)[0];
          if (sel) {
            try {
              const count = await page.evaluate((s) => {
                try {
                  return document.querySelectorAll(s).length;
                } catch {
                  return -1;
                }
              }, sel);
              if (typeof count === "number" && count >= 0) {
                result.selector_count_after = count;
              }
            } catch {
              // ignore
            }
          }
        }

        const buf = await page.screenshot({ encoding: "base64" });
        result.screenshot_after = typeof buf === "string" ? buf : undefined;
      } catch {
        // ignore screenshot failure
      }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    logger.debug("executePuppeteerAction error: %s", result.error);
  }
  return result;
}
