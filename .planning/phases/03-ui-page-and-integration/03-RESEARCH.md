# Phase 3 Research: UI Page and Integration

**Phase:** 3 - UI Page and Integration
**Date:** 2026-05-23

## RESEARCH COMPLETE

### Key Findings

#### 1. IPC Channel Pattern (src/config/channellist.ts)
Channels are string constants exported from channellist.ts. Pattern: `"google_maps:action"`.
Need to add: `GOOGLE_MAPS_SEARCH_START`, `GOOGLE_MAPS_SEARCH_CANCEL`, `GOOGLE_MAPS_SEARCH_PROGRESS`, `GOOGLE_MAPS_SEARCH_RESULT`.

#### 2. IPC Handler Pattern (src/main-process/communication/)
- Uses `ipcMain.handle()` for request/response
- Uses `BrowserWindow.getAllWindows()[0].webContents.send()` for push events
- Checks `Token` and `USER_AI_ENABLED` for AI features (but Google Maps UI is manual, not AI-gated)
- Imports `GoogleMapsModule` and delegates to it

#### 3. Frontend API Pattern (src/views/api/*.ts)
- Each module has its own API file
- Uses `windowInvoke(channel, data)` from `@/views/utils/apirequest`
- Returns typed responses
- Google Maps needs simpler API: start, cancel, onProgress, onResult

#### 4. Router Pattern (src/views/router/index.ts)
- Routes defined in `constantRoutes` array
- Each route has `path`, `name`, `meta: { visible, title, icon }`, `component` (lazy import)
- Routes with `visible: true` appear in sidebar navigation
- Parent route uses `Layout` component wrapper
- Google Maps needs a single page route: `/google-maps-scraper`

#### 5. i18n Pattern (src/views/lang/)
- Each language exports a default object with nested keys
- Namespace pattern: `googleMaps.key_name`
- 6 languages: en, zh, es, fr, de, ja
- Keys used via `t('googleMaps.key')` in components with `useI18n()`

#### 6. UI Component Patterns
- Vue 3 Composition API with `<script setup lang="ts">`
- Vuetify components (v-card, v-btn, v-text-field, v-data-table, etc.)
- Similar page pattern: search form at top, results table below
- Yellow Pages list.vue is closest analog for layout reference

### Architecture Decisions

1. **Simple IPC flow**: Unlike YellowPages (task-based with CRUD), Google Maps is request-based. Start search → get progress events → get result. No list/detail pages needed.

2. **Single page route**: `/google-maps-scraper` with one component. The page has a search form and results display. No list/create/detail split.

3. **Push events for progress**: Main process sends progress/result via `webContents.send()`. Frontend subscribes via `window.electronAPI` or preload bridge.

4. **No AI-gating for UI**: The manual UI page doesn't need AI enabled check. Only the AI skill path is AI-gated (already handled in ToolExecutor).

### Risks
- **Medium**: Preload bridge may need updating to expose new IPC channels. Need to check preload.ts.
- **Low**: Vuetify component patterns well-established in this codebase.
