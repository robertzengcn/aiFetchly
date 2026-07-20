# Local sherpa-onnx Voice Chat - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-20
- **Owner**: Engineering Team
- **Related areas**: AiChatV2, voice input, spoken AI responses, local AI runtime, Electron child processes, AI provider settings
- **Primary files**:
  - `src/views/components/aiChatV2/AiChatV2.vue`
  - `src/views/components/aiChatV2/AiChatV2Composer.vue`
  - `src/views/api/aiChatV2.ts`
  - `src/main-process/communication/ai-chat-v2-ipc.ts`
  - `src/config/channellist.ts`
  - `src/config/usersetting.ts`
  - `src/childprocess/`
  - `src/views/lang/{en,zh,es,fr,de,ja}.ts`

## 1. Summary

AiFetchly should add local voice chat support to AiChatV2 using `sherpa-onnx` for speech-to-text (STT) and text-to-speech (TTS).

The first user-visible outcome is simple:

1. The user can press a microphone button in AiChatV2, speak a message, and have the app convert speech to text locally.
2. The transcript can be reviewed in the composer and sent through the existing AiChatV2 text chat pipeline.
3. The assistant can speak its text response back to the user using local TTS.

The feature must keep the existing chat contract text-first. Voice input produces a normal text message, and voice output is generated from the assistant's normal text response. The local speech runtime must not replace the existing `ChatV2StreamRequest.message` flow.

## 2. Problem

AiChatV2 currently supports typed user input and streamed text responses. This is usable for desktop workflows, but it is slower for users who want conversational interaction, hands-free operation, or quick dictation.

Sending voice data to the hosted AI server for transcription is technically possible, but it has drawbacks:

- User audio leaves the local device.
- Voice input depends on network quality and AI server availability.
- Hosted transcription may add cost.
- Users running local AI providers expect a local-first voice path.

The product needs a private, offline-capable voice layer that integrates with the existing chat stream without destabilizing the chat engine.

## 3. Goals

1. Add local STT for AiChatV2 voice input using `sherpa-onnx`.
2. Add local TTS for assistant spoken responses using `sherpa-onnx`.
3. Keep the existing AiChatV2 message pipeline text-first and compatible with current chat history, tool calls, plan mode, and model selection.
4. Run STT/TTS inference outside the Vue renderer and outside the Electron main process.
5. Place worker-specific speech runtime code in `src/childprocess/`.
6. Avoid direct database access from speech workers.
7. Add clear UI states for recording, transcribing, speaking, paused/stopped, missing model, and errors.
8. Add settings for voice input, spoken responses, language, model, voice, speed, and auto-send behavior.
9. Preserve privacy by not storing raw audio by default.
10. Add complete i18n coverage for all user-facing text.

## 4. Non-Goals

1. Do not make the LLM API accept raw audio in the first release.
2. Do not store raw microphone recordings in chat history by default.
3. Do not require a hosted AI subscription solely for local voice input or local voice output.
4. Do not run `sherpa-onnx` inference directly in Vue components.
5. Do not run heavy local speech inference on the Electron main process.
6. Do not let child/worker processes read or write the database directly.
7. Do not speak tool logs, raw JSON, code blocks, permission prompts, or file operation summaries.
8. Do not implement voice cloning in the first release.
9. Do not support multi-speaker diarization in the first release.
10. Do not require real-time streaming voice output in the MVP if sentence-level playback is sufficient.

## 5. Definitions

| Term | Meaning |
| --- | --- |
| STT | Speech-to-text. Converts user microphone audio into transcript text. |
| TTS | Text-to-speech. Converts assistant text into playable audio. |
| Voice input | User speaks into microphone to create a chat message. |
| Spoken response | Assistant text response is read aloud to the user. |
| Push-to-talk | User explicitly starts and stops recording for a single voice message. |
| Auto-send | App sends the transcript to AI chat immediately after transcription succeeds. |
| Speech worker | Child process or utility process that owns local STT/TTS runtime and models. |
| Canonical message | The text message stored in chat history and sent to the LLM. |

## 6. Current State

AiChatV2 already has a stable text-based chat flow:

- `AiChatV2Composer.vue` emits `send(text, files)` from the current draft.
- `AiChatV2.vue` builds a `ChatV2StreamRequest` with `message: displayText`.
- `streamChatV2Message()` sends the request through Electron IPC.
- `ai-chat-v2-ipc.ts` checks chat availability before parsing stream request data.
- The main process streams assistant chunks back to the renderer.
- The renderer persists and displays assistant text, tool calls, plan cards, and errors.

Voice should be layered around this existing flow:

```text
Voice input
 -> local STT transcript
 -> existing composer draft or existing send(text)
 -> existing AiChatV2 stream
 -> assistant text
 -> local TTS playback
```

## 7. Product Requirements

### 7.1 Voice Input Entry Point

`AiChatV2Composer.vue` must add a microphone icon button near the existing attachment/send controls.

Required behavior:

- Hidden when voice input is disabled in settings.
- Disabled while chat is streaming, attachments are processing, or STT is already running.
- Click once to start recording.
- Click again to stop recording.
- Show visible recording state.
- Show transcribing state after recording stops.
- Return transcript text to the composer.

Default MVP behavior:

- Insert transcript into the composer draft for user review.
- Do not auto-send unless the user enables auto-send in voice settings.

### 7.2 Push-To-Talk MVP

The first release should implement push-to-talk rather than always-listening voice input.

Requirements:

- User explicitly starts recording.
- User explicitly stops recording, or recording stops at the maximum duration.
- Maximum recording duration defaults to 60 seconds.
- If no speech is detected or transcript is empty, do not send a message.
- Show a clear error if microphone permission is denied.

### 7.3 Local STT

Local STT must use `sherpa-onnx`.

Requirements:

- STT runs in a child process or Electron utility process, not in renderer or main.
- Renderer records microphone audio with browser media APIs.
- Main process coordinates IPC between renderer and speech worker.
- Worker receives audio data and returns transcript text.
- Worker does not access SQLite, TypeORM, token storage, or chat history.
- Worker can cache loaded STT model in memory for reuse.
- Worker reports readiness, model loading progress, and failure state.

Supported MVP modes:

- Non-streaming transcription after recording stops.

Future mode:

- Streaming partial transcripts while the user is speaking.

### 7.4 Transcript Review And Send

After STT succeeds:

- If auto-send is disabled, populate the composer draft with the transcript.
- If the draft already has text, append transcript with a separating space or newline.
- If auto-send is enabled, emit the existing `send(text, files)` event with transcript text.
- If attached files are selected, preserve existing file attachment behavior.

The transcript must become a normal user message in chat history. The app does not need a separate audio-message entity in the MVP.

### 7.5 Spoken Assistant Responses

AiChatV2 must support reading assistant responses aloud.

Requirements:

- Spoken responses are controlled by a user setting.
- Default should be off unless product decides voice mode should opt users in during onboarding.
- Optionally auto-speak only when the user sent the message by voice.
- User can stop current speech playback.
- Starting a new voice input or new chat request stops current speech playback.
- Switching conversations stops current speech playback.
- Clicking chat stop cancels both LLM streaming and queued TTS playback.

### 7.6 Local TTS

Local TTS must use `sherpa-onnx`.

Requirements:

- TTS runs in a child process or Electron utility process.
- TTS worker accepts plain text chunks and returns playable audio data or a temporary audio file reference.
- TTS worker must not access the database.
- TTS model should stay loaded for reuse after first use.
- Renderer owns audio playback queue and UI controls.
- Main process owns worker lifecycle and path validation for any temporary files.

MVP output options:

- Return WAV/PCM data to renderer for playback through `AudioContext`, or
- Write a temporary WAV file and return a safe local path or object URL.

The implementation should choose the simpler reliable path after technical validation.

### 7.7 Sentence-Level Playback

The assistant response should be spoken sentence-by-sentence where practical.

Required behavior:

- Buffer streamed assistant tokens.
- Flush to TTS when a sentence boundary is detected.
- Preserve display streaming exactly as today.
- Queue generated audio in original order.
- Continue generating audio while previous chunk is playing.

Sentence boundaries:

- `.`
- `?`
- `!`
- newline after a meaningful phrase
- language-specific punctuation such as `。`, `？`, `！`

Fallback behavior:

- If sentence chunking is unreliable, wait until the assistant message completes and then synthesize the final text.

### 7.8 Speech Text Sanitization

Before sending assistant text to TTS, the app must prepare it for speech.

Do not speak:

- fenced code blocks
- inline JSON/code-heavy snippets when they are too long
- markdown tables
- tool call details
- tool result payloads
- permission prompts
- file operation summaries
- artifact HTML/CSS/JS
- hidden metadata

The app should speak concise natural language content only.

Recommended helper:

```ts
function prepareTextForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_>~]/g, "")
    .trim();
}
```

The final implementation should strengthen this helper with tests.

### 7.9 Voice Settings

Add voice settings under the existing AI provider or chat settings area.

Required settings:

| Setting | Type | Default |
| --- | --- | --- |
| Enable voice input | boolean | false |
| Enable spoken responses | boolean | false |
| Auto-send voice transcript | boolean | false |
| Speak only after voice input | boolean | true |
| STT language | select | app language or auto |
| TTS language | select | app language or auto |
| TTS voice/model | select | default bundled voice |
| Speech speed | number/slider | 1.0 |
| Max recording duration | number | 60 seconds |

Settings must persist through the existing Token/settings mechanism where appropriate.

### 7.10 Model Management

The app must expose speech model availability clearly.

Requirements:

- Detect whether required sherpa-onnx STT/TTS runtime is available.
- Detect whether configured STT/TTS model files are available.
- Show missing model state with a clear action or installation guidance.
- Avoid downloading large speech models without user consent.
- Validate model paths before passing them to workers.
- Support future model catalog entries for multiple languages and voices.

MVP model policy:

- Start with one recommended STT model and one recommended TTS voice.
- Add additional languages/voices after the integration is stable.

### 7.11 Permissions

Voice input requires microphone permission.

Requirements:

- Request microphone access only when the user starts recording or enables voice input.
- Handle Electron media permission request/check paths explicitly.
- Surface permission-denied state in the composer.
- Do not request camera permission.
- Do not keep recording after the UI indicates recording has stopped.

### 7.12 Privacy

Local voice mode must be privacy-preserving.

Requirements:

- Raw audio is processed locally by default.
- Raw audio is not persisted by default.
- Transcript text is stored as normal chat text because it is the canonical user message.
- Temporary audio files must be cleaned up.
- If diagnostics/logging are added, logs must not include raw audio or full transcripts unless user explicitly enables verbose diagnostics.

### 7.13 Entitlement And Provider Policy

Local voice input and local spoken responses should not require hosted AI entitlement by themselves.

Required policy:

- STT/TTS local processing can run when local speech is enabled and configured.
- Sending the transcript to AiChatV2 still uses the existing chat availability resolver.
- If chat is unavailable, the app can transcribe locally but must not submit the message to AI chat.
- Any hosted fallback STT/TTS endpoint, if added later, must be gated before request parsing and before network work.

### 7.14 Internationalization

All new user-facing UI text must be translated in:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Required translation groups:

- Composer microphone labels
- Recording/transcribing/speaking statuses
- Voice settings labels
- Permission errors
- Missing model errors
- STT/TTS runtime errors
- Stop playback controls

## 8. Technical Architecture

### 8.1 Process Boundaries

Required architecture:

```text
Renderer
  - microphone UI
  - MediaRecorder capture
  - composer draft updates
  - audio playback queue

Main process
  - IPC handlers
  - chat availability checks
  - speech worker lifecycle
  - model path validation
  - temporary file cleanup coordination

Speech worker in src/childprocess/
  - load sherpa-onnx STT/TTS models
  - transcribe audio
  - synthesize speech
  - return text/audio results
  - no database access
```

### 8.2 Proposed IPC Channels

Add constants in `src/config/channellist.ts`:

```ts
export const AI_CHAT_V2_VOICE_STATUS = "ai-chat-v2:voice-status";
export const AI_CHAT_V2_VOICE_TRANSCRIBE = "ai-chat-v2:voice-transcribe";
export const AI_CHAT_V2_VOICE_TTS = "ai-chat-v2:voice-tts";
export const AI_CHAT_V2_VOICE_CANCEL = "ai-chat-v2:voice-cancel";
```

Channel behavior:

- `voice-status`: returns runtime/model availability.
- `voice-transcribe`: accepts bounded audio payload metadata and audio content reference.
- `voice-tts`: accepts sanitized text and TTS options.
- `voice-cancel`: cancels active STT/TTS work where supported.

### 8.3 Renderer API Wrapper

Add voice helpers near `src/views/api/aiChatV2.ts` or in a dedicated `src/views/api/aiChatV2Voice.ts`:

```ts
getVoiceStatus(): Promise<VoiceRuntimeStatus>
transcribeVoice(request: VoiceTranscribeRequest): Promise<VoiceTranscribeResponse>
synthesizeVoice(request: VoiceTtsRequest): Promise<VoiceTtsResponse>
cancelVoiceJob(jobId: string): Promise<void>
```

Prefer a dedicated `aiChatV2Voice.ts` file if the implementation grows beyond simple wrappers.

### 8.4 Worker Placement

Worker-specific code must live under:

```text
src/childprocess/ai-chat-voice/
```

Recommended files:

```text
src/childprocess/ai-chat-voice/AiChatVoiceWorker.ts
src/childprocess/ai-chat-voice/SherpaSttService.ts
src/childprocess/ai-chat-voice/SherpaTtsService.ts
src/childprocess/ai-chat-voice/VoiceJobQueue.ts
src/childprocess/ai-chat-voice/voiceWorkerTypes.ts
```

If a new worker entry point is added, update `forge.config.js` and add the matching Vite worker config.

### 8.5 Data Types

Add explicit TypeScript interfaces. Do not use `any`.

Recommended shared types:

```ts
export interface VoiceRuntimeStatus {
  sttAvailable: boolean;
  ttsAvailable: boolean;
  sttModelLoaded: boolean;
  ttsModelLoaded: boolean;
  errorMessage?: string;
}

export interface VoiceTranscribeRequest {
  audioBase64: string;
  mimeType: string;
  language?: string;
  conversationId?: string;
}

export interface VoiceTranscribeResponse {
  transcript: string;
  language?: string;
  durationMs?: number;
}

export interface VoiceTtsRequest {
  text: string;
  language?: string;
  voiceId?: string;
  speed?: number;
  conversationId?: string;
}

export interface VoiceTtsResponse {
  audioBase64?: string;
  mimeType: "audio/wav";
  durationMs?: number;
}
```

If audio payloads are too large for IPC, use a temporary file path created by the main process instead of base64.

### 8.6 AI Chat Integration

Do not change `ChatV2StreamRequest` for the MVP.

Voice input integration should call the existing send path with transcript text:

```text
transcript -> onSend(transcript, selectedFiles)
```

Spoken response integration should observe assistant message text from the existing stream chunk handling in `AiChatV2.vue`.

Recommended local controller in renderer:

```text
src/views/components/aiChatV2/voice/
  SpeechResponseController.ts
  SpeechTextSanitizer.ts
  VoicePlaybackQueue.ts
```

## 9. UX Requirements

### 9.1 Composer States

The composer must handle:

- Idle
- Recording
- Transcribing
- Transcript ready
- Transcription failed
- Speaking
- Speech playback stopped
- Voice unavailable
- Microphone permission denied

### 9.2 Controls

Required controls:

- Microphone icon button
- Stop recording button or toggled microphone button
- Stop speaking button when playback is active
- Voice settings entry point

Use existing Vuetify icon-button patterns.

Suggested icons:

- `mdi-microphone`
- `mdi-microphone-off`
- `mdi-stop`
- `mdi-volume-high`
- `mdi-volume-off`

### 9.3 Feedback

The UI should show short, inline feedback:

- "Recording..."
- "Transcribing..."
- "Microphone permission denied"
- "Voice model not installed"
- "Speaking..."

Do not use long instructional text inside the chat surface.

### 9.4 Accessibility

Requirements:

- All voice controls need `aria-label`.
- Recording state must not be represented by color only.
- Stop controls must be keyboard accessible.
- Spoken response should not automatically start unless the user enabled it.

## 10. Performance Requirements

1. Opening AiChatV2 must not load speech models unless voice is enabled or requested.
2. First STT/TTS use may show loading state.
3. Subsequent STT/TTS calls should reuse loaded models.
4. The renderer must remain responsive during model loading and inference.
5. Recording payload must be capped by duration and size.
6. TTS chunks should be bounded to avoid long blocking synthesis calls.
7. Worker crashes must not crash the app.

Target MVP performance:

- 5-20 second voice messages should transcribe within an acceptable interactive delay on a typical desktop.
- Spoken response should start after the first complete sentence when sentence-level TTS is enabled, or after the final response in fallback mode.

## 11. Error Handling

Required errors:

- Microphone permission denied
- No microphone found
- Recording failed
- Audio payload too large
- STT runtime unavailable
- STT model missing
- STT failed
- TTS runtime unavailable
- TTS model missing
- TTS failed
- Voice worker crashed
- Chat unavailable after transcription

Errors should be shown in the composer or snackbar with concise translated messages.

## 12. Security Requirements

1. Validate all IPC payloads before use.
2. Reject audio payloads over configured limits.
3. Validate MIME types.
4. Do not expose arbitrary file paths from worker to renderer.
5. If temporary files are used, create them in an app-owned temp directory.
6. Clean temporary files after playback or on app shutdown.
7. Do not log raw audio payloads.
8. Do not let worker code access database models.
9. Keep AI availability checks at the start of any hosted AI fallback handler.

## 13. Rollout Plan

### Phase 1: Local Voice Input MVP

Scope:

- Microphone button in composer.
- Push-to-talk recording.
- Local sherpa-onnx STT worker.
- Transcript inserted into draft.
- Voice settings for enable input, language, max duration.
- Missing model and permission errors.

Acceptance:

- User can speak a short message and see transcript in composer.
- User can edit transcript before sending.
- No raw audio is persisted.
- UI remains responsive during transcription.

### Phase 2: Auto-Send Voice Messages

Scope:

- Auto-send setting.
- Transcript confidence/error handling if supported by model.
- Stop/cancel active transcription.
- Preserve selected attachments when voice transcript is sent.

Acceptance:

- User can speak and have transcript submitted automatically when enabled.
- Failed/empty transcripts do not submit.

### Phase 3: Local Spoken Responses

Scope:

- Local sherpa-onnx TTS worker.
- Speak final assistant response.
- Stop playback control.
- Speech text sanitizer.
- Voice settings for spoken responses, voice, language, speed.

Acceptance:

- Assistant text can be spoken locally.
- User can stop playback.
- Tool calls/code blocks are not read aloud.

### Phase 4: Sentence-Level Streaming Playback

Scope:

- Sentence boundary detection during token stream.
- TTS generation queue.
- Audio playback queue.
- Cancellation across queued and active chunks.

Acceptance:

- Spoken response starts before the full assistant answer completes.
- Chunks play in order.
- Stop cancels queued and active playback.

### Phase 5: Model Catalog And Installation Flow

Scope:

- Built-in recommended STT/TTS model catalog.
- Model download/import UI.
- Model validation.
- Multi-language model selection.

Acceptance:

- User can see which voice models are installed.
- User can install or select models without manual file editing.

## 14. Test Plan

### 14.1 Unit Tests

- Speech text sanitizer removes code blocks, markdown links, markdown syntax, and empty output.
- Sentence boundary detection handles English and CJK punctuation.
- Voice settings default resolution.
- IPC request validation rejects oversized and invalid audio payloads.
- Worker message parser handles malformed messages safely.

### 14.2 Main Process Tests

Place tests under `test/vitest/main/`.

Cover:

- Voice IPC handlers register expected channels.
- Voice status returns unavailable state when models are missing.
- Voice transcription handler rejects invalid payloads.
- Hosted fallback handlers, if added, gate AI enablement before parsing request data.
- Worker crash returns a safe error response.

### 14.3 Component Tests

Place tests under `test/vitest/main/components/` if matching existing component test setup.

Cover:

- Microphone button hidden/disabled based on state.
- Recording state renders.
- Transcript populates composer draft.
- Auto-send emits existing `send` event.
- Stop speaking button appears during playback.

### 14.4 Manual QA

Required manual paths:

- Enable voice input and record a short message.
- Deny microphone permission and verify error.
- Record silence and verify no message is sent.
- Transcribe, edit transcript, send.
- Enable auto-send and verify transcript sends.
- Enable spoken responses and verify assistant response plays.
- Stop chat stream and verify speech stops.
- Switch conversation and verify speech stops.
- Test at least English and one CJK punctuation sentence boundary path.

## 15. Open Questions

1. Which exact sherpa-onnx STT model should be bundled or recommended first?
2. Which exact sherpa-onnx TTS voice should be bundled or recommended first?
3. Should the app download models automatically after user consent, or require manual model import in the first release?
4. Should local voice features be available to all users, or tied to the existing local AI provider enablement setting?
5. Should the default spoken response behavior be "speak only after voice input" or "speak every assistant response"?
6. Should temporary TTS audio be transported as base64 over IPC or played from app-owned temporary WAV files?

## 16. Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Speech models increase installer size | Do not bundle large models initially; add explicit model install/import flow. |
| Local inference freezes UI | Run STT/TTS in `src/childprocess/` worker and cache models there. |
| First model load feels slow | Show loading state and keep worker warm after first use. |
| TTS reads code/tool noise | Sanitize text and only speak assistant natural-language message content. |
| IPC audio payload too large | Cap duration/size and switch to temp-file transport if needed. |
| Worker tries to use database | Enforce no DB imports in worker code and keep CRUD in main process modules. |
| Microphone permission confusion | Request permission only on explicit user action and show clear denied state. |
| Multi-language quality varies | Start with limited recommended models and expose language/model selection later. |

## 17. Success Metrics

1. Users can complete a voice-to-text chat turn without using a hosted transcription endpoint.
2. Users can hear assistant responses locally without using a hosted TTS endpoint.
3. Voice input does not regress existing typed chat, attachments, model selection, tool approval, or plan mode.
4. No raw audio is persisted by default.
5. STT/TTS worker failures are recoverable without restarting the app.
6. All new user-facing strings have translations in every supported language.
