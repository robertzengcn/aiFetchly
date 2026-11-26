import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * B09/R07: updating a search task's proxies REPLACES the row set (the old
 * code appended a second set alongside the originals).
 */

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return "";
    }
    setValue(): void {}
  },
}));

import { SqliteDb } from "@/config/SqliteDb";
import { SearchTaskProxyModel } from "@/model/SearchTaskProxy.model";
import { SearchTaskProxyEntity } from "@/entity/SearchTaskProxy.entity";

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

beforeEach(() => {
  resetDbSingleton();
});

describe("SearchTaskProxyModel deleteByTaskId (B09)", () => {
  it("removes every row of a task and leaves other tasks untouched", async () => {
    // The task_id column carries a real FK to the search_task table —
    // seed two tasks through the model layer (connection-guarded).
    const { SearchTaskModel } = await import("@/model/SearchTask.model");
    const taskModel = new SearchTaskModel("");
    const taskOneId = await taskModel.saveSearchTaskOnly(1);
    const taskTwoId = await taskModel.saveSearchTaskOnly(1);

    const model = new SearchTaskProxyModel("");
    for (const [taskId, host] of [
      [taskOneId, "a.test"],
      [taskOneId, "b.test"],
      [taskTwoId, "c.test"],
    ] as Array<[number, string]>) {
      const entity = new SearchTaskProxyEntity();
      entity.task_id = taskId;
      entity.proxy_id = 0;
      entity.host = host;
      entity.port = "8080";
      entity.user = "";
      entity.pass = "";
      await model.create(entity);
    }
    expect(await model.getItemsByTaskId(taskOneId)).toHaveLength(2);
    expect(await model.getItemsByTaskId(taskTwoId)).toHaveLength(1);

    const removed = await model.deleteByTaskId(taskOneId);
    expect(removed).toBe(2);
    expect(await model.getItemsByTaskId(taskOneId)).toHaveLength(0);
    // Task 2's rows survive.
    expect(await model.getItemsByTaskId(taskTwoId)).toHaveLength(1);
  });
});
