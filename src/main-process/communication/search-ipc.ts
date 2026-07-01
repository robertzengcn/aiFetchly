import { ipcMain, app, dialog } from "electron";
import {
  SEARCHSCRAPERAPI,
  LISTSESARCHRESUT,
  SEARCHEVENT,
  TASKSEARCHRESULTLIST,
  SAVESEARCHERRORLOG,
  RETRYSEARCHTASK,
  SYSTEM_MESSAGE,
  GET_SEARCH_TASK_DETAILS,
  UPDATE_SEARCH_TASK,
  SEARCH_TASK_UPDATE_EVENT,
  CREATE_SEARCH_TASK_ONLY,
  EXPORT_SEARCH_RESULTS,
  KILL_SEARCH_PROCESS,
} from "@/config/channellist";
import { CommonDialogMsg, CommonResponse } from "@/entityTypes/commonType";
import { Usersearchdata } from "@/entityTypes/searchControlType";
import { SearchController } from "@/controller/SearchController";
import * as path from "path";
import * as fs from "fs";
import { ToArray } from "@/views/utils/function";
import { SearhEnginer } from "@/config/searchSetting";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  searchListInputSchema,
  searchByIdInputSchema,
  searchTaskResultListInputSchema,
  searchUpdateTaskInputSchema,
  searchCreateTaskOnlyInputSchema,
  searchExportInputSchema,
  searchKillProcessInputSchema,
} from "@/schemas/ipc/search";

/**
 * Search IPC handlers.
 *
 * 2 ipcMain.on handlers (SEARCHSCRAPERAPI, RETRYSEARCHTASK) stay as-is:
 * they push results via event.sender.send, a pattern the validated wrapper
 * doesn't cover. They keep their manual validation.
 *
 * 8 ipcMain.handle handlers migrated to registerValidatedHandler.
 */
export function registerSearchIpcHandlers(): void {
  // ── Out-of-scope: ipcMain.on handlers (push model) ─────────────────────
  ipcMain.on(SEARCHSCRAPERAPI, async (event, arg: unknown): Promise<void> => {
    const qdata = JSON.parse(arg as string) as Usersearchdata;
    if (!("searchEnginer" in qdata)) {
      (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
        SEARCHEVENT,
        JSON.stringify({
          status: false,
          code: 20240705103811,
          data: { action: "", title: "search.scraper_failed", content: "search.search_enginer_empty" },
        } satisfies CommonDialogMsg),
      );
      return;
    }
    if (!("keywords" in qdata)) {
      (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
        SEARCHEVENT,
        JSON.stringify({
          status: false,
          code: 20240705104323,
          data: { action: "", title: "search.scraper_failed", content: "search.search_enginer_empty" },
        } satisfies CommonDialogMsg),
      );
      return;
    }
    const searchcon = SearchController.getInstance();
    try {
      await searchcon.searchData(qdata);
      (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
        SEARCHEVENT,
        JSON.stringify({
          status: true,
          code: 0,
          data: { action: "search_task _start", title: "", content: "" },
        } satisfies CommonDialogMsg),
      );
    } catch (error) {
      (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
        SEARCHEVENT,
        JSON.stringify({
          status: false,
          code: 20240705103811,
          data: {
            action: "",
            title: "search.scraper_failed",
            content: error instanceof Error ? error.message : "search.scraper_failed",
          },
        } satisfies CommonDialogMsg),
      );
    }
  });

  ipcMain.on(RETRYSEARCHTASK, async (event, data): Promise<void> => {
    const qdata = JSON.parse(data as string) as { id: number };
    if (!qdata.id) {
      (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
        SYSTEM_MESSAGE,
        JSON.stringify({ status: false, msg: "task id is empty" } satisfies CommonResponse<never>),
      );
      return;
    }
    try {
      const searchControl = SearchController.getInstance();
      await searchControl.retryTask(qdata.id);
      (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
        SYSTEM_MESSAGE,
        JSON.stringify({ status: true, msg: "Task retry started successfully" } satisfies CommonResponse<never>),
      );
    } catch (error) {
      (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
        SYSTEM_MESSAGE,
        JSON.stringify({
          status: false,
          msg: error instanceof Error ? error.message : "Unknown error occurred",
        } satisfies CommonResponse<never>),
      );
    }
  });

  // ── Validated handle handlers ──────────────────────────────────────────

  registerValidatedHandler(
    LISTSESARCHRESUT,
    searchListInputSchema,
    async (input) => {
      const searchControl = SearchController.getInstance();
      const res = await searchControl.listSearchresult(
        input.page ?? 0,
        input.size ?? 10,
        input.sortby,
        input.search,
      );
      return { records: res.records, num: res.total };
    },
  );

  registerValidatedHandler(
    TASKSEARCHRESULTLIST,
    searchTaskResultListInputSchema,
    async (input) => {
      const searchControl = SearchController.getInstance();
      const res = await searchControl.listtaskSearchResult(
        input.taskId,
        input.page ?? 0,
        input.itemsPerPage ?? 20,
        input.search ?? "",
      );
      return { records: res.record, num: res.total };
    },
  );

  registerValidatedHandler(
    SAVESEARCHERRORLOG,
    searchByIdInputSchema,
    async (input) => {
      const { filePath } = await dialog.showSaveDialog({
        title: "Save Text File",
        defaultPath: path.join(
          app.getPath("documents"),
          `${input.id}_search-error-log.txt`,
        ),
        filters: [{ name: "Text Files", extensions: ["txt"] }],
      });
      if (!filePath) return null;
      const searchControl = SearchController.getInstance();
      const content = await searchControl.getTaskErrorlog(input.id);
      fs.writeFileSync(filePath, content, "utf-8");
      return filePath;
    },
  );

  registerValidatedHandler(
    GET_SEARCH_TASK_DETAILS,
    searchByIdInputSchema,
    async (input) => {
      const searchControl = SearchController.getInstance();
      return searchControl.getTaskDetailsForEdit(input.id);
    },
  );

  registerValidatedHandler(
    UPDATE_SEARCH_TASK,
    searchUpdateTaskInputSchema,
    async (input, event) => {
      const searchControl = SearchController.getInstance();
      const success = await searchControl.updateSearchTask(input.id, input.updates);
      if (!success) {
        throw new Error("Failed to update task");
      }
      // Notify via push channel (preserves original event signal).
      (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
        SEARCH_TASK_UPDATE_EVENT,
        JSON.stringify({
          status: true,
          msg: "Task updated successfully",
          taskId: input.id,
        }),
      );
      return input.id;
    },
  );

  registerValidatedHandler(
    CREATE_SEARCH_TASK_ONLY,
    searchCreateTaskOnlyInputSchema,
    async (input) => {
      // Validate search engine (original behavior)
      const seArr: string[] = ToArray(SearhEnginer);
      if (!seArr.includes(input.searchEnginer)) {
        throw new Error("Invalid search engine");
      }
      // Coerce numeric strings (legacy frontend behavior)
      const concurrency =
        typeof input.concurrency === "string"
          ? parseInt(input.concurrency, 10) || 1
          : input.concurrency ?? 1;
      const num_pages =
        typeof input.num_pages === "string"
          ? parseInt(input.num_pages, 10) || 1
          : input.num_pages ?? 1;

      const searchControl = SearchController.getInstance();
      return searchControl.createTaskOnly({
        engine: input.searchEnginer,
        keywords: input.keywords,
        num_pages,
        concurrency,
        notShowBrowser: input.notShowBrowser,
        localBrowser: input.localBrowser,
        proxys: input.proxys as Usersearchdata["proxys"],
        accounts: input.accounts,
      });
    },
  );

  registerValidatedHandler(
    EXPORT_SEARCH_RESULTS,
    searchExportInputSchema,
    async (input) => {
      const searchControl = SearchController.getInstance();
      const format = input.format ?? "csv";
      const exportData = await searchControl.exportSearchResults(input.taskId, format);

      const fileExtension = format === "csv" ? "csv" : "json";
      const defaultFilename = `search_results_task_${input.taskId}_${
        new Date().toISOString().split("T")[0]
      }.${fileExtension}`;

      const { filePath } = await dialog.showSaveDialog({
        title: `Export Search Results as ${format.toUpperCase()}`,
        defaultPath: path.join(app.getPath("documents"), defaultFilename),
        filters: [
          { name: format === "csv" ? "CSV Files" : "JSON Files", extensions: [fileExtension] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (!filePath) {
        throw new Error("Export cancelled by user");
      }
      if (format === "csv") {
        fs.writeFileSync(filePath, exportData, "utf-8");
      } else {
        fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), "utf-8");
      }
      return filePath;
    },
  );

  registerValidatedHandler(
    KILL_SEARCH_PROCESS,
    searchKillProcessInputSchema,
    async (input) => {
      const searchControl = SearchController.getInstance();
      const result = input.pid
        ? await searchControl.killProcessByPID(input.pid)
        : await searchControl.killProcessByTaskId(input.taskId!);
      return result;
    },
  );
}
