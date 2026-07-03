import { expect } from "chai";
import sinon from "sinon";
import { HookModule } from "@/modules/HookModule";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { HookCommandTrustService } from "@/service/hooks/HookCommandTrustService";
import { Token } from "@/modules/token";
import { USER_HOOKS_BUILTIN_OVERRIDES } from "@/config/usersetting";
import type { HookEventName } from "@/entityTypes/hookTypes";

describe("HookModule", () => {
  let module: HookModule;
  let tokenStub: sinon.SinonStub;

  beforeEach(() => {
    HookRegistry.resetForTests();
    HookCommandTrustService.resetForTests();
    module = new HookModule();
    // Default stub returns empty string (no override)
    tokenStub = sinon.stub(Token.prototype, "getValue").returns("");
  });

  afterEach(async () => {
    HookRegistry.resetForTests();
    HookCommandTrustService.resetForTests();
    tokenStub.restore();
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

  it("applyBuiltinOverrides reads Token map and flips builtin enabled state", async () => {
    // Register a builtin (simulating builtinHooks.ts registration at app init)
    HookRegistry.resetForTests();
    HookRegistry.registerBuiltinHook({
      id: "test-builtin",
      eventName: "PreToolUse",
      source: "builtin",
      enabled: true, // starts enabled
      trusted: true,
      type: "callback",
      callback: () => ({}),
    });

    // Stub Token to return an override that disables the builtin
    tokenStub.restore();
    const overrideStub = sinon.stub(Token.prototype, "getValue");
    overrideStub
      .withArgs(USER_HOOKS_BUILTIN_OVERRIDES)
      .returns(JSON.stringify({ "test-builtin": { enabled: false } }));
    tokenStub = overrideStub;

    await module.applyBuiltinOverrides();

    const all = HookRegistry.listAll({ source: "builtin" });
    const builtin = all.find((h) => h.id === "test-builtin");
    expect(builtin?.enabled).to.equal(false);

    HookRegistry.resetForTests();
  });

  it("applyBuiltinOverrides ignores malformed JSON in Token", async () => {
    HookRegistry.resetForTests();
    HookRegistry.registerBuiltinHook({
      id: "test-builtin-2",
      eventName: "Stop",
      source: "builtin",
      enabled: true,
      trusted: true,
      type: "callback",
      callback: () => ({}),
    });

    // Stub Token to return malformed JSON
    tokenStub.restore();
    const malformedStub = sinon.stub(Token.prototype, "getValue");
    malformedStub
      .withArgs(USER_HOOKS_BUILTIN_OVERRIDES)
      .returns("{not valid json");
    tokenStub = malformedStub;

    // Should not throw, and builtin should remain enabled (no override applied)
    let threw = false;
    try {
      await module.applyBuiltinOverrides();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(false);

    const all = HookRegistry.listAll({ source: "builtin" });
    const builtin = all.find((h) => h.id === "test-builtin-2");
    expect(builtin?.enabled).to.equal(true); // unchanged

    HookRegistry.resetForTests();
  });
});
