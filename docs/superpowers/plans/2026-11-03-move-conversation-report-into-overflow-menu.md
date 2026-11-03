# Move "Report conversation" into the chat overflow menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The workspace chat's "Report this conversation for review" flag button moves from the bottom composer strip into the top-right "..." conversation menu, as a non-destructive menu item that stays visible-but-disabled (reason announced) when reporting is unavailable.

**Architecture:** `AiChatConversationHeader.vue` (the real "..." menu) gains a `report` menu item driven by three new props (`reportEnabled` / `reportLoading` / `reportDisabledReason`) and one new emit; `AiChatCenterSurface.vue` wires its existing capability state and `onOpenConversationReport` handler to the header and deletes the strip-level `AIConversationReportButton`. The reporting dialog flow, snapshot builder, gating stores, and analytics are untouched.

**Tech Stack:** Vue 3 + Vuetify 3 (`v-menu` / `v-list-item`), vue-i18n, vitest + @vue/test-utils.

**Spec:** `docs/superpowers/specs/2026-11-03-move-conversation-report-into-overflow-menu-design.md`

## Global Constraints

- No `any`; explicit types on all new props/emits (AGENTS.md TypeScript rules).
- **No new i18n keys**: the item title reuses `aiConversationReport.action`; the disabled reason string is computed by the parent from existing keys (`aiConversationReport.unavailable` / `aiConversationReport.noEligibleOutputs`). No language files are touched. If a new user-facing string somehow becomes necessary, all six files (`src/views/lang/{en,zh,es,fr,de,ja}.ts`) must get it in the same commit.
- UI change and its tests commit together; `yarn test:components` (full suite) must pass before each commit (hard CI gate). Pre-commit hooks run lint + `tsc --noEmit` + `vue-tsc --noEmit`.
- `AIConversationReportButton.vue` and its test are NOT deleted — `AiChatV2.vue` still uses it.
- Reporting stays non-AI-gated and capability-fail-closed; do not change `useReportCapabilities`, the snapshot builder, or the dialog.

**Recorded call (design §"Left to the builder," tooltip edge case):** the disabled reason renders as the menu item's **`subtitle`**, not a hover tooltip. Reason: Vuetify sets `pointer-events: none` on disabled `.v-list-item--disabled`, which a hover tooltip cannot fire through — and PRD §11.4 wants the reason *announced*. A visible subtitle text satisfies both. The test pins this via the `subtitle` attribute.

## Review Focus

Inputs the spec implies that no happy-path test may catch, each pinned to its owning task:

1. **Capabilities fetch in flight** (`reportLoading` true, reason empty): the item must be disabled so it can't be clicked mid-load → Task 1, "disables the item while capability fetch is in flight".
2. **Fail-closed backend** (envelope missing/error): item stays visible, disabled, with the reason as subtitle → Task 1 "unavailable" test + Task 2 harness-prop test (capabilities channel unmocked → disabled + truthy reason).
3. **Duplicate entry points**: after the move, the strip must render `data-testid="report-conversation"` nowhere → Task 2 existence test.
4. **Destructive separation (PRD §11.5)**: the report item must sit ABOVE the divider, never grouped with Clear/Delete → Task 1 ordering test.
5. **Dialog continuity over remount (AD-005) and payload marking (FR-RPT-009)** must keep working when opened from the menu → Task 2 updates those existing tests to emit from the header.

---

### Task 1: "Report conversation" item in the header overflow menu

**Files:**
- Modify: `src/views/components/aiChatWorkspace/AiChatConversationHeader.vue` (menu list ~lines 52–109; props ~lines 150–161; emits ~lines 163–173)
- Test: `test/vitest/main/components/AiChatConversationHeader.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 2 relies on this exactly):
  - Props: `reportEnabled?: boolean` (default `false` — fail-closed), `reportLoading?: boolean` (default `false`), `reportDisabledReason?: string` (default `""`).
  - Emit: `(e: "report"): void`.
  - Menu item: `data-testid="workspace-overflow-report"`, title key `aiConversationReport.action`, `prepend-icon="mdi-flag-outline"`, `:disabled="!reportEnabled || reportLoading"`, `:subtitle="reportDisabledReason || undefined"`.

- [ ] **Step 1: Write the failing tests**

In `AiChatConversationHeader.test.ts`:

1. Extend `mountHeader`'s `extra` type with `reportEnabled: boolean; reportLoading: boolean; reportDisabledReason: string;` and add these defaults at the call site (`...extra` merge): `reportEnabled: true, reportLoading: false, reportDisabledReason: ""`. Add the key to the helper's i18n messages: `aiConversationReport: { action: "Report conversation" }` (sibling of `workspaceChat`).
2. Add a module-level constant: `const REPORT_UNAVAILABLE = "Conversation reporting is currently unavailable.";`
3. Add this describe block at the end of the file:

```ts
/**
 * Move-conversation-report-into-overflow-menu (2026-11-03): the report
 * action lives in the "..." menu as a non-destructive item. It stays
 * visible but disabled with the reason announced as the item subtitle
 * (PRD §11.4): Vuetify disabled list items are pointer-events:none, so a
 * hover tooltip cannot carry the reason.
 */
describe("AiChatConversationHeader report conversation entry", () => {
  it("renders the report item and emits report on click when enabled", async () => {
    const wrapper = mountHeader("idle");
    const item = wrapper.get('[data-testid="workspace-overflow-report"]');
    expect(item.attributes("title")).toBe("Report conversation");
    await item.trigger("click");
    expect(wrapper.emitted("report")).toHaveLength(1);
  });

  it("sits in the non-destructive section, above the divider (PRD §11.5)", () => {
    const wrapper = mountHeader("idle");
    const siblings = Array.from(
      wrapper.get('[data-testid="workspace-overflow-report"]')
        .element.parentElement?.children ?? []
    );
    const reportIdx = siblings.findIndex(
      (el) =>
        (el as HTMLElement).getAttribute?.("data-testid") ===
        "workspace-overflow-report"
    );
    expect(reportIdx).toBeGreaterThan(-1);
    const dividerIdx = siblings.findIndex((el) => el.tagName === "HR");
    expect(reportIdx).toBeLessThan(dividerIdx);
  });

  it("stays visible but disabled with the reason announced when reporting is unavailable", () => {
    const wrapper = mountHeader("idle", {
      reportEnabled: false,
      reportDisabledReason: REPORT_UNAVAILABLE,
    });
    const item = wrapper.get('[data-testid="workspace-overflow-report"]');
    expect(item.attributes("disabled")).toBeDefined();
    expect(item.attributes("subtitle")).toBe(REPORT_UNAVAILABLE);
  });

  it("disables the item while capability fetch is in flight", () => {
    const wrapper = mountHeader("idle", { reportLoading: true });
    expect(
      wrapper
        .get('[data-testid="workspace-overflow-report"]')
        .attributes("disabled")
    ).toBeDefined();
  });

  it("renders no reason subtitle and stays clickable when enabled", () => {
    const wrapper = mountHeader("idle");
    const item = wrapper.get('[data-testid="workspace-overflow-report"]');
    // Unstubbed custom element renders :disabled="false" as disabled="false".
    expect(item.attributes("disabled")).toBe("false");
    expect(item.attributes("subtitle")).toBeUndefined();
  });
});
```

(The harness has no Vuetify plugin — `v-list-item` renders as an opaque custom element whose props surface as attributes; `data-testid` strings stay exact.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test:components test/vitest/main/components/AiChatConversationHeader.test.ts`
Expected: the new describe fails — `wrapper.get('[data-testid="workspace-overflow-report"]')` throws because the item does not exist yet.

- [ ] **Step 3: Implement in `AiChatConversationHeader.vue`**

Template — insert this item between the Background Agents item (ends `data-testid="workspace-overflow-agent-tasks"`) and `<v-divider role="separator" />`:

```vue
          <v-list-item
            role="menuitem"
            :title="t('aiConversationReport.action') || 'Report conversation'"
            :subtitle="reportDisabledReason || undefined"
            prepend-icon="mdi-flag-outline"
            data-testid="workspace-overflow-report"
            :disabled="!reportEnabled || reportLoading"
            @click="emit('report')"
          />
```

Script — convert `defineProps` to `withDefaults` keeping every existing prop, adding:

```ts
const props = withDefaults(
  defineProps<{
    title: string | null;
    runtimeStatus: ConversationRuntimeStatus;
    recovering: boolean;
    activeToolCount: number;
    inspectorOpen: boolean;
    hasConversation: boolean;
    /** Active goal objective, when shared orchestration exposes one. */
    goalObjective?: string | null;
    /** Active/paused scheduled-loop status, when one exists. */
    loopStatus?: string | null;
    /** False when conversation reporting is off/fail-closed (PRD §11.4). */
    reportEnabled?: boolean;
    /** Content-report capability fetch in flight. */
    reportLoading?: boolean;
    /** Disabled reason shown as the item subtitle; empty when enabled. */
    reportDisabledReason?: string;
  }>(),
  { reportEnabled: false, reportLoading: false, reportDisabledReason: "" }
);
```

And add to `defineEmits`: `(e: "report"): void;`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test:components test/vitest/main/components/AiChatConversationHeader.test.ts`
Expected: PASS (all existing describes included). The `subtitle`; when the harness i18n lacks the key, that assertion is key-string robust — do not assert exact unavailable copy here.

- [ ] **Step 5: Commit**

```bash
git add src/views/components/aiChatWorkspace/AiChatConversationHeader.vue test/vitest/main/components/AiChatConversationHeader.test.ts
git commit -m "feat: add report conversation item to chat header overflow menu"
```

### Task 2: Wire the header to the dialog; remove the strip button

**Files:**
- Modify: `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue` (header attrs ~lines 3–23; strip button remove ~lines 145–152 — keep the `<template v-if="conversationId">` wrapper, only remove the `<AIConversationReportButton>` element and its inner comment; delete import at ~line 745)
- Test: `test/vitest/main/components/AiChatCenterSurface.test.ts` (HeaderStub ~lines 330–348; report tests ~lines 1772–1825)

**Interfaces:**
- Consumes: Task 1's props (`reportEnabled`/`reportLoading`/`reportDisabledReason`) and `"report"` emit; the surface's existing `conversationReportEnabled`, `reportCapabilitiesLoading`, `conversationReportDisabledReason`, `onOpenConversationReport`.
- Produces: nothing downstream.

- [ ] **Step 1: Update the failing tests in `AiChatCenterSurface.test.ts`**

1. Extend `HeaderStub`: add props `"reportEnabled", "reportLoading", "reportDisabledReason"`, add `"report"` to emits, and append this button inside the header template:

```ts
'<button data-testid="header-report-stub" @click="$emit(\'report\')" />' +
```

2. In "marks conversation-report selected outputs as reported (FR-RPT-009 B04)" (~line 1772), replace the trigger:

```ts
      // Report entry moved into the header overflow menu: emit the same
      // event the real menu item emits.
      wrapper
        .findComponent({ name: "AiChatConversationHeader" })
        .vm.$emit("report");
```

3. In "preserves reported markers across a center remount (AD-005 B04)" (~line 1800), make the same replacement on `first` (it is the only replacement in that test).

4. Add inside the same `describe("report and generated-image actions", ...)`:

```ts
    it("exposes the report entry only through the header menu (strip button removed)", async () => {
      const wrapper = await mountWithSelection();
      // The strip-level flag button is gone; the header item is the sole entry.
      expect(wrapper.find('[data-testid="report-conversation"]').exists()).toBe(
        false
      );
      const header = wrapper.findComponent({ name: "AiChatConversationHeader" });
      // Harness leaves the capabilities channel unmocked → fail-closed
      // disabled state with an announced reason.
      expect(header.props("reportEnabled")).toBe(false);
      expect(
        String(header.props("reportDisabledReason")).length
      ).toBeGreaterThan(0);
      // Opening flows through the header's report event.
      header.vm.$emit("report");
      await flushPromises();
      expect(
        wrapper.findComponent({ name: "AIConversationReportDialog" }).exists()
      ).toBe(true);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test:components test/vitest/main/components/AiChatCenterSurface.test.ts`
Expected: FAIL — the two updated tests fail on `expect(dialog.exists()).toBe(true)` (the stub emits `report`, but the surface has no `@report` listener yet, so the dialog never opens), and the new test fails on `report-conversation` still existing in the strip and `reportEnabled` being undefined before the header attrs are wired.

- [ ] **Step 3: Implement in `AiChatCenterSurface.vue`**

Template — inside `<AiChatConversationHeader>` add after the existing event bindings (`@delete="onDelete"`):

```vue
      :report-enabled="conversationReportEnabled"
      :report-loading="reportCapabilitiesLoading"
      :report-disabled-reason="conversationReportDisabledReason"
      @report="onOpenConversationReport"
```

Template — in `chat-center__workspace-strip`, delete exactly:

```vue
        <AIConversationReportButton
          :enabled="conversationReportEnabled"
          :loading="reportCapabilitiesLoading"
          :disabled-reason="conversationReportDisabledReason"
          compact
          @open="onOpenConversationReport"
        />
```

(Keep `<template v-if="conversationId">` and the history-toggle / `AiChatCompactionStatus` that follow.)

Script — delete the now-unused import:

```
import AIConversationReportButton from "@/views/components/aiContentReport/AIConversationReportButton.vue";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test:components test/vitest/main/components/AiChatCenterSurface.test.ts`
Expected: PASS (all describes intact).

- [ ] **Step 5: Full component gate + commit**

Run: `yarn test:components`
Expected: PASS repo-wide (includes `AIConversationReportButton.test.ts`, which must remain green for AiChatV2).

```bash
git add src/views/components/aiChatWorkspace/AiChatCenterSurface.vue test/vitest/main/components/AiChatCenterSurface.test.ts
git commit -m "feat: move conversation report entry into chat overflow menu"
```
