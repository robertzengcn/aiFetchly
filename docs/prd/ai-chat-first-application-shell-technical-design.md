# AI Chat-First Application Shell and Composer Refinement Technical Design

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-29
- **Owner**: AiFetchly Desktop Engineering
- **Product**: AiFetchly Electron desktop application
- **Source requirements**: [`ai-chat-first-application-shell-prd.md`](./ai-chat-first-application-shell-prd.md)
- **Parent product contracts**:
  - [`ai-chat-workspace-ui-redesign-prd.md`](./ai-chat-workspace-ui-redesign-prd.md)
  - [`inner-page-ui-convergence-prd.md`](./inner-page-ui-convergence-prd.md)
  - [`local-sherpa-onnx-voice-chat-prd.md`](./local-sherpa-onnx-voice-chat-prd.md)
- **Parent technical designs**:
  - [`ai-chat-workspace-ui-redesign-technical-design.md`](./ai-chat-workspace-ui-redesign-technical-design.md)
  - [`inner-page-ui-convergence-technical-design.md`](./inner-page-ui-convergence-technical-design.md)
  - [`local-sherpa-onnx-voice-chat-technical-design.md`](./local-sherpa-onnx-voice-chat-technical-design.md)
- **Primary implementation areas**: Vue Router, shared application shell, AI chat center surface, composer, workspace and voice composables, Pinia presentation state, Electron main-window lifecycle

## 1. Purpose

This document translates the AI Chat-First Application Shell and Composer Refinement PRD into an implementation-ready architecture. It defines:

- The authenticated Vue Router topology that keeps one application shell mounted.
- Component ownership for global navigation, routed center content, and the inspector.
- How the current standalone chat workspace becomes a routed center surface.
- How existing classic-chat workspace and voice behavior is reused without duplicating state.
- The textarea and lower composer-toolbar contract.
- Main-process window sizing, restoration, validation, and persistence.
- Migration phases, compatibility boundaries, tests, observability, and rollback.

This is a technical design. It does not change runtime behavior by itself.

## 2. Authority and Compatibility

### 2.1 Design authority

This document is authoritative for the implementation of:

1. One persistent authenticated shell per renderer window.
2. Chat as the default center route of that shell.
3. Authenticated feature routes rendering in the shell center.
4. Removal of the workspace sidebar's `Back to app` action.
5. Conversation workspace selection above the transcript.
6. Textarea and composer-control placement.
7. Microphone and spoken-response control restoration.
8. Normal-size Electron startup and valid window-state restoration.

### 2.2 Parent contracts that remain authoritative

This design does not redefine:

- Main-process ownership of AI run lifetime.
- Conversation execution, streaming, cancellation, recovery, or persistence.
- Tool approval semantics or workspace trust rules.
- Artifact storage and sandboxing.
- AI enablement checks at AI IPC entry points.
- Model/Module database architecture.
- The prohibition on worker-process database access.
- Local sherpa-onnx runtime installation and model-management behavior.

### 2.3 Superseded implementation assumptions

The following current assumptions are intentionally replaced:

- `AiChatWorkspaceShell.vue` must not remain a second full-window shell.
- `layout.vue` must not mount a competing legacy drawer when the converged shell is enabled.
- `/aiworkspace` must not bypass the authenticated shell route parent.
- Composer selectors must not live in an external row above the textarea.
- Voice capability must not depend on rendering the classic `AiChatV2.vue` page.
- `BrowserWindow.maximize()` must not run unconditionally at startup.

## 3. Executive Technical Decisions

1. **Create one authenticated route parent.** All authenticated route records are descendants of an `AuthenticatedLayoutBoundary`. Login and other unauthenticated routes remain outside it.
2. **Keep the shell mounted while child routes change.** `AppWorkspaceShell` owns navigation and inspector geometry; `AppCenterRouteHost` owns the center `RouterView`.
3. **Convert chat into a center surface.** Extract center behavior from `AiChatWorkspaceShell.vue` into `AiChatCenterSurface.vue`. The global sidebar and inspector host are not rendered by that component.
4. **Use stores as the cross-route continuity layer.** The chat workspace and selected conversation Pinia stores remain alive when users visit Insights, Knowledge, or Plugins. Route changes do not cancel runs or clear the selected conversation.
5. **Reuse classic-chat capability through composables.** Extract conversation-workspace and voice orchestration from `AiChatV2.vue`; both classic chat and the new center surface consume the same typed composables.
6. **Compose controls through the existing composer.** `AiChatV2Composer.vue` remains the only message-entry component. It starts at two rows and exposes lower-toolbar slots for selectors and spoken-response controls.
7. **Use one typed inspector registry.** Register chat in `AppInspectorHost`; do not mount a second full-window inspector beside it.
8. **Separate pure window geometry from Electron persistence.** Pure functions choose and clamp bounds; a main-process service reads and writes versioned JSON through `ElectronStoreService`.
9. **Roll out behind the existing default-on shell flag.** The legacy layout and classic chat remain available as a short-lived rollback path until migration acceptance gates pass.

## 4. Current Implementation Findings

### 4.1 Foundations to preserve

| Area | Current asset | Decision |
| --- | --- | --- |
| Default route | `/` redirects to `/aiworkspace` | Preserve the user-facing URL and default destination |
| Shared shell | `AppWorkspaceShell.vue` | Make it the only authenticated shell geometry owner |
| Center routing | `AppCenterRouteHost.vue` | Keep its stable `RouterView`, loading state, and legacy/converged framing |
| Page migration | `LegacyPageFrame.vue` and UI migration registry | Continue adapting pages without rewriting all inner-page content |
| Responsive state | `useResponsiveShell` and `useAppShellStore` | Keep one observer and one breakpoint authority |
| Sidebar data | `useChatWorkspaceStore` | Preserve lightweight workspace/conversation summaries and selection identity |
| Selected chat | `useSelectedConversationStore` | Preserve selection handshake, bounded history, streaming, and run state |
| Composer | `AiChatV2Composer.vue` | Reuse its textarea, attachments, recording, transcription, and send/stop logic |
| Workspace UI | `WorkspaceBadge.vue`, `WorkspaceRequiredCard.vue` | Reuse the existing approval and setup experience |
| Voice implementation | Classic `AiChatV2.vue` voice state | Extract and share instead of reimplementing |
| Inspector | `AppInspectorHost.vue` typed static registry | Add chat to the allowlist |
| Local settings | `ElectronStoreService` | Store versioned window state as a string value |

### 4.2 Gaps to close

| Current behavior | Technical cause | Target |
| --- | --- | --- |
| Feature routes replace the chat workspace | Most authenticated route groups mount legacy `Layout` | All authenticated leaves render below one shell parent |
| `Back to app` appears in sidebar | Sidebar still treats chat workspace as a separate destination | Remove the action; global navigation is already the app navigation |
| Selectors appear above input | `AiChatWorkspaceShell` owns an external `.composer-controls` row | Render selectors in the composer lower toolbar |
| Microphone is absent | Workspace shell omits the composer's voice props | Shared voice composable supplies the same state as classic chat |
| Spoken response is absent | Toggle remains local to classic chat header | Reusable presentational toggle in the composer toolbar |
| Workspace chooser is absent | Workspace state remains local to classic chat | Shared conversation-workspace composable and existing cards |
| Input looks single-line | Composer has `rows="1"` | Use `rows="2"`, auto-grow, and `max-rows="6"` |
| Window fills display | Startup creates `800x600`, then calls `maximize()` | Valid saved bounds or centered preferred bounds; no implicit maximize |

## 5. Target Architecture

```text
Electron BrowserWindow
└── Vue application
    ├── unauthenticated routes
    │   └── Login / protocol handoff / other public surfaces
    └── AuthenticatedLayoutBoundary
        ├── legacy Layout                         [rollback only]
        └── AuthenticatedWorkspaceLayout          [default]
            └── AppWorkspaceShell
                ├── navigation slot
                │   └── AiChatWorkspaceSidebar
                ├── center
                │   └── AppCenterRouteHost
                │       └── RouterView
                │           ├── AiChatCenterSurface
                │           ├── Insights
                │           ├── Knowledge Library
                │           ├── Plugins
                │           └── other authenticated pages
                └── AppInspectorHost
                    ├── ChatInspectorAdapter
                    ├── ScheduleInspector
                    └── future allowlisted inspectors
```

The shell is structural only. It does not become a business-logic service, database layer, AI coordinator, or authorization layer.

## 6. Router Architecture

### 6.1 Route groups

Define two top-level groups:

```typescript
interface AuthenticatedRouteMeta {
  readonly requiresAuth: true;
  readonly visible?: boolean;
  readonly title?: string;
  readonly aiNavigable?: boolean;
  readonly ui?: InnerPageRouteUiMeta;
}
```

- `publicRoutes`: `/login` and any route that must work before authentication.
- `authenticatedChildren`: `/aiworkspace`, `/insights`, `/knowledge`, `/plugins`, `/schedule`, settings, campaigns, and every other authenticated feature leaf.

The root authenticated record owns `AuthenticatedLayoutBoundary.vue`. Existing absolute URLs are preserved; migration must not introduce new user-facing paths merely to achieve nesting.

### 6.2 Target route shape

```typescript
const authenticatedRoot: RouteRecordRaw = {
  path: "/",
  component: () =>
    import("@/views/layout/AuthenticatedLayoutBoundary.vue"),
  meta: { requiresAuth: true },
  children: [
    {
      path: "",
      redirect: { name: "AI_Chat_Workspace" },
    },
    {
      path: "aiworkspace",
      name: "AI_Chat_Workspace",
      component: () =>
        import("@/views/components/aiChatWorkspace/AiChatCenterSurface.vue"),
      meta: chatRouteMeta,
    },
    ...authenticatedFeatureRoutes,
  ],
};
```

Routes that currently use `Layout` only to provide an intermediate `RouterView` must instead use a small `RouteGroupOutlet.vue` or be flattened. They must not mount another global drawer, header, notice host, or inspector host.

### 6.3 Authentication boundary

Authentication guards continue to operate at the router level. The shell flag is a rollout control, not an authentication or authorization decision. The route parent must never grant access to a child merely because its navigation item is visible.

### 6.4 Navigation behavior

- Selecting a global feature changes the child route only.
- Selecting a conversation sets the selected conversation and routes to `/aiworkspace` if necessary.
- Selecting the already-active conversation must not restart its load handshake unnecessarily.
- Creating a chat routes to `/aiworkspace`, creates or selects the conversation, and focuses the composer after the selection handshake.
- Browser back/forward changes the center route and retains the shell.
- Route changes call `appInspector.onRouteChanged(to.path)` so a target owned by another route closes.
- A chat run continues in the main process while another route is visible.

### 6.5 Route identity and selection

The conversation ID remains store-owned in the first migration. A future deep-link query may be added, but the initial change must not create two competing selection authorities. If a query parameter is introduced, the router adapter writes it into `useSelectedConversationStore`; UI components still read selection from the store.

### 6.6 Route migration validation

Add a route-coverage test that fails when:

1. An authenticated leaf is outside `AuthenticatedLayoutBoundary`.
2. An authenticated descendant directly mounts legacy `Layout`.
3. Two route records share the same name or normalized path.
4. `/` does not resolve to `/aiworkspace`.
5. `/login` is accidentally nested in the authenticated shell.

## 7. Shell Component Design

### 7.1 `AuthenticatedLayoutBoundary.vue`

Responsibilities:

- Read the existing `innerPageShellV2` rollout flag.
- Render either `AuthenticatedWorkspaceLayout` or legacy `layout.vue`.
- Avoid feature-domain state and direct IPC calls.
- Provide a deterministic default-on value before the first paint to prevent shell flicker.

The flag currently uses local storage and defaults on. Keep that behavior during rollout. Remove the boundary and flag only after the rollback window ends.

### 7.2 `AuthenticatedWorkspaceLayout.vue`

Responsibilities:

- Mount exactly one `AppWorkspaceShell`.
- Supply `AiChatWorkspaceSidebar` to its navigation slot.
- Mount `AppCenterRouteHost` in the center.
- Coordinate sidebar navigation and conversation selection.
- Bootstrap chat workspace summaries once.
- Mount global notice and confirmation hosts exactly once if they are not already above the router.
- Tear down workspace summary subscriptions only when the authenticated application unmounts, not on center-route changes.

It must not own transcript messages, drafts, AI execution, feature-page data, or database access.

### 7.3 `AppWorkspaceShell.vue`

Continue to own:

- Wide, medium, and narrow shell geometry.
- Desktop navigation width and collapsed state.
- Narrow navigation overlay and backdrop.
- Center size and scroll containment.
- The single inspector host.
- Focus restoration after overlays close.

It must expose stable DOM landmarks:

- `nav[aria-label="Primary"]`
- `main[data-testid="app-center-route"]`
- An optional complementary inspector region.

### 7.4 Sidebar changes

`AiChatWorkspaceSidebar.vue` remains the authenticated navigation and chat summary projection. Change it to:

- Remove `workspace-back-to-app` and its translation keys.
- Use `useRoute()` to set active navigation state and `aria-current="page"`.
- Preserve workspace-group expansion and roving keyboard behavior.
- Emit semantic events for conversation selection and new chat.
- Keep global route items visually distinct from conversation workspace groups.

The sidebar must not call chat execution APIs. Its router calls may remain local for global links, while conversation selection is emitted to the layout coordinator.

## 8. Chat Center Surface

### 8.1 Extraction boundary

Create `AiChatCenterSurface.vue` by extracting only center-region behavior from `AiChatWorkspaceShell.vue`:

- Conversation header.
- Workspace chooser strip.
- Contextual run strip.
- Transcript and history pagination.
- Empty, loading, and error states.
- Composer.

Do not include:

- `AiChatWorkspaceSidebar`.
- A full-window `.workspace-shell` wrapper.
- A second responsive observer.
- A directly mounted `AiChatInspector`.
- Global route navigation.

### 8.2 Store ownership

The center surface consumes:

- `useChatWorkspaceStore` for selected ID, summaries, and chat inspector preferences during migration.
- `useSelectedConversationStore` for selected messages, runtime state, send/stop, pagination, and selection loading.
- `useAppShellStore` for shell geometry only where the center needs to open navigation or inspector.
- `useAppInspectorStore` for typed inspector targets.
- Shared workspace and voice composables described below.

### 8.3 Lifecycle rules

- `onMounted` may load selected-conversation presentation state, voice settings, and conversation workspace state.
- Leaving `/aiworkspace` must not call run cancellation.
- Leaving `/aiworkspace` must not clear `chatWorkspace.selectedConversationId`.
- The composer draft is retained at least for the active conversation during center-route navigation.
- Detailed event subscription may remain active for the selected conversation; if it is paused for performance, the main-process snapshot handshake must reconcile on return.
- Workspace summary subscription remains application-scoped.

### 8.4 Conversation selection coordinator

The layout owns the selection event because the sidebar persists outside the chat center:

```typescript
async function openConversation(conversationId: string): Promise<void> {
  if (route.name !== "AI_Chat_Workspace") {
    await router.push({ name: "AI_Chat_Workspace" });
  }
  if (chatWorkspace.selectedConversationId !== conversationId) {
    await selectedConversation.loadSelection(conversationId);
  }
}
```

The real implementation must handle rejection and stale selection generations through the existing selected-conversation store. It must not cancel the previously selected conversation's main-process run.

## 9. Conversation Workspace Selection

### 9.1 Shared composable

Extract the conversation-workspace behavior currently embedded in `AiChatV2.vue` into:

`src/views/composables/useConversationWorkspace.ts`

Proposed interface:

```typescript
export interface ConversationWorkspaceState {
  readonly workspace: Readonly<Ref<WorkspaceSummary | null>>;
  readonly loading: Readonly<Ref<boolean>>;
  readonly errorMessage: Readonly<Ref<string | null>>;
  readonly setupOpen: Readonly<Ref<boolean>>;
  readonly memoryCount: Readonly<Ref<number>>;
  readonly trustCardVisible: Readonly<Ref<boolean>>;
  refresh(): Promise<void>;
  requestSetup(): void;
  closeSetup(): void;
  applyApprovedWorkspace(workspace: WorkspaceSummary): Promise<void>;
  dispose(): Promise<void>;
}

export function useConversationWorkspace(
  conversationId: Readonly<Ref<string | null>>
): ConversationWorkspaceState;
```

Implementation requirements:

- Reuse existing renderer APIs and IPC contracts.
- Treat conversation ID changes as a request generation boundary.
- Reject stale workspace responses.
- Preserve approval state and path display behavior.
- Keep filesystem watching scoped to the current approved workspace.
- Release any acquired watch during conversation change or component disposal.
- Never access the filesystem or database directly from the renderer.

### 9.2 Placement

The center order is:

1. Conversation header.
2. Workspace badge/chooser strip.
3. Workspace setup or trust card when needed.
4. Contextual run strip.
5. Transcript.
6. Composer.

The workspace strip is sticky only if usability testing shows it does not crowd the transcript. The initial implementation keeps it in normal flow beneath the header.

### 9.3 Empty and unavailable states

- No selected conversation: show a neutral prompt to create or select a chat; do not show a misleading workspace assignment.
- No workspace: `WorkspaceBadge` displays the existing unassigned state and opens `WorkspaceRequiredCard`.
- Unapproved workspace: show the existing approval action and do not imply filesystem tools are ready.
- Failed refresh: keep the last known safe summary, show an inline retry state, and do not broaden tool permissions.

### 9.4 Security boundary

Changing the badge is a user intent signal, not authorization by itself. Existing main-process workspace approval, canonicalization, and tool enforcement remain authoritative.

## 10. Composer Architecture

### 10.1 DOM and visual order

`AiChatV2Composer.vue` remains a single form-like interaction surface:

```text
Composer
├── attachment previews / validation
├── v-textarea (2–6 rows)
│   └── microphone action in append-inner
└── lower toolbar
    ├── attachment action
    ├── mode selector
    ├── model selector
    ├── tool approval selector
    ├── spoken-response toggle
    ├── stop-speaking action when active
    └── send or stop-run action
```

### 10.2 Textarea contract

Required Vuetify configuration:

```vue
<v-textarea
  v-model="draft"
  auto-grow
  rows="2"
  max-rows="6"
  ...
/>
```

Behavior remains:

- `Enter` sends when allowed.
- `Shift+Enter` inserts a newline.
- Input method editor composition never triggers an early send.
- An empty or whitespace-only draft does not send.
- Transcription merges with existing typed content according to the existing voice contract.
- Auto-grow stops at six rows, after which the input scrolls internally.

### 10.3 Lower-toolbar slots

Keep the existing `prepend` slot for backward compatibility. Add a semantic alias and action slot only if needed:

```vue
<slot name="controls">
  <slot name="prepend" />
</slot>
<slot name="toolbar-actions" />
```

During migration, classic chat may continue using `prepend`. The new center surface uses `controls` for mode/model/tool approval and `toolbar-actions` for spoken response. The default slot fallback prevents a flag rollback from losing controls.

### 10.4 Control ownership

- The center surface owns selected mode, model, and tool-approval state because they configure the next message.
- The composer renders the controls through slots but does not redefine their values or business rules.
- Send captures a single immutable `SendOptions` snapshot.
- Changing selectors after send does not mutate an active run.
- Existing provider/model availability and tool-approval rules remain authoritative.

### 10.5 Responsive toolbar

- Wide: controls remain in one line where space permits.
- Medium: controls wrap to a second toolbar line without moving above the textarea.
- Narrow: labels may collapse to compact accessible buttons/selects; the send action remains visible.
- The toolbar must not force horizontal page scrolling.
- Focus order follows DOM order: textarea, microphone, attachments, mode, model, approval, spoken response, stop-speaking, send/stop.

## 11. Voice Input and Spoken Responses

### 11.1 Shared voice orchestration

Extract classic-chat voice state into:

`src/views/composables/useAiChatVoice.ts`

Proposed contract:

```typescript
export interface AiChatVoiceState {
  readonly inputEnabled: Readonly<Ref<boolean>>;
  readonly autoSend: Readonly<Ref<boolean>>;
  readonly maxRecordingMs: Readonly<Ref<number>>;
  readonly ttsMode: Readonly<Ref<VoiceTtsMode>>;
  readonly spokenResponseEnabled: Readonly<ComputedRef<boolean>>;
  readonly speaking: Readonly<Ref<boolean>>;
  readonly settingsSaving: Readonly<Ref<boolean>>;
  readonly missingInputModel: Readonly<Ref<string | null>>;
  readonly missingOutputModel: Readonly<Ref<string | null>>;
  readonly runtimeUnavailable: Readonly<Ref<boolean>>;
  readonly installState: Readonly<Ref<VoiceInstallState>>;
  readonly playbackError: Readonly<Ref<string | null>>;
  loadSettings(): Promise<void>;
  toggleSpokenResponse(): Promise<void>;
  installRequiredRuntime(): Promise<void>;
  installRequiredModel(): Promise<void>;
  stopSpeaking(): Promise<void>;
  dispose(): void;
}
```

Both `AiChatV2.vue` and `AiChatCenterSurface.vue` consume this composable. There must be one implementation of settings loading, missing-model detection, install progress, and spoken-response toggling.

### 11.2 Microphone integration

Pass all existing composer voice props from the shared composable:

- Voice input enabled.
- Auto-send preference.
- Maximum recording duration.
- Missing model.
- Runtime unavailable.
- Install state and progress.
- Chat readiness.
- Conversation ID.

The microphone action remains visible when voice input is configured. If the runtime or model is missing, the control exposes the existing setup action instead of silently disappearing. Recording, transcription, error, and retry behavior stays inside the existing composer/voice modules.

### 11.3 Spoken-response component

Extract the current classic-header toggle into a presentational component:

`src/views/components/aiChatV2/AiChatVoiceOutputToggle.vue`

Props and events:

```typescript
interface Props {
  readonly enabled: boolean;
  readonly saving: boolean;
  readonly unavailable: boolean;
  readonly speaking: boolean;
}

interface Emits {
  (event: "toggle"): void;
  (event: "open-settings"): void;
}
```

It appears in the lower composer toolbar. Actual playback remains in the existing `VoicePlaybackQueue` and voice orchestration. The composer continues to show a stop-speaking action while audio is active.

### 11.4 Failure behavior

- Settings load failure: voice actions show unavailable/setup state; chat text remains usable.
- Recording permission denied: announce the error and retain the typed draft.
- Transcription failure: retain audio failure state and typed text; never send an empty message.
- TTS failure: show non-blocking playback error; do not mark the chat run failed.
- Component unmount: stop local recording resources and subscriptions; do not cancel the AI run.

## 12. Inspector Integration

### 12.1 Typed target

The existing `AppInspectorTarget` already includes chat. Extend it with the selected conversation identifier so stale or cross-conversation content cannot be displayed:

```typescript
type ChatInspectorTarget = {
  readonly kind: "chat";
  readonly ownerRoute: "/aiworkspace";
  readonly conversationId: string;
  readonly tab: "artifacts" | "activity" | "context";
};
```

Only validated identifiers and enum values may enter the inspector store. Do not store Vue component instances, callbacks, HTML, or complete domain objects.

### 12.2 Adapter

Create `ChatInspectorAdapter.vue` and register it statically:

```typescript
const INSPECTOR_REGISTRY: Partial<Record<AppInspectorKind, Component>> = {
  chat: ChatInspectorAdapter,
  schedule: ScheduleInspector,
};
```

The adapter may reuse `AiChatInspector.vue` internally, but `AppInspectorHost` remains the only global mount point. The adapter maps `AppInspectorTarget` and `useAppShellStore` geometry to existing chat inspector props/store actions.

### 12.3 State convergence

During Phase 1, `useChatWorkspaceStore` may continue storing the user's chat inspector tab and width preference. `useAppInspectorStore` owns target identity and route lifetime; `useAppShellStore` owns open/overlay geometry. Do not let two stores independently decide whether two inspector DOM trees are mounted.

After acceptance, migrate persisted chat width/tab preferences into a dedicated preference store and remove duplicate `inspectorOpen` geometry from `chatWorkspace`.

## 13. Responsive and Layout Behavior

Use the current shell breakpoints:

| Mode | Width | Navigation | Inspector | Center behavior |
| --- | ---: | --- | --- | --- |
| Wide | 1280px and above | Persistent, collapsible | Optional side region | Full toolbar when possible |
| Medium | 900–1279px | Persistent or compact | Overlay or narrower side region | Toolbar wraps below textarea |
| Narrow | Below 900px | Modal overlay | Modal overlay | Center uses full width; compact toolbar |

Rules:

- One `ResizeObserver` is attached by `useResponsiveShell` at the shell level.
- Center pages must not establish competing global breakpoints.
- Navigation and inspector overlays trap focus and restore focus on close.
- Opening one narrow overlay closes or covers the other deterministically.
- Route content owns its internal scrolling; the application must not produce two competing vertical document scrollbars.
- The composer respects safe-area insets where available.

## 14. Electron Window Geometry

### 14.1 Goals

- First launch opens at a practical normal size.
- The window is centered in the active primary display work area.
- Small displays receive clamped dimensions with usable margins.
- Later launches restore valid normal bounds.
- Maximized state is restored only when previously chosen by the user.
- Off-screen or corrupt saved state cannot make the application inaccessible.

### 14.2 Pure geometry module

Create `src/main-process/window/mainWindowGeometry.ts` with no Electron imports.

```typescript
export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DisplayWorkArea extends WindowBounds {
  readonly displayId: string;
  readonly scaleFactor: number;
}

export interface SavedMainWindowState {
  readonly version: 1;
  readonly normalBounds: WindowBounds;
  readonly maximized: boolean;
  readonly displayId?: string;
}
```

Export pure functions:

```typescript
computeInitialBounds(workArea: DisplayWorkArea): WindowBounds;
clampBoundsToWorkArea(bounds: WindowBounds, workArea: DisplayWorkArea): WindowBounds;
selectRestoreDisplay(saved: SavedMainWindowState, displays: readonly DisplayWorkArea[], primary: DisplayWorkArea): DisplayWorkArea;
normalizeSavedState(saved: unknown, displays: readonly DisplayWorkArea[], primary: DisplayWorkArea): SavedMainWindowState | null;
hasMeaningfulIntersection(bounds: WindowBounds, workArea: DisplayWorkArea): boolean;
```

### 14.3 Default sizing algorithm

Preferred content size is `1280 x 800`. Apply these rules:

1. Use the primary display's `workArea`, excluding taskbars and docks.
2. Reserve a 48px margin on each side where possible.
3. Width is `min(1280, workArea.width - 96)` with a practical minimum of 960 when the display allows it.
4. Height is `min(800, workArea.height - 96)` with a practical minimum of 640 when the display allows it.
5. If the display is smaller than those minimums, use all available work-area space minus a minimum 16px margin.
6. Center the resulting rectangle in the work area.
7. Do not maximize automatically.

The algorithm works in Electron display-independent pixels. Do not multiply coordinates by `scaleFactor`.

### 14.4 Persistence service

Create `src/main-process/window/MainWindowStateService.ts`.

Responsibilities:

- Read a single versioned JSON string from `ElectronStoreService("main-window")`.
- Parse and validate all fields as finite numbers within sensible limits.
- Return normalized bounds or the default bounds.
- Listen to `move`, `resize`, `maximize`, and `unmaximize` on the main window.
- Debounce writes by approximately 250ms.
- Store `window.getNormalBounds()` rather than maximized screen bounds.
- Persist immediately during the normal close path.
- Never throw a startup-fatal error for corrupt or unavailable state.

Suggested key: `mainWindow.state.v1`.

### 14.5 Restore validation

A saved state is valid only when:

- Version is supported.
- Coordinates and sizes are finite.
- Width and height exceed safe minimums.
- The rectangle has a meaningful intersection with at least one current display work area.

Prefer the saved `displayId` when it still exists. Otherwise choose the display with greatest intersection. If no meaningful intersection exists, center default bounds on the primary display. Clamp partially off-screen windows so at least the title bar and resizing edges remain reachable.

### 14.6 Startup sequence

```text
app ready
  -> screen.getAllDisplays() / getPrimaryDisplay()
  -> MainWindowStateService.resolveInitialState()
  -> new BrowserWindow({ ...normalBounds, show: false })
  -> register navigation guards and IPC
  -> load renderer
  -> restore maximize only if saved maximized === true
  -> show window
  -> attach debounced persistence listeners
```

Remove the unconditional `win.maximize()` call. Keep existing single-instance focusing behavior. If a maximized hidden window is restored, maximize it before showing to avoid a visible resize flash.

### 14.7 Deterministic test behavior

E2E tests must not inherit a developer's saved bounds. When `AIFETCHLY_E2E=1`:

- Ignore persisted state.
- Use deterministic test bounds, default `1280 x 800` unless the test config overrides them.
- Disable window-state writes.

This prevents flaky screenshots and cross-test contamination.

## 15. State Ownership Matrix

| State | Owner | Lifetime | Persistence |
| --- | --- | --- | --- |
| Active child route | Vue Router | Renderer session | URL/hash history |
| Shell mode and overlay state | `useAppShellStore` | Application window | Session; selected preferences may persist |
| Workspace/conversation summaries | `useChatWorkspaceStore` | Authenticated application | Main-process/DB source, renderer projection |
| Selected conversation ID | `useChatWorkspaceStore` | Renderer session | Existing conversation system |
| Selected messages/run state | `useSelectedConversationStore` | Selection/application | Durable source in main process; bounded renderer projection |
| Composer draft | Chat center/composer draft store | Per conversation | Session unless existing draft persistence is retained |
| Mode/model/tool approval | Chat center next-message settings | Renderer/user settings | Existing mechanisms |
| Conversation workspace | `useConversationWorkspace` | Selected conversation | Existing main-process workspace services |
| Voice settings/runtime | `useAiChatVoice` | Renderer/application | Existing voice settings APIs |
| Inspector target | `useAppInspectorStore` | Current owner route | Session |
| Inspector width/tab preference | Preference store; chat store temporarily | Application window | Local settings |
| Main window bounds/maximized | `MainWindowStateService` | Application installation/profile | Electron store |

## 16. Key Data Flows

### 16.1 Open an inner page

```text
Sidebar route action
  -> router.push('/insights')
  -> authenticated shell remains mounted
  -> AppCenterRouteHost observes route
  -> clears route-owned stale inspector target
  -> applies LegacyPageFrame or converged frame
  -> Insights page mounts in center
  -> chat summary subscription and active main-process runs continue
```

### 16.2 Return to selected conversation

```text
Select conversation in persistent sidebar
  -> layout routes to /aiworkspace
  -> selectedConversation.loadSelection(id) if selection changed
  -> generation increments
  -> detail subscription is established
  -> snapshot seeds bounded message window
  -> workspace and voice composables reconcile
  -> composer focuses when ready
```

### 16.3 Send with lower-toolbar settings

```text
User edits textarea
  -> chooses mode/model/tool approval below input
  -> optionally records/transcribes voice
  -> send captures text + immutable SendOptions
  -> selectedConversation.startChatRun
  -> main-process coordinator validates and owns run
  -> selected detail events update transcript
  -> global summaries continue updating sidebar when another route is open
```

### 16.4 Restore the desktop window

```text
Read saved JSON
  -> schema and number validation
  -> select current display
  -> intersection check
  -> clamp normal bounds
  -> construct hidden BrowserWindow
  -> optionally restore explicit maximized state
  -> show
  -> debounce subsequent state writes
```

## 17. Error and Race Handling

### 17.1 Router and shell

- Failed lazy route import shows the existing recoverable route error state; shell remains usable.
- Rapid navigation uses the latest route as inspector owner.
- Workspace summary bootstrap failure shows a retry affordance in the sidebar without blocking center routes.
- Shell rollout flag read failure defaults on, matching current behavior.

### 17.2 Conversation selection

- Existing generation numbers reject stale selection snapshots.
- Switching conversations never cancels the old conversation's run.
- A stale workspace refresh response is ignored when conversation ID changes.
- Selecting a conversation while another route loads resolves navigation before focusing chat controls.

### 17.3 Voice

- Voice errors are local capability errors, not chat-run failures.
- Disposing one chat surface must not unregister global listeners needed by another mounted consumer. The shared composable must use reference-counted or instance-scoped subscriptions as appropriate.
- Only one local recording session may own the microphone at a time.

### 17.4 Window state

- Invalid JSON, unsupported versions, impossible sizes, missing displays, and store read failures all fall back to centered defaults.
- Move/resize events after destruction are ignored.
- A pending debounce is flushed or cancelled safely on close.
- Kiosk/fullscreen state is not persisted as user maximized preference.

## 18. Accessibility Requirements

1. The shell exposes navigation, main, and complementary landmarks.
2. The active global route uses `aria-current="page"`.
3. The active conversation uses `aria-current` or `aria-selected` appropriate to its widget pattern.
4. Sidebar roving keyboard behavior remains intact after moving it to the shared layout.
5. Narrow navigation and inspector overlays trap focus and restore it to the opening control.
6. Workspace badge, approval state, microphone state, recording time, transcription state, spoken-response state, and send/stop controls have localized accessible names.
7. Recording, transcription, playback, route-load failure, and window-independent chat completion announcements use appropriate live regions without duplicating announcements.
8. Selector labels remain programmatically associated when the toolbar becomes icon-compact.
9. The textarea is the first composer field in reading order; lower settings remain below it in both visual and DOM order.
10. Touch targets remain at least 40px where feasible and no essential action depends on hover.

## 19. Internationalization

Every added or changed user-facing string must be present in:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Expected changes include:

- Removing the `Back to app` label if it is unused elsewhere.
- Workspace strip fallback, loading, retry, and unavailable text.
- Voice setup and spoken-response accessible labels if not already shared.
- Any window-related settings copy introduced later.

Component code uses `t()` and retains an English fallback according to repository convention. Tests must detect missing keys across all six catalogs.

## 20. Security and Process Boundaries

- Renderer code accesses workspace, voice, chat, and settings capabilities only through the existing preload/API wrappers.
- No direct TypeORM or SQLite access is added to UI components, composables, or IPC handlers.
- Any modified AI IPC handler checks `Token` and `USER_AI_ENABLED` before parsing data or doing AI work.
- Workspace selection never bypasses canonical path validation, trust approval, or tool-scope checks.
- `AppInspectorHost` uses a static component registry; route, IPC, and user data cannot select arbitrary component modules.
- Inspector targets contain identifiers, not raw HTML or complete records.
- Window state contains only geometry and maximized preference. It must not contain tokens, paths, chat content, or user identifiers.
- Navigation guards and context isolation remain unchanged.
- No worker process is introduced for this UI and window-lifecycle change.

## 21. Performance Budgets

| Metric | Budget |
| --- | ---: |
| Shell remounts during authenticated center navigation | 0 |
| Global responsive observers | 1 |
| Mounted full transcript projections | 1 selected conversation |
| Navigation response to center loading state | <= 100ms perceived response |
| Route loading indicator delay | Preserve current 150ms anti-flicker behavior |
| Composer key-to-paint under normal load | <= 50ms p95 |
| Stream reactive flush cadence | Preserve existing approximately 50ms batching |
| Window-state write debounce | Approximately 250ms |
| Window restore validation | Synchronous, negligible compared with BrowserWindow creation |

Route navigation must not trigger workspace summary re-bootstrap, voice model reinstall checks beyond cached settings reconciliation, or full inactive-history loads.

## 22. Observability

Use structured, content-free diagnostics:

- `shell.route_changed`: from/to route names and whether shell stayed mounted.
- `shell.navigation_overlay_changed`: mode and open/closed state.
- `chat.selection_loaded`: conversation ID hash or redacted identifier, generation, latency, outcome.
- `chat.workspace_loaded`: conversation ID hash, assigned/approved state, latency.
- `voice.settings_loaded`: capability booleans and outcome, never transcript/audio.
- `window.state_restored`: source `saved|default`, display match, clamped, maximized.
- `window.state_invalid`: reason category only.

Never log prompts, transcripts, workspace paths, voice audio, tokens, or decrypted settings. Existing logging utilities and redaction rules remain authoritative.

## 23. Proposed File Changes

### 23.1 New files

| File | Purpose |
| --- | --- |
| `src/views/layout/AuthenticatedLayoutBoundary.vue` | Default-on shell/legacy rollback boundary |
| `src/views/layout/AuthenticatedWorkspaceLayout.vue` | Persistent authenticated shell composition |
| `src/views/layout/RouteGroupOutlet.vue` | Nested `RouterView` without a second global layout |
| `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue` | Chat-only center route surface |
| `src/views/components/appShell/inspectors/ChatInspectorAdapter.vue` | Static-registry adapter for chat inspector |
| `src/views/components/aiChatV2/AiChatVoiceOutputToggle.vue` | Reusable spoken-response control |
| `src/views/composables/useConversationWorkspace.ts` | Shared conversation workspace state and lifecycle |
| `src/views/composables/useAiChatVoice.ts` | Shared voice settings/runtime orchestration |
| `src/main-process/window/mainWindowGeometry.ts` | Pure bounds and display selection functions |
| `src/main-process/window/MainWindowStateService.ts` | Electron window state persistence/lifecycle |

### 23.2 Modified files

| File | Change |
| --- | --- |
| `src/views/router/index.ts` | Introduce one authenticated route parent and preserve public routes |
| `src/views/layout/layout.vue` | Reduce to rollback-only legacy layout; remove competing converged branch after migration |
| `src/views/components/appShell/AppWorkspaceShell.vue` | Confirm single shell/inspector geometry and landmarks |
| `src/views/components/appShell/AppInspectorHost.vue` | Register chat adapter |
| `src/views/types/uiConvergenceTypes.ts` | Add conversation ID to chat inspector target |
| `src/views/components/aiChatWorkspace/AiChatWorkspaceSidebar.vue` | Remove `Back to app`; add active route semantics |
| `src/views/components/aiChatWorkspace/AiChatWorkspaceShell.vue` | Become compatibility wrapper or be removed after extraction |
| `src/views/components/aiChatV2/AiChatV2Composer.vue` | Two rows and lower-toolbar slots |
| `src/views/components/aiChatV2/AiChatV2.vue` | Consume shared workspace and voice composables |
| `src/views/store/chatWorkspace.ts` | Bridge inspector preferences during convergence |
| `src/background.ts` | Resolve initial bounds, remove implicit maximize, attach persistence |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` | Complete changed UI copy |

### 23.3 Test files

Add or update:

- `test/vitest/main/components/AuthenticatedWorkspaceLayout.test.ts`
- `test/vitest/main/components/AiChatCenterSurface.test.ts`
- `test/vitest/main/components/AiChatWorkspaceSidebar.test.ts`
- `test/vitest/main/components/AiChatV2Composer.test.ts`
- `test/vitest/main/components/AiChatV2Composer.voice.test.ts`
- `test/vitest/main/components/AiChatVoiceOutputToggle.test.ts`
- `test/vitest/main/components/WorkspaceBadge.test.ts`
- `test/vitest/main/components/AppInspectorHost.test.ts`
- `test/vitest/main/components/uiMigrationCoverage.test.ts`
- `test/vitest/main/mainWindowGeometry.test.ts`
- `test/vitest/main/MainWindowStateService.test.ts`
- `test/e2e/workspace-shell.spec.ts`

Use the repository's actual existing filenames when they differ; extend existing coverage instead of creating duplicate suites for the same component.

## 24. Implementation Phases

### Phase 0: Characterization and contracts

1. Add route-coverage tests for the current topology and target invariants.
2. Add pure geometry tests before changing startup behavior.
3. Characterize classic chat workspace and voice behavior in component tests.
4. Add translation key parity checks for affected namespaces.

Exit gate: tests describe existing capability and intended placement without implementation ambiguity.

### Phase 1: Reusable workspace and voice state

1. Extract `useConversationWorkspace` from classic chat.
2. Extract `useAiChatVoice` from classic chat.
3. Add `AiChatVoiceOutputToggle`.
4. Refactor classic chat to consume them with no visible behavior change.
5. Run component tests before connecting the new center.

Exit gate: classic chat retains workspace selection, recording, transcription, spoken response, setup, and errors.

### Phase 2: Composer refinement

1. Change textarea to two rows.
2. Add compatible lower-toolbar slots.
3. Render mode/model/tool approval through the lower slot in both surfaces.
4. Add spoken-response control in the lower action slot.
5. Verify narrow wrapping and keyboard order.

Exit gate: no selector row renders above the textarea and all existing voice tests pass.

### Phase 3: Chat center extraction

1. Extract `AiChatCenterSurface` from the full workspace shell.
2. Add workspace strip and shared voice wiring.
3. Register chat inspector adapter.
4. Keep `AiChatWorkspaceShell` as a temporary compatibility wrapper composed from shared pieces if needed.

Exit gate: the center surface can render and operate without owning a sidebar or second inspector.

### Phase 4: Persistent authenticated routing

1. Introduce the layout boundary and workspace layout.
2. Move all authenticated routes beneath the parent.
3. Replace route-group `Layout` usage with route outlets or flattened leaves.
4. Remove `Back to app`.
5. Update active route states and route migration coverage.

Exit gate: Chat, Insights, Knowledge, Plugins, and representative legacy pages navigate without shell remount or duplicate drawers.

### Phase 5: Window lifecycle

1. Implement and test pure geometry functions.
2. Implement state persistence service.
3. Integrate it into `createWindowBody`.
4. Remove unconditional maximize.
5. Add deterministic E2E behavior.

Exit gate: first launch, restore, display removal, corrupt state, and explicit maximize cases pass.

### Phase 6: Convergence cleanup

1. Run full component and E2E suites.
2. Validate all languages and accessibility states.
3. Remove duplicate inspector geometry and obsolete full-shell CSS.
4. After the rollback window, remove the legacy boundary, flag, and compatibility wrapper.

Exit gate: one shell and one inspector DOM tree remain in the default implementation.

## 25. Test Strategy

### 25.1 Unit tests: window geometry

Cover:

- 1920x1080 work area yields centered 1280x800.
- Small laptop work area clamps with margins.
- Work area smaller than minimum remains reachable.
- Negative display coordinates are valid.
- Saved bounds on a disconnected monitor fall back to primary.
- Partial off-screen bounds clamp.
- Corrupt JSON, NaN-like data, negative size, enormous size, and unsupported version fall back.
- Explicit maximized preference is preserved; fullscreen is not interpreted as maximized.

### 25.2 Component tests: shared shell

Cover:

- Shell renders once around route changes.
- Sidebar persists while center page changes.
- No `Back to app` button exists.
- Active route receives `aria-current`.
- Narrow navigation opens, traps focus, closes, and restores focus.
- Inspector closes when owner route changes.
- Workspace summary bootstrap runs once.

### 25.3 Component tests: chat center

Cover:

- Workspace badge is below the header and above transcript.
- No selected conversation state.
- Workspace setup, approval, refresh error, and retry.
- Conversation selection ignores stale responses.
- Leaving and returning retains selection and does not invoke cancellation.
- Chat inspector opens through the application inspector store.

### 25.4 Component tests: composer and voice

Cover:

- Rendered control is a textarea with two initial rows and maximum six.
- Selectors render after the textarea in DOM order.
- Toolbar wraps without moving controls above input.
- Enter, Shift+Enter, IME composition, empty send, send, and stop.
- Microphone visible when enabled.
- Recording, transcription, auto-send, merge with typed draft, permission denial, missing runtime/model, install flow, and maximum duration.
- Spoken-response toggle loading, success, failure, unavailable, speaking, and stop-speaking.
- Text chat remains available during every voice failure state.

### 25.5 Router tests

Cover route resolution for:

- `/` to `/aiworkspace`.
- `/aiworkspace` in authenticated shell.
- `/insights` in authenticated shell.
- `/knowledge/library` in authenticated shell.
- `/plugins/management` in authenticated shell.
- Representative nested edit/detail/settings routes.
- `/login` outside authenticated shell.
- `/404` behavior without a redirect loop.

### 25.6 E2E critical flow

One Playwright Electron flow must:

1. Launch at deterministic normal bounds.
2. Assert the app is not maximized.
3. Confirm chat center and persistent sidebar.
4. Select a conversation and observe workspace chooser.
5. Verify textarea and lower selector order.
6. Open Insights, Knowledge Library, and Plugins.
7. Assert the same shell DOM identity remains and `Back to app` is absent.
8. Return to chat and confirm the selected conversation remains.
9. Exercise voice setup through mocked capability state.
10. Resize to narrow mode and verify overlay behavior.

A separate Electron lifecycle test or focused integration test covers persisted normal bounds and explicit maximize restoration.

### 25.7 Required commands

At minimum, implementation changes run:

```bash
yarn test:components
yarn test:e2e
yarn vue-check
```

Run focused unit suites first, then the broader gates. Pre-existing unrelated type or lint failures must be reported explicitly; they must not be hidden by deleting or weakening new tests.

## 26. Acceptance Traceability

| Requirement group | Design sections | Primary verification |
| --- | --- | --- |
| Persistent chat-first shell | 5–8 | Router coverage, shell component tests, E2E DOM identity |
| Inner pages in center | 6–7 | Route resolution and navigation E2E |
| Remove `Back to app` | 7.4 | Sidebar component test and E2E absence assertion |
| Workspace chooser above chat | 9 | Chat center component tests |
| Textarea | 10.2 | Composer DOM and keyboard tests |
| Selectors below textarea | 10.1–10.5 | DOM-order and responsive component tests |
| Microphone restored | 11.1–11.2 | Existing and expanded voice tests |
| Spoken response restored | 11.3–11.4 | Toggle and playback-state tests |
| Suitable startup size | 14 | Geometry unit and Electron launch tests |
| Restore user window state | 14.4–14.7 | Service unit and lifecycle integration tests |
| Responsive behavior | 13 | Component resize tests and E2E |
| Accessibility | 18 | Component assertions and manual screen-reader pass |
| Localization | 19 | Six-language key parity test |
| Security boundaries | 20 | Code review and existing IPC/security tests |

## 27. Rollout and Rollback

### 27.1 Rollout

- Continue using `aifetchly.innerPageShellV2` as a default-on rollout control.
- Land reusable composables before switching route topology.
- Keep the classic chat and legacy layout capable of rendering during the rollback period.
- Compare shell errors, route-load failures, voice capability errors, and window restore fallbacks before removing compatibility code.

### 27.2 Rollback

Turning the shell flag off selects legacy `layout.vue`. Rollback must not require:

- Database migrations.
- Conversation transformation.
- Workspace reapproval.
- Voice model reinstall.
- Window-state deletion.

The window geometry change is independently reversible by ignoring the saved state and using centered defaults; never restore unconditional maximize as a fallback.

### 27.3 Removal criteria

Remove the rollback boundary only after:

1. All authenticated routes pass coverage.
2. No duplicate shell or inspector is mounted in production paths.
3. Component and E2E gates remain stable.
4. Voice and workspace capability parity is confirmed.
5. Window restore fallback rates are acceptable.
6. Product and engineering owners approve removal.

## 28. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Large router restructuring breaks nested paths | High | Preserve absolute URLs, add route resolution coverage before moving records |
| Shell remounts despite shared component type | High | Use one actual parent route, not repeated copies of the same layout component |
| Duplicate workspace/voice state drifts | High | Extract shared composables before connecting the new center |
| Two inspector stores mount two panels | Medium | One `AppInspectorHost`; temporary store bridge with explicit ownership |
| Route changes dispose run presentation | High | Keep main-process run ownership and store lifetime independent from center component |
| Small window exposes responsive defects | Medium | Fix shell responsive behavior and test normal/narrow bounds before changing startup |
| Saved window is off-screen after monitor removal | High | Intersection validation, display selection, and clamping |
| E2E screenshots become machine-dependent | Medium | Deterministic E2E bounds and persistence bypass |
| Voice runtime setup blocks text chat | High | Capability errors remain non-blocking and localized to voice controls |
| Legacy rollback code persists indefinitely | Medium | Time-bound removal criteria and coverage gate |

## 29. Engineering Review Checklist

- [ ] Exactly one authenticated shell is mounted.
- [ ] Login and public routes remain outside the shell.
- [ ] `/` resolves to `/aiworkspace`.
- [ ] Feature navigation changes only center content.
- [ ] No duplicate drawer, header, inspector, notice host, or responsive observer exists.
- [ ] `Back to app` and its unused translations are removed.
- [ ] Workspace chooser is conversation-scoped and above the transcript.
- [ ] Workspace approval remains main-process enforced.
- [ ] Textarea starts at two rows and preserves keyboard/IME behavior.
- [ ] Mode, model, and tool approval are below the textarea.
- [ ] Microphone and spoken-response states match classic chat capability.
- [ ] Voice failures never block typed chat.
- [ ] Route changes do not cancel runs or clear selection.
- [ ] Chat inspector uses the static application inspector registry.
- [ ] Window starts centered at normal size without implicit maximize.
- [ ] Saved window state is versioned, validated, clamped, and test-isolated.
- [ ] All six language files are updated.
- [ ] UI component and critical E2E tests are included in the same change.
- [ ] No `any` type is introduced.
- [ ] No renderer, IPC handler, or worker gains direct database access.

## 30. Final Technical Outcome

After implementation, AiFetchly has one durable authenticated workspace shell. The sidebar preserves global and conversation context while Vue Router changes only the center surface. Chat uses the same workspace approval and local voice capabilities as the classic experience, with a visibly multiline composer and all next-message controls below the input. The inspector has one typed host, chat execution remains independent from routed component lifetime, and the Electron window opens at a practical, recoverable user-controlled size instead of taking over the display.
