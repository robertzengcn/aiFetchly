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
import type { YellowPagesModule } from "@/modules/YellowPagesModule";
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
    yellowPagesModule: {} as unknown as YellowPagesModule,
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

  it("maps YellowPages numeric status (2 = Completed) to TaskStatus.Complete", async () => {
    const fakeGetStatus = vi.fn().mockResolvedValue(2); // 2 = Completed
    const svc = new TaskExecutorService(
      makeFakeDeps({
        yellowPagesModule: {
          getTaskStatus: fakeGetStatus,
        } as unknown as YellowPagesModule,
      })
    );

    const status = await svc.getTaskStatus(99, TaskType.YELLOW_PAGES);

    expect(fakeGetStatus).toHaveBeenCalledWith(99);
    expect(status).toBe(TaskStatus.Complete);
  });
});
