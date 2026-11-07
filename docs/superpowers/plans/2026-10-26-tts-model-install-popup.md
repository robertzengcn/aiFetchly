# TTS Model Install Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking "Enable spoken responses" while the TTS speech model is missing opens a modal install popup (with in-place install + auto-enable) instead of the inline bottom-of-chat notice bar.

**Architecture:** New presentational dialog `AiChatVoiceTtsModelInstallDialog.vue` mirrors the existing `AiChatVoiceRuntimeInstallDialog.vue`; the missing-model gate and install state stay in the shared `useAiChatVoice` composable, reusing `ttsInstallPrompt` as the popup open flag. Both chat surfaces (classic `AiChatV2.vue`, workspace `AiChatCenterSurface.vue`) render the popup and drop their inline notice bars; a successful in-popup install persists `ttsMode: "all_assistant_messages"` (user's approved decision).

**Tech Stack:** Vue 3 `<script setup>`, Vuetify, vue-i18n, Vitest + @vue/test-utils.

**Spec:** `docs/superpowers/specs/2026-10-26-tts-model-install-popup-design.md`

## Global Constraints

- NEVER use `any`; explicit return types on functions (AGENTS.md TypeScript rules).
- All i18n keys reused from the existing voice section — NO new user-facing copy; do not edit `src/views/lang/*.ts`.
- UI tests are a hard gate: `yarn test:components` must pass after each surface task.
- Commit each task (conventional commits: `feat:`/`test:`); code + its tests in the same commit.
- Out of scope: STT notices in `AiChatV2Composer`, the runtime-install flow, `AiChatVoiceSettingsPanel` (its guard messaging stays; it has its own download path and must never auto-enable TTS).
- data-testid naming: dialog `tts-install-dialog`, buttons `tts-install-confirm`, `tts-install-cancel`, `tts-install-settings`.

## Review Focus

1. **Install fails mid-download** (network error) → popup stays open with the localized error, spoken responses stay disabled. Pinned by: Task 1 failure-keeps-off test.
2. **Confirm double-clicked while installing** → exactly one download, actions disabled. Pinned by: Task 2 installing-state test + existing `modelInstalling` guard in `installTtsModel`.
3. **Cancel then re-toggle** → popup reopens each time (open flag resets). Pinned by: Task 3 reopen test.
4. **Model installs but `ttsState` still not `ready`** → no silent enablement. Pinned by: Task 1 no-auto-enable test.
5. **Unrelated inline notices unaffected** (STT composer notice, workspace save-failure notice) → existing FR-VOICE-004 test + Task 5 full suite run.

---

### Task 1: Composable — auto-enable after successful TTS install

**Files:**
- Modify: `src/views/composables/useAiChatVoice.ts:87` (interface), `:412-430` (`installTtsModel`)
- Test: `test/vitest/main/components/useAiChatVoice.test.ts` (update test at `:262`; add two tests)

**Interfaces:**
- Consumes (existing): `getVoiceSettings()`, `setVoiceSettings()`, `getVoiceStatus()`, `downloadVoiceModel()`, `notifyVoiceModelsChanged()`, `applySettings()`, viewed as `status.value?.ttsState`.
- Produces: `installTtsModel(): Promise<void>` now ALSO persists `ttsMode: "all_assistant_messages"` when `status.value?.ttsState === "ready"` after install; `ttsInstallPrompt` becomes consumer-writable `Ref<boolean>` (dialog cancel sets it false).

- [ ] **Step 1: Write the failing tests.** In `useAiChatVoice.test.ts`, update `"installTtsModel downloads the configured speech model"` to add (after existing assertions; add `setVoiceSettingsMock.mockImplementation(async (s) => s);` before `mountVoice()`):

```ts
expect(setVoiceSettingsMock).toHaveBeenCalledWith(
  expect.objectContaining({ ttsMode: "all_assistant_messages" })
);
expect(voice.spokenResponseEnabled.value).toBe(true);
```

Add two tests next to it using the same helpers (`mountVoice()`, `loadSettings()`, `baseSettings`, `readyStatus()`):

```ts
it("installTtsModel leaves spoken responses disabled when the model is still missing after download", async () => {
  getVoiceSettingsMock.mockResolvedValue(baseSettings);
  getVoiceStatusMock.mockResolvedValue(readyStatus({ ttsState: "missing_model" }));
  downloadVoiceModelMock.mockResolvedValue(undefined);
  const voice = mountVoice();
  await voice.loadSettings();

  await voice.installTtsModel();

  expect(downloadVoiceModelMock).toHaveBeenCalledWith("sherpa-onnx:tts:auto");
  expect(setVoiceSettingsMock).not.toHaveBeenCalled();
  expect(voice.spokenResponseEnabled.value).toBe(false);
});

it("installTtsModel failure keeps spoken responses off and surfaces a localized error", async () => {
  getVoiceSettingsMock.mockResolvedValue(baseSettings);
  getVoiceStatusMock.mockResolvedValue(readyStatus());
  downloadVoiceModelMock.mockRejectedValue(new Error("network"));
  const voice = mountVoice();
  await voice.loadSettings();

  await voice.installTtsModel();

  expect(voice.modelInstallError.value).toBeTruthy();
  expect(setVoiceSettingsMock).not.toHaveBeenCalled();
  expect(voice.spokenResponseEnabled.value).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure.** Run: `yarn vitest run test/vitest/main/components/useAiChatVoice.test.ts` — Expected: the two new tests FAIL (no auto-enable), updated test FAILS.

- [ ] **Step 3: Implement in `useAiChatVoice.ts`.** One line on approach when the signature and the test leave a choice (which library call, which data structure); a code block only for an algorithm they do not determine.

  a. Interface (line `:87`): change to `readonly ttsInstallPrompt: Ref<boolean>;` with doc comment "Consumer-writable: the TTS install popup closes itself on cancel (design §11.4)." — mirrors `runtimeInstallDialog` at `:92-96`.

  b. In `installTtsModel()` (`:412`), after `await loadSettings();` and before `catch`, add (own try/catch → `settingsSaveFailed.value = true` on failure, matching FR-VOICE-004 so the retry bar works):

```ts
      // Popup confirm completes the user's original enable intent
      // (toggle → popup). When the model is now usable, persist the
      // enablement (mirrors confirmRuntimeInstall auto-enabling
      // push-to-talk). A save failure surfaces via settingsSaveFailed.
      if (status.value?.ttsState === "ready") {
        try {
          const current = settings.value ?? (await getVoiceSettings());
          const saved = await setVoiceSettings({
            ...current,
            ttsMode: "all_assistant_messages",
          });
          applySettings(saved);
        } catch {
          settingsSaveFailed.value = true;
        }
      }
```

- [ ] **Step 4: Run tests to pass.** Run: `yarn vitest run test/vitest/main/components/useAiChatVoice.test.ts` — Expected: PASS (all).

- [ ] **Step 5: Commit.**

```bash
git add src/views/composables/useAiChatVoice.ts test/vitest/main/components/useAiChatVoice.test.ts
git commit -m "feat: auto-enable spoken responses after speech-model install completes"
```

---

### Task 2: Dialog component

**Files:**
- Create: `src/views/components/aiChatV2/AiChatVoiceTtsModelInstallDialog.vue`
- Test: `test/vitest/main/components/AiChatVoiceTtsModelInstallDialog.test.ts`

**Interfaces:**
- Consumes: i18n keys `aiChatV2.voice.{enable_spoken_responses, tts_model_missing, install_tts_model, installing_model, open_model_settings}` and `common.cancel` (all exist in all 6 languages; zero i18n edits).
- Produces: presentational dialog — props `{ open?: boolean; installing?: boolean; error?: string | null }` (defaults: `false, false, null`), emits `(update:modelValue, boolean)`, `confirm`, `open-settings`. `error` is already-localized text rendered as-is.

- [ ] **Step 1: Write the failing component test**

```ts
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it } from "vitest";
import AiChatVoiceTtsModelInstallDialog from "@/views/components/aiChatV2/AiChatVoiceTtsModelInstallDialog.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: { cancel: "Cancel" },
      aiChatV2: {
        voice: {
          enable_spoken_responses: "Enable spoken responses",
          tts_model_missing:
            "Spoken responses need a speech model. Install it to enable.",
          install_tts_model: "Install speech model",
          installing_model: "Installing...",
          open_model_settings: "Open settings",
        },
      },
    },
  },
});

function mountDialog(props: Record<string, unknown> = { open: true }) {
  return mount(AiChatVoiceTtsModelInstallDialog, {
    props: props as never,
    global: {
      plugins: [i18n],
      stubs: {
        VDialog: { template: "<div data-testid='dialog'><slot /></div>" },
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VAlert: { template: "<div role='alert'><slot /></div>" },
        VIcon: { template: "<span><slot /></span>" },
        VSpacer: true,
        VProgressCircular: true,
        VBtn: {
          emits: ["click"],
          template:
            "<button v-bind=\"$attrs\" @click=\"$emit('click', $event)\"><slot /></button>",
        },
      },
    },
  });
}
```

Five assertions — five `it` blocks:
1. `"renders the speech-model notice and install affordance when open"` — assert the wrapper text contains `"Spoken responses need a speech model. Install it to enable."` and contains `"Install speech model"`, and `[data-testid="tts-install-confirm"]` exists.
2. `"emits confirm when the install button is clicked"` — `trigger("click")` on confirm → `emitted("confirm")` length 1.
3. `"emits update:modelValue false when cancelled"` — click `[data-testid="tts-install-cancel"]` → `emitted("update:modelValue")[0]` equals `[false]`.
4. `"emits open-settings from the settings link"` — click `[data-testid="tts-install-settings"]` → `emitted("open-settings")` length 1.
5. `"disables actions while installing and renders the localized error"` — `mountDialog({ open: true, installing: true, error: "Speech model installation failed." })`; assert the alert div contains the error text and confirm button has attribute `disabled`.

- [ ] **Step 2: Run to verify failure.** Run: `yarn vitest run test/vitest/main/components/AiChatVoiceTtsModelInstallDialog.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Create the component.** Mirror `AiChatVoiceRuntimeInstallDialog.vue` structure (persistent v-dialog, v-card with title icon `mdi-volume-high`, body, actions). Exact template/script:

```vue
<template>
  <!--
    Spoken-response speech-model install dialog (spec 2026-10-26). Replaces
    the former inline bottom-of-chat TTS notice; presentational only — state
    lives in the shared useAiChatVoice composable, both chat surfaces render
    this one component.
  -->
  <v-dialog
    :model-value="open"
    max-width="520"
    persistent
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <v-card data-testid="tts-install-dialog">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-volume-high</v-icon>
        <span>
          {{
            t("aiChatV2.voice.enable_spoken_responses") ||
            "Enable spoken responses"
          }}
        </span>
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-3">
          {{
            t("aiChatV2.voice.tts_model_missing") ||
            "Spoken responses need a speech model. Install it to enable."
          }}
        </p>
        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="comfortable"
          class="mb-3"
        >
          {{ error }}
        </v-alert>
        <div v-if="installing" class="d-flex align-center mt-3">
          <v-progress-circular
            indeterminate
            size="18"
            width="2"
            color="primary"
            class="mr-2"
          />
          <span class="text-body-2">
            {{ t("aiChatV2.voice.installing_model") || "Installing..." }}
          </span>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-btn
          variant="text"
          :disabled="installing"
          data-testid="tts-install-settings"
          @click="emit('open-settings')"
        >
          {{ t("aiChatV2.voice.open_model_settings") || "Open settings" }}
        </v-btn>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="installing"
          data-testid="tts-install-cancel"
          @click="emit('update:modelValue', false)"
        >
          {{ t("common.cancel") || "Cancel" }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="installing"
          :disabled="installing"
          data-testid="tts-install-confirm"
          @click="emit('confirm')"
        >
          {{ t("aiChatV2.voice.install_tts_model") || "Install speech model" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

withDefaults(
  defineProps<{
    open?: boolean;
    installing?: boolean;
    error?: string | null;
  }>(),
  { open: false, installing: false, error: null }
);

const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void;
  (event: "confirm"): void;
  (event: "open-settings"): void;
}>();

const { t } = useI18n();
</script>
```

- [ ] **Step 4: Run to pass.** Run: `yarn vitest run test/vitest/main/components/AiChatVoiceTtsModelInstallDialog.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/views/components/aiChatV2/AiChatVoiceTtsModelInstallDialog.vue test/vitest/main/components/AiChatVoiceTtsModelInstallDialog.test.ts
git commit -m "feat: add spoken-response speech-model install dialog"
```

---

### Task 3: Classic surface — popup replaces inline notice

**Files:**
- Modify: `src/views/components/aiChatV2/AiChatV2.vue:425-467` (remove notice), `:610-618` (add dialog after runtime dialog), `:860` (import), `:6672-6687` (remove now-unused CSS)
- Test: `test/vitest/main/components/AiChatV2.voiceResponse.test.ts` (`:401-430` rewrite, add two tests, extend `mountChat` stubs)

**Interfaces:**
- Consumes from Task 1/2: destructured names already present at `:6438-6470` — `voiceTtsInstallPrompt`, `voiceModelInstalling`, `voiceModelInstallError`, `handleInstallTtsModel`; plus handler `openAIProviderSettings`. Dialog emits per Task 2.

- [ ] **Step 1: Update the tests first.** In `AiChatV2.voiceResponse.test.ts` mountChat stubs add:

```ts
AiChatVoiceTtsModelInstallDialog: {
  props: ["open", "installing", "error"],
  emits: ["update:modelValue", "confirm", "open-settings"],
  template:
    '<div data-testid="tts-install-dialog" :data-open="String(open)"><button data-testid="tts-install-confirm" @click="$emit(\'confirm\')"/><button data-testid="tts-install-cancel" @click="$emit(\'update:modelValue\', false)"/></div>',
},
```

Rewrite the test at `:401` — same title minus install-affordance wording, new title:

```ts
it("does not enable spoken responses when the TTS model is missing; opens the speech-model install popup", async () => {
  vi.mocked(getVoiceSettings).mockResolvedValue({
    ...defaultVoiceSettings,
    ttsMode: "disabled",
  });
  vi.mocked(getVoiceStatus).mockResolvedValue({
    sttState: "ready",
    ttsState: "missing_model",
  });
  const wrapper = mountChat();
  await flushPromises();

  await wrapper
    .find('[data-testid="spoken-response-toggle"]')
    .trigger("click");
  await flushPromises();

  expect(setVoiceSettings).not.toHaveBeenCalled();
  expect(
    wrapper.find('[data-testid="tts-install-dialog"]').attributes("data-open")
  ).toBe("true");
});
```

Add after it:

```ts
it("installing the speech model from the popup auto-enables spoken responses", async () => {
  vi.mocked(getVoiceSettings).mockResolvedValue({
    ...defaultVoiceSettings,
    ttsMode: "disabled",
  });
  // Call order: mount loadSettings, toggleSpokenResponse gate check,
  // post-install loadSettings. The first two must be missing_model; the
  // third ready. A call counter avoids mockResolvedValueOnce ordering bugs.
  let statusCalls = 0;
  vi.mocked(getVoiceStatus).mockImplementation(async () => {
    statusCalls += 1;
    return statusCalls < 3
      ? { sttState: "ready", ttsState: "missing_model" }
      : { sttState: "ready", ttsState: "ready" };
  });
  vi.mocked(downloadVoiceModel).mockResolvedValue(undefined);
  vi.mocked(setVoiceSettings).mockImplementation(async (s) => s);
  const wrapper = mountChat();
  await flushPromises();

  await wrapper
    .find('[data-testid="spoken-response-toggle"]')
    .trigger("click");
  await flushPromises();

  await wrapper
    .find('[data-testid="tts-install-confirm"]')
    .trigger("click");
  await flushPromises();

  expect(downloadVoiceModel).toHaveBeenCalledWith("sherpa-onnx:tts:auto");
  expect(setVoiceSettings).toHaveBeenCalledWith(
    expect.objectContaining({ ttsMode: "all_assistant_messages" })
  );
  expect(
    wrapper.find('[data-testid="tts-install-dialog"]').attributes("data-open")
  ).toBe("false");
});

it("closing the install popup lets the user reopen it from the toggle", async () => {
  vi.mocked(getVoiceSettings).mockResolvedValue({
    ...defaultVoiceSettings,
    ttsMode: "disabled",
  });
  vi.mocked(getVoiceStatus).mockResolvedValue({
    sttState: "ready",
    ttsState: "missing_model",
  });
  const wrapper = mountChat();
  await flushPromises();

  await wrapper
    .find('[data-testid="spoken-response-toggle"]')
    .trigger("click");
  await flushPromises();
  expect(
    wrapper.find('[data-testid="tts-install-dialog"]').attributes("data-open")
  ).toBe("true");

  await wrapper
    .find('[data-testid="tts-install-cancel"]')
    .trigger("click");
  await flushPromises();
  expect(
    wrapper.find('[data-testid="tts-install-dialog"]').attributes("data-open")
  ).toBe("false");

  await wrapper
    .find('[data-testid="spoken-response-toggle"]')
    .trigger("click");
  await flushPromises();
  expect(
    wrapper.find('[data-testid="tts-install-dialog"]').attributes("data-open")
  ).toBe("true");
});
```

- [ ] **Step 2: Run to verify failure.** Run: `yarn vitest run test/vitest/main/components/AiChatV2.voiceResponse.test.ts` — Expected: FAIL (AiChatV2 does not render the dialog yet → `data-open` undefined).

- [ ] **Step 3: Wire the popup in `AiChatV2.vue`.**
  - Delete the TTS prerequisite notice block `:425-467` (the comment lines starting "TTS prerequisite notice" through the closing `</div>` before `AiChatSelectedContext`).
  - Delete CSS `.v2-shell__tts-notice` and `.v2-shell__tts-notice-text` blocks (`:6672-6687`).
  - Insert after the `AiChatVoiceRuntimeInstallDialog` closing tag (`:618`):

```vue
      <AiChatVoiceTtsModelInstallDialog
        v-model="voiceTtsInstallPrompt"
        :installing="voiceModelInstalling"
        :error="voiceModelInstallError"
        @confirm="handleInstallTtsModel"
        @open-settings="openAIProviderSettings"
      />
```

  - Add the import next to `:860`:
    `import AiChatVoiceTtsModelInstallDialog from "./AiChatVoiceTtsModelInstallDialog.vue";`

- [ ] **Step 4: Run tests to pass.** Run: `yarn vitest run test/vitest/main/components/AiChatV2.voiceResponse.test.ts` — Expected: PASS (all).

- [ ] **Step 5: Commit.**

```bash
git add src/views/components/aiChatV2/AiChatV2.vue test/vitest/main/components/AiChatV2.voiceResponse.test.ts
git commit -m "feat: open speech-model install popup from classic chat toggle"
```

---

### Task 4: Workspace surface — popup replaces inline notice

**Files:**
- Modify: `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue:415-454` (remove TTS notice; KEEP the save-failure notice `:456-493` which shares class `chat-center__tts-notice` and its CSS `:3815-3829`), `:495-503` (add dialog after runtime dialog), `:837-842` (add computed), `:649` (import)
- Test: `test/vitest/main/components/AiChatCenterSurface.test.ts` (stubs `:417-421`, one new `describe` beside FR-VOICE-004 block `:4174`)

**Interfaces:**
- Consumes from Task 1/2: `voice.ttsInstallPrompt` (now writable `Ref<boolean>`), `voice.modelInstalling.value`, `voice.modelInstallError.value`, `voice.installTtsModel()`, `openVoiceSettings` (`:3039`).

- [ ] **Step 1: Update the tests first.** In the stubs object containing `AiChatVoiceRuntimeInstallDialog: true` (`:421`), add:

```ts
AiChatVoiceTtsModelInstallDialog: {
  props: ["open", "installing", "error"],
  emits: ["update:modelValue", "confirm", "open-settings"],
  template:
    '<div data-testid="tts-install-dialog" :data-open="String(open)"><button data-testid="tts-install-confirm" @click="$emit(\'confirm\')"/><button data-testid="tts-install-cancel" @click="$emit(\'update:modelValue\', false)"/></div>',
},
```

Add a describe block (mount via the same helper the FR-VOICE-004 block uses; base defaults at `:504-517` already provide disabled settings with `ttsModelId: "tts"`):

```ts
describe("AiChatCenterSurface speech-model install popup", () => {
  it("opens the popup instead of the inline notice when the TTS model is missing", async () => {
    getVoiceSettingsMock.mockResolvedValue(/* clone of the :504 disabled base */);
    getVoiceStatusMock.mockResolvedValue({
      sttState: "ready",
      ttsState: "missing_model",
    });
    const wrapper = /* the same mount call this file uses elsewhere */;
    await flushPromises() (or the file's await pattern);

    wrapper.findComponent({ name: "AiChatVoiceOutputToggle" }).vm.$emit("toggle");
    await flushPromises();

    expect(setVoiceSettingsMock).not.toHaveBeenCalled();
    expect(
      wrapper.find('[data-testid="tts-install-dialog"]').attributes("data-open")
    ).toBe("true");
  });

  it("confirming the popup installs the speech model and auto-enables spoken responses", async () => {
    getVoiceSettingsMock.mockResolvedValue(/* disabled base */);
    // Call order: mount loadSettings, toggleSpokenResponse gate check,
    // post-install loadSettings — twice missing_model, then ready.
    let statusCalls = 0;
    getVoiceStatusMock.mockImplementation(async () => {
      statusCalls += 1;
      return statusCalls < 3
        ? { sttState: "ready", ttsState: "missing_model" }
        : { sttState: "ready", ttsState: "ready" };
    });
    const wrapper = /* same mount */;

    wrapper.findComponent({ name: "AiChatVoiceOutputToggle" }).vm.$emit("toggle");
    await flushPromises();
    await wrapper
      .find('[data-testid="tts-install-confirm"]')
      .trigger("click");
    await flushPromises();

    expect(downloadVoiceModel).toHaveBeenCalledWith("tts");
    expect(setVoiceSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ ttsMode: "all_assistant_messages" })
    );
    expect(
      wrapper.find('[data-testid="tts-install-dialog"]').attributes("data-open")
    ).toBe("false");
  });
});
```

(The bracketed placeholders resolve to this file's existing mock-shape and mount helper — mirror the FR-VOICE-004 test verbatim for the mount/idle pattern; `import { downloadVoiceModel } from "@/views/api/aiChatV2Voice"` may need adding to the `:197` import list if not already imported.)

- [ ] **Step 2: Run to verify failure.** Run: `yarn vitest run test/vitest/main/components/AiChatCenterSurface.test.ts` — Expected: FAIL (unknown stub renders inline; dialog testid absent).

- [ ] **Step 3: Wire the popup in `AiChatCenterSurface.vue`.**
  - Delete the TTS prerequisite notice block `:415-454` (comment + `<div class="chat-center__tts-notice">` … closing `</div>` before the "Spoken-response preference save failure" comment). Keep everything after it.
  - Add below the `voiceRuntimeInstallDialog` computed (`:842`):

```ts
const voiceTtsInstallPrompt = computed({
  get: () => voice.ttsInstallPrompt.value,
  set: (value: boolean) => {
    voice.ttsInstallPrompt.value = value;
  },
});
```

  - Insert after the `AiChatVoiceRuntimeInstallDialog` closing `/>` (`:503`):

```vue
    <AiChatVoiceTtsModelInstallDialog
      v-model="voiceTtsInstallPrompt"
      :installing="voice.modelInstalling.value"
      :error="voice.modelInstallError.value"
      @confirm="voice.installTtsModel"
      @open-settings="openVoiceSettings"
    />
```

  - Add the import after `:649`:
    `import AiChatVoiceTtsModelInstallDialog from "@/views/components/aiChatV2/AiChatVoiceTtsModelInstallDialog.vue";`

- [ ] **Step 4: Run tests to pass.** Run: `yarn vitest run test/vitest/main/components/AiChatCenterSurface.test.ts` — Expected: PASS (all).

- [ ] **Step 5: Commit.**

```bash
git add src/views/components/aiChatWorkspace/AiChatCenterSurface.vue test/vitest/main/components/AiChatCenterSurface.test.ts
git commit -m "feat: open speech-model install popup from workspace chat toggle"
```

---

### Task 5: Full-suite verification

**Files:** none (verification only)

**Interfaces:** Consumes Task 1-4 commits.

- [ ] **Step 1: Run the whole component suite.** Run: `yarn test:components` — Expected: PASS (hard CI gate; confirms STT composer notice, FR-VOICE-004 save-failure notice, and all other surfaces unaffected).
- [ ] **Step 2: Typecheck + lint clean.** Run: `yarn vue-check && yarn tsc` — Expected: clean (or pre-existing warnings only, no errors).
- [ ] **Step 3: i18n key sweep (no edits expected).** Verify every reused key still exists in all six files `src/views/lang/{en,zh,es,fr,de,ja}.ts`: grep for `enable_spoken_responses`, `tts_model_missing`, `install_tts_model`, `installing_model`, `open_model_settings` — Expected: ≥1 match per file per key.
- [ ] **Step 4: Commit strays.** If verification produced any tracked changes, `git add` + `git commit -m "test: verify spoken-response popup across component suite"`. Otherwise nothing to commit.
