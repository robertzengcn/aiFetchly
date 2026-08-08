# Workspace Memory Manual QA Report - 2026-07-10

Tester: Codex via live Electron debug app
App process: `/Users/cengjianze/project/aiFetchly/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --inspect --disable-gpu --disable-software-rasterizer --no-sandbox`
Window title: `Home - AiFetchly`
Manual test source: `docs/test-manual/workspace-memory.md`

## Scope Tested

- AI Chat V2 workspace-required state
- Workspace IPC create/approve/list
- Workspace memory IPC create/list/update/archive/delete
- Workspace isolation between two approved workspaces
- Pending/unapproved workspace rejection
- Renderer-forged `workspaceKey` rejection-by-ignoring
- Secret-like memory content rejection
- Basic layout state with AI Chat V2 dock open

Temporary test folders:

- `/tmp/aifetchly-wm-alpha`
- `/tmp/aifetchly-wm-beta`

## Bugs Found

### BUG-001 - Electron window becomes unreachable through macOS accessibility while app still reports it is visible

Severity: Medium
Area: Desktop app / debug QA / accessibility

Steps:

1. Start the app in Cursor debug mode.
2. Open AI Chat V2 with DevTools visible.
3. Use macOS accessibility/Computer Use to attach to the running `Electron` app.
4. Click the AI Chat V2 workspace badge area.
5. Try to get app state again through accessibility.

Actual:

- Computer Use initially read the window and screenshot successfully.
- After interacting, `get_app_state("Electron")` repeatedly failed with `cgWindowNotFound`.
- `list_apps` still showed `Electron` running.
- Electron main-process inspector reported the window still existed and was visible:

```json
{
  "title": "Home - AiFetchly",
  "visible": true,
  "minimized": false,
  "bounds": { "x": 342, "y": 22, "width": 800, "height": 600 },
  "url": "http://localhost:5173/#/dashboard/home",
  "devtools": true
}
```

Expected:

- If Electron reports the BrowserWindow is visible, the native window should remain targetable through macOS accessibility/window APIs.
- Manual QA automation should not lose the visible window handle after normal in-app interaction.

Notes:

- This may be related to DevTools being docked/open or to the debug launch flags.
- I continued testing through `webContents.executeJavaScript()` because the renderer remained alive.

### BUG-002 - AI Chat V2 and legacy AI chat panel are both mounted as visible panels

Severity: Low to Medium
Area: AI Chat layout / responsive dock

Observed state with AI Chat V2 dock open and viewport approximately `549x572`:

```json
[
  {
    "class": "ai-chat-dock dock-open",
    "text": "AI Assistant ... No workspace set ...",
    "rect": { "x": 0, "y": 0, "w": 543, "h": 480 },
    "display": "block",
    "visibility": "visible",
    "zIndex": "9998"
  },
  {
    "class": "ai-chat-panel",
    "text": "AI Assistant\\n\\nStart a conversation with AI Assistant",
    "rect": { "x": 543, "y": 0, "w": 543, "h": 572 },
    "display": "block",
    "visibility": "visible",
    "zIndex": "9998"
  }
]
```

Actual:

- The V2 dock and the legacy `ai-chat-panel` / `ai-chat-box` both remain mounted with `display: block` / `display: flex` and `visibility: visible`.
- The legacy panel is positioned just outside the viewport (`x: 543`) with the same high z-index family.
- DOM text includes two `AI Assistant` surfaces:
  - V2 chat with the current conversation
  - legacy panel empty state: `Start a conversation with AI Assistant`

Expected:

- When AI Chat V2 is enabled/open, the legacy AI chat panel should be unmounted, hidden with `display: none`, or otherwise removed from the active accessibility/layout tree.
- Users and accessibility tools should not encounter two visible AI assistant panels.

Risk:

- Screen readers and automation can see duplicate chat surfaces.
- Future responsive/layout changes could expose the legacy panel visually.
- Click/focus behavior may become ambiguous around the right edge of the dock.

## Verified Passing Checks

### PASS-001 - Workspace memory CRUD works through live renderer IPC

Steps exercised:

1. Created Workspace A with conversation ID `manual-qa-wm-alpha-1783654022531`.
2. Approved Workspace A.
3. Created Workspace B with conversation ID `manual-qa-wm-beta-1783654022531`.
4. Approved Workspace B.
5. Created one workflow memory in each workspace.
6. Listed each workspace by the same query.
7. Updated Workspace A memory.
8. Archived Workspace A memory.
9. Verified archived memory no longer appears in active list.
10. Listed archived memory by status.
11. Deleted archived memory.
12. Verified delete result.

Result:

- Create/list/update/archive/delete returned successful IPC responses.
- Archived memory was excluded from active list.
- Delete returned `data: 1`.

### PASS-002 - Workspace isolation works for same-title memories

Workspace A memory:

```text
Use yarn testmain for this workspace.
```

Workspace B memory:

```text
Use npm run test:beta for this workspace.
```

Result:

- Listing Workspace A returned only the Workspace A memory.
- Listing Workspace B returned only the Workspace B memory.
- Workspace keys were different:
  - A: `ws_2377c5bffb1ead5d61513e841c01608b`
  - B: `ws_cef5ffb496feb996673787eeb4132670`

### PASS-003 - Secret-like memory content is rejected

Input:

```text
api_key=sk-1234567890abcdef1234567890abcdef
```

Result:

```json
{
  "status": false,
  "msg": "Workspace memory content looks like a secret or credential and was rejected."
}
```

### PASS-004 - Pending/unapproved workspaces cannot use workspace memory

Steps:

1. Set a workspace for conversation ID `manual-qa-wm-pending-1783654135576`.
2. Did not approve it.
3. Tried to create workspace memory.
4. Tried to list workspace memory.

Result:

```json
{
  "status": false,
  "msg": "Choose an approved workspace before using workspace memory."
}
```

### PASS-005 - Renderer-supplied `workspaceKey` is ignored

Steps:

1. Created and approved conversation `manual-qa-wm-forged-1783654135576`.
2. Sent create payload containing `workspaceKey: "ws_renderer_forged"`.

Result:

- Memory was created under the main-process resolved key, not the forged key:

```json
{
  "workspaceKey": "ws_2377c5bffb1ead5d61513e841c01608b",
  "workspaceRoot": "/private/tmp/aifetchly-wm-alpha"
}
```

## Not Fully Tested

- Native folder picker flow, because the Electron window became unreachable through macOS accessibility after the first interaction.
- Chat prompt injection with a real model response, to avoid relying on external model behavior while the visible window was not controllable.
- Auto-dream write/update behavior, because that may trigger AI model calls.
- Language switching and translated workspace-memory UI.
- Delete confirmation dialog in the actual UI; delete was tested through IPC only.

## Cleanup Performed

- Deleted active QA memories created for Workspace B and forged-key test.
- Workspace rows and any archived/deleted-memory history may still remain in the local test database as audit/test residue.
