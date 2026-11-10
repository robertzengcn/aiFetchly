# WS-4 R4.6 — Worker Message Contract Migration

**Goal (PRD R4.6):** collapse the fragmented worker-message interfaces
(`src/modules/interface/{IPCMessage,IPCMessageProtocol,BackgroundProcessMessages}.ts`)
into one Zod source per worker under `src/schemas/worker/`, standardize on a
single `type` discriminator + a single transport, and validate every worker
inbound message through `safeParse` (drop malformed, never crash).

The PRD explicitly allows this to land **incrementally** — "new workers use the
new contract; a migration tracker retires old ones." This file is that tracker.

## Canonical convention (the target)

- Each worker owns TWO Zod schemas in `src/schemas/worker/<name>.ts`:
  - **inbound** (main → worker) and **outbound** (worker → main)
  - both `z.discriminatedUnion("type", [...])` — the `type` field is the sole
    discriminator; TS narrows automatically inside `switch (msg.type)`.
  - types derived via `z.infer<typeof schema>` (no hand-written interfaces).
- The receiving boundary validates with `parseWorkerMessage(raw, schema)`
  from `src/schemas/worker/_shared.ts` (centralized safeParse-and-drop).
- Transport target: **`utilityProcess.fork` + `parentPort`** (Electron-native,
  typed MessagePort). `process.send` workers migrate off it.

## Exemplars (done)

| Worker | Schemas | Transport | Status |
|---|---|---|---|
| contact-extraction | `schemas/worker/contactExtraction.ts` | `process.send` | ✅ |
| local-embedding | `schemas/worker/localEmbedding.ts` | `parentPort` | ✅ |
| skill-worker | `schemas/worker/skillWorker.ts` | `parentPort` | ✅ |
| python-runtime | `schemas/worker/pythonRuntime.ts` | `parentPort` | ✅ |
| google-proxy-check | `schemas/worker/googleProxyCheck.ts` | `parentPort` | ✅ |
| website-content-scraper | `schemas/worker/websiteContentScraper.ts` | `parentPort` | ✅ |
| google-maps | `schemas/worker/googleMaps.ts` | `process.send` | ✅ |
| yandex-maps | `schemas/worker/yandexMaps.ts` | `process.send` | ✅ |
| hook-execution | `workerProtocol.ts` (local) | `process.send` | ✅ (already safeParse) |

## Migration queue (~11 workers)

Each row: add `schemas/worker/<name>.ts` inbound+outbound Zod → validate at both
endpoints via `parseWorkerMessage` → delete the hand-written interface once no
importer remains → (where applicable) switch `process.send` → `parentPort`.

### `process.send` transport (migrate to parentPort + Zod)
- `childprocess/hook-execution/HookExecutionWorker.ts`
- `childprocess/YellowPagesScraperProcess.ts`
- `childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts`
- `childprocess/yandex-maps/YandexMapsWorker.ts`
- `childprocess/google-maps/GoogleMapsWorker.ts`
- (`contact-extraction` already on Zod; transport switch is optional follow-up)

### `parentPort` transport (already on the target transport — add Zod only)
- ✅ `childprocess/SkillWorker.ts` (migrated: `schemas/worker/skillWorker.ts`)
- `childprocess/embedding/LocalEmbeddingWorker.ts` (schema exists)
- ✅ `childprocess/PythonRuntimeWorker.ts` (migrated: `schemas/worker/pythonRuntime.ts`)
- `childprocess/googleProxyCheck.ts`
- `childprocess/websiteContentScraper.ts`
- `childprocess/scrapeManager.ts`
- `childprocess/YellowPagesScraper.ts` (uses `BackgroundProcessMessages.ts` — the
  largest interface, ~18 message types; model in `schemas/worker/yellowPages.ts`)

## Interface files to delete (once their owning workers migrate)

- `src/modules/interface/IPCMessage.ts`
- `src/modules/interface/IPCMessageProtocol.ts`
- `src/modules/interface/BackgroundProcessMessages.ts` (consumed by
  `YellowPagesScraper` + orchestrator — delete only after the YellowPages
  Zod schema lands + importers move).

## Acceptance criteria (from PRD)

- [x] Shared safeParse helper exists (`schemas/worker/_shared.ts`, tested).
- [x] Migration tracker exists (this file).
- [ ] Every worker inbound passes through `safeParse` (contact-extraction +
      embedding done; ~11 to migrate).
- [ ] `grep -r "process.send" src/childprocess` shows a single documented
      transport (or this migration plan — accepted interim state).
