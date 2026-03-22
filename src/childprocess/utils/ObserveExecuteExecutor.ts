/**
 * Shared Puppeteer action executor for observe-execute loops.
 * Used by YellowPagesScraper and search engine scrapers (Google, Bing, Baidu, Yandex).
 * Action schema aligns with scrape_assist ExecutableAction and AiExecutableAction.
 */

import { Page, ElementHandle, Frame } from "puppeteer";
import { createLogger } from "./logger";
import { AI_RECOVERY_CONFIG } from "@/config/aiRecoveryConfig";

const logger = createLogger("ObserveExecuteExecutor");

/** Matches aifetchserver DEFAULT_DRAG_DISTANCE_PX when the model omits value */
const DEFAULT_DRAG_DISTANCE_PX = 280;

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

async function findAllElementsByCssOrTextHint(
  frame: Frame & {
    $x?(expr: string): Promise<ElementHandle<Element>[]>;
    $?(sel: string): Promise<ElementHandle<Element> | null>;
    $$(sel: string): Promise<ElementHandle<Element>[]>;
  },
  selector: string
): Promise<ElementHandle<Element>[]> {
  const maybeContains = extractContainsText(selector);
  if (!maybeContains) {
    try {
      return await frame.$$(selector);
    } catch {
      return [];
    }
  }

  const candidates = await frame.$$(maybeContains.baseSelector);
  if (!candidates.length) return [];

  const needle = normalizeTextForIncludes(maybeContains.textNeedle);
  const matched: ElementHandle<Element>[] = [];
  for (const c of candidates) {
    try {
      const txt = await c.evaluate((el) => (el.textContent ?? "").toString());
      if (normalizeTextForIncludes(txt).includes(needle)) matched.push(c);
    } catch {
      continue;
    }
  }
  return matched;
}

/**
 * When a vague CSS selector matches multiple nodes, prefer a small leftmost control
 * (typical slider thumb) over full-width tracks or unrelated buttons.
 */
function extractClickHintsFromDescription(description: string): string[] {
  const out = new Set<string>();
  const d = description.trim();
  if (!d) return [];

  const skip = new Set([
    "the",
    "and",
    "for",
    "not",
    "are",
    "you",
    "this",
    "that",
    "with",
    "from",
    "page",
    "click",
    "button",
    "will",
    "has",
    "have",
    "need",
    "must",
    "robot",
    "verification",
    "screen",
    "current",
    "main",
    "search",
    "results",
    "past",
    "barrier",
    "necessary",
    "proceed",
    "reach",
    "intended",
    "business",
    "list",
    "human",
    "visible",
  ]);

  for (const m of d.matchAll(/\b([A-Za-z][A-Za-z0-9_-]{2,})\b/g)) {
    const w = m[1];
    if (!skip.has(w.toLowerCase())) {
      out.add(w);
    }
  }
  for (const m of d.matchAll(/['"]([^'"]{2,40})['"]/g)) {
    const inner = m[1].trim();
    if (inner.length >= 2) {
      out.add(inner);
    }
  }
  return [...out];
}

type ClickableGeom = {
  ok: boolean;
  top: number;
  left: number;
  area: number;
  textNorm: string;
};

async function getClickableGeometry(
  h: ElementHandle<Element>
): Promise<ClickableGeom | null> {
  return h.evaluate((node) => {
    if (!(node instanceof HTMLElement)) {
      return null;
    }
    const style = window.getComputedStyle(node);
    if (
      style.visibility === "hidden" ||
      style.display === "none" ||
      parseFloat(style.opacity) === 0
    ) {
      return { ok: false, top: 0, left: 0, area: 0, textNorm: "" };
    }
    const r = node.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const inView =
      r.bottom > 2 &&
      r.top < vh - 2 &&
      r.right > 2 &&
      r.left < vw - 2 &&
      r.width >= 1 &&
      r.height >= 1;
    const textNorm = (node.innerText || node.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return {
      ok: inView,
      top: r.top,
      left: r.left,
      area: r.width * r.height,
      textNorm,
    };
  });
}

/**
 * Prefer nodes that are visible in the viewport; boost score when label/text
 * matches words from the action description (e.g. RETRY).
 */
async function rankClickCandidates(
  handles: ElementHandle<Element>[],
  description: string
): Promise<ElementHandle<Element>[]> {
  if (!handles.length) return [];

  const hints = extractClickHintsFromDescription(description);
  type Row = { el: ElementHandle<Element>; score: number; top: number; left: number; area: number };
  const rows: Row[] = [];

  for (const h of handles) {
    try {
      const g = await getClickableGeometry(h);
      if (!g || !g.ok) continue;
      let score = 0;
      for (const hint of hints) {
        const n = normalizeTextForIncludes(hint);
        if (n.length >= 2 && g.textNorm.includes(n)) {
          score += 100;
        }
      }
      rows.push({ el: h, score, top: g.top, left: g.left, area: g.area });
    } catch {
      continue;
    }
  }

  if (!rows.length) {
    return handles.slice(0, 12);
  }

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.top !== b.top) return a.top - b.top;
    if (a.left !== b.left) return a.left - b.left;
    return a.area - b.area;
  });
  return rows.map((r) => r.el);
}

async function clickElementRobustly(el: ElementHandle<Element>): Promise<void> {
  await el.evaluate((node) => {
    if (node instanceof HTMLElement) {
      node.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
    }
  });
  await new Promise((r) => setTimeout(r, 40));
  try {
    await el.click({ delay: 25 });
  } catch {
    const clicked = await el.evaluate((node) => {
      if (node instanceof HTMLElement) {
        node.click();
        return true;
      }
      return false;
    });
    if (!clicked) {
      throw new Error("Element is not an HTMLElement for programmatic click");
    }
  }
}

async function pickDragHandleCandidate(
  handles: ElementHandle<Element>[]
): Promise<ElementHandle<Element> | null> {
  if (!handles.length) return null;

  type Boxed = {
    el: ElementHandle<Element>;
    box: { x: number; y: number; width: number; height: number };
  };
  const boxed: Boxed[] = [];
  for (const h of handles) {
    const box = await h.boundingBox();
    if (!box || box.width < 6 || box.height < 6) continue;
    if (box.width > 420 || box.height > 140) continue;
    boxed.push({ el: h, box });
  }
  if (!boxed.length) {
    return handles[0] ?? null;
  }
  boxed.sort((a, b) => {
    const yd = Math.abs(a.box.y - b.box.y);
    if (yd > 40) {
      return a.box.y - b.box.y;
    }
    if (a.box.x !== b.box.x) {
      return a.box.x - b.box.x;
    }
    return (
      a.box.width * a.box.height - b.box.width * b.box.height
    );
  });
  return boxed[0].el;
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
 * Supports: click, type, waitForSelector, scroll, pressKey, navigate, wait, drag.
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
      const useDragDisambiguation =
        action.type === "drag" && (action.selector_type ?? "css") === "css";
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
                if (useDragDisambiguation && typeof frame.$$ === "function") {
                  const all = await findAllElementsByCssOrTextHint(f, part);
                  element = await pickDragHandleCandidate(all);
                  if (!element) {
                    element = await findElementByCssOrTextHint(f, part);
                  }
                } else {
                  element = await findElementByCssOrTextHint(f, part);
                }
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
      case "click": {
        const desc = action.description ?? "";
        let clickCandidates: ElementHandle<Element>[] = [];

        if (action.selector && (action.selector_type ?? "css") === "css") {
          const frames = page.frames();
          const parts = splitSelectorList(action.selector);
          for (let fi = 0; fi < frames.length; fi++) {
            const frame = frames[fi] as Frame & {
              $x?(expr: string): Promise<ElementHandle<Element>[]>;
              $?(sel: string): Promise<ElementHandle<Element> | null>;
              $$(sel: string): Promise<ElementHandle<Element>[]>;
            };
            for (const part of parts) {
              try {
                const all = await findAllElementsByCssOrTextHint(frame, part);
                for (const h of all) {
                  clickCandidates.push(h);
                }
              } catch {
                continue;
              }
            }
          }
          clickCandidates = await rankClickCandidates(clickCandidates, desc);
        }

        if (clickCandidates.length === 0) {
          if (!element) {
            result.error = "Element not found for click";
            break;
          }
          clickCandidates = [element];
        }

        result.element_found = clickCandidates.length > 0;
        let lastClickErr: string | undefined;
        const maxTries = Math.min(10, clickCandidates.length);
        for (let ti = 0; ti < maxTries; ti++) {
          try {
            await clickElementRobustly(clickCandidates[ti]);
            result.success = true;
            break;
          } catch (e) {
            lastClickErr = e instanceof Error ? e.message : String(e);
          }
        }
        if (!result.success) {
          result.error = lastClickErr ?? "Click failed for all candidates";
        }
        break;
      }
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
      case "drag": {
        if (!element) {
          result.error = "Element not found for drag";
          break;
        }
        const box = await element.boundingBox();
        if (!box) {
          result.error = "Cannot get bounding box for drag element";
          break;
        }
        // value is horizontal drag distance in px (positive: left->right, negative: right->left).
        const distanceRaw = parseInt(
          action.value ?? String(DEFAULT_DRAG_DISTANCE_PX),
          10
        );
        // Keep drag range bounded to avoid unrealistic/off-target motions.
        const distance = Math.max(
          -400,
          Math.min(
            400,
            Number.isFinite(distanceRaw) ? distanceRaw : DEFAULT_DRAG_DISTANCE_PX
          )
        );
        const startX = box.x + box.width / 2;
        const startY = box.y + box.height / 2;
        const endX = startX + distance;
        // Add a tiny y-axis jitter to avoid perfectly linear bot-like movement.
        const endY = startY + (Math.random() * 3 - 1.5);
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(endX, endY, { steps: 24 });
        await page.mouse.up();
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
