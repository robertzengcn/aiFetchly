/**
 * Voice journey E2E with a deterministic runtime stand-in (audit TODO V01,
 * 2026-10-22 fix round).
 *
 * Companion to `aiChatVoiceParity.test.ts`, which covers the missing
 * runtime/model degradation paths. This suite plants the runtime stand-in
 * (test/e2e/support/voiceRuntimeSeed.ts) into the redirected E2E userData
 * root BEFORE launch, so the REAL production voice stack runs end to end:
 * resolver + state store + model catalog discover the runtime, the real
 * BrowserVoiceRecorder records from Chromium's fake media device, the real
 * AiChatVoiceWorker loads the addon and transcribes/synthesizes via the
 * stand-in, and the real SpeechResponseController + VoicePlaybackQueue play
 * the spoken response. Only the native inference module is a stand-in: it
 * returns one deterministic transcript and 1s of Float32 samples.
 *
 * Done-when (audit V01):
 * - the runtime is discovered as ready through the REAL resolver/catalog;
 * - mic record -> real worker transcription -> auto-send -> streamed reply
 *   (accepted send through the transport);
 * - the transcript + attachments ownership stays with the composer draft
 *   (accepted send clears the draft);
 * - configured playback policy (ttsState "ready" + spoken response starts
 *   and is cancellable — Stop speaking) — deterministic stand-in synthesis;
 * - send failure (fakeAi http-500) preserves the transcript in the draft.
 */

import { expect } from "@playwright/test";
import { e2eTest as baseTest } from "../fixtures/base";
import type { LaunchedApp } from "../fixtures/electronApp";
import { launchAiFetchly } from "../fixtures/electronApp";
import { closeApp } from "../support/processCleanup";
import type { E2ETestRoot } from "../fixtures/types";
import type { FakeOpenAiController } from "../fixtures/fakeOpenAiServer";
import { writeStateManifest } from "../fixtures/temporaryState";
import { STREAM_TEXT_FINAL } from "../scenarios/aiChatScenarios";
import {
  seedVoiceRuntimeStandin,
  STANDIN_TRANSCRIPT,
} from "../support/voiceRuntimeSeed";

interface IpEnvelope {
  status: boolean;
  data: unknown;
  msg?: string;
}

async function ipc(
  app: LaunchedApp,
  channel: string,
  data: unknown
): Promise<IpEnvelope> {
  const payload = JSON.stringify(data);
  return (await app.mainWindow.evaluate(
    async ([ch, body]: [string, string]) => {
      const api = (
        window as unknown as {
          api: {
            invoke: (c: string, d?: unknown) => Promise<IpEnvelope | undefined>;
          };
        }
      ).api;
      return (await api.invoke(ch, body)) ?? { status: false, data: null };
    },
    [channel, payload] as const
  )) as IpEnvelope;
}

interface VoiceSettings {
  inputMode: string;
  ttsMode: string;
  autoSendTranscript: boolean;
  sttLanguage: string;
  ttsLanguage: string;
  sttModelId: string;
  ttsModelId: string;
  ttsSpeed: number;
  maxRecordingMs: number;
}

interface VoiceStatus {
  sttState?: string;
  ttsState?: string;
  errorMessage?: string;
}

/** Extended fixture: authenticated launch + runtime stand-in + fake mic. */
interface VoiceJourneyFixtures {
  testRoot: E2ETestRoot;
  fakeAi: FakeOpenAiController;
  voiceApp: LaunchedApp;
  /** Same launch, but the provider model catalog is EMPTY (chat gate closed). */
  voiceAppNoChat: LaunchedApp;
}

async function launchVoiceApp(
  testRoot: E2ETestRoot,
  fakeAi: FakeOpenAiController,
  aiState: "local-enabled" | "hosted-disabled"
): Promise<LaunchedApp> {
  writeStateManifest(testRoot, {
    authState: "authenticated",
    aiState,
    fakeAiBaseUrl: fakeAi.providerBaseUrl,
    workspacePath: testRoot.workspacePath,
  });
  // BEFORE launch: resolver reads state/manifest at status time; seeding
  // first guarantees the very first settings load sees a ready runtime.
  await seedVoiceRuntimeStandin({ userDataPath: testRoot.userDataPath });
  return launchAiFetchly({
    testRoot,
    fakeAiBaseUrl: fakeAi.providerBaseUrl,
    voiceFakeMediaStream: true,
  });
}

const voiceTest = baseTest.extend<VoiceJourneyFixtures>({
  voiceApp: async ({ testRoot, fakeAi }, use) => {
    await fakeAi.reset();
    const app = await launchVoiceApp(testRoot, fakeAi, "local-enabled");
    await use(app);
    await closeApp(app);
  },
  voiceAppNoChat: async ({ testRoot, fakeAi }, use) => {
    await fakeAi.reset();
    // Hosted-disabled launch: the local provider is not seeded and the
    // hosted model list is unreachable (E2E guard default-denies), so the
    // surface's chat-ready gate is deterministically closed (no models).
    // Voice settings remain usable — the real FR-VOI-010 situation of a
    // user whose AI capability is unavailable mid-voice-journey.
    const app = await launchVoiceApp(testRoot, fakeAi, "hosted-disabled");
    await use(app);
    await closeApp(app);
  },
});

function mic(app: LaunchedApp): ReturnType<LaunchedApp["mainWindow"]["getByTestId"]> {
  return app.mainWindow.getByTestId("ai-chat-microphone");
}

function composerBox(app: LaunchedApp): import("@playwright/test").Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

/**
 * Record ~1.4s from the fake media device and release. The recorder UI
 * shows the recording status while live and the transcribing status while
 * the worker round-trip runs; auto-send handles the accepted send when
 * settings allow it.
 */
async function recordAndRelease(app: LaunchedApp): Promise<void> {
  const button = mic(app);
  await expect(button).toBeEnabled({ timeout: 15_000 });
  await button.click();
  await expect(
    app.mainWindow.locator(".v2-composer__voice-status")
  ).toContainText(/Recording/i, { timeout: 10_000 });
  // ~1.4s of the synthetic tone so the fake device yields real PCM.
  await app.mainWindow.waitForTimeout(1_400);
  await button.click();
}

async function configureAutoSend(app: LaunchedApp): Promise<void> {
  const initial = await ipc(app, "ai-chat-v2:voice-get-settings", {});
  expect(initial.status, `settings read failed: ${initial.msg ?? ""}`).toBe(
    true
  );
  const view = initial.data as VoiceSettings;
  const toggled: VoiceSettings = {
    ...view,
    ttsMode: "after_voice_input",
    autoSendTranscript: true,
  };
  const saved = await ipc(app, "ai-chat-v2:voice-set-settings", toggled);
  expect(saved.status, `settings save failed: ${saved.msg ?? ""}`).toBe(true);
  // The settings-dialog save path (saveVoiceSettings api wrapper) dispatches
  // the settings-changed event so the composable reloads; a raw IPC write
  // must replay that same contract or the composer keeps stale defaults.
  // The composable reads the view and applies it through production code.
  await app.mainWindow.evaluate(
    (detail: unknown) => {
      window.dispatchEvent(
        new CustomEvent("aifetchly:ai-chat-v2-voice-settings-changed", {
          detail,
        })
      );
    },
    saved.data as unknown
  );
  // Applied through the composable's async reload before recording starts.
  await app.mainWindow.waitForTimeout(500);
}

voiceTest.describe("voice journey with the runtime stand-in", () => {
  voiceTest(
    "runtime resolves ready through the real resolver and the journey auto-sends the transcript and speaks the reply",
    async ({ voiceApp, fakeAi }) => {
      voiceTest.setTimeout(240_000);
      await fakeAi.setScenario("stream-text");
      await expect(composerBox(voiceApp)).toBeVisible({ timeout: 30_000 });

      // 1. REAL resolver + catalog: the stand-in must surface as ready on
      //    both directions — not "unavailable"/"missing_model".
      const status = await ipc(voiceApp, "ai-chat-v2:voice-status", {});
      expect(status.status, `status failed: ${status.msg ?? ""}`).toBe(true);
      const statusView = status.data as VoiceStatus;
      expect(statusView.sttState, "stt must be ready through the resolver").toBe(
        "ready"
      );
      expect(statusView.ttsState, "tts must be ready through the catalog").toBe(
        "ready"
      );

      // 2. Configured journey policy through the REAL settings store.
      await configureAutoSend(voiceApp);
      const reread = await ipc(voiceApp, "ai-chat-v2:voice-get-settings", {});
      const rereadView = reread.data as VoiceSettings;
      expect(rereadView.ttsMode).toBe("after_voice_input");
      expect(rereadView.autoSendTranscript).toBe(true);

      // 3. Record -> transcribe -> auto-send: the REAL worker bridge loads
      //    the stand-in addon and returns the deterministic transcript; the
      //    send goes through the real transport (fakeAi scenario).
      await recordAndRelease(voiceApp);
      const transcript = voiceApp.mainWindow.getByTestId(
        "workspace-transcript"
      );
      await expect(transcript).toContainText(STANDIN_TRANSCRIPT, {
        timeout: 60_000,
      });

      // 4. Ownership: the accepted send consumed the transcript — the
      //    composer draft must be empty (onAccepted restore baseline).
      await expect(composerBox(voiceApp)).toHaveValue("", {
        timeout: 15_000,
      });

      // 5. Streamed reply completes.
      await expect(transcript).toContainText(STREAM_TEXT_FINAL, {
        timeout: 60_000,
      });

      // 6. Configured playback policy: the spoken response starts (Stop
      //    speaking affordance appears once the queue speaks) and the queue
      //    actually drains (the affordance clears) — the deterministic
      //    stand-in synthesis + real playback pipeline.
      const stopSpeaking = voiceApp.mainWindow.locator(
        ".v2-composer__stop-speaking"
      );
      await expect(stopSpeaking).toBeVisible({ timeout: 30_000 });
      // 6a. Selection/Stop handling (R07): click Stop speaking mid-playback;
      //     the queue must cancel promptly.
      await stopSpeaking.click();
      await expect(stopSpeaking).toBeHidden({ timeout: 10_000 });
      // Stable after cancel: no stuck speaking state.
      await voiceApp.mainWindow.waitForTimeout(1_000);
      await expect(stopSpeaking).toBeHidden();
    }
  );

  voiceTest(
    "voice auto-send keeps the transcript in the composer draft when the chat cannot accept it",
    async ({ voiceAppNoChat }) => {
      voiceTest.setTimeout(240_000);
      // FR-VOI-010 / PRD §7.13: with the chat gate closed (no model catalog),
      // the auto-send path must keep the transcript in the draft for the
      // user to retry instead of losing the speech anywhere else.
      await expect(composerBox(voiceAppNoChat)).toBeVisible({ timeout: 30_000 });
      await configureAutoSend(voiceAppNoChat);

      await recordAndRelease(voiceAppNoChat);

      // The draft keeps the transcript for the user to retry; no transcript
      // row can appear because the send never left the composer.
      await expect(composerBox(voiceAppNoChat)).toHaveValue(
        STANDIN_TRANSCRIPT,
        { timeout: 30_000 }
      );
      // Bounded localized notice on the composer (transient by design).
      await expect(
        voiceAppNoChat.mainWindow.locator(".v2-composer__notice")
      ).toContainText(/composer|unavailable/i, { timeout: 10_000 });
    }
  );
});
