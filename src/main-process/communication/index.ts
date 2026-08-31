// export { default as SyncMsg } from "./sync-msg";
// export { default as AsyncMsg } from "./async-msg";
import { registerExtraModulesIpcHandlers } from "@/main-process/communication/extramodule-ipc";
import { log } from "@/modules/Logger";
import { registerScheduleIpcHandlers } from "@/main-process/communication/scheduleIpc";
import { registerYellowPagesIpcHandlers } from "@/main-process/communication/yellowPagesIpc";
import SyncMsg from "@/main-process/communication/sync-msg";
import AsyncMsg from "@/main-process/communication/async-msg";
import { BrowserWindow } from "electron";
import { registerSearchIpcHandlers } from "@/main-process/communication/search-ipc";
import { registeProxyIpcHandlers } from "@/main-process/communication/proxy-ipc";
import { registerEmailextractionIpcHandlers } from "@/main-process/communication/emailextraction-ipc";
import { registerEmailMarketingIpcHandlers } from "@/main-process/communication/emailMarketingIpc";
import { EmailReplyReliabilityStartup } from "@/service/emailReply/EmailReplyReliabilityStartup";
import { registerBuckEmailIpcHandlers } from "@/main-process/communication/buckEmail-ipc";
import { registerEmailTemplateIpcHandlers } from "@/main-process/communication/emailTemplate-ipc";
import { registerSocialAccountIpcHandlers } from "@/main-process/communication/socialaccount-ipc";
import { registerSystemSettingIpcHandlers } from "@/main-process/communication/systemSettingIpc";
import { registerUserIpcHandlers } from "@/main-process/communication/userIpc";
import { registerPlatformIpcHandlers } from "@/main-process/communication/platform-ipc";
import { registerSessionRecordingIpcHandlers } from "@/main-process/communication/sessionRecording-ipc";
import { registerLanguagePreferenceIpcHandlers } from "@/main-process/communication/language-ipc";
import { registerRagIpcHandlers } from "@/main-process/communication/rag-ipc";
import { registerAiChatV2IpcHandlers } from "@/main-process/communication/ai-chat-v2-ipc";
import { registerAiFileOpenIpcHandlers } from "@/main-process/communication/ai-file-open-ipc";
import { registerAiChatAtMentionIpcHandlers } from "@/main-process/communication/ai-chat-at-mention-ipc";
import { registerAiChatGoalIpcHandlers } from "@/main-process/communication/ai-chat-goal-ipc";
import { registerAiChatScheduledLoopIpcHandlers } from "@/main-process/communication/ai-chat-scheduled-loop-ipc";
import { AIChatConversationUpdateBroadcaster } from "@/service/AIChatConversationUpdateBroadcaster";
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
import { registerAiMessageTaskIpcHandlers } from "@/main-process/communication/aiMessageTask-ipc";
import { registerAgentRuntimeIpcHandlers } from "@/main-process/communication/agent-runtime-ipc";
import { registerAgentDefinitionIpcHandlers } from "@/main-process/communication/agent-definition-ipc";
import { registerPluginIpcHandlers } from "@/main-process/communication/plugin-ipc";
import { registerPluginMarketplaceIpcHandlers } from "@/main-process/communication/plugin-marketplace-ipc";
import { registerCommunityPluginIpcHandlers } from "@/main-process/communication/community-plugin-ipc";
import { registerAIUserMemoryIpcHandlers } from "@/main-process/communication/ai-user-memory-ipc";
import { registerAIWorkspaceIpcHandlers } from "@/main-process/communication/ai-workspace-ipc";
import { registerLocalAiRuntimeIpcHandlers } from "@/main-process/communication/local-ai-runtime-ipc";
import { registerAIProviderIpcHandlers } from "@/main-process/communication/ai-provider-ipc";
import { registerAiChatVoiceIpcHandlers } from "@/main-process/communication/ai-chat-v2-voice-ipc";
import { registerAIArtifactIpcHandlers } from "@/main-process/communication/ai-artifact-ipc";
import { registerAIWorkspaceMemoryIpcHandlers } from "@/main-process/communication/ai-workspace-memory-ipc";
import { registerPortableWorkspaceMemoryIpcHandlers } from "@/main-process/communication/portable-workspace-memory-ipc";
import { registerEmailReceiveIpcHandlers } from "@/main-process/communication/emailReceive-ipc";
import { registerDiagnosticsIpcHandlers } from "@/main-process/communication/diagnostics-ipc";
import { registerHooksIpcHandlers } from "@/main-process/communication/hooks-ipc";
import { registerSlashCommandHandlers } from "@/main-process/communication/slash-command-ipc";
import { registerWorkspaceWatchHandlers } from "@/main-process/communication/workspace-watch-ipc";
import { initWorkspaceWatchManager } from "@/service/workspaceWatch/WorkspaceWatchManagerSingleton";
import { setApprovedWorkspaceAcquireHook } from "@/modules/WorkspaceWatchModule";
import { ensurePortableMemoryDefault } from "@/service/PortableWorkspaceMemoryBootstrap";
import { registerAboutIpcHandlers } from "@/main-process/communication/about-ipc";
import { registerAIContentReportIpcHandlers } from "@/main-process/communication/ai-content-report-ipc";

type GlobalIpcState = typeof globalThis & {
  __aifetchlyIpcHandlersRegistered?: boolean;
};

export function registerCommunicationIpcHandlers(
  win: BrowserWindow,
  getWin: () => BrowserWindow | null
) {
  const globalState = globalThis as GlobalIpcState;
  if (globalState.__aifetchlyIpcHandlersRegistered) {
    log.warn("[IPC] Skipping duplicate handler registration (HMR guard)");
    return;
  }
  globalState.__aifetchlyIpcHandlersRegistered = true;
  try {
    SyncMsg(win);
    // Register the window so scheduled-loop turn completions can broadcast a
    // narrow conversation-update refresh hint to the renderer (FR-11).
    AIChatConversationUpdateBroadcaster.getInstance().register(win);
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
    // Use the lazy getWin provider, NOT the captured `win` argument. The
    // HMR guard above means this closure lives for the whole app lifetime;
    // capturing `win` here would pin the FIRST window forever, so after a
    // window recreation (crash recovery, second-instance) every login-flow
    // lookup would return the destroyed window and post-login IPC would
    // never reach the live renderer.
    registerUserIpcHandlers(getWin);
    registerPlatformIpcHandlers();
    registerSessionRecordingIpcHandlers();
    registerLanguagePreferenceIpcHandlers();
    registerRagIpcHandlers();
    registerAiChatV2IpcHandlers();
    registerAiFileOpenIpcHandlers();
    registerAiChatAtMentionIpcHandlers();
    registerAiChatGoalIpcHandlers();
    registerAiChatScheduledLoopIpcHandlers();
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
    registerAiMessageTaskIpcHandlers();
    registerAgentRuntimeIpcHandlers();
    registerAgentDefinitionIpcHandlers();
    registerPluginIpcHandlers();
    registerPluginMarketplaceIpcHandlers();
    registerCommunityPluginIpcHandlers();
    registerAIUserMemoryIpcHandlers();
    registerAIWorkspaceIpcHandlers(win);
    registerLocalAiRuntimeIpcHandlers(() => win);
    registerAIProviderIpcHandlers();
    registerAiChatVoiceIpcHandlers();
    registerAIArtifactIpcHandlers();
    registerAIWorkspaceMemoryIpcHandlers();
    registerPortableWorkspaceMemoryIpcHandlers();
    registerEmailReceiveIpcHandlers();
    // Best-effort reply-reliability startup: lift legacy drafts onto immutable
    // revisions and sweep stale in-flight send attempts to delivery_unknown.
    // Fire-and-forget; never blocks app startup.
    new EmailReplyReliabilityStartup()
      .start()
      .catch((e: unknown) =>
        log.error("[reply-reliability] startup failed:", e)
      );
    registerDiagnosticsIpcHandlers();
    registerHooksIpcHandlers();
    registerSlashCommandHandlers(win);
    const workspaceWatchManager = initWorkspaceWatchManager(win);
    setApprovedWorkspaceAcquireHook((workspaceRoot) => {
      void ensurePortableMemoryDefault({ workspaceRoot }).catch(
        (err: unknown) => {
          log.warn("[portable-memory] default layout bootstrap failed:", err);
        }
      );
    });
    registerWorkspaceWatchHandlers(win, workspaceWatchManager);
    registerAboutIpcHandlers(getWin);
    registerAIContentReportIpcHandlers();
    AsyncMsg();
  } catch (e) {
    log.info("registerCommunicationIpcHandlers error:");
    log.error(e);
  }
  // Register extra modules IPC handlers
}
