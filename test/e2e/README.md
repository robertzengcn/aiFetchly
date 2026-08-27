# Workspace E2E (PRD §34.4)

`yarn e2e:workspace` runs the workspace-redesign Electron specs via
Playwright's `_electron` launcher — no downloaded browsers are required
(`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` was used at install; the specs launch
the repo's own Electron binary).

## Prerequisites

1. Build assets once so Electron can boot the app:
   - `yarn install`
   - `yarn build` (renderer) — the main bundle is built by forge/vite on
     launch in dev mode; for packaged runs use `yarn package` first and set
     `APP_ENTRY` to the packaged binary.
2. Run: `yarn e2e:workspace`

## Live-AI scenarios

Scenarios that require a real provider backend (switch-while-running,
artifact creation, renderer reload during a run) are guarded by
`AIFETCHLY_E2E_LIVE_AI=1`; they skip automatically without it so the shell
spec stays runnable on any machine.
