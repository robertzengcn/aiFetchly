---
phase: 13-global-context-and-built-in-slash-commands
plan: 04
type: execute
wave: 4
depends_on: [03b]
files_modified:
  - src/preload.ts
  - src/views/api/slashCommands.ts
  - src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue
  - src/views/components/aiChatV2/AiChatV2Composer.vue
  - src/views/components/aiChatV2/AiChatV2.vue
autonomous: false
requirements: [CMD-05]
must_haves:
  truths:
    - "Typing '/' as the first character of the composer draft opens the slash-suggestions dropdown populated with the four built-in commands (CMD-05)"
    - "Each suggestion shows name, description, source badge (Built-in/User/Workspace/Plugin), argument hint, and disabled-or-trust state (CMD-05)"
    - "Arrow-key navigation moves the highlight; Enter or Tab chooses the highlighted command; Shift+Enter still inserts a newline (CMD-05 + Pitfall 4)"
    - "Selecting a command does NOT also submit the message (Pitfall 4: Enter/Tab are intercepted when the dropdown is open and an item is highlighted)"
    - "List responses from main process carry metadata only (no full prompt body) — the renderer never displays raw command bodies (TRS-07 / design §14.2)"
    - "The renderer subscribes to AIFETCHLY_CONFIG_CHANGED and refreshes its local command cache when the event fires (design §16.3, §18.2)"
    - "Dispatching a built-in command renders its show_result content; dispatching a prompt command (phase 15+) would route the submit_prompt through the existing AI_CHAT_V2_STREAM path (not exercised in phase 13 but the code path exists)"
  artifacts:
    - "src/views/api/slashCommands.ts — windowInvoke wrappers: listSlashCommands/dispatchSlashCommand/reloadAifetchlyConfig/getAifetchlyConfigStatus + onAifetchlyConfigChanged subscriber"
    - "src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue — new dropdown component (name/desc/source badge/arg hint/arrow+Enter+Tab nav)"
    - "src/views/components/aiChatV2/AiChatV2Composer.vue — modified: '/' detection, dropdown hosting, Enter/Tab interception, command-submit emit"
    - "src/views/components/aiChatV2/AiChatV2.vue — modified: subscribe onAifetchlyConfigChanged, refresh local command cache, handle command-submit"
    - "src/preload.ts — five new whitelist entries (4 invoke + 1 receive + matching removeListener entries)"
  key_links:
    - "AiChatV2Composer detects leading '/' -> shows AiChatV2SlashSuggestions -> on Enter/Tab emits 'command-submit' with the chosen command name"
    - "AiChatV2.vue on 'command-submit' -> dispatchSlashCommand -> on show_result renders content, on submit_prompt routes through existing send path"
    - "preload.invoke whitelist gates SLASH_COMMAND_LIST/DISPATCH + AIFETCHLY_CONFIG_RELOAD/STATUS; preload.receive gates AIFETCHLY_CONFIG_CHANGED (Pitfall 3)"
  prohibitions:
    - "No imports of fs/path/os.homedir or the config-root path literal anywhere under src/views/** (TRS-07 — enforced by Plan 05 boundary test)"
    - "No child_process imports in renderer"
    - "No direct ipcRenderer.send/invoke bypassing the preload whitelist"
    - "No modification to src/views/components/aiChat/AiChatBox.vue (the 1800-line legacy component — STATE.md blocker, Pitfall 7)"
    - "No fuzzy search / ghost-text / aliases ranking beyond Plan 02's deterministic ranking (FUT-01 — deferred beyond v2.0)"
---

<objective>
Build the renderer half of the slash-command surface: the preload whitelist entries, the renderer API wrappers, the suggestions dropdown component, and the composer integration that detects '/', navigates suggestions, intercepts Enter/Tab, and routes command submissions.

Purpose: Make slash commands usable from the AiChatV2 composer (CMD-05). This is the user-visible half of the feature; everything in Plans 01-03 is invisible backend.
Output: One new Vue component, one new renderer API file, modifications to preload.ts (whitelists), AiChatV2Composer.vue (dropdown + key handling), and AiChatV2.vue (subscription + dispatch routing). Optional component test.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/13-global-context-and-built-in-slash-commands/13-RESEARCH.md
@docs/prd/aifetchly-local-extensibility-technical-design.md
@src/preload.ts
@src/views/components/aiChatV2/AiChatV2Composer.vue
</context>

<tasks>

<task type="auto">
  <name>Task 1: Preload whitelist entries + renderer API wrappers (Pitfall 3 dual whitelists)</name>
  <files>
    src/preload.ts,
    src/views/api/slashCommands.ts
  </files>
  <read_first>
    - docs/prd/aifetchly-local-extensibility-technical-design.md section §17.2 (preload API shape — namespaced vs flat; research recommends FLAT to match workspace.ts)
    - src/preload.ts lines 333-543 — the FOUR whitelists: send (337), receive (393), removeListener (458), removeAllListeners (520), invoke (540). Pitfall 3 is forgetting one of these.
    - src/views/api/workspace.ts — the structural analog: a flat windowInvoke wrapper file. Mirror its import shape (windowInvoke from @/views/utils/apirequest, channel constants from @/config/channellist).
    - src/views/utils/apirequest.ts — confirm windowInvoke throws on status:false and windowReceive signature
    - src/config/channellist.ts (from Plan 03) — confirm the five channel constant names
    - src/entityTypes/slashCommandTypes.ts (from Plan 02/03) — confirm SlashCommandListResponse, SlashCommandDispatchRequest, SlashCommandDispatchResponse, AIFetchlyConfigChangedEvent shapes
  </read_first>
  <action>
    Modify src/preload.ts (Edit — add to each of the FOUR whitelists):
      - In the `invoke` whitelist (around line 540+): add SLASH_COMMAND_LIST, SLASH_COMMAND_DISPATCH, AIFETCHLY_CONFIG_RELOAD, AIFETCHLY_CONFIG_STATUS. Add them adjacent to the existing AI_CHAT_V2_* block for cohesion. Import the constants from @/config/channellist at the top of the file (extend the existing import statement).
      - In the `receive` whitelist (around line 393-444): add AIFETCHLY_CONFIG_CHANGED.
      - In the `removeListener` whitelist (around line 458-508): add AIFETCHLY_CONFIG_CHANGED (must mirror receive — Pitfall 3).
      - removeAllListeners (around line 520-535): add AIFETCHLY_CONFIG_CHANGED so the renderer can clean up on unmount.
      - CRITICAL: the channel NAME strings must exactly match the constants in channellist.ts (slash-command:list, slash-command:dispatch, aifetchly-config:reload, aifetchly-config:status, aifetchly-config:changed). Use the imported constants, NOT string literals, so a typo is impossible.

    Create src/views/api/slashCommands.ts: flat windowInvoke wrappers (mirror src/views/api/workspace.ts). Export:
      - async listSlashCommands(req: { conversationId?: string; query?: string }): Promise<SlashCommandListResponse> — windowInvoke(SLASH_COMMAND_LIST, req).
      - async dispatchSlashCommand(req: SlashCommandDispatchRequest): Promise<SlashCommandDispatchResponse> — windowInvoke(SLASH_COMMAND_DISPATCH, req).
      - async reloadAifetchlyConfig(req?: { conversationId?: string }): Promise<AIFetchlyConfigReloadResponse> — windowInvoke(AIFETCHLY_CONFIG_RELOAD, req ?? {}).
      - async getAifetchlyConfigStatus(req?: { conversationId?: string }): Promise<AIFetchlyConfigStatusResponse> — windowInvoke(AIFETCHLY_CONFIG_STATUS, req ?? {}).
      - function onAifetchlyConfigChanged(callback: (event: AIFetchlyConfigChangedEvent) => void): () => void — uses windowReceive(AIFETCHLY_CONFIG_CHANGED, callback) and returns an unsubscribe function that calls windowRemoveListener. Mirror the existing on* subscriber pattern in workspace.ts or other api files.
      - All wrappers use the t() i18n fallback pattern only for any locally-rendered error strings; the command display strings themselves come from Plan 05's i18n keys.
  </action>
  <verify>
    <automated>yarn vue-check 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - yarn vue-check (Vue TypeScript type checking) exits 0
    - All five channels appear in preload.ts: `grep -c "SLASH_COMMAND_LIST\|SLASH_COMMAND_DISPATCH\|AIFETCHLY_CONFIG_RELOAD\|AIFETCHLY_CONFIG_STATUS" src/preload.ts` returns at least 4 (invoke whitelist)
    - `grep -c "AIFETCHLY_CONFIG_CHANGED" src/preload.ts` returns at least 3 (receive + removeListener + removeAllListeners — Pitfall 3)
    - `grep -c "listSlashCommands\|dispatchSlashCommand\|reloadAifetchlyConfig\|getAifetchlyConfigStatus\|onAifetchlyConfigChanged" src/views/api/slashCommands.ts` returns at least 5 (all wrappers exported)
    - src/views/api/slashCommands.ts has NO fs/path imports: `! grep -E "from ['\"]fs|from ['\"]path|from ['\"]os" src/views/api/slashCommands.ts` exits 0 (TRS-07 — renderer API never touches filesystem)
  </acceptance_criteria>
  <done>
    Five IPC channels are whitelisted across all four preload whitelists. Renderer API exposes typed wrappers + a config-changed subscriber. No filesystem imports in the renderer API file.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: AiChatV2SlashSuggestions dropdown + composer integration + AiChatV2 subscription (CMD-05, Pitfall 4 Enter-key conflict)</name>
  <files>
    src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue,
    src/views/components/aiChatV2/AiChatV2Composer.vue,
    src/views/components/aiChatV2/AiChatV2.vue
  </files>
  <read_first>
    - docs/prd/aifetchly-local-extensibility-technical-design.md sections §18.1 (composer changes), §18.2 (AiChatV2 subscription + command routing), §18.3 (status display), §16.3 (renderer refresh on config-changed), §21.5 (component test optional — manual fallback OK)
    - src/views/components/aiChatV2/AiChatV2Composer.vue — the FULL 94-line file. Read the existing onKeydown (lines 62-67) to understand the Enter-without-Shift -> onSend behavior that MUST be intercepted when the suggestions dropdown is open (Pitfall 4).
    - src/views/components/aiChatV2/AiChatV2.vue — read to find where the composer is mounted, where conversation/stream state lives, and where to add the config-changed subscription + command-submit handler. (If AiChatV2.vue is large, focus on the script-setup section and the composer mount site.)
    - src/views/components/aiChatV2/WorkspaceBadge.vue — the badge pattern to mirror for the source badge (Built-in/User/Workspace/Plugin colors).
    - src/views/components/aiChatV2/WorkspaceRequiredCard.vue — second sibling component for Vuetify styling conventions in this folder
    - .planning/phases/13-global-context-and-built-in-slash-commands/13-RESEARCH.md Pitfall 4 (Enter-key conflict) and Pitfall 7 (do NOT touch AiChatBox.vue)
    - src/views/api/slashCommands.ts (from Task 1) — confirm the wrapper signatures the components call
  </read_first>
  <action>
    Create AiChatV2SlashSuggestions.vue, modify AiChatV2Composer.vue, modify AiChatV2.vue.

    File 1 — src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue (NEW): a presentational dropdown.
      - Props: commands: readonly SlashCommandView[]; highlightedIndex: number; open: boolean.
      - Emits: 'select' (index: number) — when Enter/Tab/click chooses an item; 'close' — when Escape or outside-click.
      - Template (Vuetify, scoped styles matching the aiChatV2/ folder): a v-list of the commands. Each row shows: name (mono font), description (truncated), a source badge (color-coded by source — Built-in=primary, User=info, Workspace=warning, Plugin=secondary — mirror WorkspaceBadge.vue colors), optional argumentHint (muted), and a disabled overlay + disabledReason if !enabled.
      - Highlighted row gets a background tint (Vuetify's hover/active class). Scroll the highlighted row into view on highlight change (use a template ref + watchEffect on highlightedIndex — keep it simple).
      - Localize all labels via t('slashCommands.*') with English fallback per CLAUDE.md i18n rule. (Plan 05 adds the full 6-language coverage; this task may use English fallback strings for any keys Plan 05 hasn't landed yet — t('slashCommands.noMatches') || 'No matching commands'.)
      - ARIA: role="listbox", each item role="option", aria-selected on the highlighted item.

    File 2 — src/views/components/aiChatV2/AiChatV2Composer.vue (MODIFY via Edit — keep the existing structure, add slash state):
      - Add reactive state: slashOpen (boolean), slashCommands (SlashCommandView[]), slashHighlighted (number).
      - Add a watcher on draft.value: if draft.value.trimStart().startsWith('/') and length is 1+ -> open the dropdown and call listSlashCommands({ conversationId, query: draft.value }) to populate (debounce lightly — 100ms — or just fetch on '/' open and filter locally per design §16.3; the latter is cheaper). If the draft no longer starts with '/' after left-trim, close the dropdown.
      - In the template, host <AiChatV2SlashSuggestions> directly above the v-textarea (or absolutely positioned below it) bound to the reactive state.
      - MODIFY onKeydown (Pitfall 4 — the critical change): BEFORE the existing Enter-without-Shift -> onSend branch, check `if (slashOpen.value && slashHighlighted.value >= 0)`: if event.key === 'Enter' OR event.key === 'Tab' -> event.preventDefault(); emit('command-select', slashCommands.value[slashHighlighted.value]); return (do NOT fall through to onSend). If event.key === 'ArrowDown' -> slashHighlighted = (slashHighlighted + 1) % commands.length; preventDefault. If event.key === 'ArrowUp' -> slashHighlighted = (slashHighlighted - 1 + commands.length) % commands.length; preventDefault. If event.key === 'Escape' -> slashOpen = false; preventDefault.
      - The EXISTING Shift+Enter newline behavior (Enter + shiftKey -> newline) is preserved because the intercept only fires when slashOpen && highlighted >= 0.
      - Add new emits: 'command-select' (command: SlashCommandView).
      - Keep the existing 'send' and 'stop' emits unchanged.

    File 3 — src/views/components/aiChatV2/AiChatV2.vue (MODIFY via Edit):
      - In script-setup, import onAifetchlyConfigChanged, listSlashCommands, dispatchSlashCommand from @/views/api/slashCommands.
      - On mounted: subscribe onAifetchlyConfigChanged(() => { /* refresh local command count / status if shown */ }) and store the unsubscribe function. On unmounted: call it (cleanup).
      - Add a handler onCommandSelect(command: SlashCommandView): async — calls dispatchSlashCommand({ conversationId, rawInput: '/' + command.name }). On response: if action === 'show_result' -> render the content into the conversation as a system/result message (mirror how tool results are displayed; if no clean path exists, render as an assistant message tagged 'system-result'). If action === 'submit_prompt' -> route through the existing send path (set the composer draft to the prompt and call the existing onSend). If status === false -> show a transient error toast / inline message with the msg. (Phase 13 exercises only show_result from built-ins + status:false from unknown commands.)
      - Special-case /clear: when the dispatcher returns /clear's show_result guidance, the AiChatV2 ALSO invokes the existing AI_CHAT_V2_CLEAR_CONVERSATION path (the clear built-in returns guidance, the renderer performs the actual clear via the existing channel — do NOT reimplement clear here). Reuse the existing clear_confirm_title/clear_confirm_body i18n keys + confirmation flow before calling AI_CHAT_V2_CLEAR_CONVERSATION — do NOT add a new confirmation dialog (the existing clear path at ai-chat-v2-ipc.ts:887 owns confirmation).
      - Wire <AiChatV2Composer @command-select="onCommandSelect" ... /> in the template.

    NO component test is strictly required (design §21.5 permits manual QA). If the renderer component harness at test/vitest/main/components/vitest.config.mjs is healthy, add a minimal AiChatV2SlashSuggestions.test.ts covering: renders the list, highlights on prop change, emits 'select' on item click. Otherwise defer to manual QA (covered by the checkpoint below).
  </action>
  <verify>
    <automated>yarn vue-check 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - yarn vue-check exits 0
    - The new component exists: `test -f src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue`
    - Composer intercepts Enter/Tab when dropdown open: `grep -c "slashOpen\|command-select" src/views/components/aiChatV2/AiChatV2Composer.vue` returns at least 2 (Pitfall 4 wiring)
    - Arrow navigation present: `grep -c "ArrowDown\|ArrowUp" src/views/components/aiChatV2/AiChatV2Composer.vue` returns at least 2
    - AiChatV2 subscribes to config changes: `grep -c "onAifetchlyConfigChanged" src/views/components/aiChatV2/AiChatV2.vue` returns at least 1
    - AiChatV2 routes command dispatch: `grep -c "dispatchSlashCommand\|onCommandSelect" src/views/components/aiChatV2/AiChatV2.vue` returns at least 2
    - Source badge rendering: `grep -c "source\|Built-in\|sourceLabel" src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue` returns at least 1
    - The legacy AiChatBox.vue is UNTOUCHED: `git diff --name-only src/views/components/aiChat/AiChatBox.vue` returns empty (Pitfall 7 — STATE.md blocker)
    - No fs/path/os imports in the new renderer files: `! grep -rE "from ['\"]fs|from ['\"]path|from ['\"]os|require\(['\"]fs" src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue src/views/api/slashCommands.ts` exits 0 (TRS-07)
  </acceptance_criteria>
  <done>
    Typing '/' opens the dropdown; arrow keys navigate; Enter/Tab select (without submitting); Shift+Enter still inserts a newline; the renderer refreshes on config changes; built-in dispatch renders show_result content. The legacy AiChatBox.vue is untouched.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Human-verify the slash-suggestions UX end-to-end (CMD-05 + Pitfall 4 + live AGENTS.md reload)</name>
  <files>n/a (human verification checkpoint)</files>
  <action>
    Human verification checkpoint. Claude has automated everything possible (vue-check, grep gates). The remaining verifications are interactive: typing '/' in a live composer, pressing arrow keys, observing whether Enter submits vs selects, and confirming a live AGENTS.md change appears in the next AI response. See <what-built> and <how-to-verify> for the exact steps.
  </action>
  <verify>
    <automated>yarn vue-check && git diff --name-only src/views/components/aiChat/AiChatBox.vue | grep -c AiChatBox.vue | grep -q '^0$' && echo "vue-check passes + legacy AiChatBox.vue untouched"</automated>
    <human-check>
      Follow the 9 steps in <how-to-verify>. Type "approved" or describe issues as the resume signal.
    </human-check>
  </verify>
  <done>Human confirms the slash-suggestions UX works end-to-end in the running app (dropdown opens on '/', arrow nav works, Enter/Tab select without submitting, Shift+Enter inserts newline, built-in dispatch renders content, live AGENTS.md reload reflects in the next AI response).</done>
  <what-built>
    The slash-suggestions UX end-to-end: typing '/' in the AiChatV2 composer opens a dropdown of the four built-in commands with source badges; arrow keys navigate; Enter/Tab select a command and dispatch it; Shift+Enter still inserts a newline; selecting a command does NOT also submit the message. Plan 05 will add the full 6-language translations; this checkpoint may run with English fallback strings.
  </what-built>
  <how-to-verify>
    Prerequisites: Plans 01-03 have landed (backend + IPC + startup). Start the development server in a tmux session (per the project convention — the repo's dev script is in package.json; run it inside tmux so logs are accessible). Then open the AiChatV2 chat panel in the running app.
    1. Click the composer textarea. Type '/' as the first character. EXPECT: a dropdown appears with /help, /clear, /status, /reload-config, each showing a "Built-in" source badge.
    2. Press ArrowDown twice. EXPECT: the highlight moves to the second then third item; the highlighted row scrolls into view if needed.
    3. Press ArrowUp once. EXPECT: highlight moves back to the second item.
    4. Press Enter on the highlighted /status. EXPECT: the dropdown closes; a result message appears showing "AiFetchly configuration status: Commands: 4, Diagnostics: 0, Watcher: not started (phase 14)"; the composer draft is cleared or reset; NO message is submitted to the AI (verify the message did NOT go to the stream).
    5. Type '/help' and press Enter. EXPECT: a result message lists the available commands.
    6. Type '/unknown'. EXPECT: either the dropdown filters to no matches, or pressing Enter shows "Unknown slash command: /unknown".
    7. Type '/' then press Escape. EXPECT: dropdown closes.
    8. Hold Shift and press Enter in an empty composer. EXPECT: a newline is inserted (NOT a submission). Release Shift, type a normal message, press Enter. EXPECT: the message submits normally (the existing behavior is preserved when no dropdown is open).
    9. Create ~/.aifetchly/AGENTS.md with a distinctive instruction. Run '/reload-config'. EXPECT: the result shows reloaded counts. Send a chat message; EXPECT: the AI response reflects the new AGENTS.md instruction (success criterion 1 + 3).
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues (e.g., "Enter submits the message even with dropdown open", "dropdown doesn't populate", "/status returns no content")</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Main process -> renderer (AIFETCHLY_CONFIG_CHANGED + list/dispatch responses) | Typed metadata crosses into the renderer. The renderer must never receive raw prompt bodies or file paths beyond display-safe labels. |
| Renderer -> main process (dispatch raw input) | The composer draft (user-typed text) crosses to main via dispatch. Already protected by zod validation in registerValidatedHandler. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-13-06 | Info Disclosure | SlashCommandView in suggestions UI (design §14.2) | medium | mitigate | listViews() (Plan 02) strips body+metadata; the renderer only displays name/description/aliases/source/argumentHint/enabled/disabledReason. Renderer API file has no fs imports (TRS-07 grep gate). |
| T-13-Key | Tampering (UX) | Composer Enter-key intercept (Pitfall 4) | medium | mitigate | When the dropdown is open and an item is highlighted, Enter/Tab are intercepted with preventDefault and do NOT fall through to onSend. Shift+Enter newline preserved. Verified by the human-verify checkpoint (step 4 + 8). |
| T-13-Inject | Spoofing | Suggestion content rendering | low | mitigate | Vue's default template escaping prevents HTML injection from command names/descriptions. Do NOT use v-html for suggestion content. |
| T-13-SC | Tampering | Package installs | n/a | accept | Zero new packages (Vuetify + Vue already present). |
</threat_model>

<verification>
- yarn vue-check exits 0 (Vue + TS type checking)
- Manual human-verify checkpoint (9 steps) covers the CMD-05 UX + the Enter-key conflict (Pitfall 4) + the live AGENTS.md reload (success criterion 1 + 3)
- No fs/path/os imports in src/views/api/slashCommands.ts or AiChatV2SlashSuggestions.vue (TRS-07 grep)
- Legacy AiChatBox.vue untouched (git diff check — Pitfall 7)
</verification>

<success_criteria>
- Slash suggestions dropdown renders with name/description/source badge/argument hint/disabled state (CMD-05).
- Arrow-key navigation + Enter/Tab selection + Shift+Enter newline all work correctly (Pitfall 4 resolved).
- Built-in dispatch renders show_result content; the message is NOT submitted to the AI stream.
- Renderer subscribes to config changes and refreshes its cache.
- The legacy AiChatBox.vue is not modified.
</success_criteria>

<output>
Create `.planning/phases/13-global-context-and-built-in-slash-commands/13-04-SUMMARY.md` when done.

## Artifacts this phase produces (Plan 04 contribution)

**Renderer API (src/views/api/slashCommands.ts):**
- listSlashCommands, dispatchSlashCommand, reloadAifetchlyConfig, getAifetchlyConfigStatus
- onAifetchlyConfigChanged (subscriber with unsubscribe)

**Components (src/views/components/aiChatV2/):**
- AiChatV2SlashSuggestions.vue (NEW — dropdown with source badges + arrow/Enter/Tab nav)
- AiChatV2Composer.vue (MODIFIED — slash state, dropdown hosting, Enter/Tab intercept, command-select emit)
- AiChatV2.vue (MODIFIED — onAifetchlyConfigChanged subscription, onCommandSelect dispatch routing)

**Preload (src/preload.ts):**
- 4 invoke entries (SLASH_COMMAND_LIST/DISPATCH + AIFETCHLY_CONFIG_RELOAD/STATUS)
- 1 receive entry + matching removeListener + removeAllListeners entries (AIFETCHLY_CONFIG_CHANGED — Pitfall 3)
</output>
