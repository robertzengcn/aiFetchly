import { ipcMain, dialog, app } from "electron";
import {
  EMAILEXTRACTIONAPI,
  EMAILEXTRACTIONMESSAGE,
  LISTEMAILSEARCHTASK,
  EMAILSEARCHTASKRESULT,
  EMAILSEARCHTASK_ERROR_LOG_DOWNLOAD,
  GETEMAILSEARCHTASK,
  UPDATEEMAILSEARCHTASK,
  DELETEEMAILSEARCHTASK,
  EMAILEXTRACTION_RESULT_EXPORT,
  EMAIL_SEARCH_TASK_KILL,
  EMAIL_SEARCH_TASK_START,
} from "@/config/channellist";
import * as path from "path";
import * as fs from "fs";
import { EmailscFormdata, EmailsControldata } from "@/entityTypes/emailextraction-type";
import { CommonDialogMsg } from "@/entityTypes/commonType";
import { isValidUrl } from "@/views/utils/function";
import { EmailextractionController } from "@/controller/emailextractionController";
import { EmailExtractionTypes } from "@/config/emailextraction";
import { CommonResponse } from "@/entityTypes/commonType";
import { SearchResultModule } from "@/modules/SearchResultModule";
import { ISearchResultApi } from "@/modules/interface/ISearchResultApi";
import { EmailSearchTaskModule } from "@/modules/EmailSearchTaskModule";
import { resolveSearchResultUrls } from "@/main-process/communication/emailExtractionSearchResultUrls";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  emailExtractionListInputSchema,
  emailExtractionTaskResultInputSchema,
  emailExtractionByIdInputSchema,
  emailExtractionUpdateInputSchema,
  emailExtractionExportInputSchema,
} from "@/schemas/ipc/emailExtraction";

/**
 * Email extraction IPC handlers.
 *
 * EMAILEXTRACTIONAPI (ipcMain.on) is the streaming submit handler —
 * it pushes results via EMAILEXTRACTIONMESSAGE. Out of scope for the
 * validated wrapper. Kept as-is.
 *
 * 9 ipcMain.handle handlers migrated to registerValidatedHandler.
 */
export function registerEmailextractionIpcHandlers() {
  // ── Out-of-scope: streaming on handler ──────────────────────────────
  ipcMain.on(EMAILEXTRACTIONAPI, async (event, arg) => {
    let extraType: EmailExtractionTypes = EmailExtractionTypes.ManualInputUrl;
    const qdata = JSON.parse(arg as string) as EmailscFormdata;
    if (!Object.prototype.hasOwnProperty.call(qdata, "extratype")) {
      qdata.extratype = "ManualInputUrl";
    }
    const validUrls: string[] = [];
    if (qdata.extratype === "ManualInputUrl") {
      if (!qdata.urls || qdata.urls.length === 0) {
        (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
          EMAILEXTRACTIONMESSAGE,
          JSON.stringify({
            status: false,
            code: 20240705103811,
            data: { action: "error", title: "emailscrape.failed", content: "emailscrape.url_empty" },
          } satisfies CommonDialogMsg),
        );
        return;
      }
      qdata.urls.forEach((item) => {
        isValidUrl(item) ? validUrls.push(item) : null;
      });
      if (validUrls.length === 0) {
        (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
          EMAILEXTRACTIONMESSAGE,
          JSON.stringify({
            status: false,
            code: 20240705103811,
            data: { action: "error", title: "emailscrape.failed", content: "emailscrape.url_invalid" },
          } satisfies CommonDialogMsg),
        );
        return;
      }
    } else if (qdata.extratype === "SearchResult") {
      extraType = EmailExtractionTypes.SearchResult;
      if (!qdata.searchTaskId) {
        (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
          EMAILEXTRACTIONMESSAGE,
          JSON.stringify({
            status: false,
            code: 20240705103811,
            data: { action: "error", title: "emailscrape.failed", content: "emailscrape.searchTaskId_empty" },
          } satisfies CommonDialogMsg),
        );
        return;
      }
      const searchResultModule: ISearchResultApi = new SearchResultModule();
      const searchResult = await searchResultModule.getAllSearchResultsByTaskId(qdata.searchTaskId);
      validUrls.push(...resolveSearchResultUrls(searchResult));
      if (validUrls.length === 0) {
        (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
          EMAILEXTRACTIONMESSAGE,
          JSON.stringify({
            status: false,
            code: 20240705103811,
            data: { action: "error", title: "emailscrape.failed", content: "emailscrape.searchResult_empty" },
          } satisfies CommonDialogMsg),
        );
        return;
      }
    } else {
      (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
        EMAILEXTRACTIONMESSAGE,
        JSON.stringify({
          status: false,
          code: 20240705103811,
          data: { action: "error", title: "emailscrape.failed", content: "emailscrape.action_error" },
        } satisfies CommonDialogMsg),
      );
      return;
    }

    const datas: EmailsControldata = {
      searchResultId: qdata.searchTaskId ? qdata.searchTaskId : 0,
      validUrls: validUrls,
      concurrency: qdata.concurrency,
      pagelength: qdata.pagelength,
      notShowBrowser: qdata.notShowBrowser,
      proxys: qdata.proxys,
      type: extraType,
      processTimeout: Number(qdata.processTimeout),
      maxPageNumber: qdata.maxPageNumber,
      aiSupportEnabled: qdata.aiSupportEnabled || false,
    };

    const emailCon = new EmailextractionController();
    emailCon.searchEmail(datas);
    (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
      EMAILEXTRACTIONMESSAGE,
      JSON.stringify({
        status: true,
        code: 0,
        data: { action: "emailscrape.emailsearch_task_start", title: "", content: "" },
      } satisfies CommonDialogMsg),
    );
  });

  // ── Validated handle handlers ─────────────────────────────────────────

  registerValidatedHandler(
    LISTEMAILSEARCHTASK,
    emailExtractionListInputSchema,
    async (input) => {
      const emailCon = new EmailextractionController();
      const res = await emailCon.listEmailSearchtasks(
        input.page ?? 0,
        input.size ?? 100,
        input.sortby,
      );
      return { records: res.records, num: res.total };
    },
  );

  registerValidatedHandler(
    EMAILSEARCHTASKRESULT,
    emailExtractionTaskResultInputSchema,
    async (input) => {
      const emailCon = new EmailextractionController();
      const res = await emailCon.Emailtaskresult(
        input.taskId,
        input.page ?? 0,
        input.size ?? 100,
      );
      const count = await emailCon.EmailtaskresultCount(input.taskId);
      return { records: res, num: count };
    },
  );

  registerValidatedHandler(
    EMAILSEARCHTASK_ERROR_LOG_DOWNLOAD,
    emailExtractionByIdInputSchema,
    async (input) => {
      const emailCon = new EmailextractionController();
      return emailCon.readTaskErrorlog(input.id);
    },
  );

  registerValidatedHandler(
    GETEMAILSEARCHTASK,
    emailExtractionByIdInputSchema,
    async (input) => {
      const emailCon = new EmailextractionController();
      return emailCon.getEmailSearchTask(input.id);
    },
  );

  registerValidatedHandler(
    UPDATEEMAILSEARCHTASK,
    emailExtractionUpdateInputSchema,
    async (input) => {
      const formData = input.data as unknown as EmailscFormdata;
      const emailCon = new EmailextractionController();

      // Validate task status before allowing edit
      const task = await emailCon.getEmailSearchTask(input.id);
      if (!task) throw new Error("Task not found");
      if (task.status !== "pending" && task.status !== "error") {
        throw new Error("Cannot edit task with current status");
      }

      // Validate URLs if ManualInputUrl mode
      const validUrls: string[] = [];
      if (formData.extratype === "ManualInputUrl") {
        if (!formData.urls || formData.urls.length === 0) {
          throw new Error("URLs cannot be empty");
        }
        formData.urls.forEach((item) => {
          isValidUrl(item) ? validUrls.push(item) : null;
        });
        if (validUrls.length === 0) throw new Error("No valid URLs provided");
      }

      const updateData: EmailsControldata = {
        searchResultId: formData.searchTaskId ? formData.searchTaskId : 0,
        validUrls: validUrls,
        concurrency: formData.concurrency,
        pagelength: formData.pagelength,
        notShowBrowser: formData.notShowBrowser,
        proxys: formData.proxys,
        type:
          formData.extratype === "SearchResult"
            ? EmailExtractionTypes.SearchResult
            : EmailExtractionTypes.ManualInputUrl,
        processTimeout: Number(formData.processTimeout),
        maxPageNumber: formData.maxPageNumber,
        aiSupportEnabled: formData.aiSupportEnabled || false,
      };

      await emailCon.updateEmailSearchTask(input.id, updateData);
      return "Task updated successfully";
    },
  );

  registerValidatedHandler(
    DELETEEMAILSEARCHTASK,
    emailExtractionByIdInputSchema,
    async (input) => {
      const emailCon = new EmailextractionController();
      // Validate task status before allowing deletion
      const task = await emailCon.getEmailSearchTask(input.id);
      if (!task) throw new Error("Task not found");
      if (task.status !== "pending" && task.status !== "error") {
        throw new Error("Cannot delete task with current status");
      }
      await emailCon.deleteEmailSearchTask(input.id);
      return "Task deleted successfully";
    },
  );

  registerValidatedHandler(
    EMAILEXTRACTION_RESULT_EXPORT,
    emailExtractionExportInputSchema,
    async (input) => {
      const emailController = new EmailextractionController();
      const format = input.format ?? "csv";
      const exportData = await emailController.exportEmailResults(input.taskId, format);

      const fileExtension = format === "csv" ? "csv" : "json";
      const defaultFilename = `email_results_task_${input.taskId}_${
        new Date().toISOString().split("T")[0]
      }.${fileExtension}`;

      const { filePath } = await dialog.showSaveDialog({
        title: `Export Email Results as ${format.toUpperCase()}`,
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
    EMAIL_SEARCH_TASK_KILL,
    emailExtractionByIdInputSchema,
    async (input) => {
      const emailCon = new EmailextractionController();
      await emailCon.killEmailSearchTask(input.id);
      return "Task stopped successfully";
    },
  );

  registerValidatedHandler(
    EMAIL_SEARCH_TASK_START,
    emailExtractionByIdInputSchema,
    async (input) => {
      const emailCon = new EmailextractionController();
      await emailCon.startEmailSearchTask(input.id);
      return "Task started successfully";
    },
  );

  // Reset any tasks stuck in "Processing" from a previous app session
  const emailTaskModule = new EmailSearchTaskModule();
  emailTaskModule.resetOrphanedProcessingTasks().catch((err) => {
    console.error("Failed to reset orphaned email tasks:", err);
  });
}
