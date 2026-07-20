"use strict";
import { describe, expect, it, vi } from "vitest";
import type { CommonMessage } from "@/entityTypes/commonType";
import {
  AGENT_MANAGEMENT_CREATE,
  AGENT_MANAGEMENT_LIST,
  AGENT_MANAGEMENT_TOGGLE,
  GET_APP_INFO,
  QUERY_USER_INFO,
} from "@/config/channellist";
import {
  DevBrowserDispatcher,
  createDefaultHandlers,
  type DevBrowserHandler,
} from "@/main-process/devtools/DevBrowserDispatcher";
import { isInvokeAllowed } from "@/main-process/devtools/devBrowserChannels";

const moduleSpies = vi.hoisted(() => ({
  listAllForManagement: vi.fn(async () => []),
  createManualAgent: vi.fn(async (input: { idSlug: string }) => ({
    id: `user:${input.idSlug}`,
    name: "Created",
  })),
  toggleAgent: vi.fn(async () => true),
}));

vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: class {
    listAllForManagement = moduleSpies.listAllForManagement;
    createManualAgent = moduleSpies.createManualAgent;
    toggleAgent = moduleSpies.toggleAgent;
  },
}));

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}
function fail(msg: string): CommonMessage<unknown> {
  return { status: false, msg, data: null };
}

describe("DevBrowserDispatcher — routing", () => {
  it("isDispatchable reflects the registered handler set", () => {
    const handlers = new Map<string, DevBrowserHandler>([
      [GET_APP_INFO, async () => ok({ version: "1.0.0" })],
    ]);
    const dispatcher = new DevBrowserDispatcher(handlers);
    expect(dispatcher.isDispatchable(GET_APP_INFO)).toBe(true);
    expect(dispatcher.isDispatchable(QUERY_USER_INFO)).toBe(false);
  });

  it("dispatch returns the handler's CommonMessage", async () => {
    const handler = vi.fn(async () => ok({ version: "9.9.9" }));
    const dispatcher = new DevBrowserDispatcher(
      new Map([[GET_APP_INFO, handler]])
    );
    const result = await dispatcher.dispatch(GET_APP_INFO, undefined);
    expect(result.status).toBe(true);
    expect(result.data).toEqual({ version: "9.9.9" });
    expect(handler).toHaveBeenCalledWith(undefined);
  });

  it("passes the request data through to the handler", async () => {
    const handler = vi.fn(async (data: unknown) =>
      ok({ echo: (data as { x: number }).x })
    );
    const dispatcher = new DevBrowserDispatcher(
      new Map([[QUERY_USER_INFO, handler]])
    );
    const result = await dispatcher.dispatch(QUERY_USER_INFO, { x: 42 });
    expect(result.data).toEqual({ echo: 42 });
  });
});

describe("DevBrowserDispatcher — unsupported channels fail safely (FR-4.3)", () => {
  it("returns a safe {status:false} response for an unregistered channel", async () => {
    const dispatcher = new DevBrowserDispatcher(new Map());
    const result = await dispatcher.dispatch("dangerous:channel", { a: 1 });
    expect(result.status).toBe(false);
    expect(result.data).toBeNull();
    expect(result.msg).toMatch(/not available|not allowed/i);
    expect(result.msg).toContain("dangerous:channel");
  });
});

describe("DevBrowserDispatcher — handler error isolation", () => {
  it("converts a thrown handler error into {status:false} without rethrowing", async () => {
    const handler = vi.fn(async () => {
      throw new Error("boom");
    });
    const dispatcher = new DevBrowserDispatcher(
      new Map([[GET_APP_INFO, handler]])
    );
    const result = await dispatcher.dispatch(GET_APP_INFO, undefined);
    expect(result.status).toBe(false);
    expect(result.msg).toContain("boom");
    expect(result.data).toBeNull();
  });

  it("converts a non-Error throw into a safe message", async () => {
    const handler = vi.fn(async () => {
      throw "string error"; // eslint-disable-line no-throw-literal
    });
    const dispatcher = new DevBrowserDispatcher(
      new Map([[GET_APP_INFO, handler]])
    );
    const result = await dispatcher.dispatch(GET_APP_INFO, undefined);
    expect(result.status).toBe(false);
    expect(typeof result.msg).toBe("string");
    expect(result.msg.length).toBeGreaterThan(0);
  });
});

describe("DevBrowserDispatcher — result normalization", () => {
  it("normalizes a handler that returns a bare value into {status:true}", async () => {
    const dispatcher = new DevBrowserDispatcher(
      new Map([[GET_APP_INFO, async () => ({ hello: "world" } as unknown)]])
    );
    const result = await dispatcher.dispatch(GET_APP_INFO, undefined);
    expect(result.status).toBe(true);
    expect(result.data).toEqual({ hello: "world" });
  });

  it("preserves an explicit {status:false,msg} from the handler", async () => {
    const dispatcher = new DevBrowserDispatcher(
      new Map([[QUERY_USER_INFO, async () => fail("not found")]])
    );
    const result = await dispatcher.dispatch(QUERY_USER_INFO, undefined);
    expect(result.status).toBe(false);
    expect(result.msg).toBe("not found");
  });
});

describe("createDefaultHandlers — MVP channel wiring", () => {
  it("registers the PRD-named MVP channels", () => {
    const handlers = createDefaultHandlers();
    expect(handlers.has(GET_APP_INFO)).toBe(true);
    expect(handlers.has(QUERY_USER_INFO)).toBe(true);
    expect(handlers.has(AGENT_MANAGEMENT_LIST)).toBe(true);
    expect(handlers.has(AGENT_MANAGEMENT_CREATE)).toBe(true);
    expect(handlers.has(AGENT_MANAGEMENT_TOGGLE)).toBe(true);
  });

  it("does not register any handler outside the invoke allowlist", () => {
    const handlers = createDefaultHandlers();
    // Every default handler must correspond to an allowed channel — the
    // dispatcher and allowlist must never disagree.
    for (const channel of handlers.keys()) {
      expect(isInvokeAllowed(channel), `channel ${channel}`).toBe(true);
    }
  });

  it("dispatches validated subagent management calls through AgentDefinitionModule", async () => {
    moduleSpies.createManualAgent.mockClear();
    const dispatcher = new DevBrowserDispatcher();
    const input = {
      idSlug: "browser-agent",
      name: "Browser Agent",
      description: "Created from browser QA",
      systemPrompt: "You are a browser QA agent.",
      allowedTools: [],
      mode: "specialist",
      maxToolCalls: 8,
      maxRuntimeMs: 300000,
      maxContinueCalls: 8,
      enabled: true,
    };

    const result = await dispatcher.dispatch(AGENT_MANAGEMENT_CREATE, input);

    expect(result.status).toBe(true);
    expect(result.data).toEqual({ id: "user:browser-agent", name: "Created" });
    expect(moduleSpies.createManualAgent).toHaveBeenCalledWith(input);
  });

  it("rejects invalid subagent management payloads before the module layer", async () => {
    moduleSpies.createManualAgent.mockClear();
    const dispatcher = new DevBrowserDispatcher();

    const result = await dispatcher.dispatch(AGENT_MANAGEMENT_CREATE, {
      idSlug: "bad",
    });

    expect(result.status).toBe(false);
    expect(result.msg).toMatch(/name|description|systemPrompt/);
    expect(moduleSpies.createManualAgent).not.toHaveBeenCalled();
  });
});
