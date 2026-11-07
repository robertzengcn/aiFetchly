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
