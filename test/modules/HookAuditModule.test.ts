import { expect } from "chai";
import { HookAuditModule } from "@/modules/HookAuditModule";

describe("HookAuditModule", () => {
  let auditModule: HookAuditModule;

  beforeEach(() => {
    auditModule = new HookAuditModule();
  });

  afterEach(async () => {
    try {
      await auditModule.clearForTests();
    } catch {
      /* ok */
    }
  });

  it("records an entry and returns it via query", async () => {
    await auditModule.recordEntry({
      hookRunId: "run-1",
      hookId: "h-1",
      eventName: "PreToolUse",
      source: "user",
      type: "command",
      matchQuery: "shell_execute",
      status: "blocked",
      durationMs: 3,
      reason: "matched dangerous pattern",
    });

    const result = await auditModule.query({ limit: 10, offset: 0 });
    expect(result.total).to.equal(1);
    expect(result.rows[0].hookId).to.equal("h-1");
    expect(result.rows[0].status).to.equal("blocked");
  });

  it("accepts filters and pagination", async () => {
    for (let i = 0; i < 3; i++) {
      await auditModule.recordEntry({
        hookRunId: `r${i}`,
        hookId: "h-1",
        eventName: "PreToolUse",
        source: "user",
        type: "command",
        status: "success",
        durationMs: i,
      });
    }
    const page = await auditModule.query({ limit: 2, offset: 0 });
    expect(page.rows.length).to.equal(2);
    expect(page.total).to.equal(3);
  });
});
