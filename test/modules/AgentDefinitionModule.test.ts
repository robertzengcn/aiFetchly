// test/modules/AgentDefinitionModule.test.ts
import { describe, it, expect, before } from "mocha";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";

describe("AgentDefinitionModule", () => {
  let module: AgentDefinitionModule;

  before(() => {
    module = new AgentDefinitionModule();
  });

  it("seeds all built-in definitions as active", async () => {
    await module.ensureBuiltIns();
    const defs = await module.listActive();
    expect(defs.length).toBeGreaterThan(0);
    const researcher = defs.find((d) => d.id === "agent-lead-researcher");
    expect(researcher).to.not.be.undefined;
    expect(researcher!.status).to.equal("active");
  });

  it("is idempotent on re-seed", async () => {
    await module.ensureBuiltIns();
    const first = await module.listActive();
    await module.ensureBuiltIns();
    const second = await module.listActive();
    expect(second.length).to.equal(first.length);
  });

  it("getActiveById returns the researcher after seeding", async () => {
    await module.ensureBuiltIns();
    const d = await module.getActiveById("agent-lead-researcher");
    expect(d).to.not.be.null;
    expect(d!.allowedTools.length).to.be.greaterThan(0);
  });

  it("getActiveById returns null for unknown agents", async () => {
    await module.ensureBuiltIns();
    const d = await module.getActiveById("agent-nope");
    expect(d).to.be.null;
  });
});
