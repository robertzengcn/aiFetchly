/**
 * WS-5 R5.1 — DI acceptance test for YellowPagesProcessManager (the singleton hub).
 *
 * Uses the static createForTest() factory (bypasses the singleton cache) + the
 * clean getTaskByPID seam (→ taskModel.getTaskByPID). All collaborators faked
 * → no DB/Electron/process spawning.
 */
import { describe, it, expect, vi } from "vitest";
import {
  YellowPagesProcessManager,
  type YellowPagesProcessManagerDeps,
} from "@/modules/YellowPagesProcessManager";
import type { YellowPagesTaskModel } from "@/model/YellowPagesTask.model";
import type { YellowPagesResultModel } from "@/model/YellowPagesResult.model";
import type { PlatformRegistry } from "@/modules/PlatformRegistry";
import type { AccountCookiesModule } from "@/modules/accountCookiesModule";
import type { YellowPagesAiSupportHandler } from "@/modules/YellowPagesAiSupportHandler";

function makeFakeDeps(
  overrides: Partial<YellowPagesProcessManagerDeps> = {}
): YellowPagesProcessManagerDeps {
  return {
    taskModel: {} as unknown as YellowPagesTaskModel,
    resultModel: {} as unknown as YellowPagesResultModel,
    platformRegistry: {} as unknown as PlatformRegistry,
    accountCookiesModule: {} as unknown as AccountCookiesModule,
    aiSupportHandler: {} as unknown as YellowPagesAiSupportHandler,
    ...overrides,
  };
}

describe("YellowPagesProcessManager DI (R5.1)", () => {
  it("createForTest routes getTaskByPID to the injected fake taskModel", async () => {
    const fakeTask = { id: 1, pid: 42 };
    const fakeGetByPID = vi.fn().mockResolvedValue(fakeTask);
    const mgr = YellowPagesProcessManager.createForTest(
      makeFakeDeps({
        taskModel: {
          getTaskByPID: fakeGetByPID,
        } as unknown as YellowPagesTaskModel,
      })
    );

    const task = await mgr.getTaskByPID(42);

    expect(fakeGetByPID).toHaveBeenCalledWith(42);
    expect(task).toBe(fakeTask);
  });

  it("createForTest returns a fresh instance each call (test isolation from the singleton)", () => {
    const a = YellowPagesProcessManager.createForTest();
    const b = YellowPagesProcessManager.createForTest();
    expect(a).not.toBe(b);
  });
});
