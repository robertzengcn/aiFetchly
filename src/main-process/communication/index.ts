// export { default as SyncMsg } from "./sync-msg";
// export { default as AsyncMsg } from "./async-msg";
import { registerExtraModulesIpcHandlers } from "@/main-process/communication/extramodule-ipc";
import { registerScheduleIpcHandlers } from "@/main-process/communication/scheduleIpc";
import { registerYellowPagesIpcHandlers } from "@/main-process/communication/yellowPagesIpc";
import SyncMsg from "@/main-process/communication/sync-msg";
import AsyncMsg from "@/main-process/communication/async-msg";
import { BrowserWindow } from "electron";
import { registerSearchIpcHandlers } from "@/main-process/communication/search-ipc";
import { registeProxyIpcHandlers } from "@/main-process/communication/proxy-ipc";
import { registerEmailextractionIpcHandlers } from "@/main-process/communication/emailextraction-ipc";
import { registerEmailMarketingIpcHandlers } from "@/main-process/communication/emailMarketingIpc";
import { registerBuckEmailIpcHandlers } from "@/main-process/communication/buckEmail-ipc";
import { registerEmailTemplateIpcHandlers } from "@/main-process/communication/emailTemplate-ipc";
import { registerSocialAccountIpcHandlers } from "@/main-process/communication/socialaccount-ipc";
import { registerSystemSettingIpcHandlers } from "@/main-process/communication/systemSettingIpc";
import { registerUserIpcHandlers } from "@/main-process/communication/userIpc";
import { registerPlatformIpcHandlers } from "@/main-process/communication/platform-ipc";
import { registerSessionRecordingIpcHandlers } from "@/main-process/communication/sessionRecording-ipc";
import { registerLanguagePreferenceIpcHandlers } from "@/main-process/communication/language-ipc";
import { registerRagIpcHandlers } from "@/main-process/communication/rag-ipc";
import { registerAiChatIpcHandlers } from "@/main-process/communication/ai-chat-ipc";
import { registerAIEmailTemplateHandlers } from "@/main-process/communication/ai-email-template-ipc";
import { registerDashboardIpcHandlers } from "@/main-process/communication/dashboard-ipc";
import { registerMCPToolIpcHandlers } from "@/main-process/communication/mcp-tool-ipc";
import { registerSearchResultIpcHandlers } from "@/main-process/communication/search-result-ipc";
import { registerWebSocketIpcHandlers } from "@/main-process/communication/websocket-ipc";
import { registerContactExtractionHandlers } from "@/main-process/communication/contactExtraction-ipc";
import { registerSkillsIpcHandlers } from "@/main-process/communication/skills-ipc";
import { registerSystemDependencyIpcHandlers } from "@/main-process/communication/system-dependency-ipc";
import { registerGoogleMapsHandlers } from "@/main-process/communication/googleMaps-ipc";
import { registerYandexMapsHandlers } from "@/main-process/communication/yandexMaps-ipc";

type GlobalIpcState = typeof globalThis & {
  __aifetchlyIpcHandlersRegistered?: boolean;
};

export function registerCommunicationIpcHandlers(win: BrowserWindow) {
  const globalState = globalThis as GlobalIpcState;
  if (globalState.__aifetchlyIpcHandlersRegistered) {
    console.warn("[IPC] Skipping duplicate handler registration (HMR guard)");
    return;
  }
  globalState.__aifetchlyIpcHandlersRegistered = true;
  try {
    SyncMsg(win);
    registerExtraModulesIpcHandlers();
    registerScheduleIpcHandlers();
    registerYellowPagesIpcHandlers();
    registerSearchIpcHandlers();
    registeProxyIpcHandlers();
    registerEmailextractionIpcHandlers();
    registerEmailMarketingIpcHandlers();
    registerBuckEmailIpcHandlers();
    registerEmailTemplateIpcHandlers();
    registerSocialAccountIpcHandlers(win);
    registerSystemSettingIpcHandlers();
    registerUserIpcHandlers();
    registerPlatformIpcHandlers();
    registerSessionRecordingIpcHandlers();
    registerLanguagePreferenceIpcHandlers();
    registerRagIpcHandlers();
    registerAiChatIpcHandlers();
    registerAIEmailTemplateHandlers();
    registerDashboardIpcHandlers();
    registerMCPToolIpcHandlers();
    registerSearchResultIpcHandlers();
    registerWebSocketIpcHandlers(win);
    registerContactExtractionHandlers();
    registerSkillsIpcHandlers();
    registerSystemDependencyIpcHandlers();
    registerGoogleMapsHandlers();
    registerYandexMapsHandlers();
    AsyncMsg();
  } catch (e) {
    console.log("registerCommunicationIpcHandlers error:");
    console.error(e);
  }
  // Register extra modules IPC handlers
}
