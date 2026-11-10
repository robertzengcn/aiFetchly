# TTS Model Install Popup — Design

Date: 2026-10-26
Status: Draft for approval

## Intent and why

Clicking the speaker toggle ("Enable spoken responses") when no TTS speech
model is installed today renders an inline notice bar at the bottom of the
chat (`ttsInstallPrompt` in `useAiChatVoice`) with "Install speech model" /
"Open settings" buttons. The user found the bottom-of-chat bar wrong: the
prerequisite notice and the install action should appear in a popup
window, visible on top of the chat, where the model can be installed
directly.

## Goals

- Clicking the speaker toggle with `ttsState === "missing_model"` opens a
  modal dialog (popup) instead of rendering the inline bottom-of-chat bar.
- The popup shows the same notice text plus Install / Cancel actions and
  install progress / error states.
- After a successful install inside the popup, spoken responses are
  **auto-enabled** (completing the click intent) and the popup closes —
  mirroring how `confirmRuntimeInstall` auto-enables push-to-talk after
  the runtime install.
- Applied to both chat surfaces: classic `AiChatV2.vue` and workspace
  `AiChatCenterSurface.vue`.

## Non-goals

- No change to the STT (voice-input) notices in `AiChatV2Composer` — the
  user's complaint is scoped to spoken responses.
- No change to `AiChatVoiceSettingsPanel` — its message already lives in
  the settings surface.
- No change to the runtime-install flow (`ttsState === "unavailable"`
  already opens `AiChatVoiceRuntimeInstallDialog`).

## Anti-goals

- Removing the gate: enabling spoken responses still requires an installed
  TTS model; the toggle must never persist an enablement that would fail
  silently on every reply.

## Constraints

- Keep architecture: all installation state/actions stay in the shared
  `useAiChatVoice` composable; the dialog is presentational only
  (same pattern as `AiChatVoiceRuntimeInstallDialog.vue`).
- i18n: new keys must be added to all six language files
  (`en, zh, es, fr, de, ja` under `src/views/lang/`).
- UI tests must be added/updated in the same change
  (`test/vitest/main/components/`); `AiChatV2.voiceResponse.test.ts`
  currently asserts the inline notice and must be updated.

## Approaches

1. **Chosen — sibling dialog component.** Create
   `AiChatVoiceTtsModelInstallDialog.vue` mirroring the runtime dialog
   (props: open / installing / error / progress; emits confirm). Remove
   the inline notice blocks from both surfaces, wire the dialog there.
   After install succeeds, `useAiChatVoice` re-enables spoken responses.
   - Tradeoff: one more component, but it keeps the two surfaces DRY and
     matches the established runtime-dialog pattern.

2. **Reuse the runtime dialog with swapped copy.** Rejected: the runtime
   dialog is runtime-specific (title, message, testids, runtime progress
   semantics); shoehorning TTS into it couples unrelated flows.

3. **Keep inline bar but upgrade to a prominent snackbar/banner.**
   Rejected: the user explicitly wants a popup window with in-place
   install.

## Decided

- Auto-enable spoken responses after a successful in-popup install
  (user's pick).
- Dialog content: speaker/volume icon, title ("Enable spoken responses"
  completion), notice text (`tts_model_missing`), Cancel + primary
  "Download and install" action, progress + error rendering like the
  runtime dialog, plus a secondary "Open settings" text link mirroring
  the old inline bar affordance.

## Left to the builder

- Exact new i18n keys (`confirm`, `title`) and copy polish.
- Whether `confirmRuntimeInstall`-style post-install enable lives in the
  existing `installTtsModel()` or a new confirm handler in
  `useAiChatVoice` — pick what keeps existing callers
  (settings panel, composer) safe; the settings panel calls its own
  download path and must not auto-enable TTS implicitly.
- Test updates: adjust `AiChatV2.voiceResponse.test.ts` to assert the
  dialog (open on toggle, confirm installs, auto-enables, closes);
  check for workspace-surface test coverage of the removed inline bar
  and update it the same way.
