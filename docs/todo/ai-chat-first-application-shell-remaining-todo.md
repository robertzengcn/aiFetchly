# AI Chat-First Application Shell — Remaining TODO

Last audited: 2026-09-08

Source documents:

- `docs/prd/ai-chat-first-application-shell-prd.md`
- `docs/prd/ai-chat-first-application-shell-technical-design.md`

Status: **Not ready for PRD completion sign-off.** The persistent shell,
workspace chooser, draft persistence, most voice functionality, localization,
and window-state foundation are implemented, but the tasks below remain open.

## Functional gaps

### 1. Prevent Enter from sending during IME composition

- [ ] Update the composer keyboard handler to ignore Enter while
  `KeyboardEvent.isComposing` is true (and account for the browser-specific
  composition key-code fallback if the supported Electron version needs it).
- [ ] Add component coverage proving composition Enter neither sends a message
  nor selects a slash/at-mention suggestion prematurely.
- **Requirement:** FR-COMP-004; PRD sections 13.2 and 25.3; technical design
  sections 10.2 and 29.
- **Why incomplete:** `AiChatV2Composer.vue` handles Enter for suggestions and
  normal sends without checking `event.isComposing`.
- **Evidence:** `src/views/components/aiChatV2/AiChatV2Composer.vue:1317-1380`.

### 2. Correct current-route versus selected-conversation semantics

- [ ] Keep the selected conversation retained while an inner route is open,
  but remove its `aria-current` state unless chat is the current center route.
- [ ] Apply the same semantics to grouped and unassigned conversations.
- [ ] Extend component and E2E assertions to prove an inner route and a
  conversation are not simultaneously exposed as the current center surface.
- **Requirement:** PRD sections 11.4, 19.1, and 21; FR-SHELL-008.
- **Why incomplete:** grouped selected conversations always receive
  `aria-current="true"`, including while Insights, Knowledge Library, Plugins,
  or another global route has `aria-current="page"`.
- **Evidence:**
  `src/views/components/aiChatWorkspace/AiChatWorkspaceSidebar.vue:143-154`.

### 3. Implement route and conversation focus transfer

- [ ] After inner-page navigation, focus the page heading or primary center
  landmark without disturbing retained sidebar state.
- [ ] After conversation selection or New chat, focus the conversation heading
  or composer according to the initiating action.
- [ ] Test the post-navigation `document.activeElement`, not only route
  visibility and `aria-current` attributes.
- **Requirement:** PRD sections 16.3, 19.1, and 21; FR-QUAL-005; acceptance
  criterion 42.
- **Why incomplete:** `AppCenterRouteHost.vue` updates inspector/loading state,
  and `AuthenticatedWorkspaceLayout.vue` pushes the chat route, but neither
  establishes focus in the newly active center surface.
- **Evidence:**
  `src/views/components/appShell/AppCenterRouteHost.vue:68-81` and
  `src/views/layout/AuthenticatedWorkspaceLayout.vue:65-91`.

### 4. Complete spoken-response saving and error states

- [ ] Show a localized recoverable error and settings/retry action when saving
  the spoken-response preference fails.
- [ ] Ensure enabled, disabled, saving, speaking, and error states each have an
  observable accessible presentation.
- [ ] Add chat-center component tests for a failed `setVoiceSettings()` call.
- **Requirement:** FR-VOICE-004; PRD sections 14.3, 18, and 25.4.
- **Why incomplete:** `toggleSpokenResponse()` stores the raw error in
  `modelInstallError`, but the chat-center TTS notice is rendered only for the
  missing-model prompt. A normal preference-save failure can therefore remain
  invisible.
- **Evidence:** `src/views/composables/useAiChatVoice.ts:309-342` and
  `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue:255-294`.

### 5. Keep microphone input discoverable in every supported state

- [ ] Distinguish permanently unsupported builds from user-disabled,
  setup-required, and temporarily unavailable states.
- [ ] Keep an accessible microphone/setup affordance visible whenever voice is
  supported by the build, including when input mode is disabled in settings.
- [ ] Add explicit permission-denied retry guidance and verify busy, setup,
  permission, recording, transcription, and generic failure states.
- **Requirement:** FR-COMP-009, FR-VOICE-001, FR-VOICE-003, and FR-VOICE-005;
  PRD sections 14.2 and 14.4.
- **Why incomplete:** the microphone is mounted only when `voiceEnabled` or a
  settings-load failure is present. A successfully loaded `inputMode` other
  than `push_to_talk` hides it, even though the build supports voice.
- **Evidence:** `src/views/components/aiChatV2/AiChatV2Composer.vue:166-188`
  and `src/views/composables/useAiChatVoice.ts:257-260`.

### 6. Sanitize voice errors before rendering

- [ ] Map transcription, playback, model-install, and preference-save failures
  to bounded public error codes/messages.
- [ ] Do not append raw exception text that may contain filesystem paths,
  provider responses, keys, or internal details.
- [ ] Add regression tests with deliberately sensitive-looking exception text.
- **Requirement:** PRD sections 14.5, 23, and 29; technical design sections
  11.4, 20, and 22.
- **Why incomplete:** transcription and voice orchestration concatenate raw
  `Error.message` values into renderer-visible messages.
- **Evidence:** `src/views/components/aiChatV2/AiChatV2Composer.vue:768-775`
  and `src/views/composables/useAiChatVoice.ts:337-339`.

### 7. Add the actionable no-model state

- [ ] Distinguish bounded loading from a completed empty model list.
- [ ] Show a localized provider/settings action when no usable model exists.
- [ ] Explain disabled selector state accessibly without changing toolbar
  height.
- **Requirement:** PRD sections 13.4 and 18; Definition of Done item 14.
- **Why incomplete:** the center treats an empty model array as loading, while
  `AiChatV2ModelSelector` always inserts an `Auto` item and exposes no settings
  action. This can leave the selector loading indefinitely without recovery.
- **Evidence:**
  `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue:193-200` and
  `src/views/components/aiChatV2/AiChatV2ModelSelector.vue:1-20,88-105`.

### 8. Reconcile and implement the composer toolbar order

- [ ] Resolve the specification conflict explicitly: PRD section 13.3 places
  attachment after context, while technical design section 10.1 places it
  first.
- [ ] Because the PRD declares its ordering fixed and authoritative, either
  move attachment after context or amend the PRD through product approval.
- [ ] Add a DOM-order assertion covering every lower-toolbar control.
- **Requirement:** PRD sections 8, 13.1, and 13.3.
- **Why incomplete:** the implementation currently follows the technical
  design's attachment-first order, not the PRD's mode, model, approval,
  context, attachment, spoken-response order.
- **Evidence:** `src/views/components/aiChatV2/AiChatV2Composer.vue:307-344`.

### 9. Complete privacy-safe shell observability

- [ ] Record bounded shell mount and center-route transition events.
- [ ] Add development duplicate-shell detection.
- [ ] Record sanitized workspace-selection failure categories, voice state
  failures, invalid-window-state fallback reasons, and display-clamping events.
- [ ] Verify diagnostics exclude prompts, transcripts, audio, raw paths,
  workspace contents, API keys, and provider secrets.
- **Requirement:** PRD section 29 and technical design section 22.
- **Why incomplete:** the shell, center-route host, workspace chooser, voice
  orchestration, and window-state service do not implement the specified
  structured diagnostic events.

## Test and validation gaps

### 10. Repair the failing AI Chat V2 IPC regression tests

- [ ] Fix the generated-image reference boundary implementation or update the
  tests only if the governing contract intentionally changed.
- [ ] Restore green coverage for malformed-reference error codes, first-wins
  deduplication, combined upload/reference limits, and normalized blank-text
  reference forwarding.
- [ ] Run the complete main-process suite after the repair.
- **Requirement:** FR-QUAL-006; acceptance criterion 41; Definition of Done
  items 12 and 14.
- **Why incomplete:** the focused suite currently has four failures. One path
  throws because `getGeneratedImageSourceMessage` is unavailable; the other
  assertions show reference normalization/limit behavior diverging from the
  tests.
- **Reproduction:**
  `npx vitest run --config vite.main.config.mjs test/vitest/main/ipc/ai-chat-v2-ipc.test.ts`
  → 4 failed, 30 passed on 2026-09-08.

### 11. Make run-preservation E2E deterministic and meaningful

- [ ] Start a deterministic long-running fake-provider run.
- [ ] Navigate away from chat and/or reload the renderer while the run is
  active.
- [ ] Assert the main-process run continues, the shell restores, and the final
  result reconnects to the correct conversation.
- [ ] Remove the required scenario's live-provider-only skip.
- **Requirement:** FR-SHELL-009, FR-COMP-011, FR-QUAL-003, and FR-QUAL-006;
  PRD sections 22 and 26.4 scenario 10; Definition of Done item 14.
- **Why incomplete:** the current test is skipped without
  `AIFETCHLY_E2E_LIVE_AI=1`; even when enabled, it reloads the page without
  starting a run, so it does not prove the behavior named by the test.
- **Evidence:** `test/e2e/specs/workspace-shell.test.ts:187-203`.

### 12. Finish cross-platform and assistive-technology validation

- [ ] Run window geometry and packaged smoke validation on Windows 10/11.
- [ ] Run window geometry and packaged smoke validation on macOS 12+.
- [ ] Run the workspace and voice flows with NVDA and VoiceOver.
- [ ] Record dates, versions, results, failures, and linked fixes in the
  validation matrix.
- **Requirement:** PRD rollout Phase 5 and Definition of Done items 12-14.
- **Why incomplete:** the repository validation matrix explicitly marks the
  Windows, macOS, and screen-reader rows as pending.
- **Evidence:**
  `docs/prd/ai-chat-first-application-shell-validation-matrix.md:21-27,40-49`.

### 13. Expand accessibility target-size verification

- [ ] Verify every critical shell/composer pointer target is at least 40x40px,
  including Send, Stop, microphone, attachment, spoken response, workspace
  Choose/Change, and compact toolbar controls.
- [ ] Fix controls that do not meet the minimum and add measured assertions.
- **Requirement:** PRD sections 16.4 and 21.
- **Why incomplete:** the current E2E evidence measures only the narrow
  navigation opener, so it cannot establish the PRD's minimum for all
  interactive controls.
- **Evidence:**
  `test/e2e/specs/workspace-shell-gaps.test.ts:285-298` and
  `docs/prd/ai-chat-first-application-shell-validation-matrix.md:44`.

## Final completion gate

- [ ] All tasks above are resolved with implementation and tests committed
  together.
- [ ] `yarn test:components` passes.
- [ ] `yarn typecheck` passes.
- [ ] `yarn vue-typecheck` passes.
- [ ] The complete main-process Vitest suite passes with zero failed files.
- [ ] `yarn test:e2e` passes with no skipped PRD-required scenarios.
- [ ] Translation parity passes for English, Chinese, Spanish, French, German,
  and Japanese.
- [ ] The cross-platform and accessibility validation matrix has no required
  pending rows.
- [ ] The PRD Definition of Done and technical-design engineering checklist are
  reviewed and marked complete only after the evidence above is green.

## Audit baseline

Results observed on 2026-09-08 before creating this TODO:

- `yarn test:components`: 54 files / 349 tests passed.
- `yarn typecheck`: passed.
- `yarn vue-typecheck`: passed.
- Focused window, i18n, and shell tests: 8 files / 144 tests passed.
- `yarn test:e2e`: 43 passed / 2 skipped / 0 failed.
- Focused `ai-chat-v2-ipc.test.ts`: 4 failed / 30 passed.

