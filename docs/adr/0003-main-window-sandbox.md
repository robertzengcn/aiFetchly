# ADR-0003: Main-window sandbox

- **Status:** Accepted — compensating control documented; flip is a follow-up
- **Workstream:** WS-1 (R1.3)
- **Date:** 2026-07-10

## Context

The main window runs with `contextIsolation: true`, `nodeIntegration: false`,
and a privileged preload (`src/preload.ts`) that exposes `window.api`
(channel-allowlisted). `sandbox` is **not** explicitly set. Electron's sandbox
hardens the renderer by moving it into an OS process with no direct Node access,
further limiting a renderer compromise.

## Decision (this wave)

Do **not** blindly flip `sandbox: true` in this wave. Instead:

1. Add a `will-navigate` / `will-redirect` guard (WS-1 R1.2) so the privileged
   preload cannot be re-injected on an attacker origin. This closes the primary
   navigation-bypass path independent of sandbox.
2. Set `contextIsolation: true` + `nodeIntegration: false` **explicitly** on
   child-window override options (so a future Electron default change cannot
   regress them).
3. File a follow-up to audit `preload.ts` for Node-builtin usage; if
   sandbox-compatible, set `sandbox: true` and verify the dev launch.

## Consequences

- + The navigation-bypass attack surface is closed now (the higher-value fix).
- + Child windows are explicitly hardened.
- − Main window is not yet sandboxed; a renderer exploit still has preload-level
  capability. Mitigated by contextIsolation + the navigation guard, and tracked
  as a follow-up.

## Alternatives considered

- **Flip `sandbox: true` now:** rejected without a preload audit — a preload
  dependency on a Node builtin would break the app at runtime, and we ship
  half-enabled security.
