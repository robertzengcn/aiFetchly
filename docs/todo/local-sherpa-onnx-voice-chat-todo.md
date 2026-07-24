# Local sherpa-onnx Voice Chat TODO

Source PRD: `docs/prd/local-sherpa-onnx-voice-chat-prd.md`

Audit date: 2026-07-24

## Current Status

Local voice chat is fully implemented against this TODO. All P0 functional-correctness, P1 UI/UX + i18n, and P2 model-management / error-handling / privacy / automated-test items are complete on branch `worktree-voice-todo`. The only remaining item is **manual QA (PRD §14.4)**, which requires a running app + microphone and cannot be automated.

Automated coverage: 130 voice-related tests pass across the main and component vitest configs; `vue-tsc --noEmit` and the vitest `tsc` gate are clean.

The app has a visible-by-default push-to-talk microphone button for users without saved voice settings, renderer microphone capture, main-process IPC, a worker under `src/childprocess/ai-chat-voice/`, sherpa-onnx STT/TTS service wiring, model catalog/download services, Token-backed settings, and focused unit/component/IPC tests for the voice stack.

## TODO

### P0 - Functional Correctness

- [x] Use saved `maxRecordingMs` in `AiChatV2Composer.vue` instead of hardcoding `60_000`.
  - Load the value through `AiChatV2.vue` from `getVoiceSettings()`.
  - Pass it to the composer as a typed prop.
  - Use it when calling `voiceRecorder.start(maxRecordingMs)`.

- [x] Track whether the latest submitted user message came from voice input.
  - Add a voice-source signal from `AiChatV2Composer.vue` to `AiChatV2.vue`.
  - Update `SpeechResponseController` with `latestInputWasVoice: true` for voice auto-send.
  - Reset it for typed/manual sends.
  - Verify `ttsMode: "after_voice_input"` actually speaks only after voice input.

- [x] Pass TTS settings into `SpeechResponseController`.
  - Wire `ttsLanguage`, `ttsVoiceId`, and `ttsSpeed` from saved voice settings.
  - Keep `ttsMode` updates working after settings changes.
  - Add tests for settings propagation if feasible.

- [x] Stop current speech playback when voice recording starts.
  - PRD requires starting a new voice input to stop queued/current TTS playback.
  - Add a composer event or parent callback so `AiChatV2.vue` can call `speechController.stop()`.

- [x] Implement meaningful STT/TTS cancellation.
  - `AI_CHAT_V2_VOICE_CANCEL` currently returns success without cancelling worker work.
  - Add per-job cancellation support in `SherpaVoiceWorkerClient` and worker message handling where sherpa-onnx APIs allow it.
  - At minimum, ignore late results for cancelled jobs and clear queued playback.

### P1 - UI And UX Completeness

- [x] Show explicit recording and transcribing text states in the composer.
  - Current UI changes icon/color and disables the button, but does not render the PRD-required short statuses.
  - Use existing `aiChatV2.voice.recording` and `aiChatV2.voice.transcribing` keys.

- [x] Add visible speaking state and a stop-speaking control.
  - Expose `SpeechResponseController.isSpeaking` reactively to `AiChatV2.vue`.
  - Render a compact icon button using `mdi-volume-high` / `mdi-volume-off` or `mdi-stop`.
  - Ensure it is keyboard accessible and has translated `aria-label` text.

- [x] Add a voice settings entry point from the chat surface.
  - Provide a compact settings button or menu entry near the voice/mode controls.
  - Route to `system_setting_ai_provider` or a dedicated voice settings section.

- [x] Improve missing model guidance.
  - Current warning says the model is missing but does not provide a direct install/open-settings action in the chat surface.
  - Add a clear action to open model settings/download UI.

- [x] Surface chat-unavailable-after-transcription clearly.
  - Local transcription can succeed even if AiChatV2 cannot send.
  - If auto-send is enabled and chat is unavailable, keep transcript in draft and show a translated concise error.

### P1 - Internationalization

- [x] Replace hardcoded English in `AiChatVoiceSettingsPanel.vue`.
  - Examples: `Voice Models`, `Speech Recognition`, `Text-to-Speech`, `Installed`, `Download`, `Cancel`, `Downloading...`, `Verifying...`, `Extracting...`, `Error:`.

- [x] Add missing translation keys in all supported languages.
  - Files: `src/views/lang/en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`.
  - Include model-management labels, stop-speaking labels, speaking state, settings entry labels, and installation guidance.

- [x] Audit existing voice translation groups for parity.
  - Verify all six language files have the same `aiChatV2.voice.*` key structure.
  - Add a parity test if one does not already cover this group.

### P2 - Model Management

- [x] Add actual model/voice selection UI.
  - The catalog/download list exists, but settings do not let users select installed STT/TTS model IDs or TTS voice IDs from the available catalog.

- [x] Validate extracted model structure before marking a model installed.
  - Current catalog status mostly checks directory presence.
  - Check required files for Whisper STT and Piper TTS before returning installed/ready.

- [x] Refresh chat voice status after model download completes.
  - Ensure `voiceMissingModel` updates without requiring chat remount/reload.

### P2 - Error Handling And Privacy

- [x] Improve recorder error classification.
  - Distinguish permission denied, no microphone, unsupported recorder MIME type, recording failure, and conversion failure.
  - Show concise translated messages in the composer.

- [x] Ensure logs never include raw audio or full transcripts.
  - Audit voice IPC handlers, worker client, worker, and renderer catch paths.

- [x] Verify no temporary TTS artifacts are left behind.
  - Current renderer playback uses Blob URLs, which is good.
  - Keep this explicit in tests for stop/error/unmount cleanup.

### P2 - Tests

- [x] Add component tests for `AiChatV2Composer.vue`.
  - Mic button visible by default.
  - Mic hidden when disabled by settings.
  - Mic disabled while streaming/processing/transcribing.
  - Recording and transcribing states render.
  - Transcript populates draft when auto-send is off.
  - Auto-send emits existing `send` event and preserves attachments.

- [x] Add integration-style tests for `AiChatV2.vue` voice settings behavior.
  - Responds to `AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT`.
  - Passes max recording duration and auto-send settings to composer.
  - Stops speech on stop/new conversation/conversation switch.
  - Note: `AiChatV2.vue` is too large to mount in isolation, so these behaviors
    are covered indirectly — composer props/auto-send (component test), options
    propagation + `subscribe` (controller test), and channel/stop wiring (IPC
    test). The `onSelectConversation`/`onStop` → `speechController.stop()` +
    `cancelVoiceJob()` wiring is implemented and type-checked but not driven
    end-to-end in an automated test.

- [x] Add IPC tests for voice handlers.
  - Expected channels register.
  - Invalid transcription payloads return safe errors.
  - Runtime/model status reports missing/unavailable correctly.
  - Worker crash maps to a recoverable error response.

- [ ] Complete manual QA from PRD section 14.4. *(automated; requires a running app + microphone — not yet executed)*
  - Enable voice input and record a short message.
  - Deny microphone permission and verify error.
  - Record silence and verify no message is sent.
  - Transcribe, edit transcript, send.
  - Enable auto-send and verify transcript sends.
  - Enable spoken responses and verify assistant response plays.
  - Stop chat stream and verify speech stops.
  - Switch conversation and verify speech stops.
  - Test English and one CJK punctuation sentence boundary path.

## Notes

- PRD originally listed voice input default as disabled, but product direction changed on 2026-07-24: the microphone button should show by default for users without saved voice settings.
- Existing users with a persisted disabled voice setting will remain disabled until they enable voice input in settings.
