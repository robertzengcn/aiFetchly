/**
 * WS-5 R5.1 — DI acceptance test for TaskExecutorService.
 *
 * PRD acceptance: "TaskExecutorService ... has a passing unit test that
 * substitutes a fake collaborator (impossible today)." The constructor now
 * accepts injectable collaborators (Partial<TaskExecutorServiceDeps>); these
 * tests inject fakes and verify the service routes to them — no DB/Electron
 * needed (all collaborators are faked, so no real module is constructed).
 */
import { describe, it, expect, vi } from "vitest";
import {
  TaskExecutorService,
  type TaskExecutorServiceDeps,
} from "@/modules/TaskExecutorService";
import { TaskType } from "@/entity/ScheduleTask.entity";
import { TaskStatus } from "@/entityTypes/commonType";
import type { SearchTaskModule } from "@/modules/SearchTaskModule";
import type { EmailSearchTaskModule } from "@/modules/EmailSearchTaskModule";
import type { BuckEmailTaskModule } from "@/modules/buckEmailTaskModule";
import type { SearchModule } from "@/modules/SearchModule";
import type { GoogleMapsModule } from "@/modules/GoogleMapsModule";
import type { YandexMapsModule } from "@/modules/YandexMapsModule";
import type { AiMessageTaskModule } from "@/modules/AiMessageTaskModule";

/** Build a full fake deps (all collaborators stubbed) + apply overrides. */
function makeFakeDeps(
  overrides: Partial<TaskExecutorServiceDeps> = {}
): TaskExecutorServiceDeps {
  return {
    searchTaskModel: {} as unknown as SearchTaskModule,
    buckEmailTaskModel: {} as unknown as BuckEmailTaskModule,
    searchModel: {} as unknown as SearchModule,
    emailSeachTaskModule: {} as unknown as EmailSearchTaskModule,
    googleMapsModule: {} as unknown as GoogleMapsModule,
    yandexMapsModule: {} as unknown as YandexMapsModule,
    aiMessageTaskModule: {} as unknown as AiMessageTaskModule,
    ...overrides,
  };
}

describe("TaskExecutorService DI (R5.1)", () => {
  it("substitutes a fake emailSeachTaskModule and routes getTaskStatus to it", async () => {
    const fakeGetTaskDetail = vi
      .fn()
      .mockResolvedValue({ status: TaskStatus.Complete });
    const svc = new TaskExecutorService(
      makeFakeDeps({
        emailSeachTaskModule: {
          getTaskDetail: fakeGetTaskDetail,
        } as unknown as EmailSearchTaskModule,
      })
    );

    const status = await svc.getTaskStatus(42, TaskType.EMAIL_EXTRACT);

    expect(fakeGetTaskDetail).toHaveBeenCalledWith(42);
    expect(status).toBe(TaskStatus.Complete);
  });

  it("substitutes a fake searchTaskModel for the SEARCH path", async () => {
    const fakeRead = vi
      .fn()
      .mockResolvedValue({ status: TaskStatus.Processing });
    const svc = new TaskExecutorService(
      makeFakeDeps({
        searchTaskModel: { read: fakeRead } as unknown as SearchTaskModule,
      })
    );

    const status = await svc.getTaskStatus(7, TaskType.SEARCH);

    expect(fakeRead).toHaveBeenCalledWith(7);
    expect(status).toBe(TaskStatus.Processing);
  });
});

describe("TaskExecutorService.executeAiMessageTask status propagation (Bug #4)", () => {
  it("returns runId when ScheduledAiMessageRunner completes", async () => {
    const fakeRun = vi.fn().mockResolvedValue({
      runId: 88,
      status: "completed",
      assistantFinalMessage: "done",
      toolCallsCount: 1,
      blockedToolCalls: [],
    });
    const svc = new TaskExecutorService(
      makeFakeDeps({
        createScheduledAiMessageRunner: () => ({ run: fakeRun }),
      })
    );

    const runId = await svc.executeAiMessageTask(42, 7);

    expect(fakeRun).toHaveBeenCalledWith(42, 7);
    expect(runId).toBe(88);
  });

  it("throws when ScheduledAiMessageRunner returns blocked_by_policy (CONVERSATION_BUSY)", async () => {
    const fakeRun = vi.fn().mockResolvedValue({
      runId: 89,
      status: "blocked_by_policy",
      assistantFinalMessage: "",
      toolCallsCount: 0,
      blockedToolCalls: [],
      errorMessage: "CONVERSATION_BUSY",
    });
    const svc = new TaskExecutorService(
      makeFakeDeps({
        createScheduledAiMessageRunner: () => ({ run: fakeRun }),
      })
    );

    await expect(svc.executeAiMessageTask(42, 7)).rejects.toThrow(
      /blocked_by_policy.*CONVERSATION_BUSY/
    );
  });

  it("throws when ScheduledAiMessageRunner returns failed or timeout", async () => {
    for (const status of ["failed", "timeout"] as const) {
      const fakeRun = vi.fn().mockResolvedValue({
        runId: 90,
        status,
        assistantFinalMessage: "",
        toolCallsCount: 0,
        blockedToolCalls: [],
        errorMessage: status === "failed" ? "PROVIDER_ERROR" : "Timed out",
      });
      const svc = new TaskExecutorService(
        makeFakeDeps({
          createScheduledAiMessageRunner: () => ({ run: fakeRun }),
        })
      );

      await expect(svc.executeAiMessageTask(42, 7)).rejects.toThrow(
        new RegExp(status)
      );
    }
  });
});
