/**
 * WS-5 R5.1 — DI acceptance test for YellowPagesOrchestrator.
 *
 * The pass-through task-control methods (stopTask/pauseTask/resumeTask/
 * deleteTask) delegate directly to yellowPagesModule — a clean seam for a
 * fake-substitution test. All collaborators faked → no DB/Electron/process.
 */
import { describe, it, expect, vi } from "vitest";
import {
  YellowPagesOrchestrator,
  type YellowPagesOrchestratorDeps,
} from "@/modules/YellowPagesOrchestrator";
import type { YellowPagesModule } from "@/modules/YellowPagesModule";
import type { YellowPagesProcessManager } from "@/modules/YellowPagesProcessManager";
import type { BrowserManager } from "@/modules/browserManager";
import type { AccountCookiesModule } from "@/modules/accountCookiesModule";
import type { YellowPagesTaskModel } from "@/model/YellowPagesTask.model";
import type { PlatformRegistry } from "@/modules/PlatformRegistry";
import type { YellowPagesResultModel } from "@/model/YellowPagesResult.model";
import type { YellowPagesInitModule } from "@/modules/YellowPagesInitModule";
import type { YellowPagesHealthCheck } from "@/modules/YellowPagesHealthCheck";

function makeFakeDeps(
  overrides: Partial<YellowPagesOrchestratorDeps> = {}
): YellowPagesOrchestratorDeps {
  return {
    yellowPagesModule: {} as unknown as YellowPagesModule,
    processManager: {} as unknown as YellowPagesProcessManager,
    browserManager: {} as unknown as BrowserManager,
    accountCookiesModule: {} as unknown as AccountCookiesModule,
    taskModel: {} as unknown as YellowPagesTaskModel,
    platformRegistry: {} as unknown as PlatformRegistry,
    resultModel: {} as unknown as YellowPagesResultModel,
    initModule: {} as unknown as YellowPagesInitModule,
    healthCheck: {} as unknown as YellowPagesHealthCheck,
    ...overrides,
  };
}

describe("YellowPagesOrchestrator DI (R5.1)", () => {
  it("routes stopTask to the injected fake yellowPagesModule", async () => {
    const fakeStop = vi.fn().mockResolvedValue(undefined);
    const orch = new YellowPagesOrchestrator(
      makeFakeDeps({
        yellowPagesModule: {
          stopTask: fakeStop,
        } as unknown as YellowPagesModule,
      })
    );

    await orch.stopTask(7);

    expect(fakeStop).toHaveBeenCalledWith(7);
  });

  it("routes pauseTask + resumeTask + deleteTask to the fake module", async () => {
    const fakePause = vi.fn().mockResolvedValue(undefined);
    const fakeResume = vi.fn().mockResolvedValue(undefined);
    const fakeDelete = vi.fn().mockResolvedValue(undefined);
    const orch = new YellowPagesOrchestrator(
      makeFakeDeps({
        yellowPagesModule: {
          pauseTask: fakePause,
          resumeTask: fakeResume,
          deleteTask: fakeDelete,
        } as unknown as YellowPagesModule,
      })
    );

    await orch.pauseTask(1);
    await orch.resumeTask(1);
    await orch.deleteTask(1);

    expect(fakePause).toHaveBeenCalledWith(1);
    expect(fakeResume).toHaveBeenCalledWith(1);
    expect(fakeDelete).toHaveBeenCalledWith(1);
  });
});
