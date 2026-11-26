import { describe, expect, it } from "vitest";

import { ManagedBrowserRuntime } from "@/childprocess/managed-browser/ManagedBrowserRuntime";
import {
  WorkerSession,
  type LaunchBrowserOptions,
  type PuppeteerBrowserLike,
  type PuppeteerPageLike,
  type WorkerSessionDeps,
} from "@/childprocess/managed-browser/WorkerSession";
import type { FingerprintSelfTestEvidence } from "@/entityTypes/managedBrowserTypes";
import {
  managedBrowserInboundSchema,
  managedBrowserOutboundSchema,
  type ManagedBrowserOutboundMessage,
} from "@/schemas/worker/managedBrowser";
import type { ManagedBrowserInboundMessage } from "@/schemas/worker/managedBrowser";

/**
 * §8.4 counter contract: the worker emits exactly ONE monotonic sequence
 * stream. Heartbeats (emitted by the entry module) and command replies
 * (emitted by WorkerSession) must draw from the SAME allocator — the client
 * discards any message whose sequence is ≤ the last observed value, so a
 * split counter makes real replies look stale (caught by E2E: start timed
 * out whenever enough heartbeats had flown before LOGIN_REQUIRED).
 */

interface SendRecord {
  requestId: string | undefined;
  sequence: number | undefined;
  type: string;
}

function decode(raw: string): SendRecord {
  const parsed = managedBrowserOutboundSchema().safeParse(
    JSON.parse(raw) as unknown
  );
  if (!parsed.success) {
    throw new Error(
      `invalid outbound message: ${parsed.error.message} raw=${raw}`
    );
  }
  const message = parsed.data as ManagedBrowserOutboundMessage & {
    requestId: string;
    sequence: number;
  };
  return {
    requestId: message.requestId,
    sequence: message.sequence,
    type: message.type,
  };
}

function buildStartPayload(
  overrides?: Partial<
    Extract<ManagedBrowserInboundMessage, { type: "START_SESSION" }>
  >
): Extract<ManagedBrowserInboundMessage, { type: "START_SESSION" }> {
  return {
    ...({
      type: "START_SESSION",
      requestId: "req-seq-shared-test",
      executable: {
        path: "/fake/chrome",
        source: "system",
        product: "chrome",
        version: "999.0.0.1",
        majorVersion: 999,
        architecture: "x64",
      },
      launchPolicy: {
        headless: false,
        locale: "en-US",
        viewport: { width: 1365, height: 768 },
        windowSize: { width: 1400, height: 900 },
        userAgentOverride: null,
        timezoneId: null,
        enabledStealthEvasions: [],
        extraArgs: [],
      },
      storagePolicy: {
        temporaryProfilePath: "/tmp/opencode/mb-profile-test",
        persistentCache: {
          enabled: false,
          cachePath: null,
          scopeToken: null,
          namespace: null,
        },
      },
      platform: {
        id: 2,
        displayName: "YouTube",
        allowedOrigins: ["https://www.youtube.com"],
        loginOrigins: ["https://accounts.google.com"],
        verificationUrl: "https://www.youtube.com/",
        domains: ["youtube.com"],
      },
      proxy: { mode: "direct" },
      cookies: [],
    } as unknown as Extract<
      ManagedBrowserInboundMessage,
      { type: "START_SESSION" }
    >),
    ...overrides,
  };
}

function fakePage(evidence: FingerprintSelfTestEvidence): PuppeteerPageLike {
  const page = {
    url: () => "about:blank",
    goto: async () => undefined,
    evaluate: async () => evidence,
    bringToFront: async () => undefined,
    authenticate: () => undefined,
  } as unknown as PuppeteerPageLike;
  return page;
}

const mismatchedEvidence: FingerprintSelfTestEvidence = {
  browserVersion: "104.9",
  browserMajor: 104,
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/104.9 Safari/537.36",
  userAgentMajor: 104,
  platform: "Linux x86_64",
  language: "en-US",
  languages: ["en-US"],
  timezone: "Etc/UTC",
  viewport: { width: 1365, height: 768 },
  screen: { width: 1920, height: 1080 },
  webdriver: false,
};

async function runSessionOnceSent(): Promise<{
  records: SendRecord[];
}> {
  const raw: string[] = [];
  const fakeBrowser = {
    pages: async () => [fakePage(mismatchedEvidence)],
    newPage: async () => fakePage(mismatchedEvidence),
    close: async () => undefined,
    defaultBrowserContext: {
      setCookie: async () => undefined,
    } as unknown as PuppeteerBrowserLike["defaultBrowserContext"],
    process: () => ({ pid: 4242 }),
    on: () => undefined,
  } as unknown as PuppeteerBrowserLike;
  const launch = async (_options: LaunchBrowserOptions) => fakeBrowser;
  const deps: WorkerSessionDeps = {
    sessionId: "mb_seq-shared-test-1",
    sessionNonce: "seq-nonce-shared-test-1",
    send: (message) => {
      raw.push(JSON.stringify(message));
    },
    launchBrowser: launch,
  };
  const session = new WorkerSession(deps);
  await session.startSession(buildStartPayload());
  return { records: raw.map(decode) };
}

describe("managed browser worker sequence counter", () => {
  it("falls back to a monotonic local counter when no allocator is provided", async () => {
    const { records } = await runSessionOnceSent();
    expect(records.length).toBeGreaterThan(0);
    const sequences = records.map((record) => record.sequence);
    for (let index = 1; index < sequences.length; index += 1) {
      expect(sequences[index]).toBe(sequences[index - 1]! + 1);
    }
  });

  it("continues the shared allocator (READY + heartbeats) without restarting at 1", async () => {
    const raw: string[] = [];
    const shared = { value: 2 };
    const sharedCounter = {
      next: () => {
        shared.value += 1;
        return shared.value;
      },
    };
    const fakeBrowser = {
      pages: async () => [fakePage(mismatchedEvidence)],
      newPage: async () => fakePage(mismatchedEvidence),
      close: async () => undefined,
      defaultBrowserContext: {
        setCookie: async () => undefined,
      } as unknown as PuppeteerBrowserLike["defaultBrowserContext"],
      process: () => ({ pid: 4242 }),
      on: () => undefined,
    } as unknown as PuppeteerBrowserLike;
    const deps: WorkerSessionDeps = {
      sessionId: "mb_seq-shared-test-2",
      sessionNonce: "seq-nonce-shared-test-2",
      send: (message) => {
        raw.push(JSON.stringify(message));
      },
      launchBrowser: async () => fakeBrowser,
      nextSequence: sharedCounter.next,
    };
    const session = new WorkerSession(deps);
    const initial = shared.value;
    await session.startSession(buildStartPayload());
    const records = raw.map(decode);
    expect(records.length).toBeGreaterThan(0);
    const sequences = records.map((record) => record.sequence);
    for (let index = 0; index < sequences.length; index += 1) {
      expect(sequences[index]).toBe(initial + index + 1);
    }
    for (let index = 0; index < sequences.length; index += 1) {
      expect(sequences[index]).toBeGreaterThan(2);
    }
  });

  it("runtime state machine accepts the start path transitions", () => {
    const runtime = new ManagedBrowserRuntime("starting");
    runtime.transition("validating_fingerprint");
    runtime.transition("applying_session");
    runtime.transition("verifying_login");
    runtime.transition("login_required");
    runtime.transition("user_login_in_progress");
    expect(runtime.getState()).toBe("user_login_in_progress");
  });
});

it("starts a public worker ready without navigating to YouTube or reading account cookies", async () => {
  const messages: ManagedBrowserOutboundMessage[] = [];
  const navigations: string[] = [];
  const evidence = { ...mismatchedEvidence, browserMajor: 999, userAgentMajor: 999,
    userAgent: "Mozilla/5.0 Chrome/999.0.0.1 Safari/537.36" };
  const page = fakePage(evidence);
  page.goto = async (url: string): Promise<unknown> => { navigations.push(url); return undefined; };
  const browser = {
    pages: async () => [page], newPage: async () => page, close: async () => undefined,
    defaultBrowserContext: () => ({ setCookie: async (): Promise<void> => { throw new Error("no cookie expected"); }, cookies: async (): Promise<never> => { throw new Error("no cookie capture expected"); } }),
    process: () => ({ pid: 4242 }), on: () => undefined,
  } as unknown as PuppeteerBrowserLike;
  const session = new WorkerSession({ sessionId: "mb_public_test", sessionNonce: "nonce-public-test", send: (message) => messages.push(message), launchBrowser: async () => browser });
  await session.startSession(buildStartPayload({ platform: { platformId: 0, platformName: "Chrome", loginUrl: "about:blank", verificationUrl: "about:blank", allowedDomainSuffixes: [] } }));
  expect(session.state).toBe("ready");
  expect(messages.some((message) => message.type === "SESSION_READY")).toBe(true);
  expect(navigations.every((url) => url === "about:blank")).toBe(true);
  await session.dispose("user_stop");
});

// ---------------------------------------------------------------------------
// F07: ACTION_RESULT carries the full step evidence
// ---------------------------------------------------------------------------

describe("ACTION_RESULT schema carries the full step evidence (F07)", () => {
  const base = {
    protocolVersion: 2,
    sessionId: "mb_f07_schema01",
    requestId: "req_f07_schema01",
    sequence: 1,
  };

  function parse(value: unknown): { ok: boolean } {
    const result = managedBrowserOutboundSchema().safeParse(value);
    return { ok: result.success };
  }

  it("accepts stopCode and extracted on ACTION_RESULT", () => {
    const parsed = parse({
      ...base,
      type: "ACTION_RESULT",
      effect: "known",
      pageRevision: 3,
      results: [
        {
          actionIndex: 0,
          type: "extract",
          success: true,
          errorCode: null,
          elementFound: true,
          urlAfter: null,
        },
      ],
      stopCode: null,
      extracted: [{ ref: "e_aaa", text: "widget price: 10" }],
      observation: null,
    });
    expect(parsed.ok).toBe(true);
    // A terminal stop code rides along too.
    const stopped = parse({
      ...base,
      type: "ACTION_RESULT",
      effect: "known",
      pageRevision: 3,
      results: [],
      stopCode: "consecutive_failures",
      observation: null,
    });
    expect(stopped.ok).toBe(true);
  });

  it("rejects unknown stop codes on ACTION_RESULT", () => {
    const parsed = parse({
      ...base,
      type: "ACTION_RESULT",
      effect: "known",
      pageRevision: 3,
      results: [],
      stopCode: "mystery_stop",
      observation: null,
    });
    expect(parsed.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B06: a post-action challenge is delivered as a HANDOFF-state observation
// in the ACTION_RESULT — never as a ready page the runner could act on.
// ---------------------------------------------------------------------------

describe("B06 challenge ordering in runActions", () => {
  const matchedEvidence: FingerprintSelfTestEvidence = {
    browserVersion: "999.0.0.1",
    browserMajor: 999,
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/999.0.0.1 Safari/537.36",
    userAgentMajor: 999,
    platform: "Linux x86_64",
    language: "en-US",
    languages: ["en-US"],
    timezone: "Etc/UTC",
    viewport: { width: 1365, height: 768 },
    screen: { width: 1920, height: 1080 },
    webdriver: false,
  };

  const clickRecord = {
    obsId: "0",
    tag: "button",
    role: "button",
    name: "Pay now",
    inputType: null,
    value: null,
    disabled: false,
    checked: null,
    selected: null,
    hrefOrigin: null,
    hrefFull: null,
    visible: true,
  };

  function makeChallengePage(): PuppeteerPageLike {
    const handle = {
      async click(): Promise<void> {
        /* no-op */
      },
      async scrollIntoView(): Promise<void> {
        /* no-op */
      },
      async isIntersectingViewport(): Promise<boolean> {
        return true;
      },
      async evaluate<T>(script: unknown): Promise<T> {
        const fnName = typeof script === "function" ? script.name : "";
        if (fnName === "readElementDescriptor") {
          return { role: "button", name: "Pay now" } as unknown as T;
        }
        if (fnName === "probeInputElementTypeFn") {
          return null as unknown as T;
        }
        return undefined as unknown as T;
      },
      dispose(): Promise<void> {
        return Promise.resolve();
      },
    };
    return {
      url: () => "https://www.shop.test/checkout",
      goto: async () => undefined,
      bringToFront: async () => undefined,
      authenticate: () => undefined,
      $: async () => null,
      $$: async () => [handle],
      evaluate: (async (script: unknown) => {
        const src = typeof script === "string" ? script : String(script);
        if (src.includes("navigator.userAgent")) {
          return matchedEvidence;
        }
        if (src.includes("obsId")) {
          return [clickRecord];
        }
        if (src.includes("document.title.slice")) {
          return { title: "Checkout", text: "Pay now" };
        }
        // The challenge probe (probePageSignals) — a CAPTCHA landed after
        // the click.
        if (src.includes("innerText")) {
          return {
            title: "Security check",
            text: "Please verify you are human to continue",
            inputTypes: [],
          };
        }
        return undefined;
      }) as PuppeteerPageLike["evaluate"],
    } as unknown as PuppeteerPageLike;
  }

  it("ACTION_RESULT observes state handoff and the challenge events follow", async () => {
    const raw: string[] = [];
    const page = makeChallengePage();
    const fakeBrowser = {
      pages: async () => [page],
      newPage: async () => page,
      close: async () => undefined,
      defaultBrowserContext: (() => ({
        setCookie: async () => undefined,
        cookies: async () => [],
      })) as unknown as PuppeteerBrowserLike["defaultBrowserContext"],
      process: () => ({ pid: 4242 }),
      on: () => undefined,
    } as unknown as PuppeteerBrowserLike;
    const session = new WorkerSession({
      sessionId: "mb_b06-challenge-1",
      sessionNonce: "b06-nonce-1",
      send: (message) => {
        raw.push(JSON.stringify(message));
      },
      launchBrowser: async () => fakeBrowser,
    });
    await session.startSession(
      buildStartPayload({
        platform: {
          platformId: 5,
          platformName: "Shop",
          allowedDomainSuffixes: ["shop.test"],
          loginUrl: "https://accounts.shop.test/login",
          verificationUrl: "https://www.shop.test/",
        },
      })
    );
    raw.length = 0;
    // Observe first: registers the button ref and reports the revision.
    // Awaited — the worker session serializes commands, so runActions
    // below must not race the registration.
    await session.observe("req-b06-obs");
    const observeRaw = raw.map((m) => JSON.parse(m) as Record<string, unknown>);
    const observation = observeRaw.find((m) => m.type === "OBSERVATION_RESULT") as
      | {
          observation: {
            pageRevision: number;
            elements: Array<{ ref: string }>;
          };
        }
      | undefined;
    expect(observation).toBeDefined();
    const ref = observation!.observation.elements[0]!.ref;
    const pageRevision = observation!.observation.pageRevision;
    raw.length = 0;

    // Awaited: runActions resolves after the full message burst
    // (ACTION_RESULT → CHALLENGE_DETECTED → HANDOFF_REQUIRED) is sent.
    await session.runActions("req-b06-run", {
      actions: [{ type: "click", ref, pageRevision }],
    } as unknown as Extract<
      ManagedBrowserInboundMessage,
      { type: "RUN_ACTIONS" }
    >["program"]);
    const messages = raw.map(
      (m) =>
        managedBrowserOutboundSchema().safeParse(JSON.parse(m) as unknown)
          .data as ManagedBrowserOutboundMessage & { requestId: string }
    );
    const resultIndex = messages.findIndex(
      (m) =>
        m.type === "ACTION_RESULT" &&
        (m as unknown as { requestId: string }).requestId === "req-b06-run"
    );
    expect(resultIndex).toBeGreaterThanOrEqual(0);
    const actionResult = messages[resultIndex] as unknown as {
      requestId: string;
      observation: { state: string } | null;
    };
    // B06: the result's observation is HANDOFF — not a ready page.
    expect(actionResult.observation?.state).toBe("handoff");
    const challengeIndex = messages.findIndex(
      (m) => m.type === "CHALLENGE_DETECTED"
    );
    expect(challengeIndex).toBeGreaterThan(resultIndex);
    expect(
      messages.some((m) => m.type === "HANDOFF_REQUIRED")
    ).toBe(true);
    await session.stop("req-b06-stop", "test_done");
  });
});
