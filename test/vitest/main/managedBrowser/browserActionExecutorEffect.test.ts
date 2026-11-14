import { describe, expect, it } from "vitest";
import { BrowserActionExecutor } from "@/childprocess/managed-browser/BrowserActionExecutor";
import { PageReferenceRegistry } from "@/childprocess/managed-browser/PageReferenceRegistry";
import type {
  ExecutorElementHandle,
  ExecutorPageLike,
} from "@/childprocess/managed-browser/BrowserActionExecutor";
import type { BrowserActionProgram } from "@/schemas/worker/managedBrowser";

/**
 * PRD D-FR-26 / technical design §7.3: failures AFTER input dispatch are
 * classified effectUnknown (and stop the program); failures proven to occur
 * before dispatch remain known no-effect.
 */

function makeElement(overrides: {
  click?: () => Promise<void>;
  type?: (text: string) => Promise<void>;
  descriptor?: { role: string; name: string };
  inputType?: string | null;
  select?: (...values: string[]) => Promise<string[]>;
  /** B07: route page-function evaluates by script name. */
  onEvaluate?: (fnName: string) => Promise<unknown>;
}): ExecutorElementHandle {
  const descriptor = overrides.descriptor ?? { role: "button", name: "Go" };
  return {
    async click() {
      if (overrides.click) {
        await overrides.click();
      }
    },
    async type(text: string) {
      if (overrides.type) {
        await overrides.type(text);
      }
    },
    async select(...values: string[]): Promise<string[]> {
      if (overrides.select) {
        return await overrides.select(...values);
      }
      return values;
    },
    async hover(): Promise<void> {
      /* no-op */
    },
    async scrollIntoView(): Promise<void> {
      /* no-op */
    },
    async isIntersectingViewport(): Promise<boolean> {
      return true;
    },
    async evaluate<T>(script: unknown): Promise<T> {
      // F02: identify page functions by name (stable across transpilation).
      const fnName = typeof script === "function" ? script.name : "";
      if (fnName === "readElementDescriptor") {
        return descriptor as unknown as T;
      }
      if (fnName === "probeInputElementTypeFn") {
        return (overrides.inputType ?? null) as unknown as T;
      }
      if (overrides.onEvaluate) {
        return (await overrides.onEvaluate(fnName)) as T;
      }
      return undefined as unknown as T;
    },
    dispose(): void {
      /* no-op */
    },
  } as unknown as ExecutorElementHandle;
}

function makePage(overrides: {
  goto?: () => Promise<void>;
  keyboard?: () => Promise<void>;
  evaluate?: () => Promise<void>;
}): ExecutorPageLike {
  return {
    url: () => "https://www.youtube.com/",
    async evaluate<T>(): Promise<T> {
      if (overrides.evaluate) {
        await overrides.evaluate();
      }
      return undefined as unknown as T;
    },
    async goto(): Promise<unknown> {
      if (overrides.goto) {
        await overrides.goto();
      }
      return null;
    },
    keyboard: {
      async press(): Promise<void> {
        if (overrides.keyboard) {
          await overrides.keyboard();
        }
      },
    },
  };
}

function makeRegistry(
  element: ExecutorElementHandle,
  role = "button",
  name = "Go",
): { registry: PageReferenceRegistry<ExecutorElementHandle>; ref: string } {
  const registry = new PageReferenceRegistry<ExecutorElementHandle>(3);
  const ref = registry.register({ element, role, name, frameId: null });
  return { registry, ref };
}

const NAVIGATION = { allowedOrigins: ["https://www.youtube.com"] };

function run(
  actions: BrowserActionProgram["actions"],
  page: ExecutorPageLike,
  registry: PageReferenceRegistry<ExecutorElementHandle>,
): ReturnType<BrowserActionExecutor["executeProgram"]> {
  const executor = new BrowserActionExecutor();
  return executor.executeProgram(
    { actions } as unknown as BrowserActionProgram,
    {
      page,
      registry,
      navigation: NAVIGATION,
      shouldCancel: () => false,
    },
  );
}

describe("BrowserActionExecutor unknown-effect classification (D-FR-26)", () => {
  it("classifies a click timeout after dispatch as unknown and stops the program", async () => {
    const element = makeElement({
      click: () => {
        throw new Error("TimeoutError: click");
      },
    });
    const { registry, ref } = makeRegistry(element);
    const outcome = await run(
      [
        { type: "click", ref, pageRevision: 3 },
        { type: "scroll", direction: "down", amount: 100 },
      ],
      makePage({}),
      registry,
    );
    expect(outcome.effect).toBe("unknown");
    expect(outcome.stopCode).toBe("unknown_effect");
    expect(outcome.results).toHaveLength(1);
  });

  it("classifies a fill failure after clearing began as unknown", async () => {
    const element = makeElement({
      type: () => {
        throw new Error("detached during typing");
      },
      descriptor: { role: "textbox", name: "Query" },
    });
    const { registry, ref } = makeRegistry(element, "textbox", "Query");
    const outcome = await run(
      [{ type: "fill", ref, pageRevision: 3, value: "hello" }],
      makePage({}),
      registry,
    );
    expect(outcome.effect).toBe("unknown");
    expect(outcome.stopCode).toBe("unknown_effect");
  });

  it("classifies a navigation failure after goto started as unknown", async () => {
    const outcome = await run(
      [{ type: "navigate", url: "https://www.youtube.com/results" }],
      makePage({
        goto: () => {
          throw new Error("net::ERR_ABORTED");
        },
      }),
      new PageReferenceRegistry<ExecutorElementHandle>(3),
    );
    expect(outcome.effect).toBe("unknown");
    expect(outcome.stopCode).toBe("unknown_effect");
  });

  it("keeps a pre-dispatch sensitive-field fill rejection known no-effect", async () => {
    const element = makeElement({
      descriptor: { role: "textbox", name: "Password" },
      inputType: "password",
    });
    const { registry, ref } = makeRegistry(element, "textbox", "Password");
    const outcome = await run(
      [{ type: "fill", ref, pageRevision: 3, value: "secret" }],
      makePage({}),
      registry,
    );
    expect(outcome.effect).toBe("known");
    expect(outcome.stopCode).toBe("handoff_required");
  });

  it("keeps a stale-reference failure before input known no-effect", async () => {
    const element = makeElement({});
    const { registry, ref } = makeRegistry(element);
    const outcome = await run(
      [{ type: "click", ref, pageRevision: 2 }],
      makePage({}),
      registry,
    );
    expect(outcome.effect).toBe("known");
    expect(outcome.stopCode).toBe("stale_page_reference");
  });

  it("keeps read-only action failures (scroll) known no-effect", async () => {
    const outcome = await run(
      [{ type: "scroll", direction: "down", amount: 200 }],
      makePage({
        evaluate: () => {
          throw new Error("context destroyed");
        },
      }),
      new PageReferenceRegistry<ExecutorElementHandle>(3),
    );
    expect(outcome.effect).toBe("known");
    expect(outcome.stopCode).toBe("completed");
    expect(outcome.results[0]?.success).toBe(false);
  });

  it("classifies a press_key failure as unknown because the key may have landed", async () => {
    const outcome = await run(
      [{ type: "press_key", key: "Enter" }],
      makePage({
        keyboard: () => {
          throw new Error("keyboard dispatch failed");
        },
      }),
      new PageReferenceRegistry<ExecutorElementHandle>(3),
    );
    expect(outcome.effect).toBe("unknown");
  });
});

describe("BrowserActionExecutor B07 SELECT stale-option classification", () => {
  const selectAction = {
    type: "select" as const,
    ref: "",
    pageRevision: 3,
    values: ["o_0"],
    expected_values: ["expected-live-value"],
  };

  it("a stale_select_option throw before dispatch is a KNOWN no-effect failure", async () => {
    // Options were reordered after the observation: the resolution throws
    // before element.select is invoked — the page state is unchanged, so
    // the runner must be able to reobserve (not halt on unknown effect).
    const selectCalls: string[][] = [];
    const element = makeElement({
      descriptor: { role: "combobox", name: "Country" },
      select: async (...values) => {
        selectCalls.push(values);
        return values;
      },
      onEvaluate: async (fnName) => {
        if (fnName === "resolveSelectOptionsFn") {
          throw new Error("stale_select_option");
        }
        return undefined;
      },
    });
    const { registry, ref } = makeRegistry(element, "combobox", "Country");
    const outcome = await run(
      [{ ...selectAction, ref }],
      makePage({}),
      registry,
    );
    expect(outcome.effect).toBe("known");
    expect(outcome.stopCode).toBe("completed");
    expect(outcome.results[0]?.success).toBe(false);
    expect(outcome.results[0]?.errorCode).toBe("stale_select_option");
    // Nothing was dispatched to the page.
    expect(selectCalls).toHaveLength(0);
  });

  it("a select failure AFTER the resolution dispatched is still unknown", async () => {
    const element = makeElement({
      descriptor: { role: "combobox", name: "Country" },
      select: async () => {
        throw new Error("select detached");
      },
      onEvaluate: async (fnName) => {
        if (fnName === "resolveSelectOptionsFn") {
          return ["live-value"];
        }
        return undefined;
      },
    });
    const { registry, ref } = makeRegistry(element, "combobox", "Country");
    const outcome = await run(
      [{ ...selectAction, ref }],
      makePage({}),
      registry,
    );
    expect(outcome.effect).toBe("unknown");
    expect(outcome.stopCode).toBe("unknown_effect");
  });
});
