# Computer Use Plugin Repository — Technical Design

## Document information

| Field | Value |
| --- | --- |
| Version | 1.5 |
| Status | Proposed; repository-scoped design. No implementation is claimed |
| Date | 2026-09-27 |
| Implementation owner | `aifetchly-computer-use` |
| Primary language | TypeScript for developer/CI tools; Python and Swift for the scoped components in §1.2 |
| Companion document | [Product requirements](computer-use-plugin-prd.md) |
| Distribution dependency | `aifetchly-hub-go`; separate Hub work, not owned by either implementation repository |

### Document set and revision

| Repository | Product requirements | Technical design |
| --- | --- | --- |
| `aiFetchly` | [AiFetchly PRD](computer-use-aifetchly-prd.md) | [AiFetchly technical design](computer-use-aifetchly-technical-design.md) |
| `aifetchly-computer-use` | [Plugin PRD](computer-use-plugin-prd.md) | [Plugin technical design](computer-use-plugin-technical-design.md) |

Version 1.4 splits the version 1.3 combined documents by repository responsibility. Existing product decisions, W-1, model selection, delivery channels, and release gates remain in force. The plugin repository is proposed; these documents do not create it. The plugin pair can be copied into its `docs/prd/` when it is initialized; sibling links here describe the current review set and must be replaced by pinned cross-repository links on transfer.

Revision 1.5 specifies the language/toolchain policy, module boundaries, developer commands, backend lifecycle, schema evolution, fixture/report formats, build outputs, CI matrix, and implementation work packages. All new paths, command names and interfaces are proposed contracts for repository implementation; this documentation update does not create executable tooling.

## 1. Architecture and ownership

This repository builds artifacts consumed by the host; it does not own a running agent. AiFetchly owns the planner loop, sessions, grants, desktop lease, stop, coordinate transforms, image routing, persistence, runtime installation, and UI. Backend tools are private atomic primitives, invoked only by its supervisor.

There are three independent interfaces: the host planner provider chooses steps; a host-owned grounding-model adapter produces candidate locations; the desktop backend observes the OS and executes authorized input. The plugin owns schemas and test fixtures for their integration, backend source/packaging, and model reference/export pipelines. Schemas and fixtures are shared, not executable host code.

The initial inference runtime stays ONNX Runtime. GUI-Actor-2B is the default; new architectures/configurations need host adapter support and independent qualification. Remote grounding, Ghost's own vision sidecar, recipes, and learning remain outside the product scope. Only installed compatible models are selected between host sessions.

### 1.1 Independent development contract

Pin a released schema/fixture artifact and develop against synthetic backend clients, saved captures, and golden tensors. Standalone tests may invoke native primitives only against controlled test applications; this does not provide a production route around host supervision. End-to-end W-1 and packaged-app permission/stop acceptance require the matching AiFetchly build.

The host and Hub consume artifacts by immutable version and digest, not a checkout of a moving branch. A breaking schema change requires a new contract version and coordinated host support; additive optional fields need tolerant-reader and negative-fixture tests before declaring compatibility. Each release records supported app versions and schema/adapter identities. Do not infer compatibility solely from a plugin version number.

### 1.2 Language and toolchain policy

Use a **TypeScript-led repository with Python and Swift components**. TypeScript owns cross-platform developer tools; production desktop execution stays in the language of the selected native backend. There is no extra Node process between AiFetchly and either backend.

| Area | Selected language/tooling | Version/lock policy | Customer distribution |
| --- | --- | --- | --- |
| `tooling/`, `eval/`, `packaging/` orchestration and fixture/MCP tests | TypeScript, Node.js, npm; TypeScript compiler, ESLint, Vitest | Pin a supported Node LTS patch in `.node-version`, exact npm in `packageManager`, and tested TypeScript/tool versions in `package-lock.json`; CI uses `npm ci` | None of the development CLI or `node_modules` is added to backend packages |
| `contracts/` | JSON Schema 2020-12 and JSON fixtures; Ajv's matching dialect validator in TypeScript tooling | Pin validator/generator versions; prohibit remote schema resolution in builds/tests | Data/schema artifact only; generated declarations are types, not executable host code |
| Windows backend integration | Python with Windows-MCP's pinned dependencies; uv, pytest, Ruff | Its own `pyproject.toml`, `uv.lock`, `.python-version`, upstream source/patch lock | Managed Windows environment or qualified prebuilt Python bundle |
| Model engineering | Python, pinned reference stack, ONNX/export tooling; uv, pytest | A separate `grounding/pyproject.toml`, `uv.lock`, `.python-version`; choose the exact interpreter from export/wheel compatibility in the spike | ONNX graphs, external data, tokenizer/configuration and notices only |
| macOS helper | Swift and Swift Package Manager; native framework APIs | Exact Swift/Xcode build identity and `Package.resolved`; upstream/fork/patch pin in `upstream.lock` | Signed native `ghost` or in-house helper executable |
| OS-specific packaging | Small PowerShell/shell wrappers | Versioned scripts and pinned tool identities recorded in provenance | No install script requiring customer compilers or global configuration |

These are repository choices, not claims about the latest available compiler. The Windows-MCP `main` project inspected on 2026-09-27 declares Python `>=3.14`; choose an exact tested interpreter for the selected immutable revision. Do not retain the earlier generic Python 3.13 assumption. Ghost's inspected `Package.swift` declares Swift tools 6.2 and macOS 14. An upstream revision/toolchain change triggers its corresponding native qualification; fetching `main` at build time is forbidden. Sources: [Windows Python declaration](https://github.com/CursorTouch/Windows-MCP/blob/main/pyproject.toml), [Ghost Swift declaration](https://github.com/ghostwright/ghost-os/blob/main/Package.swift).

Use one root TypeScript package initially; separate npm workspaces are unnecessary until independent executable packages exist. Set `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`; use explicit function return types, `unknown` at external boundaries, and no `any`. Node tooling uses ESM with `NodeNext` resolution and explicit emitted `.js` import paths. Build tooling with `tsc`; do not require a custom TypeScript loader in customer processes. Python boundaries use type annotations and schema tests; Swift preserves the selected upstream concurrency model and keeps logs off MCP stdout.

Keep development prerequisites incremental: Node is sufficient for contract/unit work; Windows backend work additionally needs its managed development Python environment; model engineering needs its separate Python environment and approved weights; Swift/native Mac work needs a Mac and the pinned toolchain. Linux can run portable checks but is not a supported desktop-control target.

### 1.3 Process and data boundaries

| Mode | Processes and transport | Data authority |
| --- | --- | --- |
| Production Windows | AiFetchly → private persistent stdio MCP → pinned Python backend | Host owns sessions/grants; backend only observes and executes validated atomic requests |
| Production macOS | AiFetchly → private persistent stdio MCP → signed Swift helper | Same host boundary; no Python/MLX sidecar or Node gateway |
| Production grounding | AiFetchly → app-owned utility worker → selected built-in ONNX adapter | Worker and model selection are host code; this repository supplies schemas/models/fixtures |
| Offline model evaluation | TypeScript CLI → explicit Python reference/ONNX runner → structured report/files | No desktop backend loaded; fixtures are local and no screenshot network routing exists |
| Native test harness | TypeScript test client → pinned backend → controlled test window | Developer opts into input; no production planner or reusable authorization grant is supplied |

Developer subprocess runners pass argv arrays with `shell: false`, explicit working directories, bounded logs, deadlines and cancellation. JSON control records use stdout; logs go to stderr; large tensor/image results are written under an explicit output directory with paths/hashes in the report. Native test entry points are separate from the default test/replay command and never start through an import side effect.

## 2. Repository layout

```text
aifetchly-computer-use/
├── package.json                   # One private TypeScript developer-tools package
├── package-lock.json
├── .node-version
├── tsconfig.json                  # Strict NodeNext; source build excludes native/model dependencies
├── tooling/
│   ├── cli.ts                     # Shared command parsing, exit/result conventions
│   ├── contracts/                 # Offline schema validation, type generation, fixture checks
│   ├── processes/                 # Bounded child-process execution for developer tasks
│   └── release/                   # Hashing, compatibility, artifact and evidence verification
├── plugin/                        # Manifest, skills, tool descriptions
├── contracts/                     # Versioned JSON Schemas + fixtures shared with the host
│   ├── tools/
│   ├── desktop/                  # Backend capabilities, observations, atomic input, errors
│   ├── grounding/                # Model capabilities, lifecycle, requests/results, compatibility
│   ├── models/                   # Model file-set manifests and compatibility fixtures
│   ├── traces/
│   └── fixtures/transforms/       # Golden geometry cases consumed by host tests
├── adapters/
│   ├── windows/
│   │   ├── pyproject.toml         # Backend integration package and dev dependencies
│   │   ├── uv.lock                # Independent of the model engineering environment
│   │   ├── .python-version
│   │   ├── upstream.lock          # Commit/artifact, patch digest, interpreter and dependency pins
│   │   ├── tool-allowlist.json
│   │   ├── launch-profile.json
│   │   ├── patches/               # Only if the spike selects a fork/patch integration
│   │   └── src/aifetchly_windows/ # Python entrypoint/extensions, metadata and normalization
│   └── macos/                     # Backend chosen by spike; Ghost candidate layout below
│       └── ghost-os/
│           ├── upstream.lock      # Exact source commit, dependency pins, toolchain identity
│           ├── patches/           # Reproducible AiFetchly patch set (or lock to a maintained fork)
│           └── tool-allowlist.json # Reviewed backend surface; host also enforces it
├── grounding/
│   ├── pyproject.toml             # Model engineering package; never shipped as a runtime
│   ├── uv.lock
│   ├── .python-version
│   ├── models.lock.json           # Approved model revisions, licences and source hashes
│   ├── configs/                   # Versioned quantization, pixel-budget and tolerance profiles
│   ├── src/aifetchly_grounding/
│   │   ├── reference/             # Upstream reference inference wrapper
│   │   ├── export/                # Graph export, quantization and external-data sharding
│   │   └── parity/                # Tensor comparison and region-hit verification
│   └── fixtures/                  # Per-model preprocessing, output, absence/ambiguity cases
├── eval/
│   ├── cli.ts                     # Offline evaluate/replay/compare; no desktop executor import
│   ├── datasets/                  # Versioned dataset manifests and split assignments
│   ├── metrics/                   # Region hits, absence errors, latency and report aggregation
│   └── reports/                   # JSON/HTML report renderers, not generated customer traces
├── packaging/
│   ├── windows/
│   └── macos/                     # Build, sign, notarize, archive, checksums, Hub metadata
├── test/
│   ├── contracts/                # Positive/negative multi-language serialization fixtures
│   ├── tooling/                  # Vitest tests, fake MCP servers, fake model subprocesses
│   ├── windows/                  # Python unit tests and explicit native harness cases
│   ├── macos/                    # Integration fixtures; Swift unit tests stay in package Tests/
│   ├── grounding/                # Python export/parity tests and small synthetic graphs
│   └── fixtures/                 # Synthetic windows, workbooks, images and expected output
├── .github/workflows/             # Portable, Windows, Mac, model and release jobs
└── THIRD_PARTY_NOTICES            # Code and model licences, including base-model chains
```

For grounding, PyTorch and Python are used only in CI and on developer machines to export and verify models; customer machines receive ONNX files. The separate Windows-MCP backend still uses managed Python. Do not commit weights, Python distributions, virtualenvs, caches, credentials, or customer traces.

The host and this repository share **schemas and fixtures, not code**. The host consumer generates TypeScript types from or validates them against these JSON Schemas, and host transform tests consume `contracts/fixtures/transforms`.

Executable grounding adapters, including model-specific preprocessing and output decoding, ship in the AiFetchly worker. They are not dynamically imported from this repository or a downloaded model package. Moving them into a shared executable package would require a separate revision of this boundary. The Ghost source/fork is different: it is compiled into the separately versioned native desktop helper and delivered through the Hub.

### 2.1 Module responsibilities

| Module | Input | Output | Boundary |
| --- | --- | --- | --- |
| Contract validator/type generator | Local `$id`/`$ref` schema registry and fixture manifest | Validation results and generated `.d.ts` declarations | No network fetching, backend start, or handwritten duplicate interface source |
| Windows integration package | Pinned upstream API plus validated MCP request | Normalized state/geometry, integrity/ownership data or atomic action result | Runs in the backend process; not a second MCP proxy |
| Swift helper/fork | Validated scoped request and macOS APIs | Same backend semantics with explicit logical-point/capture mapping | No model runtime, recipe store or host database |
| Reference/export package | Approved model revision and configuration | Reference tensors, ONNX graphs/data, manifest inputs | No OS input API, AiFetchly import or runtime installation |
| Parity runner | Reference and exported outputs plus tolerance profile | Per-stage/case pass/fail and divergence details | A failed stage prevents model qualification |
| Evaluation CLI | Dataset/configuration IDs and runner profile | Case records, aggregate JSON report, optional local HTML | Exact replay and comparison are distinct modes; neither can execute a recorded click |
| Release verifier/packager | Built artifacts, pins and reports | Checksummed closure and compatibility manifest | Does not build missing models or silently fetch floating dependencies |

Generated build output goes to ignored `dist/`; candidate artifacts and reports go to ignored `out/<run-id>/`; downloaded weights and pinned source checkouts use explicitly configured cache directories. Tests use temporary directories. No command writes into a user's AiFetchly runtime installation or includes cache paths/credentials in published manifests.

### 2.2 Developer command contract

The following scripts must be implemented in `package.json`; names below are proposed developer interfaces. Run them from the repository root after installing the exact Node/npm toolchain. `npm ci` installs only the TypeScript developer dependencies and never downloads models or provisions native backends.

| Command | Work performed | Required environment / result |
| --- | --- | --- |
| `npm run check` | Schema/fixture validation, generated-type check, lint, TypeScript check, portable unit tests | Node only; no desktop access or weights |
| `npm run build` | Compile TypeScript tooling and evaluation CLI | Produces `dist/tooling/` and `dist/eval/`; does not package native artifacts |
| `npm run contracts:check` | Validate canonical schemas and all valid/invalid fixtures; detect generated declaration drift | Node only; deterministic diagnostics naming schema and fixture |
| `npm run contracts:build` | Assemble schema/fixture/type-declaration archive and digest | Prior checks pass; writes a candidate to `out/` |
| `npm run backend:prepare -- --target win32-x64` | Verify source/patch pins and synchronize the Windows development environment from its lock | Windows plus pinned uv/Python; does not launch MCP or send input |
| `npm run backend:test -- --target win32-x64 --suite unit` | Run Python unit/serialization tests | Windows development environment; no native input |
| `npm run backend:test -- --target darwin-arm64 --suite unit` | Build/test the selected Swift package at its pin | macOS and pinned Swift toolchain; no automatic permission setup |
| `npm run backend:test -- --target <target> --suite native --allow-input` | Run bounded native tests against the configured controlled test window | Interactive OS session and explicit input opt-in; errors if unavailable |
| `npm run model:prepare -- --config <id>` | Synchronize model engineering environment and fetch the approved model revision to the configured cache | Explicit download/size notice; respects existing licensed source access |
| `npm run model:export -- --config <id>` | Invoke Python export/sharding for cached pinned weights | Fails if prerequisites/weights are absent; emits candidate files, not a qualified release |
| `npm run model:parity -- --config <id> --dataset <id>` | Compare reference/export stages with the frozen tolerance profile | Structured report with sample counts and provider identity |
| `npm run eval -- replay --bundle <path> --runner <profile>` | Re-evaluate saved evidence with an exact compatible configuration | No backend or input; records runner identity and hashes |
| `npm run eval -- compare --dataset <id> --configs <id-a,id-b>` | Compare configurations on identical evidence | Reports geometry/error/latency differences, not comparable raw confidence |
| `npm run package:build -- --target <target>` | Assemble already built/verified target artifacts and notices | No dependency resolution or implicit native/model build |
| `npm run release:verify -- --manifest <path>` | Validate closure, hashes, schema/target compatibility and required evidence | Nonzero status for missing or skipped required evidence; never publishes |

Python runners use the correct project explicitly, for example `uv run --locked --project grounding python -m aifetchly_grounding.parity ...`; the tool pins uv and supplies structured argv. Do not activate a global environment or reuse the Windows lock for export. Command implementations may wrap these operations, but report which project, interpreter, config, runner and output directory were selected.

CLI exit codes are `0` for completed checks, `1` for test/evaluation/gate failure, `2` for invalid arguments/schema, `3` for missing prerequisites or incompatible configuration, and `4` for cancelled work. In JSON mode, stdout is one structured result and diagnostics go to stderr. A required skipped test uses a nonzero result at the gate even if optional cases were skipped successfully. Help text clearly distinguishes offline commands from `--allow-input` native tests.

## 3. Shared contracts

`contracts/` is the authoritative producer of JSON Schemas and conformance fixtures. Public tools describe the host's model-visible surface; they are not extra Ghost/Windows backend tools or a gateway implemented here. The host validates untrusted data and implements authority-bearing behavior. Generated types use explicit types and no `any`.

### 3.1 Public tools

| Tool | Inputs | Result / semantics |
| --- | --- | --- |
| `computer_capabilities` | None or target query | Backend and protocol versions, supported actions, permissions, grounder state and provider, planner mode, display support |
| `computer_start_session` | User-selected target reference, purpose | Session ID and scoped capabilities; the host takes the lease first |
| `computer_observe` | Session ID, region/mode | Observation ID and structured state. In visual planner mode the host attaches a transient image artifact |
| `computer_find` | Session ID, observation ID, target description | Opaque target handle, or `target_not_found` / `target_ambiguous`, with grounding source |
| `computer_act` | Session ID, target handle, typed action, action ID | Dispatched / failed / uncertain, with a post-observation reference |
| `computer_verify` | Session ID, expected state, observation ID | Satisfied / unsatisfied / unknown with evidence |
| `computer_request_handoff` | Session ID, reason | Revokes automatic input until trusted resume |
| `computer_resume_after_handoff` | Session ID | Host-approved resume with a fresh observation |
| `computer_stop_session` | Session ID | Idempotent cancellation and release |

The model-facing act schema accepts target handles, not raw desktop coordinates. Raw coordinates exist only inside the supervisor and a guarded developer calibration path. Keyboard actions without a visual target still require a current session, target window focus, and authorization.

### 3.2 Core records

```typescript
type GroundingSource = 'accessibility' | 'vision';
type PlannerMode = 'local_only' | 'visual_planner';
type VerificationState = 'satisfied' | 'unsatisfied' | 'unknown';
type ExecutorUnits = 'desktop_physical_pixels' | 'desktop_logical_points';
type ExecutionProviderId = 'dml' | 'coreml' | 'cpu';

interface Point2D {
  readonly x: number;
  readonly y: number;
}

interface GroundingMetadata {
  readonly modelConfigurationId: string;
  readonly modelRuntimeVersion: string;
  readonly modelManifestSha256: string;
  readonly groundingContractVersion: number;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly preprocessingRevision: string;
  readonly decodingRevision: string;
  readonly calibrationRevision: string;
  readonly executionProvider: ExecutionProviderId;
  readonly onnxRuntimeVersion: string;
  readonly attentionGrid?: { readonly width: number; readonly height: number };
  readonly inferenceMs: number;
}

interface ObservationMetadata {
  readonly id: string;
  readonly sessionId: string;
  readonly sessionGeneration: number;
  readonly capturedAt: string;
  readonly targetWindowId: string;
  readonly displayConfigurationVersion: string;
  readonly executorUnits: ExecutorUnits;
  readonly captureWidthPx: number;
  readonly captureHeightPx: number;
  readonly plannerMode: PlannerMode;
  readonly plannerImageAttached: boolean;
  readonly imageSha256: string;
}

interface ResolvedTarget {
  readonly handle: string;
  readonly observationId: string;
  readonly source: GroundingSource;
  readonly expiresAt: string;
  readonly evidenceSummary: string;
}

interface ActionOutcome {
  readonly actionId: string;
  readonly state: 'not_dispatched' | 'dispatched' | 'failed' | 'uncertain';
  readonly verification: VerificationState;
  readonly postObservationId?: string;
  readonly errorCode?: string;
}
```

Coordinates, native identifiers, transforms, grounding metadata, generation, and expiry live in the supervisor's bounded target store. Grants and raw image bytes are never model-supplied fields or part of ordinary tool results.

### 3.3 Errors

Stable codes: `ai_disabled`, `permission_required`, `desktop_busy`, `unsupported_target`, `unsupported_display_configuration`, `runtime_not_ready`, `model_not_ready`, `target_not_found`, `target_ambiguous`, `invalid_grounding_output`, `stale_observation`, `focus_changed`, `action_not_authorized`, `action_cancelled`, `execution_uncertain`, `verification_failed`, `backend_unavailable`, `resource_limit`, `protocol_mismatch`, `planner_mode_unavailable`, `stop_hotkey_unavailable` (the global stop hotkey could not be registered, so the session does not start), `host_elevated` (AiFetchly itself is running elevated, so sessions are refused).

`unsupported_target` carries a reason: `elevated_window`, `own_window`, `protected_view`, `unsupported_app`, or `unsupported_display`. `model_not_ready` carries the `GroundingReadiness` value ([AiFetchly design 7.8](computer-use-aifetchly-technical-design.md#78-install-activation-leases-updates-and-removal)).

Each error has a safe message, stage, retry classification, and correlation ID. No tracebacks, secrets, image bytes, absolute paths, or argv in renderer results.

### 3.4 Grounding contract

Own and publish the schema and capability fixtures here. The executable registry, `GroundingModelAdapter`, and selection service are implemented in AiFetchly; source locations below identify the consumer, not files to add in this repository.

#### 3.4.1 Responsibilities and lifecycle

| Interface | Responsibility | Implementation location |
| --- | --- | --- |
| Planner provider | Choose steps and interpret observations; optional transient screenshot understanding | Existing host planner/provider routing |
| `GroundingModelAdapter` | Describe capabilities, load a model, preprocess an image, infer and decode candidate locations, cancel, unload | Host `src/childprocess/computer-use/grounding/` |
| Desktop adapter | Accessibility, window capture/geometry, and supervised atomic input | Windows-MCP or the chosen Mac helper, through host MCP wrappers |

The plugin repository publishes versioned JSON Schemas and conformance fixtures under `contracts/grounding/`. The worker implements these lifecycle operations:

| Operation | Input | Output / guarantee |
| --- | --- | --- |
| `capabilities` | Built-in adapter ID | Contract version, adapter/version, accepted model architecture and manifest versions, ONNX Runtime/provider support, image formats and pixel limits, crop support, point/region/heatmap output support, absence-policy support, cooperative-cancel support |
| `load` | Validated model/runtime roots and immutable identity, provider preference, session generation | Loaded identity and effective capabilities, selected provider, load timing and memory estimate; rejects incompatible packages before inference |
| `ground` | Request defined below | Candidate result or typed failure, never an input action or target handle |
| `cancel` | Request ID and session generation | Marks work cancelled and suppresses its result; attempts cooperative cancellation; the supervisor enforces a deadline and kills the worker if needed |
| `unload` | Loaded configuration identity | Releases model sessions and buffers; host releases version leases after unload/exit is confirmed |

The registry is a compile-time map from approved adapter IDs to implementations. A catalog can name a supported adapter, but cannot supply module paths, JavaScript, commands, or an entry point. `GuiActorOnnxAdapter` wraps the pipeline in [plugin design 6.2](computer-use-plugin-technical-design.md#62-reference-inference-path)–[AiFetchly design 5.8](computer-use-aifetchly-technical-design.md#58-precision). The model adapter never calls desktop tools, sends network requests, accesses the database, converts coordinates to desktop units, or authorizes input.

#### 3.4.2 Requests, results, and model-specific behavior

| Contract field | Semantics |
| --- | --- |
| Request envelope | `contractVersion`, `requestId`, `sessionGeneration`, `observationId`, and the loaded configuration identity |
| Request image | Private image reference/bytes using [AiFetchly design 5.6](computer-use-aifetchly-technical-design.md#56-grounding-worker) transport, format, original capture width/height; optional crop in capture pixels with an explicit origin and bounds |
| Request task | Target description and bounded inference/pixel-budget options supported by that adapter |
| Result envelope | Echoes request/generation/observation IDs and loaded identity; host compares all of them before accepting candidates |
| Candidate geometry | Finite point and/or region coordinates in explicitly declared `capture_pixels` or `model_input_pixels`; never desktop coordinates. Bounds must match the declared image dimensions |
| Preprocessing evidence | Crop, resize, padding, model-input dimensions, and mapping to the original capture; host validates and applies the common transform path ([AiFetchly design 11](computer-use-aifetchly-technical-design.md#11-coordinate-system)) |
| Candidate interpretation | Adapter-specific ranking scores with named score semantics and versioned decoding/calibration policy; no assumed cross-model confidence scale |
| Diagnostics | Stage timings, runtime version and execution provider, optional attention grid/heatmap according to declared capabilities; no image bytes in ordinary tool JSON |
| Failure | Common typed codes: `target_not_found`, `target_ambiguous`, `invalid_grounding_output`, `action_cancelled`, `resource_limit`, `backend_unavailable`, `model_not_ready`, or `protocol_mismatch`, with stage and correlation metadata ([plugin design 3.3](computer-use-plugin-technical-design.md#33-errors)) |

The immutable configuration identity includes adapter ID/version, contract version, model runtime ID/version and manifest hash, preprocessing revision, decoding revision, and calibration revision. Runtime version and actual execution provider are bound at load time. Image byte limits, dimensions, finite values, candidate counts, transform validity, and capability support are checked at the worker boundary and again before the host creates a target handle. Missing/invalid transforms or unsupported outputs fail closed.

Each architecture needs its own preprocessing and output decoding; ONNX compatibility alone does not make weights interchangeable. GUI-Actor uses the attention policy in [AiFetchly design 5.7](computer-use-aifetchly-technical-design.md#57-candidates-ambiguity-and-absence). Other models must implement and qualify their own absence/ambiguity policy; a generated confidence value is not automatically a probability. Do not reuse thresholds across architectures or quantizations without evaluation. Unsupported heatmaps are omitted, never fabricated. Adapters without a qualified absence policy cannot be selected for autonomous input.

### 3.5 Coordinate fixtures

Publish explicit coordinate-space, crop, resize, padding, display-origin, and executor-unit schema fields. Desktop observations identify the captured window/process, foreground owner, frame, capture pixel dimensions, scaling/downsampling and monotonic timestamp. An ambiguous or unavailable field is a typed failure, never an assumed global scale.

`contracts/fixtures/transforms/` contains input geometry, expected capture-to-desktop mapping, inverse/round-trip tolerance, and invalid/stale cases for Windows DPI, Retina points, anisotropic model resize, negative origins, moved windows, crops, and padding. The host owns the executable [transform implementation](computer-use-aifetchly-technical-design.md#11-coordinate-system). The plugin test harness and host consumer tests must agree on the same fixture release; multi-display cases do not imply current product support.

### 3.6 Trace bundle

```text
trace-<id>/
├── manifest.json                 # Schema, versions, target, planner mode, consent
├── events.jsonl                  # Stage transitions, timings, safe errors
├── steps/<step-id>/
│   ├── observation.json          # Geometry, transforms, planner image flag
│   ├── original.png              # Opt-in original capture
│   ├── model-input.png           # Exact resized/cropped model input
│   ├── attention.json            # Optional: adapter-provided patch-grid activations
│   ├── grounding.json            # Adapter/model/calibration identity, candidates, score semantics, timings
│   ├── action.json               # Intended input, transformed target, outcome
│   ├── after.png                 # Opt-in post-action capture
│   └── verification.json         # Expected state and evidence
└── annotations.json              # Human labels, clickable regions, absent flags
```

Also record ONNX Runtime version, execution provider, model manifest hash, complete configuration identity ([plugin design 3.4](computer-use-plugin-technical-design.md#34-grounding-contract)), Python/Windows-MCP or Mac helper source/build identity, OS/display/DPI metadata, dispatch timestamp, and foreground window. Typed content is redacted by default. Replay requires a compatible installed adapter and matching model/processing revisions; unavailable versions fail explicitly without substituting the currently selected model. Comparing another model is a separately labelled comparison run.

### 3.7 Schema authority and compatibility tests

JSON Schema is authoritative. Give each versioned schema a stable `$id`; resolve its references through a packaged local registry. Generated TypeScript declarations support tooling/host typechecks; Python and Swift encoders are validated by running serialized examples through the same canonical fixtures. Native decoders also reject unsupported required fields/capabilities before input. TypeScript interfaces shown in this design illustrate the records and must be generated or checked against the schema when implemented.

Declare required fields, finite numeric bounds, enum values, discriminated result/error shapes, candidate/element counts, image/message byte limits, and units. Transport limits are versioned deployment constants, negotiated or matched to the host; Phase 0 records their concrete ceilings and oversized-message behavior. Reject duplicate identities, invalid relative artifact paths and missing coordinate metadata. Unknown fields follow an explicit policy per schema: strict authority/action records reject them; designated diagnostic-extension objects permit only bounded inert data. An optional field is not backward compatible when an existing strict reader rejects it.

Compatibility tests pair the candidate schema with the supported previous host decoder/fixtures, not just the candidate validator. A breaking shape, unit meaning, action behavior, or newly required capability needs a new contract version and host consumer support. Protocol/MCP version, backend semantic contract, grounding contract, model manifest, and trace schema versions are separate identities. Do not use a plugin release number as their substitute.

### 3.8 Backend lifecycle and action outcomes

The conformance harness implements these states for each private MCP backend: `STOPPED → STARTING → INITIALIZED → READY → BUSY → READY → STOPPING → STOPPED`; protocol/permission/exit failures become `UNAVAILABLE`. Only the host decides whether a READY backend may act. A lifecycle state in a backend response is not an action grant.

| Stage | Backend/harness obligation |
| --- | --- |
| Startup | Verify pinned launch profile, start with explicit argv/cwd/env, and keep stdout protocol-only; do not download, resolve dependencies, prompt for credentials, or start another service |
| Initialization | Complete negotiated MCP initialization, discover the reviewed tool subset, and probe version/capabilities/permissions through the agreed diagnostic/state response |
| Readiness | Report missing permission, unsupported interactive session/target, or incompatible semantics explicitly; a responsive process alone is insufficient |
| Observation | Return bounded window/process identity, geometry, capture dimensions, timestamps and AX data; no hidden focus transition or VLM fallback |
| Dispatch | Serialize input; validate the selected native target, units and action fields; perform at most the authorized atomic operation and track whether input began |
| Completion | Return dispatched/not-dispatched/uncertain evidence, affected target and timings; input delivery is not proof of application success |
| Cancellation/disconnect | Suppress queued operations, cease further input dispatch and release held keys/buttons where possible; never replay an incomplete request after reconnect |
| Shutdown | Exit within the host's bounded deadline; stop owned child work and expose enough timestamps for the independent termination harness |

The host supplies request/action correlation IDs and maintains session generation and grants. Upstream methods that cannot carry those fields are correlated in the host wrapper and test manifest; the backend does not manufacture authority. Candidate backend extensions must be declared in the compatibility manifest and have a host consumer before use. Track a per-process monotonic clock with its clock identifier; host and backend timestamps require an explicit synchronization/correlation method before comparing the no-input-after-stop gate.

For a click, the producer test proves geometry/ownership validation, native dispatch count, and outcome reporting. It does not implement planner verification. If a process exits after dispatch might have started, the host reports `execution_uncertain`; cancellation after OS input has been queued does not prove that input was undone. Test the last native dispatch independently of a cancellation response, and disqualify an implementation that cannot meet the host stop invariant.

## 4. Windows backend

- Pin a Windows-MCP revision and its licence/dependency closure. The upstream Python project inspected on 2026-09-27 requires Python 3.14+; the chosen immutable revision determines the exact qualified interpreter (§1.2). This is the only Python component shipped to customers.
- The host wrapper enforces an allowlist on both `tools/list` and `tools/call`: screenshot/state, display inventory, app/window focus, click, type, scroll, move/drag, and keys. Upstream allowlist settings are also configured. PowerShell, registry, filesystem, and process tools are unreachable.
- Adapter tools are never registered as model-visible tools. Only the supervisor calls them, after grant validation.
- Normalize the UI Automation tree and capture bounds into the observation contract.
- Elevated target windows are rejected with `unsupported_target`. UIPI blocks injection from a lower-integrity process, and `SendInput` reports neither an error nor a distinguishable return value when UIPI blocks it, so the check must happen before dispatch ([AiFetchly design 10.5.4](computer-use-aifetchly-technical-design.md#1054-elevated-windows-and-elevated-host)).
- The plugin adds one read-only tool to the allowlisted surface, `process_integrity`. Given a window handle or process ID, it returns the owning process ID and integrity level (`low`, `medium`, `high`, `system`), using `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` and `GetTokenInformation(TokenIntegrityLevel)` through `ctypes`. The same tool reports AiFetchly's own integrity level. It ships either as an extension module loaded by the plugin's launch entrypoint or as a patch in a pinned fork, decided with the Windows-MCP pin in Phase 0. The host has no FFI dependency today and does not add one for this.
- Window-at-point: the adapter returns the top-level window handle and owning process ID for a desktop point (`WindowFromPoint` → `GetAncestor(GA_ROOT)` → `GetWindowThreadProcessId`). The supervisor uses this for own-window and elevation checks.
- Disable upstream telemetry and verify the setting in the pinned version.
- Test Unicode/CJK input and non-English application names for all six locales.

### 4.1 Backend implementation and W-1 observations

Own backend pins, patches/extensions, `process_integrity`, window-at-point, schema normalization, allowlist defaults, and native test harnesses in this repository. References above to supervisor enforcement specify the consumer integration; this repository does not implement `ComputerUseSupervisor` or host FFI.

For W-1, provide bounded UI Automation grid/value observations: header row, visible/used range and row count, active cell, selection, Name Box, formula bar, sheet tabs, and relevant ribbon controls. Cap depth and element count and expose native failures explicitly. Supply fixtures for edit mode, IME candidate state, protected/read-only workbooks and observation timing. The host owns TSV, clipboard text restoration, empty-range checks, column planning and read-back comparison; Windows-MCP clipboard tools are excluded.

### 4.2 Windows implementation units

`adapters/windows/src/aifetchly_windows/` contains only extensions needed by the reviewed contract. Pin the upstream MCP server and use its supported extension points when possible; if registration or implicit behavior cannot be constrained, maintain a tested patch set. Do not start an upstream server behind another Python server.

| Unit | Responsibility | Required cases |
| --- | --- | --- |
| Entrypoint/registration | Register the reviewed upstream subset and required read-only extensions; configure stdio and disabled telemetry | Exact `tools/list` set; hidden tools cannot be called by name; stdout has no logs |
| Integrity/ownership reader | Resolve native handle/PID, target and host integrity, top-level window-at-point | Closed/reused handle, inaccessible process, low/medium/high/system, own-window owner, unknown result |
| Observation normalizer | Bound AX traversal and return window/display/capture metadata with explicit units | Large Excel tree, empty result, CJK labels, moved/occluded/minimized window, truncation reported |
| Atomic input integration | Preserve validated target and track start/completion of the upstream input operation | Focus changes, repeat request correlation, timeout before/after dispatch, typing and drag cancellation |
| Diagnostics | Report backend/source version, capability/permission state and bounded redacted failure details | No token, typed lead content or raw screenshot in ordinary logs |

Native identifiers are process-local observations, not durable element references. Before input, a stale or ambiguous native target returns a failure to the host; it must not search for another window with a matching title. The host remains responsible for action deduplication, grants and selecting the next observation.

## 5. macOS backend

| Option | Description | Considerations |
| --- | --- | --- |
| A — pinned Ghost OS fork | MIT, macOS 14+, Swift 6.2. Created February 2026; last upstream push March 2026 | Accessibility tools and input exist today. We would build, sign, and notarize it ourselves, disable its MLX vision sidecar and learning features, and own maintenance of the fork |
| B — in-house Swift helper | Accessibility API tree (`AXUIElement`), `CGEvent` input, ScreenCaptureKit capture, NSWorkspace app/window listing, exposing the same tool subset over stdio MCP | Full ownership and a smaller surface; more initial work |

Spike criteria (time-boxed, Phase 0): accessibility coverage on the target workflows' Mac apps, CJK input, capture geometry correctness, binary size, signing/notarization effort, and estimated maintenance cost. The decision is recorded before Phase 3.

Either way:

- The shared ONNX grounder is used; no Mac-specific model format or sidecar.
- Qualify permission attribution in the packaged app. A helper spawned by AiFetchly is normally attributed to AiFetchly.app as the responsible process, so prompts name AiFetchly, the app's signing identity must stay stable across updates, and development builds attribute to the terminal or IDE.
- Accessibility and Screen Recording are required; Input Monitoring only for later recording/learning features.

### 5.1 Ghost OS source, packaging, and launch

This is the integration plan if option A wins the spike, not a declaration that Ghost OS has been selected or qualified. The [upstream developer guide](https://github.com/ghostwright/ghost-os/blob/main/CLAUDE.md), inspected on 2026-09-26, documents `ghost mcp` as the Swift stdio server. The source build requires Swift 6.2+ and macOS 14+; the published project is MIT-licensed. Customer machines receive only our built native helper and required notices/resources.

- Maintain `adapters/macos/ghost-os/upstream.lock` with an exact upstream/fork commit, locked dependency revisions (including AXorcist), patch-set digest, Swift toolchain, and deployment target. Either a maintained fork or patches applied to a pinned checkout is acceptable; builds must fail on unresolved patches or lock drift. Never resolve a branch or download source during installation/startup.
- macOS CI checks out the pin, applies patches, resolves locked dependencies, tests, and builds the release executable for `darwin-arm64`. Sign the distributed executable/bundle, notarize the chosen distribution format, and verify signatures and notarization after packaging. Record source/dependency identities, output SHA-256, architecture, minimum OS, signing identity, and compatible contract/app versions in release metadata. Retain Ghost OS and dependency licence notices.
- Publish a target-specific Hub `native-component` resource ([plugin design 7.1](computer-use-plugin-technical-design.md#71-delivery-channels)); keep executable artifacts out of the plugin code ZIP. The managed extractor restores only validated executable permissions. Do not package Ghost's Python/MLX sidecar, model weights, recipes, or learning assets.
- The host resolves the verified executable's absolute path and launches it with argv `["mcp"]`, `shell: false`, sanitized environment, and an app-owned working directory via the supervised MCP transport ([AiFetchly design 4.1](computer-use-aifetchly-technical-design.md#41-mcp-client-on-the-official-sdk)). Keep the connection for the session and stdout reserved for MCP. Do not invoke `ghost setup`, alter another MCP client's configuration, edit global PATH, or require Homebrew.
- Supply permission/readiness diagnostics for the capabilities actually shipped, without requiring the removed vision or learning components. AiFetchly owns the permission UI and signed-app attribution tests; the plugin provides the helper and cooperates in after-update qualification. Shared ONNX runtime/model installation stays with the host's `LocalAiRuntimeModule`.

### 5.2 Ghost OS tool isolation and required patches

The [upstream tool guide](https://github.com/ghostwright/ghost-os/blob/main/GHOST-MCP.md) documents implicit vision fallback in ordinary tools, focus changes during input/capture, and screenshots downsampled to a maximum width of 1280 pixels. These behaviors must be audited in the pinned source and adapted to the host contract; hiding `ghost_ground` alone is insufficient.

| Surface | AiFetchly integration policy |
| --- | --- |
| Observation | Allow scoped `ghost_context`, `ghost_state`, `ghost_find`, `ghost_read`, `ghost_inspect`, `ghost_element_at`, and `ghost_screenshot`; validate target window/process and bound output |
| Input | Allow only needed atomic `ghost_click`, `ghost_type`, `ghost_press`, `ghost_hotkey`, `ghost_scroll`, `ghost_hover`, `ghost_drag`, and `ghost_focus` operations after host validation; serialize them. Omit unused operations from the shipped allowlist |
| Vision | Remove/disable `ghost_ground`, `ghost_parse_screen`, and all implicit sidecar fallbacks in perception/actions. AX failure returns a typed unresolved-target error to the supervisor, which may call its selected grounder |
| Workflows and recording | Remove/disable `ghost_run`, all recipe management, and `ghost_learn_*`; no multi-step execution or recorder starts behind a single grant |
| Other tools | Deny by default, including broad `ghost_window` operations, annotation, long-press, or waits until explicitly mapped, bounded, and qualified for a required host action |

Enforce the reviewed allowlist in both backend registration/dispatch and the host wrapper's `tools/list` and `tools/call` paths. Do not register raw Ghost tools as model-visible tools or import upstream agent instructions/recipes into AiFetchly's planner.

Patch or constrain action strategy fallbacks so each dispatch acts on the already validated target. Re-searching by an ambiguous label, switching windows, restoring focus, or using an alternate CDP/VLM execution path must not silently expand the authorized action. Observation must not unexpectedly activate another app; return a recoverable error when capture requires an unapproved focus transition. Retain the host's window-at-point/own-window and freshness checks and add the backend metadata or primitives needed to support them.

Return capture pixel dimensions, captured window identity, logical frame/origin, scale/resize information, and executor coordinate convention. Either preserve original captures or describe any downsampling exactly. The host maps selected-model output through these transforms; it never calls `ghost_ground` to perform coordinate conversion. Qualify Retina, moved windows, occlusion, and foreground changes with native fixtures.

The upstream server is documented as synchronous, so receiving an MCP cancellation message cannot be assumed to interrupt a running action. Add bounded operations and cooperative stop where possible; the host revokes grants immediately and owns process-tree termination independently of that connection. Passing the existing stop/last-input gates is required before shipping; the fork must fix cancellation gaps or the spike chooses the in-house helper.

Producer work in this section is the source pin/fork, native changes, build/sign/notarize pipeline, reviewed tool surface, geometry/cancellation metadata, and backend tests. Host launch/permission UI and grant checks are integration requirements consumed by AiFetchly, whose [Mac implementation plan](computer-use-aifetchly-technical-design.md#62-macos-backend-consumption) owns that code. The spike must demonstrate these requirements can be met; it does not silently commit to Ghost OS.

### 5.3 Mac implementation units and spike output

For Ghost, map changes to the pinned upstream MCP registration/dispatch, perception/capture, action and vision-bridge modules. Patch the smallest set that establishes the reviewed contract; record each patch's purpose and fixture. For an in-house helper, own a Swift package under `adapters/macos/swift-helper/` with equivalent perception, capture, input, diagnostics and stdio modules. Either option returns the same normalized semantics through the host wrapper.

The spike report includes: source/toolchain pins; required patches or new Swift modules; AX coverage on a controlled app and candidate Mac workflow; CJK input behavior; original/downsampled Retina mapping; permission denial/revocation; long-action cancellation with dispatch timestamps; signed/notarized packaging trial; binary/dependency footprint; and known maintenance work. Time-box the investigation in the phase plan and record its actual duration. Failing a required safety gate cannot be offset by better convenience or a smaller binary.

Keep Swift unit tests for normalization/geometry/dispatch decisions independent of TCC permission prompts. Interactive tests use a controlled target and the packaged helper. Test binaries signed differently from AiFetchly are not sufficient evidence of final permission attribution. Remove runtime references to excluded vision/recipe/learning assets; absence of files alone does not prove those call paths are disabled.

## 6. Grounding model artifacts

### 6.1 Model selection

| Model | Base and licence chain | Parameters | Weights (published) | Status |
| --- | --- | --- | --- | --- |
| GUI-Actor-2B-Qwen2-VL | Qwen2-VL-2B-Instruct (Apache-2.0) → MIT | ~2B, 28 decoder layers, hidden 1536 | bf16 safetensors ≈ 4.45 GB | **Default** |
| GUI-Actor-3B-Qwen2.5-VL | Qwen2.5-VL-3B-Instruct (Qwen Research License, non-commercial) → MIT | ~3B | — | **Blocked** pending commercial licence |
| GUI-Actor-7B-Qwen2.5-VL | Qwen2.5-VL-7B-Instruct (Apache-2.0) → MIT | ~7B | — | Future high-memory tier |
| GUI-Actor-Verifier-2B | UI-TARS-2B-SFT → MIT | ~2B | — | Future; licence chain to confirm |

Release tooling records the licence of every weight file and its base model, and fails publication on a non-commercial licence.

### 6.2 Reference inference path

GUI-Actor adds an attention-based pointer head to Qwen2-VL. The reference implementation's placeholder mode (`inference(..., use_placeholder=True)`) needs **one forward pass and no token-by-token generation**:

1. Build the chat prompt with the system grounding message, the image, and the instruction, then append the assistant starter `<|im_start|>assistant<|recipient|>os\npyautogui.click(<|pointer_start|><|pointer_pad|><|pointer_end|>)`.
2. Run the vision encoder on the image patches.
3. Run the decoder over the full prompt (prefill only, no KV cache output).
4. Take the input-embedding-layer hidden states at `<|image_pad|>` positions and the final-layer hidden state at `<|pointer_pad|>` (`pointer_pad_token_id` 151661 in the 2B config).
5. Run the pointer head to get attention scores over the merged patch grid (`image_grid_thw / merge_size`).
6. Postprocess: keep patches above 0.3 × max activation, group 4-connected regions, rank regions by mean activation, and return activation-weighted centers normalized to `[0,1]` in model-input image space.

The reference runner in this repository supplies golden outputs for all six steps. In production, steps 1 and 6 are implemented in the AiFetchly TypeScript worker; steps 2–5 use the exported ONNX graphs. Publish preprocessing and decoding revisions so the host can prove parity.

### 6.3 Export pipeline

- Export three graphs, or fewer if fusion is verified: `vision_encoder.onnx`, `decoder_prefill.onnx` (returns the two hidden-state tensors needed, not logits, so the vocabulary projection is never computed), and `pointer_head.onnx`.
- Save weights as ONNX external data, sharded by the export pipeline into files of at most 512 MiB, so every file fits the model package limits and GitHub release asset limits ([plugin design 6.4](computer-use-plugin-technical-design.md#64-model-package-format)).
- Pin the opset and exporter versions. Record them in the model manifest.
- Produce configurations as separate, independently benchmarked model packages, each with its own local runtime ID ([AiFetchly design 7.4](computer-use-aifetchly-technical-design.md#74-runtime-ids-and-model-configurations)): fp16 baseline; int8 or int4 weight-only decoder (for example `MatMulNBits`) with fp16 vision encoder. Verify each operator is supported by each target execution provider before publishing. Size estimates to confirm in Phase 0: about 4.4 GB for fp16 (the published bf16 checkpoint is about 4.45 GB; the 2B model ties its input and output embeddings, so dropping the LM head saves little), and about 2.2–2.7 GB for an int4 decoder with fp16 vision encoder.
- Ship `tokenizer.json`, special-token map, chat template, and `preprocessor_config.json` alongside the graphs.
- Manifest identity includes model revision, export pipeline version, opset, quantization, preprocessing configuration, and per-file hashes.

**Parity tests** (hard gate for every configuration): for each fixture, compare the ONNX pipeline against the PyTorch reference at every stage — `pixel_values`, `image_grid_thw`, position ids, image-token embeddings, pointer hidden state, attention scores, ranked regions, and final points — with recorded tolerances. The final check is region-hit agreement on the labeled fixture set.

### 6.4 Model package format

ZIP is not used for models:

- GUI-Actor weights exceed the current 768 MiB archive, 1 GiB entry, and 2 GiB extracted limits.
- Weights barely compress.
- Extraction doubles the disk needed.
- A single archive cannot resume per part, and GitHub release assets are limited to 2 GiB each.

A model package is instead a set of individually hashed files downloaded straight into staging.

```text
model-artifact-root/  # Producer files; host adds runtime-ID/version directories and active.json
├── manifest.json
├── vision_encoder.onnx
├── vision_encoder.data.000 … .NNN     # external data shards, each ≤ 512 MiB
├── decoder_prefill.onnx
├── decoder_prefill.data.000 … .NNN
├── pointer_head.onnx
├── tokenizer.json
├── special_tokens_map.json
├── chat_template.jinja
├── preprocessor_config.json
├── health/fixture.png
├── health/expected.json
└── LICENSES/                          # GUI-Actor (MIT), Qwen2-VL (Apache-2.0), NOTICE
```

The model `manifest.json` (Zod-validated as `LocalAiModelPackageManifest`) records:

- package kind, runtime ID, and version;
- upstream model ID and commit revision;
- grounding contract/adapter identity, model architecture and manifest version, and preprocessing/decoding/calibration revisions matching the catalog ([plugin design 3.4](computer-use-plugin-technical-design.md#34-grounding-contract));
- export pipeline version, exporter, opset, and quantization;
- model-specific preprocessing configuration (for GUI-Actor: patch 14, merge 2, temporal patch 2, pixel bounds, default budget, `pointer_pad_token_id`) and calibrated output-policy parameters;
- graph file names and their input/output names;
- supported execution providers;
- the file list with sizes and hashes;
- licences, the parity report hash and fixture count, and build provenance.

The host catalog owns installation/activation. Match its [catalog-v2 fields](computer-use-aifetchly-technical-design.md#73-catalog-v2), approved runtime IDs, built-in adapter/architecture/contract and processing revisions, required runtime version, execution providers, memory floor, app-version range, and per-file URL/size/hash records. Publish the manifest and health fixture only after conformance with the pinned host consumer schema.

Producer limits: external-data shards at most 512 MiB; all files at most 1 GiB; at most 128 files and 8 GiB total. Do not enlarge these host ceilings through catalog data. Model artifacts contain graphs/data/tokenizers/fixtures/notices, never Python environments or executable adapter code. The host owns HTTP resume, timeouts, checksum enforcement, disk preflight, leases, activation, repair and pruning.

### 6.5 Model adapter evolution

Export pipeline changes and host processing changes are coordinated through the configuration identity: adapter ID/version, contract version, model runtime ID/version and manifest digest, preprocessing, decoding and calibration revisions. A new configuration/architecture that is absent from the host allowlist needs a host app release. A data-only revision can ship independently only within an existing qualified compatibility contract.

Publish absence/ambiguity policy and validation fixtures per model/quantization. GUI-Actor attention thresholds are not reusable generic confidence scores. Candidate points, regions and optional heatmaps conform to the shared schema; no absence-qualified model means no autonomous visual input. A second test adapter exercises schema interchangeability, while a second production model waits for independent qualification.

### 6.6 Reproducible export and parity sequence

1. Resolve `grounding/models.lock.json` and the selected configuration. Record upstream model commit, downloaded file hashes, licence notices, Python/dependency/tool versions and hardware. Download is an explicit preparation step, never an implicit fallback inside export or replay.
2. Run the reference on a small smoke fixture before export. Save canonical image dimensions, prompt/tokenization inputs and stage outputs under a run ID; this isolates reference/setup errors from ONNX errors.
3. Export each graph at the pinned opset; validate graph structure, external-data paths and input/output names. Apply the chosen quantization and sharding; generate package metadata from actual files.
4. Compare preprocessing tensors, positions, hidden states, attention/regions and final geometry against the reference. The configuration names a versioned tolerance profile with per-stage absolute/relative error and region-hit requirements, chosen before evaluating the held-out cases.
5. Evaluate missing/ambiguous targets, small controls and crop transforms. Fit thresholds only on the calibration split; freeze the policy before testing held-out data. A new quantization or preprocessing revision requires requalification.
6. Test each claimed provider on matching hardware and report effective provider/fallback and peak memory; a CPU run cannot qualify DirectML/CoreML. Host consumer runs under its Electron/Node binding remain a separate mandatory report.
7. Assemble the model file set, health fixture, evidence and notices; verify all file hashes and manifest identity. Mark it a candidate until host adapter/installation/native evidence is accepted.

Store full tensor dumps only for opt-in local debug or failed CI artifacts with explicit retention; normal reports contain hashes, shapes, error summaries and fixture IDs. Out-of-memory, unsupported operator, missing weights, timeout and export divergence are typed failures with stages. Retrying may resume artifact preparation, but cannot quietly change the configuration, pixel budget, precision or provider and reuse the old result identity.

## 7. Packaging and distribution

### 7.1 Delivery channels

| Resource | Channel | Identity includes | Download policy |
| --- | --- | --- | --- |
| Common plugin code | Hub | Plugin version + hash | When changed |
| Windows-MCP environment | Hub (managed uv, [AiFetchly design 8](computer-use-aifetchly-technical-design.md#8-managed-python-for-windows-mcp)) | Python runtime identity + full dependency lock hash + target | Windows only |
| uv toolchain + Python runtime | Hub | Version + OS + architecture + hash | Windows only, shared when compatible |
| macOS helper | Hub (native-component resource, Phase 3) | Helper revision + architecture + hash + signing identity | macOS only |
| ONNX Runtime Node binding | Local AI runtime catalog v2, runtime ID `grounding-onnxruntime` | ONNX Runtime version + execution providers + platform + architecture + Electron ABI + SHA-256 | When the user turns on local vision |
| GUI-Actor model configuration | Local AI runtime catalog v2, runtime ID `grounding-model-gui-actor-2b-<config>` | Model revision + export pipeline version + opset + quantization + preprocessing identity + per-file SHA-256 | When the user turns on local vision; independent of plugin code |

The Hub install plan for Computer Use contains no model or ONNX Runtime resource. The plugin manifest declares which local runtime IDs it can use (`localAiRuntimes: [{ runtimeId, minVersion }]`). The host accepts only IDs in its compiled allowlist, so a plugin can never add a runtime, change a download URL, or select a different model file.

### 7.2 Windows provisioning artifacts

Publish either the reviewed managed-uv environment inputs or the prebuilt embeddable-Python bundle selected in Phase 0. Pin Python, backend and complete transitive dependencies; emit the Hub JSON lock from the development lock and verify hashes/target wheels in CI. `uv.lock` and the Hub lock are not interchangeable.

CI/developer builds may resolve dependencies; customer provisioning is host-managed from the validated immutable plan, with no source builds, global PATH changes, or session-start installation. Missing target wheels fail packaging/qualification. The host implementation of provisioning is in the [AiFetchly design](computer-use-aifetchly-technical-design.md#8-managed-python-for-windows-mcp).

### 7.3 Artifact manifests and resource handoff

A release manifest identifies plugin version, exact source/dependency/patch pins, schema/fixture digests, backend platform/architecture/minimum OS, input tool surface version, executable launch profile, hashes/sizes, signing identity where applicable, model manifest URLs/digests, supported host app/adapter/runtime ranges, licence notices, and conformance/parity report digests. Model compatibility metadata is not permission to load new host code.

Publish plugin code and backend/native resources for Hub ingestion. Publish immutable model file sets for the host's reviewed `grounding-models.lock.json` and local runtime catalog, independent of plugin code updates. The host builds/distributes its ONNX binding; the plugin does not own `local-ai-runtime-release.yml` or serve as another runtime installer. Hub listing, native-component resource type, safe executable extraction and target-conditional plan support remain Hub-owned dependencies.

### 7.4 Build outputs and artifact verification

Artifact names below are proposed producer output conventions; the Hub's accepted manifest/packager schema remains authoritative for ingestion. Phase 0 adds an explicit mapping and consumer fixture rather than assuming an arbitrary filename is an install plan.

| Artifact role | Example output | Required contents / exclusions |
| --- | --- | --- |
| Contracts | `computer-use-contracts-<version>.zip` | Schemas, fixture manifests/data, generated declarations and checksums; no runtime JavaScript or desktop executor |
| Common plugin | `computer-use-plugin-<version>.zip` | Hub-compatible plugin manifest, skills/tool descriptions, compatibility declarations and notices; no weights, private environments or native binaries |
| Windows environment | `windows-env-<revision>-win32-x64.json` and referenced immutable wheels/resources, or the selected prebuilt bundle | Exact Python/backend/dependency closure and launch profile; no model engineering dependencies, unpinned source build or global installation |
| Mac native component | `computer-use-helper-<revision>-darwin-arm64.tar.gz` | Signed helper, required resources/notices and validated executable mode; no MLX/Python/recipe assets |
| Model | `models/<configuration>/<version>/manifest.json` plus file set | Graphs/shards/tokenizer/configuration/health fixture/licences; immutable URLs and hashes, independently delivered through the host catalog |
| Evidence | `reports/<run-id>/report.json` and optional local HTML | Fixture/configuration/hardware/source identities, case counts, failures, skips, measurements and report digest |
| Release manifest | `computer-use-release-<version>.json` | References the exact artifacts and evidence forming a compatibility candidate; does not itself authorize host activation |

The release manifest schema includes `schemaVersion`, `releaseVersion`, `sourceCommit`, toolchain/source lock digests, contract/fixture versions and digests, and a bounded `artifacts` array. Each artifact records role, platform/architecture applicability, immutable location, byte size, SHA-256 and compatible host/backend/model identities. Native entries additionally identify launch profile and signing identity; evidence entries identify test suite, result, target, candidate artifact digest and required consumer build. Package versions may differ; the closure records their precise combination.

Compute artifact hashes after packaging/signing so they cover the bytes delivered. Store any digest/signature of the release manifest outside the manifest being hashed. A clean verifier checks path/resource closure, target applicability, per-file sizes/hashes, notices, launch-profile consistency, signatures where applicable, and report-to-artifact identity before publication. Reproducibility means pinned inputs and a recorded verifiable build; notarization timestamps/signatures need not yield byte-identical packages across signing runs.

### 7.5 Candidate, qualified release, and update handling

Candidate artifacts can be handed to consumer CI without being listed as supported. Qualification requires complete producer reports and the matching host/Hub consumer results; record target-specific state, so a passing Windows build does not qualify Mac. Missing evidence is `unqualified`, not an implied pass.

On a failed candidate, keep the previous qualified artifact set available and publish the failure report internally. On a corrected build, create a new immutable version/digest; never replace bytes at a published identity. Upgrades carry a compatibility diff describing tool/schema changes, native permission/signing impact, and whether host adapter code must change. Host activation, leases, removal and rollback are implemented by AiFetchly; this repository supplies the compatible artifacts and evidence and never changes a customer's active session.

## 8. Tests and evaluation

### 8.1 Producer conformance

- ONNX parity per configuration and execution provider at every stage ([plugin design 6.3](computer-use-plugin-technical-design.md#63-export-pipeline)).
- Transform fixtures: exact geometry, inverse round trips, anisotropic resize, crops, padding, negative origins, mixed-scale rejection.
- Contract tests for both adapters: field meanings, units, errors, absent capabilities, allowlists.
- Grounding schema conformance fixtures for GUI-Actor and a test-only second adapter, including point-only output without a heatmap, crop transforms, incompatible contracts, and absent/ambiguous targets.
- Ghost fork tests if selected: reproducible pins/patch application; allowlist enforcement in discovery and dispatch; explicit and implicit vision paths disabled; recipe/learning tools unavailable; unresolved AX targets return without sidecar launch or access, even if a user has an upstream sidecar installed.
- Licence-chain check for every published model.

### 8.2 Benchmark

Labeled clickable regions (any point inside counts), absent targets, distractors, repeated labels, icons, custom controls, small targets, Chinese/English UI, themes, and layout changes, drawn from the target workflows. Held-out evaluation is separate from regression fixtures.

**W-1 Excel benchmark.**

- **Tasks.** Paste 20, 200, and 500 lead rows into each fixture workbook, then format and verify. Source rows are synthetic leads with realistic edge cases (CJK names, leading zeros, long IDs, duplicate emails, values starting with `=` or `+`).
- **Grounding targets.** Labeled from Excel screenshots at 100% and 150% scaling, light and dark Office themes, and full and collapsed ribbons: Name Box, sheet tabs, header cells, filter dropdown arrows, table style gallery swatches, conditional formatting menu items, and icon-only ribbon buttons. Absent-target variants remove the control, for example a collapsed ribbon group.
- **Arms.** Accessibility-only (Phase 1), grounder-only (Phase 2, grounding every step through the vision path so the grounder is qualified on its own), combined, and visual planner mode.
- **Metrics.** Task success, handoffs, cell mismatches after verification (hard gate: 0), unauthorized consequential actions (hard gate: 0), run time per 200 rows, planner steps, and API cost.

Compare on identical tasks:

- accessibility-only, grounder-only, and combined target resolution;
- local-only vs. visual planner mode;
- pixel budgets and quantization configurations per execution provider;
- GUI-Actor-2B vs. ShowUI-2B vs. an end-to-end computer-use model baseline.

Report sample counts, revisions, hardware, resolution, region hits, wrong-action rate on absent targets, uncertainty, interventions, recovery, end-to-end completion, cold/warm stage latency, peak RAM/VRAM, and API cost.

Hard gates: no input from read-only modes; no click on parse error, absence, or ambiguity; no wrong-platform artifacts; no action after a revoked generation or stop acknowledgment; no unapproved consequential action; no blind retry of uncertain input; no screenshot to the planner in local-only mode; no action on an AiFetchly window or an elevated window; no remaining cell mismatch after W-1 verification.

### 8.3 Native and consumer integration

- Producer native tests cover window ownership/integrity, AX reads, window-at-point, CJK/IME, focus, moved/occluded windows, Windows scaling and Retina/downsample mapping, locked desktop and permission errors, long typing/drag, held-input cleanup, and bounded synchronous calls.
- The Mac pipeline verifies executable signatures/notarization after extraction, patch/dependency pins, disabled vision/recipe/learning paths, and dispatch timestamps. A locally installed upstream sidecar must remain unused even after AX failure.
- The host reruns contract tests against the exact released artifacts and owns signed-app permission attribution, UI/hotkey, private tool routing, planner image isolation, version leases/selection, and no-input-after-stop acceptance. Expose the native metadata/test hooks it needs without embedding host authority in the helper.
- Export/parity and offline replay run with synthetic/consented captures and never load a desktop executor. End-to-end benchmark arms require the host harness and current-task authorization; replay is not a recipe runner.
- Contract release tests include incompatible versions, malformed geometry, invalid model manifests, missing capabilities, point-only results with no heatmap, absent/ambiguous controls, and stale generation/observation identities. Store held-out evaluation separately from regression fixtures.

### 8.4 Fixture and report records

Fixture manifests are versioned data under `eval/datasets/` and `test/fixtures/`. Each case has a stable ID, content hash, source/provenance and consent classification (`synthetic` or reviewed/consented), split (`regression`, `calibration`, or `held_out`), task/target description, image/workbook references and hashes, geometry/locale/theme/display metadata, and expected output (clickable region, absent/ambiguous label, or typed error). Never infer the split from a filename or move failing held-out examples into calibration while retaining the same evaluation version.

An evaluation report contains:

| Field group | Required values |
| --- | --- |
| Run | Report schema/version, run ID, source commit, start/end, command mode, dataset/split revision and fixture manifest hash |
| Configuration | Model/adapter/contract/processing/calibration identity; reference or ONNX runner and tool versions; pixel budget/quantization; actual provider and hardware |
| Per case | Fixture ID/hash, expected/actual geometry or error, coordinate space/transforms, region hit and absence/ambiguity decision, stage timings, optional memory measurement, pass/fail/skipped and reason |
| Aggregate | Planned/executed/passed/failed/skipped counts, denominators, region hit rate, absence false-accept count, p50/p95/max latency, peak measured RAM/VRAM and measurement method |
| Qualification | Required suites/targets, missing evidence, report digest and compatibility candidate identity; producer-only versus integrated-host status |

The same image may support multiple descriptions, but the manifest records each case explicitly. Region-hit tests use the labeled clickable region in original capture pixels after applying the declared transforms; an absent case fails if any candidate is accepted for action. An empty set or a skipped required case fails the gate. Model scores remain diagnostic values with named semantics.

The plugin replay CLI's Python reference or ONNX runner is not the host's TypeScript/Electron worker. Label the runner accordingly. Exact reproduction of host preprocessing/provider behavior is performed by the host replay path using the same fixture/model identity; cross-runner disagreement is a reportable parity failure, not silently described as exact replay. Native W-1 benchmark checks compare all expected fixture output cells after the run, independent of the host's live sampling policy.

### 8.5 CI and qualification matrix

| Job | Runner and trigger | Checks / outputs | Required for |
| --- | --- | --- | --- |
| Portable checks | Linux, Windows and macOS Node jobs; PRs affecting contracts/tooling | `npm ci`, `npm run check`, build and contract archive validation; no input/weights | Every schema/tooling release |
| Windows unit/package | Windows x64; backend/lock/packaging changes | Pinned Python, unit/serialization tests, allowlist/closure/launch checks | Windows candidate |
| Windows native | Controlled interactive Windows x64 desktop; explicit qualification workflow | AX/capture/geometry/CJK/integrity, W-1 primitives, drag/typing cancellation and last-dispatch evidence | Input-capable Windows release |
| Mac unit/package | Apple Silicon Mac; Swift/pin/patch changes | Pinned Swift build/tests, package resources, source/lock consistency | Mac candidate |
| Mac packaged native | Controlled interactive Mac and signed host/helper; explicit qualification | TCC attribution/denial, CJK, Retina/occlusion, no sidecar/recipe fallback, cancellation and signed-update behavior | Mac release |
| Model smoke | Compatible Python environment; model tooling/schema changes | Small synthetic graph/tensor tests, manifest/parity failure handling | Model tooling release |
| Full model qualification | Reference CPU and each claimed GPU/provider; model/config changes | Actual weights, per-stage parity, frozen calibration, held-out fixtures, resource report | Each production configuration/provider claim |
| Host/Hub consumer | Pinned consumer builds and candidate artifact closure | Actual host adapter/catalog/install tests, native safety and W-1; Hub target plan validation | Qualified compatibility combination |
| Release verification | Trusted release job with candidate artifacts | Closure/digest/evidence checks, final native signatures/notarization and notices | Publication/promotion |

Path filters select expensive jobs, but cannot turn a missing required release report into a pass. Reusing evidence is allowed only when the relevant source/dependency/configuration/fixture/artifact identities and qualification target are unchanged. Ordinary hosted runner availability does not prove an unlocked interactive desktop, Excel licence, TCC grant or GPU/provider capability. Preflight those requirements and mark unavailable jobs explicitly. Release credentials are needed only for trusted signing/publishing jobs; PR tests do not depend on them.

## 9. Release and handoff

| Phase | Repository deliverable | Consumer acceptance |
| --- | --- | --- |
| 0 | Schema/fixture release, Windows pin/prototypes, default model export/parity/resource spike, Mac comparison report | Host SDK/client and adapter prototypes consume schema; agree identifiers, reference hardware and report formats |
| 1 | Versioned Windows backend artifact/lock and W-1 fixture set | Hub plan provisions it; host native/accessibility workflow and stop gates pass |
| 2 | Qualified GUI-Actor file set, immutable manifest, licence/parity reports and replay CLI | Host catalog v2 and built-in adapter agree on identities, process fixture outputs, and pass native vision gates |
| 3 | Selected signed/notarized Mac helper, pins/patches and conformance report | Hub native-component plan and signed host build pass Mac permissions, geometry, CJK and cancellation |
| 4 | Clean-machine and upgrade artifact evidence, supported revision matrix | Joint GA checklist and measured host SLOs |
| 5 | Independently qualified expansions | Host/Hub support exists before claiming support |

Release procedure: freeze source/schema/configuration IDs; build and test; retain licence/build provenance; publish immutable artifacts with hashes and reports; submit the reviewed manifest to host/Hub consumers; run integrated consumer gates; then mark that compatibility combination qualified. Do not change a published artifact in place. Release versions for plugin code, schemas, native backends, model configurations, and evidence independently.

A schema release may precede native artifacts so the repositories can develop independently. Fake adapters and fixture runners establish boundary behavior, not model accuracy or native permission/stop claims. Never replace a backend/model inside a running host session; activation/rollback remains host-managed.

### 9.1 Implementation work packages

| Work package | Owned paths / dependency | Implementation and output | Completion check |
| --- | --- | --- | --- |
| P0-A Toolchain | Root configs, `tooling/`, `test/tooling/`; no native dependency | Exact Node/npm pins; strict build; bounded subprocess runner; command/result conventions; independent Python/Swift lock placeholders resolved by their spikes | Clean Node-only `npm run check` and `npm run build`; no desktop/model side effects |
| P0-B Contracts | `contracts/`, `tooling/contracts/`, `test/contracts/`; after P0-A | Canonical schemas, local reference registry, declarations, valid/invalid fixtures, version policy; contract archive | `contracts:check` and `contracts:build`; host decodes the pinned fixture candidate |
| P0-C Windows spike | `adapters/windows/`, `test/windows/`; P0-B | Choose exact backend/interpreter and extension/fork path; prototype integrity/window-at-point and bounded Excel observations; choose environment delivery | Unit/native spike report, reviewed tool subset and pinned package closure |
| P0-D Model spike | `grounding/`, `test/grounding/`; P0-B | Separate Python environment; reference smoke, export, sharding/parity, provider/memory timing; default configuration and tolerance profile | `model:export` and `model:parity` reports; no production model claim on failure |
| P0-E Mac spike | `adapters/macos/`, `test/macos/`; P0-B | Compare Ghost patch set and thin Swift helper; produce §5.3 decision evidence | Backend decision and bounded remaining work before P3 |
| P1 Windows artifact | Windows integration and `packaging/windows/`; P0-C | Complete atomic surface/lifecycle and fixtures; build reproducible environment inputs or selected bundle; native timing report | Windows backend suites, `package:build`, host accessibility W-1/stop acceptance |
| P2-A Model artifact | Model export/parity and file-set assembly; P0-D | Frozen qualified model/processing/calibration identity, health fixture, hashes, notices and reports | Every claimed provider/parity gate; host worker and catalog consumer acceptance |
| P2-B Evaluation | `eval/`, dataset manifests and report schema; P0-B plus reference runner | Replay/compare, metrics, fail/skip semantics, synthetic Excel oracle and local report | Offline CLI tests prove no backend launch; full report round-trip and independent mismatch detection |
| P3 Mac artifact | Selected Swift source/patches and `packaging/macos/`; P0-E | Production tool subset, diagnostics/geometry/cancellation, signing/notarization and native package | Swift/unit/native suites and signed-host CU-MAC acceptance |
| P4 Release operations | `tooling/release/`, workflows, compatibility records; target artifacts | Closure assembly, evidence verification, target qualification state, update compatibility report and transfer instructions | `release:verify`, clean-machine/upgrade matrix and pinned host/Hub reports |

P0-C, P0-D and P0-E can be planned independently after the shared boundary is agreed. Contract changes discovered during a spike update P0-B fixtures and host expectations before the corresponding artifact is declared compatible. Phase acceptance is a report against an immutable candidate, not merely completion of code files.

### 9.2 Handoff checklist by consumer

| Consumer | Required handoff | Consumer confirmation |
| --- | --- | --- |
| AiFetchly contract implementer | Schema/fixture archive, digest, compatibility notes and generated type expectations | Consumer fixture suite passes; public tools and private backend mapping use the same meanings |
| AiFetchly runtime implementer | Model manifest/file set, licence/parity/health reports and required built-in adapter revisions | Catalog lock reviewed; download/probe/worker/replay tests pass with exact versions |
| AiFetchly native integration | Backend/native package, launch profile, permissions/capabilities, geometry and cancellation reports | Private launch, target validation, packaged permission and stop tests pass |
| Hub maintainer | Common plugin and platform artifact metadata, dependencies/locks, executable-mode/signing data | Target-specific immutable install plan and verified extraction pass; model/ONNX resources remain outside Hub closure |

Record outstanding consumer work as a dependency with an artifact ID and failing/missing gate. A producer can finish a contract or candidate artifact while host integration is pending, but cannot claim the integrated feature is shipped.

## 10. Requirement traceability

| Plugin PRD requirement | Design | Verification |
| --- | --- | --- |
| CU-PLUGIN-01–04 | §1, §3, §7.3 | Versioned schemas/fixtures, negative compatibility cases, host consumer suite |
| CU-PLUGIN-05–06 | §4, §7.2, §8.3 | Pinned backend/lock, restricted tool surface, integrity/window geometry and CJK |
| CU-PLUGIN-07 | §4, §5.2, §8.3 | Bounded native calls, dispatch timestamps, held-input cleanup, host stop gate |
| CU-PLUGIN-08 | §5, §9, §11 | Ghost versus in-house helper decision report |
| CU-MAC-01 | §2, §5.1, §7, §8.3 | Source/dependency pins, signed/notarized native artifact and extraction validation |
| CU-MAC-03 | §5.2, §8.1, §8.3 | Explicit/implicit vision paths disabled; recipes/learning unavailable |
| CU-INST-11 | §6.1, §6.3, §7.3 | Full model/base-model licence provenance and release rejection tests |
| CU-PLUGIN-09–10 | §6, §7.1, §7.3 | Export parity, graph/processing identity, file hashes/limits, consumer compatibility |
| CU-PLUGIN-11–12 | §3.5–3.6, §8 | Synthetic W-1 and geometry corpus, read-only replay, reproducible benchmark |
| CU-PLUGIN-13–14 | §7, §9 | Platform artifact closure, release manifest, consumer report and handoff |
| CU-PLUGIN-15–16 | §1.2–1.3, §2.1–2.2 | Isolated toolchains, clean Node-only workflow, commands with no native/model side effects |
| CU-PLUGIN-17–18 | §3.7–3.8, §4.2, §5.3 | Common language-independent fixtures; lifecycle, incompatibility, cancellation and uncertain-outcome cases |
| CU-PLUGIN-19–20 | §6.6, §8.4–8.5 | Report schema/denominators, explicit skips, held-out evaluation and target CI evidence |
| CU-PLUGIN-21–22 | §7.4–7.5, §9.1–9.2 | Immutable artifact/evidence closure, work-package exits and exact consumer handoff |

Host requirements remain canonical in the AiFetchly PRD. Plugin contributions support CU-INST-01–10/12–18 through metadata/artifact closure; CU-SESSION-03–06/10–13 and CU-PERM through backend boundaries and dispatch evidence; CU-VISION through contracts/model fixtures; CU-MAC-02/04–05 through native interfaces; and CU-DEBUG through trace/evaluation schemas. These dependencies do not move host implementation into this repository.

## 11. Open decisions

Plugin-owned: Mac backend winner; Windows-MCP extension versus pinned fork and managed uv versus prebuilt Python artifacts; default model quantization/export configuration, opset and provider evidence; absence/ambiguity calibration; any future model licence clearance. Coordinate model hosting, schema/fixture versions, host adapter identities, runtime compatibility, reference hardware and release sequencing with AiFetchly and the Hub.

Host-owned choices such as stop hotkey, planner providers/image crop policy, UI retention defaults and final integrated SLOs remain in the [AiFetchly design](computer-use-aifetchly-technical-design.md#17-limitations-and-open-decisions). No producer default overrides host privacy/authorization policy.

## 12. References

Upstream links refer to moving branches; pin exact revisions when implementing. The Ghost OS repository, developer guide, and tool guide were rechecked on 2026-09-26 for revision 1.3; these upstream capabilities still require packaged-app qualification.

Toolchain declarations were rechecked on 2026-09-27 for revision 1.5. TypeScript/npm/uv/Swift tooling choices are proposed repository decisions; actual versions must be pinned and tested during bootstrap.

- [Windows-MCP Python version and dependencies](https://github.com/CursorTouch/Windows-MCP/blob/main/pyproject.toml); [Ghost Swift tools and deployment target](https://github.com/ghostwright/ghost-os/blob/main/Package.swift).
- [Ajv JSON Schema versions](https://ajv.js.org/json-schema.html) (use its 2020-12-specific validator; older drafts require a separate compatible instance); [uv locking and syncing](https://docs.astral.sh/uv/concepts/projects/sync/) (`--locked` rejects a stale lock instead of updating it).

- [GUI-Actor repository and inference code](https://github.com/microsoft/GUI-Actor) (`src/gui_actor/inference.py`, placeholder mode); [GUI-Actor-2B model](https://huggingface.co/microsoft/GUI-Actor-2B-Qwen2-VL) (config and `preprocessor_config.json`).
- [Qwen2-VL-2B-Instruct](https://huggingface.co/Qwen/Qwen2-VL-2B-Instruct); [Qwen2.5-VL-3B-Instruct licence](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/blob/main/LICENSE).
- [ONNX Runtime DirectML EP](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html); [DirectML maintenance notice](https://github.com/microsoft/DirectML); [Windows ML execution providers](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/supported-execution-providers).
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk); [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle).
- [Windows-MCP](https://github.com/CursorTouch/Windows-MCP); [Ghost OS](https://github.com/ghostwright/ghost-os).
- [Ghost OS developer guide](https://github.com/ghostwright/ghost-os/blob/main/CLAUDE.md); [Ghost OS tool behavior and coordinate mapping](https://github.com/ghostwright/ghost-os/blob/main/GHOST-MCP.md).
- [uv standalone installation](https://docs.astral.sh/uv/getting-started/installation/).
- [Electron `globalShortcut`](https://www.electronjs.org/docs/latest/api/global-shortcut); [`BrowserWindow.setContentProtection`](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable); [`screen.dipToScreenRect`](https://www.electronjs.org/docs/latest/api/screen#screendiptoscreenrectwindow-rect-windows); [`SetWindowDisplayAffinity` / `WDA_EXCLUDEFROMCAPTURE`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity).
- [UI Automation security and UIPI](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview); [`SendInput`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput) (UIPI blocking is not reported); [`GetTokenInformation` / `TokenIntegrityLevel`](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation); [mandatory integrity control](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control).
- [UI Automation overview](https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32) (grid, table, and value patterns used by W-1).
- [ONNX Runtime Node.js binding](https://onnxruntime.ai/docs/get-started/with-javascript/node.html); [ONNX external data](https://onnx.ai/onnx/repo-docs/ExternalData.html); [HTTP range requests (RFC 9110 §14)](https://www.rfc-editor.org/rfc/rfc9110#name-range-requests); [GitHub release asset size limit](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas).
- Host: [AiFetchly PRD](computer-use-aifetchly-prd.md) and [technical design](computer-use-aifetchly-technical-design.md), including managed installation and local runtime consumer dependencies.
- Hub (`aifetchly-hub-go`): `docs/prd/plugin-hub-uv-managed-runtime-technical-design.md`, `docs/prd/plugin-hub-uv-managed-runtime-prd.md`, `docs/plugin-runtime-requirements-crud.md`.
