import { expect } from "chai";
import { HookModule } from "@/modules/HookModule";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { HookCommandTrustService } from "@/service/hooks/HookCommandTrustService";
import type { HookEventName } from "@/entityTypes/hookTypes";

describe("HookModule", () => {
  let module: HookModule;

  beforeEach(() => {
    HookRegistry.resetForTests();
    HookCommandTrustService.resetForTests();
    module = new HookModule();
  });

  afterEach(async () => {
    HookRegistry.resetForTests();
    HookCommandTrustService.resetForTests();
    try {
      await module.deleteAllUserHooksForTests();
    } catch {
      /* ok */
    }
  });

  it("creates a user hook and rejects oversize matcher", async () => {
    try {
      await module.create({
        id: "u1",
        eventName: "PreToolUse" as HookEventName,
        matcher: "x".repeat(200),
        command: "node ./x",
        timeoutMs: 5000,
        failureMode: "warn",
        enabled: false,
        trusted: false,
      });
      expect.fail("should have rejected");
    } catch (err: unknown) {
      expect(String(err)).to.match(/matcher/i);
    }
  });

  it("creates a hook and registers it when enabled", async () => {
    await module.create({
      id: "u2",
      eventName: "PreToolUse" as HookEventName,
      matcher: "shell_execute",
      command: "node ./x",
      timeoutMs: 5000,
      failureMode: "warn",
      enabled: true,
      trusted: true,
    });

    const matched = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      matchQuery: "shell_execute",
    });
    expect(matched.find((h) => h.id === "u2")).to.not.equal(undefined);
  });

  it("does not register an untrusted command hook for execution", async () => {
    await module.create({
      id: "u3",
      eventName: "PreToolUse" as HookEventName,
      matcher: "*",
      command: "node ./x",
      timeoutMs: 5000,
      failureMode: "warn",
      enabled: true,
      trusted: false,
    });

    const matched = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      matchQuery: "anything",
    });
    expect(matched.find((h) => h.id === "u3")).to.equal(undefined);
  });

  it("updates fields and re-registers", async () => {
    await module.create({
      id: "u4",
      eventName: "PreToolUse" as HookEventName,
      matcher: "shell_execute",
      command: "node ./x",
      timeoutMs: 5000,
      failureMode: "warn",
      enabled: true,
      trusted: true,
    });
    await module.update("u4", { command: "node ./y" });

    const matched = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      matchQuery: "shell_execute",
    });
    const hook = matched.find((h) => h.id === "u4");
    expect(hook?.type === "command" && hook.command).to.equal("node ./y");
  });

  it("deletes a user hook and unregisters it", async () => {
    await module.create({
      id: "u5",
      eventName: "PreToolUse" as HookEventName,
      matcher: "*",
      command: "node ./x",
      timeoutMs: 5000,
      failureMode: "warn",
      enabled: true,
      trusted: true,
    });
    await module.deleteById("u5");
    const matched = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      matchQuery: "anything",
    });
    expect(matched.find((h) => h.id === "u5")).to.equal(undefined);
  });

  it("setTrusted writes through to HookCommandTrustService", async () => {
    await module.create({
      id: "u6",
      eventName: "PreToolUse" as HookEventName,
      matcher: "*",
      command: "node ./x",
      timeoutMs: 5000,
      failureMode: "warn",
      enabled: true,
      trusted: false,
    });
    await module.setTrusted("u6", true);
    expect(HookCommandTrustService.isTrusted("u6")).to.equal(true);
  });
});
