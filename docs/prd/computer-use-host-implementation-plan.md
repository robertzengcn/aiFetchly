# Computer Use Integration — Host Implementation Plan

Source of truth: `docs/prd/computer-use-aifetchly-prd.md` (PRD v1.4) and
`docs/prd/computer-use-aifetchly-technical-design.md` (design v1.4).

## Scope

The plugin repository (`aifetchly-computer-use`) and the Hub are **external
release dependencies** that do not exist yet. This plan implements the
**host-owned** work that is buildable and testable inside `aiFetchly` today:
PRD Phase 0 (foundations) plus the host scaffolding of Phases 1–2 that runs
against compile-time stubs, conformance fixtures, and the existing local AI
runtime test suites. Native Windows/Excel qualification, packaged model
downloads, and macOS work remain gated on plugin artifacts per PRD §9.

## Stages

### Stage A — Foundation types and schemas
- `src/entityTypes/computerUseTypes.ts`: session state machine, generation,
  target handles, observation/grounding/action records, trusted action grants,
  planner modes, shared error codes, `GroundingReadiness`, worker protocol,
  settings contract.
- `src/schemas/ipc/computerUse.ts`: Zod validation for every renderer→main
  payload (design §9 "cross-process communication must be validated").

### Stage B — MCP SDK client (PRD D-19, design §4.1–4.2) — ships independently
- Add `@modelcontextprotocol/sdk` (verify zod peer range vs `zod ^3.24`).
- `src/modules/mcp/SupervisedStdioTransport.ts`: SDK `Transport` over host
  spawn — keeps `assertStdioTrusted`, env allow/deny, shell-free argv, bounded
  message size, process-tree ownership; byte-buffered newline decode (fixes the
  CJK split bug), stderr bounded+redacted.
- Rebuild `src/modules/MCPClient.ts` on SDK `Client`: full init/negotiation,
  `notifications/initialized`, notifications/progress/cancellation, complete
  content-block results, graceful close + tree termination.
- `src/service/MCPSessionPool.ts`: persistent sessions keyed by identity +
  launch-config hash + trust generation; idle timeout; supervisor-owned
  lifecycle for Computer Use sessions.
- Tests under `test/vitest/main/`: handshake against a fake stdio server child,
  chunked multi-byte UTF-8, timeout, cancel, exit rejection, pool reuse.

### Stage C — Supervisor core (design §10.1–10.3, §11)
- `ComputerUseSupervisor`: state machine, generation counters, serialized
  dispatch, stop/revoke, pause/handoff/takeover, late-result discard.
- `ComputerUseTargetStore`: bounded in-memory handles bound to generation and
  observation expiry.
- `ComputerUseCoordinateTransforms`: §11.2 composition with independent
  per-axis scales, padding, crop origin; failure on out-of-bounds points.
- `ComputerUseLeaseService`: one desktop-control owner, `desktop_busy`.
- `ComputerUseActionAuthorization`: short-lived grants bound to session
  generation + action hash + target fingerprint; model-supplied grants are
  never accepted (CU-PERM-03).

### Stage D — Safety controls (design §10.5)
- `ComputerUseStopHotkeyService`: `globalShortcut` registered only during a
  session, accelerator validation (≥2 modifiers), `stop_hotkey_unavailable`
  fail-closed, hotkey-chord text refusal.
- `ComputerUseSafetyService`: own-window rejection via `dipToScreenRect` for
  every visible window incl. strip/overlay, keyboard refusal while AiFetchly
  focused, strip-rectangle masking of observations.
- `ComputerUseElevationService`: integrity queries, fail-closed on unknown,
  `host_elevated` session refusal.
- `ComputerUseMeasurementService`: stop-ack / last-input / latency timestamps
  per §10.5.5.

### Stage E — Grounding worker and adapters (design §5)
- `src/childprocess/computer-use/grounding/`: versioned adapter contract
  (capabilities/load/ground/cancel/unload), compile-time
  `GroundingAdapterRegistry`, conformance test adapter, `GuiActorOnnxAdapter`
  (graph I/O through the pinned manifest contract; typed
  `runtime_not_supported` when the downloaded runtime is absent).
- `GuiActorPreprocessor`: exact `smart_resize` (multiple-of-28, independent
  axes, pixel budget), transform record; `GuiActorPostprocessor`: candidate
  ranking, ambiguity ratio and absence threshold calibration (§5.7).
- `GroundingWorker.ts` + `OnnxRuntimeLoader.ts` (scoped `createRequire`,
  manifest version check) + `GroundingRuntimeProbeWorker.ts`.
- Host-side `ComputerUseGroundingClient` with version leases; stale-generation
  discard; kill-on-stop.

### Stage F — Local AI runtime catalog v2 (design §7.3–7.8)
- v2 catalog schema with `packageKind` union, unknown-ID/package-kind skipping,
  per-ID rule table, prefix-driven `expectedArchiveFileName`.
- Model file-set types, manifest schema, licence fields.
- `LocalAiRuntimeFileSetDownloadService`: disk preflight, manifest-first,
  hash-keyed `.part` resume (206/200, Content-Range validation), 60 s idle
  timeout, single retry on hash mismatch, aggregated throttled progress.
- Reference-counted version leases, `prepareInstallSet`/`installSet` (one
  consent for runtime+model), deferred activation during sessions, pruning,
  `listStatuses(group)`.
- Tests extend the existing `LocalAiRuntime*` suites.

### Stage G — W-1 Excel logic (design §6.3)
- `excel/ExcelLeadListPlanner`: column mapping (ask on ambiguity), TSV build
  with formula-injection apostrophe prefix, Text-format column detection,
  whitespace-normalizing read-back diff with row/column reporting.
- `ComputerUseClipboardService`: save/write/restore clipboard text around
  paste (restore on success, failure, and stop).

### Stage H — IPC, module, UI, i18n
- `computer-use-ipc.ts` via `registerAiValidatedHandler` with the
  `USER_AI_ENABLED` gate first (mandatory rule); channels in `channellist.ts`
  **and** `src/preload.ts` invoke whitelist.
- `ComputerUseModule` persistence of session/action summaries (entity +
  `dbEntities.ts` registration).
- `ComputerUseControlStrip` always-on-top non-focusable strip + target overlay.
- Settings panel (`views/components/computerUse/`), "Computer Use" group in
  `LocalAiComponentsPanel`, install-set consent dialog, `views/api/`.
- All six locales; component tests (`yarn test:components`).

### Stage I — Build config and gates
- `forge.config.js` / vite entries for the new childprocess workers.
- `yarn tsc` (one-shot), `yarn testmain`, `yarn test:components` green.

## Explicitly deferred (external prerequisites)
- Windows-MCP managed uv provisioning (needs Hub install plan + plugin package).
- Real GUI-Actor weights, export parity, DirectML measurements (plugin repo).
- macOS helper, CoreML package (Phase 3). Native Excel benchmark runs.
- E2E specs requiring a real desktop session; benchmark arms (§14.5).

## Delivered vs plan (review D2-A, 2026-10-12)

Recorded as intentionally dropped — each with its reason; re-plan deliberately:

- `GroundingRuntimeProbeWorker` + `DisposableGroundingRuntimeProbe` (Stage E/F):
  dropped — real probes need the plugin's health fixtures; install-path health
  for models stays hash-verified until then.
- `LocalAiRuntimeCatalogService` v2 fetch/cache methods (Stage F): dropped —
  v2 parsing + cache paths shipped in schemas/PathService; the service-level
  v2 fetch accessor is injected (`getCatalogV2`) and lands with the release
  workflow's dual-catalog output.
- `LocalAiRuntimeResolver` model-kind support (Stage F): dropped — model roots
  resolve through install-set paths; resolver branching lands with real model
  packages.
- `ComputerUseModule` persistence entity + `dbEntities` registration
  (Stage H): dropped — no session history exists without a backend; audit
  persistence follows the first real sessions.
- Control-strip window, settings panel, consent dialog, `views/api` client,
  component tests (Stage H): dropped — UI is unreachable without the plugin
  backend; building it now would ship dead surface (review D1 chose a
  fail-closed registration instead).
- `vite.groundingWorker.config.mjs` packaged-entry verification
  (`verify-packaged-childprocess`): follow-up — needs a packaging run.

IPC registration: wired fail-closed in `src/main-process/communication/index.ts`
(review D1-A) — settings/status/readiness live; sessions return
`backend_unavailable`.
