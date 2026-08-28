# AI Chat-First Application Shell and Composer Refinement Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-29
- **Owner**: AiFetchly Desktop Engineering
- **Product**: AiFetchly Electron desktop application
- **Primary areas**: Application shell, authenticated routing, AI chat composer, workspace selection, local voice controls, responsive layout, Electron window sizing
- **Related product documents**:
  - [`AI Chat Workspace UI Redesign PRD`](./ai-chat-workspace-ui-redesign-prd.md)
  - [`Inner-Page UI Convergence PRD`](./inner-page-ui-convergence-prd.md)
  - [`Local sherpa-onnx Voice Chat PRD`](./local-sherpa-onnx-voice-chat-prd.md)
- **Related technical designs**:
  - [`AI Chat-First Application Shell and Composer Refinement Technical Design`](./ai-chat-first-application-shell-technical-design.md)
  - [`AI Chat Workspace UI Redesign Technical Design`](./ai-chat-workspace-ui-redesign-technical-design.md)
  - [`Inner-Page UI Convergence Technical Design`](./inner-page-ui-convergence-technical-design.md)
  - [`Local sherpa-onnx Voice Chat Technical Design`](./local-sherpa-onnx-voice-chat-technical-design.md)
- **Current implementation areas expected to evolve**:
  - `src/background.ts`
  - `src/views/router/index.ts`
  - `src/views/layout/layout.vue`
  - `src/views/components/appShell/AppWorkspaceShell.vue`
  - `src/views/components/appShell/AppCenterRouteHost.vue`
  - `src/views/components/appShell/LegacyPageFrame.vue`
  - `src/views/components/aiChatWorkspace/AiChatWorkspaceShell.vue`
  - `src/views/components/aiChatWorkspace/AiChatWorkspaceSidebar.vue`
  - `src/views/components/aiChatV2/AiChatV2.vue`
  - `src/views/components/aiChatV2/AiChatV2Composer.vue`
  - `src/views/components/aiChatV2/WorkspaceBadge.vue`

## 1. Executive Summary

AiFetchly will use the AI chat workspace as the default authenticated application layout. The workspace sidebar will remain visible while Chat, Insights, Knowledge Library, Plugins, Automations, Customize, and other authenticated routes replace only the center content. Users will no longer leave the workspace shell when opening an inner page, so the `Back to app` action will be removed.

The selected chat will regain the controls already available in the classic chat implementation. A conversation-scoped workspace chooser will appear above the transcript. The message composer will use a visibly multiline textarea. Mode, model, and tool-approval selectors will sit below the textarea. Microphone input and spoken-response controls will remain discoverable in the chat area and expose clear recording, transcription, playback, unavailable, and setup states.

The Electron application will stop maximizing itself at startup. First launch will use a centered, practical desktop size that fits the active display. Later launches will restore the user's last valid window bounds and may restore maximized state only when the user explicitly chose it.

This PRD is a focused refinement of the existing workspace redesign and inner-page convergence contracts. It does not redefine chat execution, persistence, tool safety, artifacts, or worker architecture.

## 2. Authority and Supersession

### 2.1 Authority

This document is authoritative for:

- The AI chat workspace as the default authenticated shell.
- How authenticated routes render inside that shell.
- Removal of `Back to app` from the workspace sidebar.
- Placement and behavior of the conversation workspace chooser.
- Composer textarea and control ordering.
- Voice-input and spoken-response control discoverability.
- First-launch and restored Electron window geometry.

The parent PRDs remain authoritative for background execution, conversation state, artifacts, inspectors, tools, plans, security boundaries, page-template design, and migration coverage unless this document explicitly changes a placement or shell-ownership rule.

### 2.2 Superseded assumptions

The following earlier assumptions are superseded:

1. `AiChatWorkspaceShell.vue` is not the permanent owner of a complete standalone full-window shell. Chat becomes one center surface inside the shared authenticated `AppWorkspaceShell`.
2. Insights, Knowledge Library, Plugins, and other authenticated routes must not mount the legacy application layout as a competing shell.
3. `Back to app` is not required because the workspace shell is the app.
4. Composer-scoped selectors must not render in a separate row above the textarea.
5. Voice controls must not disappear merely because the workspace shell omitted classic-chat voice-state wiring.
6. The main Electron window must not call `maximize()` unconditionally during startup.

### 2.3 Unchanged contracts

This PRD does not change:

- One trusted renderer per application window.
- Main-process ownership of AI run lifetime.
- Model/Module ownership of database access.
- The prohibition on worker-process database access.
- AI enablement checks at AI IPC entry points.
- Workspace approval and trust requirements for filesystem tools.
- Artifact sandboxing.
- Existing provider, model, plan, goal, scheduled-loop, permission, recovery, slash-command, at-mention, and attachment semantics.
- Support for English, Chinese, Spanish, French, German, and Japanese.

## 3. Background and Current State

### 3.1 What already works

- `/` redirects to `/aiworkspace`, so chat is already the landing route.
- The workspace sidebar already links to Insights, Knowledge Library, Plugins, Automations, and Customize.
- `AppWorkspaceShell.vue`, `AppCenterRouteHost.vue`, and `LegacyPageFrame.vue` provide much of the intended persistent-shell foundation.
- `AiChatV2Composer.vue` already uses `v-textarea`, supports auto-grow, attachments, microphone recording, transcription, multiline keyboard handling, and send/stop behavior.
- `AiChatV2.vue` already wires workspace selection, voice settings, voice runtime state, spoken-response state, mode, model, and tool-approval controls.
- Responsive sidebar and inspector behaviors already exist in the workspace and convergence foundations.

### 3.2 Current gaps

1. Insights, Knowledge Library, Plugins, and other inner routes still mount `Layout`, replacing the chat workspace instead of replacing only its center.
2. `AiChatWorkspaceSidebar.vue` includes `Back to app`, even though the workspace is now the default landing experience.
3. The workspace shell renders mode, model, and tool-approval controls above the composer.
4. The workspace shell invokes `AiChatV2Composer` without the voice settings and availability props used by `AiChatV2.vue`, so microphone input is absent.
5. The workspace shell does not expose the spoken-response toggle used by the classic chat.
6. The new workspace does not expose the current conversation workspace badge and setup flow in the expected position above chat.
7. The textarea starts at one row and visually resembles a single-line input despite using a textarea element.
8. `src/background.ts` creates an `800 x 600` window and immediately maximizes it.

## 4. Problem Statement

The application currently behaves as if the AI workspace and the rest of AiFetchly are separate destinations. Opening a feature removes the workspace context, and returning requires a special navigation action. At the same time, the redesigned chat omits useful controls that still exist in the classic chat implementation.

This creates four user problems:

1. **Lost orientation**: opening an inner page removes workspaces and conversations from view.
2. **Fragmented navigation**: `Back to app` implies chat is outside the application rather than its primary shell.
3. **Reduced chat capability**: workspace selection, microphone input, and spoken responses appear missing.
4. **Poor desktop startup behavior**: the application takes the entire display even when the user wants a normal resizable window.

## 5. Users and Jobs to Be Done

### 5.1 Marketing operator

The operator moves between a conversation, Insights, Knowledge Library, Plugins, and Automations while keeping current workspaces and conversations available. They should never need to reconstruct where they were after opening a feature.

### 5.2 Workspace power user

The power user needs to know which filesystem workspace a conversation can access, change it deliberately, and understand whether it is approved before asking the AI to use tools.

### 5.3 Voice user

The voice user expects microphone input and spoken responses to be visible wherever chat is available. Missing models or runtimes should produce an actionable setup state rather than silently removing controls.

### 5.4 Keyboard and assistive-technology user

The user must navigate the shell, change routes, select a workspace, compose multiline messages, configure the next message, and send or stop without relying on a pointer or color.

### 5.5 Small-display user

The user should receive a usable centered window that fits the display. The shell should adapt by converting navigation and inspector regions into overlays rather than requiring a maximized window.

## 6. Goals

1. Make the AI chat workspace the persistent default authenticated application shell.
2. Preserve the sidebar and optional inspector while authenticated center routes change.
3. Remove the conceptual division between `chat workspace` and `app`.
4. Keep conversation and workspace context continuously available.
5. Restore workspace selection, microphone input, and spoken-response controls in the redesigned chat.
6. Make the composer clearly multiline and prioritize message entry over configuration.
7. Place mode, model, and tool approval below the textarea in a stable, responsive toolbar.
8. Start the desktop application at a suitable non-maximized size.
9. Restore valid user-chosen window geometry on later launches.
10. Preserve all existing chat execution, security, accessibility, and localization guarantees.

## 7. Non-Goals

This initiative does not include:

- Redesigning the internal content of every inner page.
- Completing all 50 inner-page visual convergence migrations.
- Replacing Vue Router, Vuetify, Pinia, Electron, or the existing Model/Module architecture.
- Changing how workspaces are stored, approved, trusted, or scoped to conversations.
- Adding a new speech engine or replacing sherpa-onnx.
- Changing provider or model availability rules.
- Changing Enter-to-send semantics beyond making multiline behavior explicit.
- Creating one Electron window or renderer per route, workspace, or conversation.
- Removing the classic-chat rollback capability before its existing rollout policy allows removal.
- Adding cloud synchronization for desktop window geometry.
- Automatically maximizing the window based on screen size.

## 8. Product Principles

1. **The workspace is the application.** Chat and features share one shell rather than navigating between competing shells.
2. **Only the center changes.** Routine route navigation must preserve global orientation.
3. **Controls live where their effect occurs.** Conversation workspace controls sit above the conversation; next-message controls sit at the composer.
4. **Writing comes before configuration.** The textarea is visually primary; mode, model, and approval are secondary.
5. **Capabilities remain discoverable.** A missing runtime creates a setup path, not a mysteriously missing button.
6. **Workspace identity is explicit.** Users must see which directory the conversation can use before tool execution.
7. **Responsive layout replaces forced maximization.** The app adapts to available space rather than occupying all of it.
8. **State survives navigation.** Route changes must not cancel runs, discard drafts, or reset the selected conversation unnecessarily.
9. **One control, one meaning.** Workspace grouping and conversation workspace selection must remain visually and behaviorally distinct.
10. **Accessibility is part of the interaction contract.** Keyboard order, names, states, and announcements are specified behavior.

## 9. Fixed Product Decisions

The following are requirements, not open implementation choices:

1. `/` resolves to the AI chat center surface inside the authenticated workspace shell.
2. Login and unauthenticated utility surfaces remain outside the authenticated shell.
3. Authenticated feature routes render in the shell center through Vue Router.
4. The left sidebar is owned by the shell and is not recreated per route.
5. Chat is a center-surface adapter, not a second complete shell.
6. Inner pages may use `LegacyPageFrame` during migration but may not mount the old global drawer or header.
7. `Back to app` is removed from the workspace sidebar.
8. `New chat` and conversation selection return the center to chat when an inner page is active.
9. The current global-navigation item is visibly and accessibly selected.
10. The conversation workspace chooser appears below the conversation header and above the transcript.
11. The composer uses a real textarea and starts at two visible rows.
12. The textarea appears before the mode/model/approval toolbar in DOM and visual order.
13. Mode, model, and tool-approval selectors appear below the textarea.
14. Microphone input remains directly accessible from the textarea area.
15. Spoken-response preference remains directly accessible from the lower composer toolbar.
16. Voice controls expose setup, unavailable, active, and error states instead of disappearing without explanation.
17. Send and Stop remain directly accessible at every supported width.
18. First launch does not maximize the Electron window.
19. Later launches restore only validated on-screen bounds.
20. User-selected maximized state may be restored; programmatic first-launch maximization is forbidden.

## 10. Target Information Architecture

### 10.1 Wide layout

```text
┌─────────────────────┬─────────────────────────────────────┬──────────────────┐
│ Persistent sidebar  │ Route-owned center surface          │ Optional         │
│                     │                                     │ inspector        │
│ New chat            │ Chat                                │                  │
│ Search              │ or                                  │ Chat: Artifacts  │
│ Automations         │ Insights                            │ Activity/Context │
│ Customize           │ or                                  │                  │
│ Insights            │ Knowledge Library                   │ Page: selected   │
│ Knowledge Library   │ or                                  │ record/history   │
│ Plugins             │ Plugins / other authenticated page  │                  │
│                     │                                     │                  │
│ Workspace groups    │                                     │                  │
│ Conversations       │                                     │                  │
└─────────────────────┴─────────────────────────────────────┴──────────────────┘
```

### 10.2 Chat center hierarchy

The chat center must present information in this order:

```text
Conversation header
Conversation workspace chooser
Contextual run strip, when relevant
Transcript or chat empty state
Pinned decision surface, when relevant
Composer
  Textarea with microphone and send/stop
  Mode / model / tool approval / context / attachment / spoken response
```

The transcript owns the flexible vertical space. Header, workspace chooser, run strip, pinned decisions, and composer remain stable around it.

### 10.3 Inner-page center hierarchy

Inner pages must render inside `AppCenterRouteHost`:

```text
Route loading or route error state
Page identity and primary action
Page toolbar, when present
Page-owned scroll container
Page-owned sticky action area, when present
```

The page must not add a second global sidebar or global app header.

## 11. Persistent Shell and Routing Requirements

### 11.1 Authenticated shell ownership

`AppWorkspaceShell` owns:

- The global/workspace sidebar.
- Responsive navigation visibility.
- The center route host.
- The shared inspector host.
- Shell-level notices and confirmation hosts where already defined.
- Shell measurement and breakpoint state.

The shell does not own:

- Page-domain records.
- Chat messages or run authority.
- Feature-specific forms or collections.
- Conversation workspace approval business logic.

### 11.2 Chat center ownership

The current center portion of `AiChatWorkspaceShell.vue` must become a center component that owns:

- Selected conversation presentation.
- Conversation header.
- Workspace chooser presentation.
- Run strip.
- Transcript.
- Composer integration.
- Chat inspector requests.

It must not render another workspace sidebar around itself.

### 11.3 Route behavior

1. Application startup after authentication opens the chat center.
2. Clicking Insights changes only the center route.
3. Clicking Knowledge Library changes only the center route.
4. Clicking Plugins changes only the center route.
5. Clicking other authenticated destinations follows the same shell contract.
6. Sidebar search query, expanded workspace groups, selected conversation, and unread state remain intact while visiting an inner page.
7. Selecting a conversation while an inner page is open navigates to chat and displays that conversation.
8. Clicking `New chat` while an inner page is open navigates to chat and creates or selects the new conversation according to existing behavior.
9. Browser back and forward navigate center-route history without creating duplicate shells.
10. Deep links to authenticated inner pages mount the shared shell first and then the requested center surface.
11. Login redirects continue to clear user state and leave the authenticated shell.

### 11.4 Navigation selection

- The active global route uses `aria-current="page"` or an equivalent accessible selected state.
- A selected conversation uses `aria-current="true"` or its existing tree selection state.
- Global-route selection and conversation selection are separate. Opening Insights does not erase the last selected conversation.
- The sidebar must not display both a global route and a conversation as if both are the current center surface.

### 11.5 Removal of `Back to app`

- Remove the button, icon, translation usage, and tests that require `workspace-back-to-app`.
- Do not replace it with another back button.
- Chat remains reachable through `New chat`, conversation selection, and an optional explicit Chat/Home navigation affordance if required by the final sidebar hierarchy.
- A temporary rollout escape hatch may remain behind existing feature-flag or settings behavior, but it must not be labeled `Back to app`.

## 12. Conversation Workspace Chooser

### 12.1 Purpose

The chooser identifies and changes the filesystem workspace attached to the active conversation. It is not the same as the sidebar's grouping of conversations by workspace.

### 12.2 Placement

The chooser appears:

- Directly below the conversation header.
- Above the run strip and transcript.
- Inside the chat center, not inside the global sidebar.
- At all supported widths, using a compact variant where needed.

### 12.3 Required content

When a workspace is approved, show:

- Workspace display name.
- A shortened path or repository root where space permits.
- Approval/trust status using icon and text, not color alone.
- A `Change` action.
- Workspace-memory count or entry point when currently supported by `WorkspaceBadge`.

When no workspace is set, show:

- `No workspace selected`.
- A primary `Choose workspace` action.
- Short context that workspace selection is needed only for local workspace tools.

### 12.4 Selection behavior

1. Choosing a workspace uses the existing secure folder-selection flow.
2. Workspace approval remains conversation-scoped.
3. Changing the workspace must not silently reuse approval from an unrelated path.
4. A path must not appear approved until the main process confirms approval.
5. Cancellation leaves the existing workspace unchanged.
6. Failure leaves the existing workspace unchanged and shows a localized recoverable error.
7. Changing the workspace while a tool call is running is disabled or deferred until the run reaches a safe state.
8. Changing workspace does not move or merge conversation history.
9. The selected workspace refreshes slash commands, at-mention scope, workspace memory, watcher state, and trust presentation through existing contracts.
10. The chooser never exposes raw permission tokens or unsafe path details to logs.

### 12.5 Workspace states

| State | User sees | Available action |
| --- | --- | --- |
| Loading | Compact skeleton and `Loading workspace…` | None |
| None selected | `No workspace selected` | Choose workspace |
| Pending approval | Selected name plus `Approval required` | Review/approve or cancel |
| Approved | Name/path plus `Approved` | Change, open memory if supported |
| Instructions untrusted | Name plus trust explanation | Review instructions or dismiss according to existing policy |
| Missing/unavailable path | Warning with previous display name | Choose another workspace |
| Selection error | Localized error that does not replace transcript | Retry or choose another |
| Busy conversation | Current workspace plus `Available after current run` | Stop run or wait |

## 13. Composer Layout and Textarea

### 13.1 Required visual structure

```text
┌────────────────────────────────────────────────────────────────────┐
│ Message textarea                                         Mic  Send│
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ Mode ▾  Model ▾  Tool approval ▾  Context     Attach  Voice output│
└────────────────────────────────────────────────────────────────────┘
```

The exact icon alignment may follow Vuetify constraints, but the ordering and hierarchy are fixed.

### 13.2 Textarea behavior

1. Use a semantic `<textarea>` through `v-textarea` or an equivalent accessible component.
2. Start at two visible rows.
3. Auto-grow up to six rows by default; eight rows is acceptable if validated at narrow widths.
4. After the maximum height, the textarea scrolls internally while the composer remains fixed.
5. `Enter` sends when the existing send conditions are satisfied.
6. `Shift+Enter` inserts a newline.
7. Input method editor composition must not send prematurely.
8. Pasted multiline text preserves line breaks and continues to use existing pasted-text limits and chip behavior.
9. Slash-command and at-mention suggestions remain anchored to the textarea and retain keyboard navigation.
10. Draft text, attachments, pasted-text references, and generated-image references survive center-route navigation according to existing draft persistence policy.
11. Disabled, processing, and streaming states do not erase the draft.
12. The textarea has a localized accessible name that remains available when content replaces the placeholder.

### 13.3 Lower toolbar order

The lower toolbar presents, from left to right where space permits:

1. Mode selector.
2. Model selector.
3. Tool-approval selector.
4. Context indicator.
5. Attachment action.
6. Spoken-response control.

Send/Stop and microphone may remain in the textarea action area. If Vuetify layout constraints require Send/Stop in the lower toolbar, they stay pinned at the far right and remain directly visible.

### 13.4 Control behavior

- Mode, model, and approval controls are disabled only when changing them would affect an already accepted or active request.
- Disabled controls retain readable labels and expose a reason through accessible description or tooltip.
- Model loading shows a bounded loading state without changing toolbar height.
- A missing model shows an actionable provider/settings path.
- Tool approval uses plain-language values and does not rely on internal enum names.
- Context opens the existing Context inspector.
- Attachment retains existing type, count, and size validation.
- The lower toolbar must not cover or reduce the send target below the minimum touch size.

### 13.5 Narrow toolbar behavior

When the center width cannot show all controls:

1. Send/Stop remains visible.
2. Microphone remains visible.
3. Mode remains visible when mode choice is supported.
4. Model and tool approval may collapse into a labeled `Chat settings` menu.
5. Attachment remains visible or moves into the same labeled menu only when its presence remains obvious.
6. Spoken response may use a speaker icon with an accessible label.
7. Controls must not wrap into more than two toolbar rows.
8. No horizontal page scroll is permitted.

## 14. Voice Input and Spoken Response

### 14.1 Separate capabilities

Voice input and spoken response are separate controls:

- **Microphone**: records speech and transcribes it into the composer.
- **Spoken response**: enables or disables assistant text-to-speech playback.

The UI must not use one ambiguous `voice` button for both behaviors.

### 14.2 Microphone placement and states

The microphone appears at the trailing edge of the textarea action area.

| State | Icon/presentation | Behavior |
| --- | --- | --- |
| Ready | Microphone | Starts recording |
| Recording | Stop icon, error/accent tone, `Recording…` status | Stops and submits recording for transcription |
| Transcribing | Loading indicator, `Transcribing…` | Prevents duplicate recording |
| Disabled by active run | Disabled microphone with reason | User may stop/wait |
| Runtime or model missing | Setup state, not silent omission | Opens voice settings or install flow |
| Permission denied | Warning with retry guidance | Requests OS/browser permission on deliberate retry |
| Recording failure | Localized inline error | Retry or open settings |
| Transcription failure | Draft preserved, localized inline error | Retry without losing typed content |

### 14.3 Spoken-response placement and states

- Place a compact speaker toggle in the lower toolbar.
- Show speaker-high when enabled and speaker-off when disabled.
- Use `aria-pressed` or an equivalent toggle state.
- While saving the setting, show loading and prevent duplicate toggles.
- While speech is playing, provide a visible `Stop speaking` action.
- Playback failure shows a localized recoverable message and settings action.
- Starting microphone recording stops current speech according to existing voice behavior.

### 14.4 Discoverability rule

Voice controls must not disappear because settings failed to load or a runtime is missing. If the current platform or policy cannot support the capability, show a disabled control with a concise explanation. A deliberate product policy may hide a capability only when it is permanently unavailable for that build, not during recoverable setup states.

### 14.5 Privacy and safety

- Recording starts only after an explicit user action.
- The UI visibly indicates the entire recording period.
- Recording respects existing duration and payload limits.
- Audio and transcripts follow existing local/remote processing disclosures.
- Logs must not contain raw audio or full transcript content by default.
- Voice errors must not expose filesystem paths, API keys, or provider secrets.

## 15. Inner-Page Center Surfaces

### 15.1 Required first-wave routes

The first implementation wave must demonstrate the persistent shell with:

- Chat (`/aiworkspace`).
- Insights (`/insights`).
- Knowledge Library (`/knowledge/library`).
- Plugins (`/plugins/management`).

Automations and Customize must follow the same routing boundary when their current pages are connected. Other authenticated routes may continue through `LegacyPageFrame` until converged.

### 15.2 Legacy compatibility

An unconverged page may receive only outer geometry normalization:

- Center-owned height.
- Center-owned scrolling.
- Shared canvas background.
- Responsive outer padding.

The compatibility frame must not restyle feature controls, cards, or tables unpredictably. It must not mount legacy global navigation.

### 15.3 Route states

| State | User sees | Shell behavior |
| --- | --- | --- |
| Loading route bundle | Small center loading affordance | Sidebar stays interactive |
| Page loading data | Page-owned skeleton/progress | Shell stays mounted |
| Empty page | Feature-specific explanation and primary action | Sidebar stays mounted |
| Page error | Feature error and retry | Shell stays mounted |
| Unauthorized | Safe localized denial and valid navigation action | No partial privileged content |
| Route not found | Utility not-found center surface or existing 404 treatment | No duplicate shell |
| Inner-page inspector | Page-specific contextual panel | Does not overwrite chat inspector state permanently |

## 16. Responsive Behavior

Responsive mode must use the shell's measured available width, not assume the application is maximized.

### 16.1 Wide mode

Suggested threshold: center shell width at or above 1280px.

- Sidebar visible at full width.
- Center surface flexible.
- Inspector may be visible and resizable.
- Composer selectors remain inline below the textarea.

### 16.2 Medium mode

Suggested threshold: 900px to 1279px.

- Sidebar may collapse to a rail or narrower persistent column.
- Inspector becomes an overlay unless sufficient center width remains.
- Composer selectors may use compact labels.
- Workspace path truncates while name and approval state remain visible.

### 16.3 Narrow mode

Suggested threshold: below 900px.

- Sidebar becomes an explicit drawer with backdrop.
- Inspector becomes an overlay or separate full-width surface.
- A visible menu action opens the sidebar.
- Selecting a route or conversation closes the sidebar and focuses the center heading or chat context.
- Composer lower controls collapse without hiding Send/Stop or microphone.
- Workspace chooser uses name, status icon/text, and a compact Change action.

### 16.4 Minimum interaction sizes

- Pointer and touch targets must be at least 40 x 40px; 44 x 44px is preferred for primary mobile-style controls.
- Visible focus rings must not be clipped by overflow containers.
- Text must remain usable at 200% zoom without horizontal page scrolling.

## 17. Electron Window Geometry

### 17.1 First launch

On first launch or when no valid saved geometry exists:

1. Do not call `BrowserWindow.maximize()`.
2. Prefer a content size of `1280 x 800` CSS pixels.
3. Fit the window inside the active display's work area, including taskbar, dock, or menu-bar exclusions.
4. If `1280 x 800` does not fit, use no more than 90% of the work-area width and height.
5. Center the window in the active display work area.
6. Use a minimum supported content size of approximately `960 x 640` when the display permits it.
7. On displays smaller than the minimum, fit the complete window to the work area rather than placing controls off screen.

### 17.2 Subsequent launches

Persist:

- Last non-maximized `x`, `y`, `width`, and `height`.
- Whether the user last left the window maximized.

Restore behavior:

1. Validate saved numbers and minimum dimensions.
2. Ensure a meaningful portion of the title bar and window intersects a currently connected display.
3. Clamp partially off-screen bounds into the closest display work area.
4. If the saved display no longer exists, center the preferred size on the primary display.
5. Restore maximized state only after showing a valid normal bound and only when the saved state came from an explicit user action.
6. Do not treat full-screen state as ordinary maximized state unless a separate product requirement adds full-screen restoration.

### 17.3 Persistence constraints

- Window geometry is local application state, not user database business data.
- Geometry persistence must not use direct database access from window-creation code.
- Writes should be debounced or performed on move/resize completion and close, not on every raw resize event.
- Invalid or corrupt state falls back safely without blocking startup.
- E2E mode may use deterministic bounds and disable persistence to avoid test pollution.

### 17.4 Multi-display behavior

- New windows open on the display associated with the cursor or current primary display according to the chosen Electron convention.
- Restored windows remain on their prior display when it still exists.
- Disconnecting a display must not strand the window off screen on the next launch.
- Different scale factors must not produce a window larger than the destination work area.

## 18. Interaction State Coverage

| Feature | Loading | Empty | Error | Success | Busy/partial |
| --- | --- | --- | --- | --- | --- |
| Shared shell | Stable shell skeleton if needed | Not applicable | Safe startup error | Sidebar and center visible | Route center may load independently |
| Center route | Small route progress | Feature-owned empty state | Feature-owned retry | Page visible | Sidebar remains interactive |
| Conversation | Transcript skeleton | Warm new-chat prompt | Retry without losing selection | Transcript visible | Streaming messages continue |
| Workspace chooser | Skeleton | Choose workspace prompt | Preserve prior workspace and retry | Approved name/status | Disabled during unsafe workspace change |
| Textarea | Settings-independent render | Empty draft placeholder | Draft preserved | Message accepted and cleared by existing rule | Disabled only when required |
| Model selector | Stable-width loading | No-model setup action | Provider/settings action | Selected model | Disabled for accepted request |
| Microphone | Voice-state loading | Ready action | Inline retry/settings | Transcript appended or sent | Recording/transcribing status |
| Spoken response | Setting loading | Off state | Playback/settings recovery | On state | Speaking and stop action |
| Window state | Not user-visible | Preferred centered bounds | Safe fallback bounds | Restored valid bounds | Maximization only from saved user choice |

## 19. Keyboard and Focus Requirements

### 19.1 Shell navigation

- Sidebar global actions use normal tab order.
- Workspace/conversation tree retains its documented roving keyboard model.
- `Escape` closes narrow navigation and inspector overlays.
- Opening an inner route moves focus to the page heading or primary center landmark without resetting sidebar state.
- Selecting a conversation moves focus to the conversation heading or composer according to the initiating action.

### 19.2 Composer

- The textarea precedes lower-toolbar controls in tab order.
- Slash and at-mention suggestion keyboard behavior remains intact.
- `Enter` and `Shift+Enter` behavior is announced in accessible help text where needed.
- Microphone, Send/Stop, mode, model, approval, context, attachment, and spoken response are keyboard reachable.
- Recording and transcription status uses `aria-live="polite"` or an equivalent non-interruptive announcement.
- Errors receive an alert or status role without stealing focus unexpectedly.

### 19.3 Workspace chooser

- The current workspace name and approval state form one understandable accessible group.
- `Choose` and `Change` have explicit names, not icon-only ambiguous labels.
- Native folder selection returns focus to the initiating control after cancel or completion when Electron permits it.

## 20. Localization Requirements

All new or changed user-facing text must be added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Required translation coverage includes:

- Navigation selection and chat destination labels.
- Workspace chooser labels, approval states, busy states, and errors.
- Composer textarea placeholder and keyboard guidance.
- Mode/model/tool-approval compact-menu labels.
- Microphone, recording, transcription, permission, installation, and error text.
- Spoken-response enabled, disabled, saving, speaking, stop, and failure text.
- Window-state errors only if any become user-facing.

Long German, French, Spanish, and Japanese labels must be tested in medium and narrow composer layouts. Truncation must preserve a tooltip or accessible full label.

## 21. Accessibility Requirements

1. Center content uses a semantic `main` landmark.
2. Sidebar uses a navigation landmark with a localized label.
3. The active global route exposes an accessible current state.
4. Workspace status never depends on color alone.
5. Voice state never depends on icon color alone.
6. Text and meaningful icons meet WCAG 2.1 AA contrast.
7. Body text should remain at least 14px in dense desktop controls and 16px where it serves as primary reading text.
8. Every icon-only control has a localized accessible name and tooltip where useful.
9. Reduced-motion preference disables nonessential transitions and loading rotation receives a static alternative.
10. Route changes, workspace approval, recording, transcription, and playback failures are announced without repeated noisy messages.
11. Overlay navigation and inspectors trap focus appropriately and restore focus on close.
12. The app remains operable at 200% zoom.

## 22. Performance and Reliability Requirements

1. Route changes must not remount the persistent sidebar.
2. Route changes must not create additional Electron renderer processes.
3. Returning to chat must not reload every conversation history.
4. Selected-conversation subscriptions continue to follow existing detailed-event ownership rules.
5. Inner-page navigation must not stop background runs.
6. Route bundle loading must not freeze sidebar interactions.
7. The composer must not change height unexpectedly when model or voice state loads.
8. Voice setup errors must not break typed chat.
9. Window-state corruption must not block application startup.
10. Window bounds must remain usable after display disconnects or scale-factor changes.
11. The application must not require maximization to keep Send, Stop, microphone, and navigation accessible.

Suggested user-visible budgets:

- Shell-preserving route selection feedback: within 100ms.
- Already-loaded center route swap: within 200ms at p95 on a representative development machine.
- Chat return with cached selected conversation: within 250ms at p95, excluding provider/network work.
- Composer keystroke response: no visible input lag under normal transcript load.

## 23. Security and Privacy Requirements

1. The persistent shell must not weaken context isolation or enable Node integration in the renderer.
2. Routes must continue through existing navigation guards.
3. Workspace changes use existing approved IPC and native folder-selection flows.
4. No renderer-only visual state may mark a workspace approved.
5. Workspace paths and errors must be sanitized before crossing process boundaries or appearing in logs.
6. Voice state wiring must continue through typed preload APIs.
7. Voice setup must not bypass AI enablement policy.
8. Inner pages retain their existing authorization and input-validation boundaries.
9. Legacy pages rendered through `LegacyPageFrame` do not receive extra privileged APIs.
10. Window geometry state contains only display coordinates, dimensions, and display state; it must not contain workspace or conversation content.

## 24. Functional Requirements

### Application shell and routing

- **FR-SHELL-001**: AiFetchly must open the chat center as the default authenticated route.
- **FR-SHELL-002**: One persistent authenticated shell must own the sidebar, center route host, and optional inspector host.
- **FR-SHELL-003**: Authenticated route changes must replace only the center surface and route-owned inspector content.
- **FR-SHELL-004**: Chat must render as a center surface and must not create a second global sidebar.
- **FR-SHELL-005**: Unconverged authenticated routes must render through a compatibility frame without mounting legacy global navigation.
- **FR-SHELL-006**: Login must remain outside the authenticated shell.
- **FR-SHELL-007**: Deep links to authenticated routes must mount the shell and requested center route.
- **FR-SHELL-008**: The active global destination must expose visible and accessible selected state.
- **FR-SHELL-009**: Sidebar workspace expansion, search, and conversation state must survive center-route navigation.
- **FR-SHELL-010**: Selecting a conversation from an inner page must return the center to chat.
- **FR-SHELL-011**: Creating a new chat from an inner page must return the center to chat.
- **FR-SHELL-012**: `Back to app` must be removed and must not be replaced by a competing-shell navigation concept.

### Workspace chooser

- **FR-WS-001**: The chat center must show the active conversation workspace below the conversation header and above the transcript.
- **FR-WS-002**: The chooser must distinguish no workspace, pending approval, approved, untrusted instructions, unavailable path, error, and busy states.
- **FR-WS-003**: The chooser must show workspace name, approval state, and Change/Choose action.
- **FR-WS-004**: Workspace selection and approval must use existing main-process contracts.
- **FR-WS-005**: Changing workspace must never silently retain approval from another path.
- **FR-WS-006**: Cancelling or failing a workspace change must preserve the current workspace.
- **FR-WS-007**: Unsafe workspace changes must be disabled during active tool execution.
- **FR-WS-008**: Workspace grouping in the sidebar and conversation workspace selection must remain distinct concepts.

### Composer

- **FR-COMP-001**: The composer must use a semantic textarea.
- **FR-COMP-002**: The textarea must start at two rows and auto-grow to a bounded height.
- **FR-COMP-003**: Enter must send and Shift+Enter must insert a newline under existing send rules.
- **FR-COMP-004**: Input method editor composition must not cause premature send.
- **FR-COMP-005**: The textarea must appear before mode, model, and approval controls in visual and DOM order.
- **FR-COMP-006**: Mode, model, and tool approval must render below the textarea.
- **FR-COMP-007**: Context, attachment, and spoken-response controls must be available from the composer toolbar.
- **FR-COMP-008**: Send and Stop must remain directly visible at all supported widths.
- **FR-COMP-009**: Microphone input must remain directly visible at all supported widths where voice is supported.
- **FR-COMP-010**: Narrow layout may collapse secondary selectors but must use a labeled and keyboard-accessible menu.
- **FR-COMP-011**: Draft and attachments must not be cleared merely because the user navigates to an inner page.
- **FR-COMP-012**: Pasted-text, attachment, slash-command, at-mention, and generated-image behavior must remain compatible.

### Voice

- **FR-VOICE-001**: The composer must expose a microphone control for speech-to-text.
- **FR-VOICE-002**: The composer must expose a separate spoken-response toggle.
- **FR-VOICE-003**: Microphone state must distinguish ready, recording, transcribing, busy, setup-required, permission-denied, and error states.
- **FR-VOICE-004**: Spoken-response state must distinguish enabled, disabled, saving, speaking, and error states.
- **FR-VOICE-005**: Missing runtime or model must expose an install/settings action instead of silently hiding a recoverable capability.
- **FR-VOICE-006**: Starting recording must stop active speech according to the existing voice contract.
- **FR-VOICE-007**: Recording and transcription must provide localized live status text.
- **FR-VOICE-008**: Voice errors must preserve the typed draft and selected attachments.
- **FR-VOICE-009**: Voice controls must have localized accessible names and toggle states.

### Window geometry

- **FR-WIN-001**: The main window must not maximize automatically on first launch.
- **FR-WIN-002**: First launch must prefer a centered `1280 x 800` window when it fits the active work area.
- **FR-WIN-003**: First-launch bounds must fit within the active display work area.
- **FR-WIN-004**: The application must define a minimum usable size near `960 x 640` when the display permits it.
- **FR-WIN-005**: The application must persist the last valid non-maximized bounds locally.
- **FR-WIN-006**: The application must validate and clamp restored bounds to connected displays.
- **FR-WIN-007**: The application may restore maximized state only when it reflects the user's saved choice.
- **FR-WIN-008**: Corrupt, missing, or off-screen bounds must fall back to safe centered defaults.
- **FR-WIN-009**: E2E execution must be able to use deterministic window state without polluting normal user state.

### Quality

- **FR-QUAL-001**: New or changed user-facing text must be translated into all six supported languages.
- **FR-QUAL-002**: UI changes must include component tests in `test/vitest/main/components/`.
- **FR-QUAL-003**: Persistent-shell and critical composer flows must include Playwright E2E coverage.
- **FR-QUAL-004**: Status and selection must not depend on color alone.
- **FR-QUAL-005**: Keyboard-only operation must cover navigation, workspace selection, composing, selector changes, voice controls, and send/stop.
- **FR-QUAL-006**: Existing chat, voice, workspace, and route tests must continue to pass or be intentionally updated to the new contract.

## 25. Acceptance Criteria

### 25.1 Persistent shell

1. Given an authenticated startup, when the renderer becomes ready, then the workspace sidebar and chat center are visible without another navigation action.
2. Given chat is open, when the user selects Insights, then the sidebar remains mounted and Insights replaces only the center.
3. Given Insights is open, when the user selects Knowledge Library, then only the center route changes.
4. Given an inner page is open, when the user selects a conversation, then chat opens with that conversation and the sidebar state is retained.
5. Given an inner page is open, when the user clicks New chat, then chat opens and the existing new-chat behavior completes.
6. Given the workspace sidebar, then no `Back to app` button or equivalent label is rendered.
7. Given browser back/forward navigation, then the application never renders two global sidebars or two inspector hosts.
8. Given a direct authenticated deep link, then the shared shell mounts around the requested page.

### 25.2 Workspace chooser

9. Given a conversation with an approved workspace, then its name and approval state appear above the transcript.
10. Given a conversation without a workspace, then a Choose workspace action appears above the transcript.
11. Given the user cancels folder selection, then the previous workspace remains unchanged.
12. Given workspace approval fails, then the previous state remains and an actionable localized error appears.
13. Given a workspace-backed tool is running, then changing the workspace is unavailable with a reason.
14. Given a workspace changes successfully, then workspace-dependent suggestions and memory/trust presentation refresh.

### 25.3 Composer

15. Given chat is visible, then the message control renders an actual textarea with at least two visible rows.
16. Given multiline text, when the user presses Shift+Enter, then a newline is inserted and no message is sent.
17. Given sendable text, when the user presses Enter outside input-method composition, then the message sends through the existing path.
18. Given the composer DOM, then the textarea precedes mode, model, and tool approval.
19. Given a wide or medium center, then mode, model, and tool approval are visibly below the textarea.
20. Given a narrow center, then Send/Stop and microphone remain visible and collapsed secondary settings remain keyboard accessible.
21. Given an inner-page round trip, then an unsent chat draft is restored under the existing draft policy.

### 25.4 Voice

22. Given voice input is ready, then a microphone control is visible in the textarea area.
23. Given recording starts, then the UI shows a stop control and localized recording status.
24. Given recording stops, then transcribing status appears until success or failure.
25. Given the voice runtime or model is missing, then the user receives an install/settings path rather than an unexplained absent control.
26. Given spoken response is enabled, then the speaker toggle exposes pressed state.
27. Given assistant speech is playing, then Stop speaking is visible and operable.
28. Given microphone recording starts while speech plays, then active speech stops.
29. Given voice transcription or playback fails, then typed text and attachments remain intact.

### 25.5 Window geometry

30. Given no saved geometry, when the app starts on a display that fits `1280 x 800`, then the main window opens centered near `1280 x 800` and is not maximized.
31. Given a smaller display, then the first window fits inside the work area and remains usable.
32. Given the user resizes and moves the window, then the next launch restores valid bounds.
33. Given the prior display is disconnected, then the next launch opens fully reachable on a connected display.
34. Given corrupt saved bounds, then startup succeeds with safe defaults.
35. Given the user explicitly left the window maximized, then a later launch may restore maximized state without losing valid normal bounds.

### 25.6 Quality gates

36. All changed component tests pass with `yarn test:components`.
37. The workspace-shell Playwright scenarios pass with the project E2E command.
38. Voice component tests cover ready, recording, transcribing, setup-required, disabled, and error states.
39. Route tests prove Insights, Knowledge Library, and Plugins use the shared shell boundary.
40. Translation-key parity passes for English, Chinese, Spanish, French, German, and Japanese.
41. Type checks pass without introducing `any`.
42. Keyboard-only manual or automated verification covers the complete critical flow.

## 26. Test Strategy and Traceability

### 26.1 Component tests

Create or update tests in `test/vitest/main/components/` for:

- Persistent application shell composition.
- Sidebar active-route state and removal of `Back to app`.
- Chat center rendering without a nested sidebar.
- Workspace chooser placement and states.
- Textarea semantics, row settings, Enter, Shift+Enter, and input-method composition.
- DOM ordering of textarea and lower toolbar.
- Mode/model/tool-approval responsive collapse.
- Microphone ready, recording, transcribing, setup, permission, and failure states.
- Spoken-response toggle and Stop speaking.
- Draft preservation across route navigation where the owning store permits it.
- Long translation labels and narrow widths.
- Keyboard focus and accessible names.

### 26.2 Router tests

Update route coverage tests to prove:

- One parent shell owns authenticated routes.
- Chat is a child/center surface rather than a standalone duplicate shell.
- Insights, Knowledge Library, and Plugins no longer mount competing global layouts.
- Login remains outside the shell.
- Legacy-frame classification remains complete with no gaps or overlaps.

### 26.3 Electron/main-process tests

Extract pure window-geometry logic where practical and test:

- Preferred first-launch bounds.
- Work-area fitting.
- Minimum-size handling.
- Centering.
- Off-screen clamping.
- Disconnected-display fallback.
- Corrupt-state fallback.
- Saved maximized-state interpretation.
- Deterministic E2E override behavior.

### 26.4 Playwright E2E scenarios

At minimum:

1. Startup lands in chat inside the persistent shell.
2. Chat to Insights to Knowledge Library to Plugins preserves one sidebar.
3. Selecting a conversation from an inner page returns to chat.
4. New chat from an inner page returns to chat.
5. `Back to app` is absent.
6. Workspace chooser changes and displays approval state.
7. Composer is multiline and selectors appear below it.
8. Microphone and spoken-response controls are visible in supported test state.
9. Narrow viewport uses drawer/overlay behavior without hiding critical composer actions.
10. Renderer reload restores shell and selected workspace/conversation state without cancelling runs.

### 26.5 Requirement mapping

| Requirement family | Primary verification |
| --- | --- |
| FR-SHELL | Router unit tests, shell component tests, E2E navigation |
| FR-WS | Workspace badge/chooser component tests, existing workspace IPC tests, E2E selection |
| FR-COMP | Composer component tests, keyboard tests, responsive E2E |
| FR-VOICE | Existing voice component/IPC tests plus workspace integration tests |
| FR-WIN | Pure geometry unit tests and Electron launch E2E |
| FR-QUAL | Type check, translations, component suite, E2E, accessibility assertions |

## 27. Migration and Rollout

### Phase 1: Shell composition

- Promote `AppWorkspaceShell` to the authenticated parent shell.
- Connect `AppCenterRouteHost`.
- Reuse `AiChatWorkspaceSidebar` as the navigation slot.
- Extract the chat center from `AiChatWorkspaceShell`.
- Keep legacy pages behind `LegacyPageFrame`.
- Remove `Back to app`.

Exit condition: Chat, Insights, Knowledge Library, and Plugins navigate within one shell.

### Phase 2: Workspace and composer parity

- Reuse `WorkspaceBadge` and the existing workspace-required/trust flow in the chat center.
- Move mode, model, approval, and context controls into the composer lower toolbar.
- Set textarea to two visible rows with bounded auto-grow.
- Preserve attachment, pasted-text, slash-command, at-mention, and generated-image behavior.

Exit condition: The redesigned chat has functional parity with classic chat for next-message controls and workspace selection.

### Phase 3: Voice parity

- Share or extract voice-state loading used by `AiChatV2.vue`.
- Pass voice settings and availability to `AiChatV2Composer`.
- Add spoken-response toggle and Stop speaking to the redesigned composer.
- Verify setup and error states.

Exit condition: Voice input and spoken response work from the default workspace chat.

### Phase 4: Window geometry

- Remove unconditional startup maximize.
- Add safe first-launch geometry.
- Add validated local bounds persistence and multi-display recovery.
- Add deterministic test behavior.

Exit condition: First launch is centered and non-maximized; later launches restore safe user geometry.

### Phase 5: Validation and rollout

- Complete translations.
- Run component, router, main-process, and E2E suites.
- Validate keyboard-only use and 200% zoom.
- Validate Windows, macOS, and supported Linux development behavior.
- Keep the existing redesign rollback policy until stability criteria are satisfied.

## 28. Rollback Requirements

1. Shell migration must remain reversible through the existing workspace-redesign rollout mechanism until the approved stability window ends.
2. Rollback must not require database migration or delete conversation/workspace state.
3. Window-state persistence may be ignored safely by an older build.
4. Voice state remains stored through existing settings and does not require conversion.
5. A rollback may restore legacy route presentation but must not corrupt current routes, drafts, conversations, or workspace approvals.
6. Rollback controls intended for diagnostics or staged rollout should live in settings or feature configuration, not as `Back to app` in ordinary navigation.

## 29. Observability

Record bounded, privacy-safe diagnostics for:

- Shell mount and center-route transitions.
- Duplicate-shell detection in development.
- Workspace chooser success/failure categories without raw paths.
- Voice setup/record/transcription/playback state failures without audio or transcript bodies.
- Invalid saved window geometry and fallback reason.
- Display-clamping events using dimensions and display identifiers only.

Do not log:

- Prompts, assistant messages, transcripts, or raw audio.
- Workspace file contents.
- Full sensitive filesystem paths by default.
- API keys or provider secrets.

## 30. Risks and Mitigations

| Risk | User impact | Mitigation |
| --- | --- | --- |
| Chat shell and application shell both mount | Duplicate navigation, lost space, broken focus | Extract chat center; enforce route/component tests |
| Legacy page assumes viewport ownership | Double scrolling or clipped actions | `LegacyPageFrame` owns only outer geometry; migrate by family |
| Route navigation destroys chat draft | Lost user input | Move draft ownership to existing durable/store boundary and test round trips |
| Workspace grouping is confused with workspace binding | User changes the wrong scope | Separate placement, labels, and accessible descriptions |
| Voice controls render but lack state wiring | Buttons fail or appear permanently disabled | Reuse/extract classic chat voice state; avoid duplicate logic |
| Lower toolbar becomes crowded | Wrapped controls and reduced message space | Fixed priority order and labeled compact menu at narrow widths |
| Saved bounds restore off screen | App appears not to launch | Validate against connected display work areas and fall back centered |
| Restored maximization conflicts with user preference | App again occupies full screen unexpectedly | Never maximize on first launch; restore only explicit saved state |
| Route refactor breaks deep links | Page opens blank or outside shell | Router tests for direct authenticated routes and back/forward |
| Translation expansion breaks layout | Hidden selectors/actions | Long-label tests in all supported languages |

## 31. Implementation Boundaries

The PRD does not prescribe exact class or function names, but implementation should prefer the existing intended boundaries:

- `AppWorkspaceShell.vue`: persistent shell geometry.
- `AppCenterRouteHost.vue`: center route boundary.
- `LegacyPageFrame.vue`: compatibility geometry for unconverged routes.
- `AiChatWorkspaceSidebar.vue`: persistent navigation and conversation hierarchy.
- A new or extracted chat-center component: conversation-only center presentation.
- `AiChatV2Composer.vue`: textarea, lower toolbar slots, attachment, microphone, and send/stop.
- Shared composables or stores: voice settings/state and chat draft state, avoiding duplicated logic between classic and workspace chat.
- A pure window-geometry helper/service: first-launch sizing, validation, clamping, and restoration.

Any new AI-related IPC handler or modification to an existing AI handler must continue to check `USER_AI_ENABLED` through `Token` before parsing or executing an AI request. Any database change must use Model and Module layers. Worker processes must not access the database.

## 32. Definition of Done

This PRD is complete only when:

1. The workspace is the default authenticated application shell.
2. Chat, Insights, Knowledge Library, and Plugins render in its center without duplicate navigation.
3. `Back to app` is absent.
4. Selecting or creating a conversation from an inner page returns to chat.
5. The active conversation workspace is visible and changeable above the transcript.
6. The composer uses a visibly multiline textarea.
7. Mode, model, and tool approval appear below the textarea.
8. Microphone input and spoken-response controls are visible and functional with complete states.
9. The first desktop launch is centered and not automatically maximized.
10. Valid user window geometry restores safely across launches and displays.
11. All new UI text exists in all six language files.
12. Required component, router, main-process, and E2E tests pass.
13. Keyboard-only navigation and 200% zoom pass manual or automated verification.
14. Existing chat execution, workspace security, voice, attachment, and background-run behavior remains intact.
15. The implementation is committed as logical units with no incomplete or broken code.

## 33. Explicitly Deferred

- Full visual redesign of every authenticated inner page.
- Retirement of the classic chat after the stability window.
- Cloud-synchronized window layout.
- Multiple saved window-layout presets.
- Detachable chat, inspector, or artifact windows.
- Mobile-native application behavior.
- A new combined voice conversation mode beyond existing microphone and spoken-response capabilities.
- Changes to workspace storage or permission semantics.
- Changes to AI execution concurrency, persistence, or process ownership.
