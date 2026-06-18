import { expect } from "chai";
import { describe, it } from "mocha";
import { AIChatV2Module } from "@/modules/AIChatV2Module";

/**
 * Tests for AIChatV2Module.getDefaultSystemPrompt() auto-plan behavior.
 *
 * NOTE: Token is backed by ElectronStoreService (electron-store v8). In a
 * non-Electron test environment, different Token instances do NOT share the
 * same store file, so we cannot reliably set USER_AI_AUTO_PLAN in one Token
 * instance and have getDefaultSystemPrompt() (which creates its own Token)
 * observe it. Therefore we only test the default-on behavior here: when the
 * key is unset, Token.getValue returns "" which is !== "false", so auto-plan
 * is enabled.
 *
 * Full verification of the "false" branch relies on tsc --noEmit and manual
 * smoke testing in the Electron runtime.
 */
describe("AIChatV2Module.getDefaultSystemPrompt (auto-plan)", function () {
  this.timeout(5000);

  it("appends the auto-plan section by default (default-on)", function () {
    const mod = new AIChatV2Module();
    const prompt = mod.getDefaultSystemPrompt();

    // Starts with the base prompt
    expect(prompt).to.contain("You are a helpful assistant.");
    // Contains the auto-plan section built by ChatModePromptSection
    expect(prompt).to.contain("EnterPlanMode");
    expect(prompt).to.contain("Auto Plan Mode");
    // The base prompt should come before the auto-plan section
    expect(prompt.indexOf("You are a helpful assistant.")).to.be.lessThan(
      prompt.indexOf("Auto Plan Mode")
    );
  });

  it("separates base prompt and auto-plan section with double newline", function () {
    const mod = new AIChatV2Module();
    const prompt = mod.getDefaultSystemPrompt();

    expect(prompt).to.contain("You are a helpful assistant.\n\n# Auto Plan Mode");
  });
});
