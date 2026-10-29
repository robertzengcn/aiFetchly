/**
 * Voice parity journey over the default workspace route (audit 2026-10-17,
 * FR-VOI-001..010 / R07 residual coverage).
 *
 * The suite exercises the REAL local-voice stack in the E2E environment:
 * status degradation, durable settings round-trips, the real worker fork with
 * the real missing-runtime/missing-model paths, the bounded cancel channel and
 * the composer's degraded affordances. A real transcription/synthesis result
 * is impossible here — the sherpa-onnx-native runtime and whisper/vITS model
 * files are not installed — which is exactly the "missing runtime/model"
 * acceptance path; the positive STT/TTS paths stay covered by the worker unit
 * matrix (test/vitest/main/aiChatVoiceWorker.test.ts + schema/types tests)
 * and the renderer composer/useAiChatVoice suites.
 *
 * R07 (speech cancellation on selection change/Stop) is fix-certified at the
 * component level (`AiChatCenterSurface.test.ts` "speech cancellation (R07)"
 * + `useAiChatVoice` stopSpeaking + composer stop control) because real audio
 * playback cannot run headless; this suite proves the REAL cancel channel
 * round-trips and stays bounded.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import type { LaunchedApp } from "../fixtures/electronApp";

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
  const resp = await app.mainWindow.evaluate(
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
  );
  return resp as IpEnvelope;
}

interface VoiceStatus {
  sttState?: string;
  ttsState?: string;
  sttModelId?: string;
  ttsModelId?: string;
  errorMessage?: string;
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

/** A tiny valid PCM16 WAV (200 ms silence, 16 kHz mono) as base64. */
function silentWavBase64(): string {
  const sampleRate = 16_000;
  const samples = sampleRate / 5;
  const bytesPerSample = 2;
  const dataSize = samples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer.toString("base64");
}

test.describe("local voice parity (missing runtime/model)", () => {
  test("reports the missing runtime status, persists settings, proves bounded transcribe/tts failures through the real worker, and keeps cancel safe", async ({
    aiApp,
  }) => {
    test.setTimeout(180_000);

    // 1. REAL runtime status: sherpa-onnx-native is absent in the E2E env, so
    //    the status must degrade explicitly (missing model + reason message)
    //    instead of pretending readiness.
    const status = await ipc(aiApp, "ai-chat-v2:voice-status", {});
    expect(status.status, "voice-status must succeed as CommonMessage").toBe(
      true
    );
    const statusData = status.data as VoiceStatus;
    expect(
      ["unavailable", "missing_model", "error"].includes(
        statusData.sttState ?? ""
      ),
      `stt must not claim ready without the runtime (got ${statusData.sttState})`
    ).toBe(true);
    expect(
      ["unavailable", "missing_model", "error"].includes(
        statusData.ttsState ?? ""
      ),
      `tts must not claim ready without the runtime (got ${statusData.ttsState})`
    ).toBe(true);
    expect(statusData.sttModelId ?? "").toContain("sherpa-onnx");

    // 2. Settings round trip: read the typed view, flip a prereq-free field
    //    (autoSendTranscript), persist through the REAL store and re-read.
    const initial = await ipc(aiApp, "ai-chat-v2:voice-get-settings", {});
    expect(initial.status, `settings read failed: ${initial.msg ?? ""}`).toBe(
      true
    );
    const initialView = initial.data as VoiceSettings;
    expect(initialView.inputMode).toBe("push_to_talk");
    expect(initialView.ttsMode).toBe("disabled");

    const flipped: VoiceSettings = {
      ...initialView,
      autoSendTranscript: !initialView.autoSendTranscript,
    };
    const saved = await ipc(aiApp, "ai-chat-v2:voice-set-settings", flipped);
    expect(saved.status, `settings save failed: ${saved.msg ?? ""}`).toBe(true);
    const savedView = saved.data as VoiceSettings;
    expect(savedView.autoSendTranscript).toBe(flipped.autoSendTranscript);
    const reread = await ipc(aiApp, "ai-chat-v2:voice-get-settings", {});
    const rereadView = reread.data as VoiceSettings;
    expect(rereadView.autoSendTranscript).toBe(flipped.autoSendTranscript);
    // Restore the default so later journeys (and local inspection) clone it.
    const restored = await ipc(
      aiApp,
      "ai-chat-v2:voice-set-settings",
      initialView
    );
    expect(restored.status).toBe(true);

    // 3. REAL transcription through the forked worker: the worker boots, the
    //    ready handshake reports STT unavailable (no native runtime/model)
    //    and the transcribe request resolves to a BOUNDED failure.
    const wav = silentWavBase64();
    const t0 = Date.now();
    const transcribed = await ipc(aiApp, "ai-chat-v2:voice-transcribe", {
      audioBase64: wav,
      mimeType: "audio/wav",
      language: "en",
      conversationId: "voice-parity-e2e",
    });
    const elapsed = Date.now() - t0;
    expect(transcribed.status).toBe(false);
    // The E2E build always emits AiChatVoiceWorker.js next to e2e-main.js, so
    // the request must land INSIDE the worker and surface the model-level
    // failure (not the pre-fork "worker file not found" denial).
    expect(
      transcribed.msg,
      `expected the worker-level missing-model denial (got ${
        transcribed.msg ?? ""
      })`
    ).toMatch(/STT model is not loaded/i);
    expect(
      (transcribed.msg ?? "").length,
      `failure must stay bounded (got ${transcribed.msg ?? ""})`
    ).toBeGreaterThan(0);
    expect((transcribed.msg ?? "").length).toBeLessThan(300);
    expect(transcribed.msg ?? "").not.toMatch(/at \w|node:|\.ts:/);
    // A fast, healthy worker handshake → not a dead fork or 90s stall.
    expect(elapsed).toBeLessThan(60_000);

    // 4. REAL synthesis through the worker: same missing-model guarantee.
    const synthesized = await ipc(aiApp, "ai-chat-v2:voice-tts", {
      text: "voice parity check",
      language: "en",
      conversationId: "voice-parity-e2e",
    });
    expect(synthesized.status).toBe(false);
    expect(
      synthesized.msg,
      `expected the worker-level missing-model denial (got ${
        synthesized.msg ?? ""
      })`
    ).toMatch(/TTS model is not loaded/i);

    // 5. Cancel channel: best-effort by contract — an unknown id must not
    //    crash and must stay bounded (R07's real-channel proof; the
    //    selection/Stop wiring is certified at component level).
    const cancelled = await ipc(aiApp, "ai-chat-v2:voice-cancel", {
      jobId: `stt-voice-parity-unknown-${Date.now()}`,
    });
    expect(cancelled.status, `cancel failed: ${cancelled.msg ?? ""}`).toBe(
      true
    );
    expect((cancelled.data as { ok?: boolean })?.ok).toBe(true);

    // 6. Malformed request safety: neither payload nor crash — explicit
    //    bounded denial both ways (strict IPC input for voice too).
    const badPayload = await ipc(aiApp, "ai-chat-v2:voice-transcribe", {
      audioBase64: wav,
      mimeType: "application/octet-stream",
    });
    expect(badPayload.status).toBe(false);
    const emptyPayload = await ipc(aiApp, "ai-chat-v2:voice-transcribe", null);
    expect(emptyPayload.status).toBe(false);
    const emptyTts = await ipc(aiApp, "ai-chat-v2:voice-tts", { text: "  " });
    expect(emptyTts.status).toBe(false);

    // 7. Composer affordances on the default route: with the runtime missing
    //    the mic stays a labeled push-to-talk affordance; clicking it must
    //    never silently open a recorder or crash (no harness → bounded).
    const mic = aiApp.mainWindow.locator('[data-testid="ai-chat-microphone"]');
    const micCount = await mic.count();
    if (micCount > 0) {
      const micButton = mic.first();
      await expect(micButton).toBeVisible();
      const disabled = await micButton.getAttribute("disabled");
      if (disabled !== "") {
        await micButton.click();
        const recorderVisible = await aiApp.mainWindow
          .locator(".v2-composer__voice-status")
          .count();
        expect(recorderVisible).toBe(0);
      }
    }
  });
});
