# Local sherpa-onnx Voice Chat - Technical Design

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Created date | 2026-07-20 |
| Status | Draft |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/local-sherpa-onnx-voice-chat-prd.md` |
| Primary code paths | `src/views/components/aiChatV2/AiChatV2.vue`, `src/views/components/aiChatV2/AiChatV2Composer.vue`, `src/views/api/aiChatV2.ts`, `src/main-process/communication/ai-chat-v2-ipc.ts`, `src/config/channellist.ts`, `src/config/usersetting.ts`, `src/childprocess/ai-chat-voice/` |

---

## 1. Purpose

This document translates the local sherpa-onnx voice chat PRD into an implementation-facing technical design.

The feature adds two local speech capabilities to AiChatV2:

1. Speech-to-text (STT): microphone audio becomes normal composer text.
2. Text-to-speech (TTS): assistant text becomes local spoken audio.

The core design decision is text-first integration:

```text
Voice input
  -> local STT transcript
  -> existing AiChatV2 send(text, files)
  -> existing chat stream
  -> assistant text
  -> local TTS playback
```

The LLM never receives raw audio in the MVP. Chat history stores the transcript and assistant text exactly like typed chat. This keeps tool calling, plan mode, workspace context, attachment handling, stream recovery, and conversation history on the current AiChatV2 path.

## 2. Current Behavior To Preserve

### 2.1 Existing AiChatV2 Send Path

`AiChatV2Composer.vue` currently owns draft text, selected files, and the `send` event:

```text
AiChatV2Composer.vue
  -> emit("send", text, files)
  -> AiChatV2.vue:onSend()
  -> ChatV2StreamRequest.message
  -> streamChatV2Message()
  -> AI_CHAT_V2_STREAM
```

Voice input must feed this same path. It should not create a parallel chat request type.

### 2.2 Existing AI Chat Gate

`ai-chat-v2-ipc.ts` checks chat availability before parsing stream request payloads. That rule stays intact.

Local STT/TTS processing does not by itself require hosted AI entitlement. Sending a transcribed message still uses the existing AiChatV2 chat availability resolver.

### 2.3 Existing Worker Boundary Rule

Worker-specific code belongs under `src/childprocess/`.

The local voice worker must not:

- import TypeORM
- import database Models
- import Modules that initialize database connections
- read or write SQLite
- access token storage directly
- call hosted AI APIs

The main process owns IPC, settings lookup, model path validation, worker lifecycle, and temporary file cleanup.

### 2.4 Existing Local Worker Pattern

The implementation should follow the local embedding worker shape:

```text
src/service/embedding/LocalEmbeddingWorkerClient.ts
src/childprocess/embedding/LocalEmbeddingWorker.ts
src/childprocess/embedding/LocalEmbeddingWorkerTypes.ts
src/schemas/worker/localEmbedding.ts
vite.localEmbeddingWorker.config.mjs
forge.config.js plugin entry
```

Voice should use the same conventions:

- `utilityProcess.fork`
- JSON-stringified worker messages
- request ids
- per-request timeouts
- explicit `initialize -> ready` handshake
- Zod validation at process boundaries
- worker restart after crash
- singleton worker client in production

## 3. Target Architecture

### 3.1 Component Overview

```text
Renderer
  AiChatV2Composer.vue
    - microphone button
    - MediaRecorder capture
    - transcript insertion
    - auto-send option

  AiChatV2.vue
    - marks whether latest user turn came from voice
    - observes assistant stream chunks
    - passes assistant text to speech controller
    - cancels speech on stop/new conversation/unmount

  voice helpers
    - BrowserVoiceRecorder
    - SpeechResponseController
    - VoicePlaybackQueue
    - SpeechTextSanitizer

Preload-safe renderer API
  src/views/api/aiChatV2Voice.ts
    - getVoiceStatus()
    - transcribeVoice()
    - synthesizeVoice()
    - cancelVoiceJob()

Main process
  ai-chat-v2-voice-ipc.ts or ai-chat-v2-ipc.ts section
    - voice status handler
    - transcription handler
    - TTS handler
    - cancellation handler
    - permission and payload validation

Service layer
  AiChatVoiceModule
    - settings resolution
    - model catalog/status
    - delegates STT/TTS to worker client
    - no chat database writes

  SherpaVoiceWorkerClient
    - utilityProcess lifecycle
    - request routing
    - timeout/crash handling
    - model initialize/ready handshake

Worker
  src/childprocess/ai-chat-voice/AiChatVoiceWorker.ts
    - loads sherpa-onnx
    - runs STT
    - runs TTS
    - returns transcript/audio
    - no database access
```

### 3.2 Runtime Flow: Voice Input

```text
User clicks microphone
  -> Composer requests microphone with getUserMedia({ audio: true })
  -> BrowserVoiceRecorder starts MediaRecorder
  -> User stops recording or max duration expires
  -> Renderer converts Blob to ArrayBuffer/base64
  -> transcribeVoice({ audioBase64, mimeType, language })
  -> Main validates payload and settings
  -> SherpaVoiceWorkerClient.ensureReady("stt", model)
  -> Worker transcribes audio
  -> Main returns transcript
  -> Composer inserts transcript into draft
  -> Optional auto-send calls existing send(text, files)
```

### 3.3 Runtime Flow: Spoken Response

```text
User sends message
  -> AiChatV2 records latestInputSource = "voice" or "text"
  -> Existing chat stream starts
  -> Assistant tokens render normally
  -> SpeechResponseController buffers assistant text
  -> Sentence boundary detector flushes natural-language sentence
  -> synthesizeVoice({ text, language, voiceId, speed })
  -> Worker returns WAV audio
  -> VoicePlaybackQueue plays chunks in order
  -> Stop/new conversation/unmount cancels queue and worker job
```

If sentence-level synthesis fails or is disabled, the controller waits for the final assistant message and synthesizes once.

## 4. Proposed File Layout

### 4.1 New Files

```text
src/entityTypes/aiChatVoiceTypes.ts
src/views/api/aiChatV2Voice.ts
src/views/components/aiChatV2/voice/BrowserVoiceRecorder.ts
src/views/components/aiChatV2/voice/SpeechResponseController.ts
src/views/components/aiChatV2/voice/SpeechTextSanitizer.ts
src/views/components/aiChatV2/voice/SentenceChunker.ts
src/views/components/aiChatV2/voice/VoicePlaybackQueue.ts
src/main-process/communication/ai-chat-v2-voice-ipc.ts
src/modules/AiChatVoiceModule.ts
src/service/aiChatVoice/SherpaVoiceWorkerClient.ts
src/service/aiChatVoice/VoiceModelCatalogService.ts
src/childprocess/ai-chat-voice/AiChatVoiceWorker.ts
src/childprocess/ai-chat-voice/SherpaSttService.ts
src/childprocess/ai-chat-voice/SherpaTtsService.ts
src/childprocess/ai-chat-voice/AiChatVoiceWorkerTypes.ts
src/schemas/worker/aiChatVoice.ts
vite.aiChatVoiceWorker.config.mjs
```

### 4.2 Modified Files

```text
src/config/channellist.ts
src/config/usersetting.ts
src/preload.ts
src/main-process/communication/index or registration site
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/AiChatV2Composer.vue
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
forge.config.js
package.json
yarn.lock
```

`package.json` changes depend on the chosen sherpa-onnx package and model delivery approach.

## 5. Data Contracts

### 5.1 Settings Types

Create shared view/runtime settings in `src/entityTypes/aiChatVoiceTypes.ts`.

```typescript
export type AiChatVoiceInputMode = "disabled" | "push_to_talk";
export type AiChatVoiceTtsMode = "disabled" | "after_voice_input" | "all_assistant_messages";

export interface AiChatVoiceSettingsView {
  inputMode: AiChatVoiceInputMode;
  ttsMode: AiChatVoiceTtsMode;
  autoSendTranscript: boolean;
  sttLanguage: string;
  ttsLanguage: string;
  sttModelId: string;
  ttsModelId: string;
  ttsVoiceId?: string;
  ttsSpeed: number;
  maxRecordingMs: number;
}
```

### 5.2 Runtime Status Types

```typescript
export type AiChatVoiceRuntimeState =
  | "unavailable"
  | "missing_model"
  | "loading"
  | "ready"
  | "error";

export interface AiChatVoiceRuntimeStatus {
  sttState: AiChatVoiceRuntimeState;
  ttsState: AiChatVoiceRuntimeState;
  sttModelId?: string;
  ttsModelId?: string;
  sttModelPath?: string;
  ttsModelPath?: string;
  errorMessage?: string;
}
```

Do not expose arbitrary user filesystem paths to the renderer unless they are already user-selected settings. Prefer display labels in UI.

### 5.3 Renderer IPC Request Types

```typescript
export interface AiChatVoiceTranscribeRequest {
  audioBase64: string;
  mimeType: string;
  language?: string;
  conversationId?: string;
}

export interface AiChatVoiceTranscribeResponse {
  transcript: string;
  language?: string;
  durationMs?: number;
}

export interface AiChatVoiceTtsRequest {
  text: string;
  language?: string;
  modelId?: string;
  voiceId?: string;
  speed?: number;
  conversationId?: string;
}

export interface AiChatVoiceTtsResponse {
  audioBase64: string;
  mimeType: "audio/wav";
  durationMs?: number;
}
```

### 5.4 Worker Protocol Types

Create `src/childprocess/ai-chat-voice/AiChatVoiceWorkerTypes.ts`.

```typescript
export const AI_CHAT_VOICE_MAX_AUDIO_BYTES = 12 * 1024 * 1024;
export const AI_CHAT_VOICE_MAX_TTS_CHARS = 1_200;
export const AI_CHAT_VOICE_REQUEST_TIMEOUT_MS = 120_000;

export interface AiChatVoiceInitializeMessage {
  type: "initialize";
  requestId: string;
  sttModelPath?: string;
  ttsModelPath?: string;
  sttLanguage?: string;
  ttsLanguage?: string;
}

export interface AiChatVoiceTranscribeMessage {
  type: "transcribe";
  requestId: string;
  audioBase64: string;
  mimeType: string;
  language?: string;
}

export interface AiChatVoiceSynthesizeMessage {
  type: "synthesize";
  requestId: string;
  text: string;
  language?: string;
  voiceId?: string;
  speed?: number;
}

export interface AiChatVoiceCancelMessage {
  type: "cancel";
  requestId: string;
  targetRequestId?: string;
}

export interface AiChatVoiceShutdownMessage {
  type: "shutdown";
  requestId: string;
}

export type AiChatVoiceInboundMessage =
  | AiChatVoiceInitializeMessage
  | AiChatVoiceTranscribeMessage
  | AiChatVoiceSynthesizeMessage
  | AiChatVoiceCancelMessage
  | AiChatVoiceShutdownMessage;
```

Outbound:

```typescript
export interface AiChatVoiceReadyMessage {
  type: "ready";
  requestId: string;
  sttAvailable: boolean;
  ttsAvailable: boolean;
}

export interface AiChatVoiceTranscribeResultMessage {
  type: "transcribe-result";
  requestId: string;
  transcript: string;
  language?: string;
  durationMs?: number;
}

export interface AiChatVoiceSynthesizeResultMessage {
  type: "synthesize-result";
  requestId: string;
  audioBase64: string;
  mimeType: "audio/wav";
  durationMs?: number;
}

export interface AiChatVoiceErrorMessage {
  type: "error";
  requestId: string;
  error: string;
}

export type AiChatVoiceOutboundMessage =
  | AiChatVoiceReadyMessage
  | AiChatVoiceTranscribeResultMessage
  | AiChatVoiceSynthesizeResultMessage
  | AiChatVoiceErrorMessage;
```

## 6. IPC Channels

Add these constants to `src/config/channellist.ts`:

```typescript
export const AI_CHAT_V2_VOICE_STATUS = "ai-chat-v2:voice-status";
export const AI_CHAT_V2_VOICE_TRANSCRIBE = "ai-chat-v2:voice-transcribe";
export const AI_CHAT_V2_VOICE_TTS = "ai-chat-v2:voice-tts";
export const AI_CHAT_V2_VOICE_CANCEL = "ai-chat-v2:voice-cancel";
export const AI_CHAT_V2_VOICE_GET_SETTINGS = "ai-chat-v2:voice-get-settings";
export const AI_CHAT_V2_VOICE_SET_SETTINGS = "ai-chat-v2:voice-set-settings";
```

### 6.1 Handler Behavior

| Channel | Handler type | Returns | Notes |
| --- | --- | --- | --- |
| `AI_CHAT_V2_VOICE_STATUS` | `ipcMain.handle` | `CommonMessage<AiChatVoiceRuntimeStatus>` | No audio payload. Safe to call from settings and composer. |
| `AI_CHAT_V2_VOICE_TRANSCRIBE` | `ipcMain.handle` | `CommonMessage<AiChatVoiceTranscribeResponse>` | Validates settings, MIME type, and payload size before worker call. |
| `AI_CHAT_V2_VOICE_TTS` | `ipcMain.handle` | `CommonMessage<AiChatVoiceTtsResponse>` | Validates sanitized text length before worker call. |
| `AI_CHAT_V2_VOICE_CANCEL` | `ipcMain.handle` | `CommonMessage<{ ok: boolean }>` | Best-effort cancellation of pending worker work. |
| `AI_CHAT_V2_VOICE_GET_SETTINGS` | `ipcMain.handle` | `CommonMessage<AiChatVoiceSettingsView>` | Reads Token/settings through module. |
| `AI_CHAT_V2_VOICE_SET_SETTINGS` | `ipcMain.handle` | `CommonMessage<AiChatVoiceSettingsView>` | Validates and persists settings. |

### 6.2 Preload Allowlist

Update `src/preload.ts` so the new channels are available through existing safe wrappers.

Required:

- Add voice channels to invoke allowlist.
- Do not add send/listener exposure for arbitrary channels.
- Do not expose worker internals to renderer.

## 7. Settings Storage

Add keys to `src/config/usersetting.ts`:

```typescript
export const AI_CHAT_VOICE_INPUT_MODE = "ai_chat_voice_input_mode";
export const AI_CHAT_VOICE_TTS_MODE = "ai_chat_voice_tts_mode";
export const AI_CHAT_VOICE_AUTO_SEND = "ai_chat_voice_auto_send";
export const AI_CHAT_VOICE_STT_LANGUAGE = "ai_chat_voice_stt_language";
export const AI_CHAT_VOICE_TTS_LANGUAGE = "ai_chat_voice_tts_language";
export const AI_CHAT_VOICE_STT_MODEL_ID = "ai_chat_voice_stt_model_id";
export const AI_CHAT_VOICE_TTS_MODEL_ID = "ai_chat_voice_tts_model_id";
export const AI_CHAT_VOICE_TTS_VOICE_ID = "ai_chat_voice_tts_voice_id";
export const AI_CHAT_VOICE_TTS_SPEED = "ai_chat_voice_tts_speed";
export const AI_CHAT_VOICE_MAX_RECORDING_MS = "ai_chat_voice_max_recording_ms";
```

Defaults:

```typescript
const DEFAULT_VOICE_SETTINGS: AiChatVoiceSettingsView = {
  inputMode: "disabled",
  ttsMode: "disabled",
  autoSendTranscript: false,
  sttLanguage: "auto",
  ttsLanguage: "auto",
  sttModelId: "sherpa-onnx:stt:auto",
  ttsModelId: "sherpa-onnx:tts:auto",
  ttsSpeed: 1,
  maxRecordingMs: 60_000,
};
```

`AiChatVoiceModule` should own conversion between Token string values and typed settings.

## 8. Main Process Design

### 8.1 `AiChatVoiceModule`

Create `src/modules/AiChatVoiceModule.ts`.

Responsibilities:

- Read and write voice settings.
- Validate voice settings.
- Resolve selected model ids to app-owned model paths.
- Return voice runtime status.
- Call `SherpaVoiceWorkerClient.transcribe()`.
- Call `SherpaVoiceWorkerClient.synthesize()`.
- Cancel active jobs.
- Normalize errors into user-safe messages.

It should not:

- store chat messages
- read chat history
- call LLM APIs
- perform audio inference itself

### 8.2 IPC Handler Placement

Prefer a new file:

```text
src/main-process/communication/ai-chat-v2-voice-ipc.ts
```

This keeps speech payload validation out of the already large `ai-chat-v2-ipc.ts`.

Register it from the same communication bootstrap used by other IPC modules.

### 8.3 Payload Validation

Use Zod schemas for renderer-to-main payloads if the project already has nearby validation helpers. Otherwise, use explicit type guards with no `any`.

Validation requirements:

- `audioBase64` is non-empty.
- decoded audio size <= configured max.
- `mimeType` is in allowlist.
- `language`, if present, is a bounded string.
- `conversationId`, if present, is a bounded string.
- TTS text is non-empty after trim.
- TTS text length <= `AI_CHAT_VOICE_MAX_TTS_CHARS`.
- `speed` is clamped to a safe range, for example `0.5 <= speed <= 2.0`.

MVP MIME allowlist:

```typescript
const AI_CHAT_VOICE_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp4",
]);
```

If sherpa-onnx requires WAV/PCM, convert audio before calling the worker. Keep conversion in main/worker, not in Vue.

## 9. Worker Client Design

### 9.1 `SherpaVoiceWorkerClient`

Create `src/service/aiChatVoice/SherpaVoiceWorkerClient.ts`.

Mirror `LocalEmbeddingWorkerClient`:

- singleton `getInstance()`
- test factory with fake fork
- `dispose()`
- `getStatus()`
- `transcribe(request)`
- `synthesize(request)`
- `cancel(targetRequestId)`
- worker path resolution across dev/prod
- request map with timeout
- crash handling rejects all pending requests
- `initialize` handshake before first request

### 9.2 Worker Path Resolution

Resolve these candidates:

```text
path.join(__dirname, "childprocess", "AiChatVoiceWorker.js")
path.join(__dirname, "../childprocess", "AiChatVoiceWorker.js")
path.join(process.cwd(), "dist/childprocess", "AiChatVoiceWorker.js")
path.join(process.cwd(), ".vite/build/childprocess", "AiChatVoiceWorker.js")
```

If the built worker file is missing, throw a clear error:

```text
Local voice worker is not built. Run yarn dev or yarn make to build AiChatVoiceWorker.
```

### 9.3 Environment

Fork with:

```typescript
utilityProcess.fork(workerPath, [], {
  stdio: "pipe",
  env: {
    ...process.env,
    NODE_OPTIONS: "",
    WORKER_TYPE: "ai-chat-voice",
  },
});
```

Set `WORKER_TYPE` so database guards can block accidental Model access.

## 10. Worker Design

### 10.1 `AiChatVoiceWorker.ts`

Responsibilities:

- Parse inbound JSON.
- Validate inbound message using `aiChatVoiceInboundSchema`.
- Initialize STT/TTS services lazily.
- Route `transcribe` and `synthesize` requests.
- Return JSON outbound messages.
- On uncaught errors, return safe error strings.
- Shut down cleanly on `shutdown`.

### 10.2 `SherpaSttService`

Responsibilities:

- Load selected sherpa-onnx STT model.
- Cache recognizer/session.
- Decode or receive normalized audio.
- Run non-streaming transcription for MVP.
- Return transcript and detected/provided language if available.

Open implementation point:

- Validate whether the selected sherpa-onnx Node package can consume WebM/Opus directly.
- If not, add audio conversion to WAV/16 kHz mono PCM.

### 10.3 `SherpaTtsService`

Responsibilities:

- Load selected sherpa-onnx TTS model.
- Cache synthesizer/session.
- Apply voice id and speed when supported.
- Return WAV audio bytes as base64.

The worker should return `audio/wav` for MVP because it is simple to play and debug.

### 10.4 Model Loading

Use lazy loading:

- Do not load STT/TTS models at app startup.
- Load STT on first transcription.
- Load TTS on first synthesis.
- Keep loaded sessions in worker memory.
- Reset/reload only when selected model changes.

## 11. Audio Capture Design

### 11.1 `BrowserVoiceRecorder`

Create `src/views/components/aiChatV2/voice/BrowserVoiceRecorder.ts`.

Responsibilities:

- Request microphone stream with `navigator.mediaDevices.getUserMedia({ audio: true })`.
- Select a supported `MediaRecorder` MIME type.
- Start/stop recording.
- Enforce max recording duration.
- Stop all media tracks after recording.
- Return a `Blob` plus metadata.

Suggested MIME selection:

```typescript
const CANDIDATE_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/wav",
];
```

Use `MediaRecorder.isTypeSupported(type)` before selecting a type.

### 11.2 Composer Integration

`AiChatV2Composer.vue` changes:

- Add props:

```typescript
voiceInputEnabled?: boolean;
voiceRecording?: boolean;
voiceProcessing?: boolean;
voiceError?: string | null;
```

- Add emits:

```typescript
(e: "voice-start"): void;
(e: "voice-stop"): void;
```

Alternative:

- Keep recorder inside composer and emit `voice-transcript`.

Preferred:

- Keep recorder orchestration in `AiChatV2.vue`, because auto-send and speech playback need conversation-level state.
- Composer remains a UI component with a `setDraftText()` exposed method or a `draftText` prop/model.

If exposing composer internals becomes awkward, add a controlled `modelValue` draft prop in a small refactor.

## 12. Spoken Response Design

### 12.1 `SpeechResponseController`

Create a renderer-side controller class:

```text
src/views/components/aiChatV2/voice/SpeechResponseController.ts
```

Responsibilities:

- Accept assistant token deltas.
- Track active assistant message id.
- Ignore non-text stream events.
- Use `SentenceChunker` to emit chunks.
- Call `synthesizeVoice()` for each chunk.
- Push audio to `VoicePlaybackQueue`.
- Cancel active/queued TTS on demand.
- Flush remaining text when assistant response completes.

### 12.2 Speak Policy

Policy inputs:

- `settings.ttsMode`
- latest input source: `"voice"` or `"text"`
- current message type
- whether assistant content is natural language

Rules:

```text
ttsMode = disabled
  -> never speak

ttsMode = after_voice_input
  -> speak only if latest user message came from voice

ttsMode = all_assistant_messages
  -> speak all normal assistant text responses
```

Never speak:

- tool call messages
- tool result messages
- permission prompts
- plan approval cards
- code-only assistant messages
- empty sanitized text

### 12.3 `SentenceChunker`

Chunking rules:

- Accumulate token deltas in a buffer.
- Emit when buffer has a sentence-ending punctuation mark and a minimum length.
- Support English and CJK punctuation.
- Do not emit inside fenced code blocks.
- Flush at completion.

Suggested constants:

```typescript
const MIN_TTS_CHUNK_CHARS = 24;
const MAX_TTS_CHUNK_CHARS = 600;
const SENTENCE_END_RE = /[.!?\u3002\uff1f\uff01](?:\\s|$)/;
```

### 12.4 `SpeechTextSanitizer`

The sanitizer should be tested independently.

Behavior:

- Remove fenced code blocks.
- Remove markdown tables.
- Convert markdown links to labels.
- Strip markdown control characters.
- Collapse whitespace.
- Limit chunk size.
- Return empty string for code-heavy or table-heavy output.

## 13. Playback Queue Design

### 13.1 `VoicePlaybackQueue`

Responsibilities:

- Convert WAV base64 to Blob URL or ArrayBuffer.
- Play audio chunks in order.
- Expose `isSpeaking`.
- Stop current audio.
- Clear queued audio.
- Revoke object URLs after playback.

Implementation options:

1. `HTMLAudioElement` with Blob URLs.
2. `AudioContext.decodeAudioData()` with scheduled buffers.

Prefer `HTMLAudioElement` for MVP. It is simpler and sufficient for queued sentence playback.

### 13.2 Cancellation

Cancel speech on:

- user clicks stop speaking
- user clicks chat stop
- user starts new recording
- user sends a new message
- active conversation changes
- component unmounts
- stream errors or cancellation

Cancellation should:

- pause current audio
- clear queue
- revoke object URLs
- call `cancelVoiceJob()` for active TTS request ids where possible

## 14. Model Catalog

### 14.1 MVP Catalog

Create `VoiceModelCatalogService`.

MVP responsibilities:

- Declare built-in logical model ids.
- Resolve model ids to app-owned model paths.
- Check if files exist.
- Return status to UI.

Example ids:

```text
sherpa-onnx:stt:auto
sherpa-onnx:tts:auto
```

Do not hard-code large model file paths across multiple files.

### 14.2 Installation Strategy

MVP can require manually installed/imported model files if bundling is not decided.

Future:

- model catalog UI
- download with user consent
- checksum validation
- per-language recommendations
- installed model list

### 14.3 Packaging Risk

Sherpa-onnx packages and model files may include native or ONNX runtime assets. The worker Vite config should externalize packages that fail bundling, similar to `vite.localEmbeddingWorker.config.mjs`.

`vite.aiChatVoiceWorker.config.mjs` should start from the local embedding worker config and adapt externals for sherpa-onnx.

## 15. Build Configuration

### 15.1 Vite Worker Config

Create `vite.aiChatVoiceWorker.config.mjs`.

Use:

- CJS output
- `dir: "dist/childprocess"`
- `entryFileNames: "AiChatVoiceWorker.js"`
- `ssr: true`
- alias `@ -> ./src`
- external native/ONNX packages as needed

### 15.2 Forge Config

Add plugin entry:

```javascript
{
  entry: "src/childprocess/ai-chat-voice/AiChatVoiceWorker.ts",
  config: "vite.aiChatVoiceWorker.config.mjs",
}
```

Keep the entry under `src/childprocess/`.

## 16. Electron Permission Handling

Voice input requires microphone permission.

Main process should configure Electron session permission handling for `media` permission if not already present.

Rules:

- Allow audio capture only for trusted app renderer origins.
- Deny video capture for this feature.
- Check `details.mediaType` when available.
- Do not broadly allow all media permissions.

Renderer should still handle rejected `getUserMedia()` calls because OS-level permission denial may happen before or outside app-level permission checks.

## 17. i18n Keys

Add keys under `aiChatV2.voice`.

Suggested English keys:

```typescript
voice: {
  microphone: "Voice input",
  start_recording: "Start recording",
  stop_recording: "Stop recording",
  recording: "Recording...",
  transcribing: "Transcribing...",
  speak_response: "Speak response",
  stop_speaking: "Stop speaking",
  speaking: "Speaking...",
  permission_denied: "Microphone permission denied.",
  no_microphone: "No microphone was found.",
  recording_failed: "Recording failed.",
  transcription_failed: "Voice transcription failed.",
  tts_failed: "Speech playback failed.",
  model_missing: "Voice model is not installed.",
  runtime_unavailable: "Local voice runtime is unavailable.",
  empty_transcript: "No speech was detected.",
  settings_title: "Voice",
  enable_input: "Enable voice input",
  enable_spoken_responses: "Enable spoken responses",
  auto_send: "Send voice transcript automatically",
  speak_after_voice_input: "Speak only after voice input",
  stt_language: "Speech recognition language",
  tts_language: "Speech response language",
  voice_model: "Voice model",
  speech_speed: "Speech speed",
  max_recording_duration: "Max recording duration",
}
```

All supported language files must receive the same key structure.

## 18. Testing Strategy

### 18.1 Unit Tests

Add tests for:

- `SpeechTextSanitizer`
- `SentenceChunker`
- `VoicePlaybackQueue` cancellation behavior using mocked audio
- `AiChatVoiceModule` settings parsing
- voice IPC payload validation
- worker inbound/outbound schemas
- `SherpaVoiceWorkerClient` timeout/crash handling with fake fork

### 18.2 Main Process Tests

Place under `test/vitest/main/`.

Cover:

- IPC handlers register all voice channels.
- status handler returns unavailable/missing model states.
- transcribe handler rejects invalid MIME type.
- transcribe handler rejects oversized audio.
- TTS handler rejects empty/oversized text.
- cancel handler is best-effort and safe when no worker is active.
- worker crash returns `status: false` response.

### 18.3 Component Tests

Place under existing component test area if compatible.

Cover:

- microphone button visibility.
- disabled state while streaming.
- recording/transcribing text appears.
- transcript inserts into composer.
- auto-send emits the existing `send` event.
- stop speaking button clears speaking state.

### 18.4 Manual QA

Required paths:

1. Enable voice input, record a short English message, verify transcript appears.
2. Edit transcript and send.
3. Enable auto-send, record message, verify chat sends.
4. Deny microphone permission, verify user-facing error.
5. Record silence, verify no chat submission.
6. Enable spoken responses, verify assistant response plays.
7. Stop chat stream, verify playback stops.
8. Switch conversation, verify playback stops.
9. Remove/misconfigure model, verify missing model state.
10. Test one CJK sentence boundary path.

## 19. Implementation Sequence

### Step 1: Types, Channels, Settings

- Add `aiChatVoiceTypes.ts`.
- Add channel constants.
- Add settings keys and defaults.
- Add i18n keys in all language files.
- Add renderer API wrappers.

Commit as a standalone unit.

### Step 2: Worker Skeleton

- Add worker protocol types.
- Add Zod worker schemas.
- Add `AiChatVoiceWorker.ts` skeleton.
- Add `SherpaVoiceWorkerClient` with fakeable fork.
- Add Vite and Forge worker config.
- Add tests for worker client lifecycle.

Commit as a standalone unit.

### Step 3: STT MVP

- Add `BrowserVoiceRecorder`.
- Add STT service in worker.
- Add transcribe IPC handler.
- Add microphone button states.
- Insert transcript into composer draft.
- Add tests for validation and component states.

Commit as a standalone unit.

### Step 4: Auto-Send

- Add latest input source tracking.
- Add auto-send setting behavior.
- Preserve existing selected file behavior.
- Add empty transcript protection.

Commit as a standalone unit.

### Step 5: TTS Final-Message Playback

- Add TTS worker service.
- Add TTS IPC handler.
- Add sanitizer.
- Add playback queue.
- Speak final assistant message only.
- Add stop speaking behavior.

Commit as a standalone unit.

### Step 6: Sentence-Level Streaming Playback

- Add sentence chunker.
- Wire assistant token deltas to speech controller.
- Queue chunks in order.
- Add cancellation across active/queued chunks.

Commit as a standalone unit.

### Step 7: Model Catalog And Installer UX

- Add model status UI.
- Add model import/download flow if needed.
- Add checksum/path validation.

Commit as a standalone unit.

## 20. Open Implementation Decisions

1. Which sherpa-onnx package binding should be used in Electron main/utility process.
2. Whether recorded WebM/Opus must be converted to WAV/PCM before STT.
3. Whether TTS audio should cross IPC as base64 or app-owned temporary WAV files.
4. Which STT model and TTS voice should be the first recommended defaults.
5. Whether model files are bundled, downloaded, or imported by the user in MVP.
6. Whether voice settings live under AI Provider settings or a dedicated Chat settings panel.

## 21. Security And Privacy Checklist

- [ ] Microphone permission is requested only on explicit user action.
- [ ] Electron media permission handler allows audio only for trusted renderer origins.
- [ ] Audio payloads are size-limited before worker calls.
- [ ] MIME types are allowlisted.
- [ ] Raw audio is not persisted by default.
- [ ] Temporary audio files are cleaned up.
- [ ] Worker has `WORKER_TYPE=ai-chat-voice`.
- [ ] Worker imports no database Models or Modules.
- [ ] Renderer cannot invoke arbitrary worker commands.
- [ ] Hosted fallback, if later added, gates AI entitlement before parsing payloads.

## 22. Acceptance Criteria

The feature is technically complete when:

1. Voice input can transcribe locally and populate AiChatV2 composer text.
2. Auto-send can route transcript through the existing chat stream without changing `ChatV2StreamRequest`.
3. Assistant text can be synthesized locally and played back.
4. Playback stops on chat stop, new recording, conversation switch, and component unmount.
5. Workers run under `src/childprocess/` and do not touch the database.
6. New IPC payloads are validated.
7. Missing model, missing microphone, and permission denial have clear UI states.
8. All new user-facing text is translated in every supported language.
9. Unit and main-process tests cover validation, chunking, sanitization, and worker lifecycle.
