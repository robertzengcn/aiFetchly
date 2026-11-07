# Docked Inspector Column (Push Layout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking the sidebar toggle opens the inspector as the shell's third flex column ([left nav][center][inspector]) on wide screens — content shrinks/reflows instead of being covered; narrow/medium keep the floating drawer.

**Architecture:** `AppInspectorHost` renders its inspector inline in `.app-workspace-shell` (drop the `<Teleport to="body">`; the shell owns the mount, routes don't remount it). Both inspector surfaces (chat + schedule) rework their `position: fixed` docked rules into in-flow participation so the inline `width` preference + resizer drive a real column. Overlay-mode CSS (drawer on narrow/medium) is unchanged.

**Tech Stack:** Vue 3 SFC (Teleport removal, scoped CSS), Pinia, Vitest + @vue/test-utils, Playwright e2e (drill re-run as regression gate).

**Spec:** `docs/superpowers/specs/2026-10-26-inspector-docked-column-design.md`

## Global Constraints

- UI change and its tests land in one commit; `yarn test:components` green afterwards (hard gate).
- No `any`; explicit return types; i18n untouched (no new strings).
- Narrow/medium keep `overlay` drawer behavior (user-approved default).
- Work happens directly on `dev` (session-consented pattern; no worktree).
- Do NOT run `yarn package`/`yarn make` locally.

## Review Focus

1. **Inspector must NOT teleport to `document.body` anymore** — expected: panel renders as a shell flex child. Pinned: Task 1 topology test (`body child must be null; wrapper contains panel`).
2. **Docked chat inspector must be in-flow** — no `position: fixed`; JS cannot test flex layout in jsdom, so pin via `?raw` source on `.workspace-inspector.docked`. Pinned: Task 2 Step 1.
3. **Schedule inspector must be in-flow on wide, drawer on narrow** — pin via `?raw`: `.app-inspector` declares `position: relative`, `.app-inspector.overlay` declares `position: absolute`. Pinned: Task 2 Step 4.
4. **Overlay drawer kept on narrow/medium** — existing overlay-mode behavior/props untouched; regression caught by Task 3's full component suite + the drill e2e (which exercises adapter-off artifacts fallback + activity panels through the real inspector).
5. **Resize + width prefs unchanged** — no resizer logic edits; existing close/resize tests must stay green (Task 2 Step 5 run).

---

### Task 1: Host renders inline (no body teleport) + topology test

**Files:**
- Modify: `src/views/components/appShell/AppInspectorHost.vue` (drop `<Teleport to="body">`)
- Create: `test/vitest/main/components/AppInspectorHost.test.ts`

**Interfaces:**
- Consumes: `useAppInspectorStore` (`inspector.target`, `inspector.kind`, `requestGeneration`), `INSPECTOR_REGISTRY` (chat → ChatInspectorAdapter, schedule → ScheduleInspector).
- Produces: the inspector panel mounts as a normal child of `AppInspectorHost` (a shell flex child). Task 2's CSS work relies on the panel being in the shell row.

- [ ] **Step 1: Write the failing topology test `AppInspectorHost.test.ts`**

Store API facts (read from `src/views/store/appInspector.ts` + `uiConvergenceTypes.ts`):
`useAppInspectorStore().open(target)` / `close()`; the chat target shape is
`{ kind: "chat", ownerRoute: string, conversationId: string | null, tab: "artifacts" | "activity" | "context" }`.

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AppInspectorHost from "@/views/components/appShell/AppInspectorHost.vue";
import { useAppInspectorStore } from "@/views/store/appInspector";

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: {} } });

beforeEach(() => {
  setActivePinia(createPinia());
});

function mountHost() {
  return mount(AppInspectorHost, { global: { plugins: [i18n] } });
}

describe("AppInspectorHost — inline topology (no body teleport)", () => {
  it("renders the active chat inspector INSIDE the host, not in document.body", async () => {
    const store = useAppInspectorStore();
    const wrapper = mountHost();
    store.open({
      kind: "chat",
      ownerRoute: "/aiworkspace",
      conversationId: "conv-1",
      tab: "activity",
    });
    await flushPromises();

    const panel = wrapper.find('[data-testid="workspace-inspector"]');
    expect(panel.exists()).toBe(true);
    // The host is a shell flex child; the panel must live there — a
    // body-teleported panel would still mount but outside the layout row.
    expect(document.querySelector("body > [data-testid='workspace-inspector']")).toBeNull();

    // Closing empties the host again.
    store.close();
    await flushPromises();
    expect(wrapper.find('[data-testid="workspace-inspector"]').exists()).toBe(false);
  });
});
```

Mount notes (fixed decisions, not TBD):
- The real `ChatInspectorAdapter` mounts; it reads pinia stores (defaults fine offline) and stubs nothing.
- `useWorkspaceRolloutAdapters` may fetch flags on mount — vi.mock its API module (`grep useWorkspaceRolloutAdapters` for the import; mock that fetch to resolve the default-on flags), otherwise the panel still renders but may spam console rejects.
- The REAL `AiChatInspector` must mount for the testid to exist (it reads i18n via `useI18n` — the i18n plugin above carries the `workspaceChat.inspector.*` keys copied from `AiChatInspector.test.ts` lines 11–21).

- [ ] **Step 2: Run it — expect FAIL because the content teleports to body**

Run: `npx vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AppInspectorHost.test.ts`
Expected: FAIL — `wrapper.find('[data-testid="workspace-inspector"]')` is empty (content teleported to body; `document.querySelector("body > …")` NOT null).

- [ ] **Step 3: Implement — remove the Teleport wrapper**

`AppInspectorHost.vue` template becomes:

```html
<component :is="inspectorComponent" v-if="inspectorComponent && inspector.target" :key="inspectorKey" />
```

(update the header comment: "renders inline in the shell's flex row (docked push column); no body teleport").

- [ ] **Step 4: Run — expect PASS**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/components/appShell/AppInspectorHost.vue test/vitest/main/components/AppInspectorHost.test.ts
git commit -m "refactor: render the inspector host inline (prep for docked push column)"
```

---

### Task 2: In-flow docked CSS on both inspector surfaces + source-level assertions

**Files:**
- Modify: `src/views/components/aiChatWorkspace/AiChatInspector.vue` (`.workspace-inspector.docked`)
- Modify: `src/views/components/appShell/inspectors/ScheduleInspector.vue` (`.app-inspector`)
- Test: `test/vitest/main/components/AiChatInspector.test.ts` plus `ScheduleInspector` skipped (no separate fixture needed — the `?raw` layout assertions live per surface in ONE guard describe each, colocated in the surfaces' existing test files; Schedule surface assertion goes in a new tiny `ScheduleInspector.test.ts`? NO — see plan: create `test/vitest/main/components/ScheduleInspectorLayout.test.ts` orchestrating the `?raw` assertion only)

**Interfaces:**
- Consumes: Task 1's inline mounting (panel is a shell flex child).
- Produces: wide = in-flow push column; overlay (narrow) = absolute drawer with same width/shadow.

- [ ] **Step 1: RED — add `?raw` assertions to `AiChatInspector.test.ts`**

```ts
describe("AiChatInspector docked layout (push column, not fixed)", () => {
  it("declares in-flow docked mode: no fixed positioning, fills shell height", async () => {
    const source = (await import("@/views/components/aiChatWorkspace/AiChatInspector.vue?raw")).default;
    const docked = /\.workspace-inspector\.docked \{[^}]*\}/.exec(source)?.[0] ?? "";
    expect(docked).toContain(".workspace-inspector.docked");
    expect(/\bposition:\s*fixed/.test(docked)).toBe(false);
    expect(/top:\s*0/.test(docked)).toBe(false);
    expect(/bottom:\s*0/.test(docked)).toBe(false);
    // In-flow participation: height follows the shell row.
    expect(/\bheight:\s*100%/.test(docked)).toBe(true);
    // No floating shadow on docked (it is a real column).
    expect(/box-shadow/.test(docked)).toBe(false);
  });
});
```

Run: header-inspector file → Expected: FAIL (docked still fixed).

- [ ] **Step 2: GREEN — rewrite the chat `.docked` rule**

`.workspace-inspector.docked` becomes:

```css
.workspace-inspector.docked {
  position: relative;
  height: 100%;
}
```

(Update the block comment to say the host renders inline in the shell row.)

- [ ] **Step 3: RED→GREEN for the Schedule surface**

Create `test/vitest/main/components/ScheduleInspectorLayout.test.ts` asserting via `?raw` on `appShell/inspectors/ScheduleInspector.vue`:

```ts
// `.app-inspector` must NOT declare position: fixed (it is a shell column
// on wide), and `.app-inspector.overlay` MUST declare position: absolute
// + the drawer width/shadow (narrow drawer).
expect(/\bposition:\s*fixed/.test(baseRule)).toBe(false);
expect(/\bheight:\s*100%/.test(baseRule)).toBe(true);
expect(/position:\s*absolute/.test(overlayRule)).toBe(true);
```

Run it — then apply to `ScheduleInspector.vue`:

- `.app-inspector` becomes `position: relative; height: 100%;` (drop `top/right/bottom/z-index` — it sits inside the hidden-overflow shell row; keep display/background/border).
- `.app-inspector.overlay` gains `position: absolute; top: 0; right: 0; bottom: 0; z-index: 30;` and keeps `width: min(92vw, 520px); box-shadow: …`.

- [ ] **Step 4: Run both test files — expect PASS**

- [ ] **Step 5: Whole-suite regression gate**

Run: `yarn test:components` → all green (existing close/resize tests untouched and passing; no other component relied on the fixed docked panel).

- [ ] **Step 6: Commit (Task 1 + 2 are one logical unit — amend/lump into one commit sequence)**

```bash
git add src/views/components/aiChatWorkspace/AiChatInspector.vue src/views/components/appShell/inspectors/ScheduleInspector.vue test/vitest/main/components/AiChatInspector.test.ts test/vitest/main/components/ScheduleInspectorLayout.test.ts
git commit -m "feat: docked inspector becomes a real layout column (push, not overlay)"
```

---

### Task 3: Regression gates + real-app confirmation (test and confirm)

**Files:** none modified expected.

- [ ] **Step 1: Full component suite + typecheck**

Run: `yarn test:components && yarn typecheck` → green.

- [ ] **Step 2: e2e rollout drill (uses the real inspector mount)**

Run: `AIFETCHLY_E2E_RENDERER_ORIGIN=http://127.0.0.1:5173 xvfb-run -a -s "-screen 0 1920x1080x24" npx playwright test test/e2e/specs/workspaceRolloutDrill.test.ts --reporter=list` → 6/6 green (Activity/artifacts through the REAL inspector still reachable after the mount moved into the layout).

- [ ] **Step 3: Visual confirmation in the real Electron renderer**

Throwaway spec: open `#/aiworkspace`, click `workspace-inspector-toggle`, screenshot full window → verify the chat + composer SHRINK and the inspector is a right column (no shadow floating over content). Copy screenshots, Read them for the user, then DELETE the spec.

- [ ] **Step 4: Rollback-adapter check stays live**

The drill's scenario 6 gates artifacts fallback through the inspector — same run covers Review Focus #4 (narrow drawer path unaffected) since narrow uses `.overlay` (unchanged CSS branch).

- [ ] **Step 5: Report; commit any stragglers (fix-forward only)**
