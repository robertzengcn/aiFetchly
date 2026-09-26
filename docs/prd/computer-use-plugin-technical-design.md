# Computer Use Plugin Repository — Technical Design

## Document information

| Field | Value |
| --- | --- |
| Version | 1.4 |
| Status | Proposed; repository-scoped design. No implementation is claimed |
| Date | 2026-09-26 |
| Implementation owner | `aifetchly-computer-use` |
| Companion document | [Product requirements](computer-use-plugin-prd.md) |
| Distribution dependency | `aifetchly-hub-go`; separate Hub work, not owned by either implementation repository |

### Document set and revision

| Repository | Product requirements | Technical design |
| --- | --- | --- |
| `aiFetchly` | [AiFetchly PRD](computer-use-aifetchly-prd.md) | [AiFetchly technical design](computer-use-aifetchly-technical-design.md) |
| `aifetchly-computer-use` | [Plugin PRD](computer-use-plugin-prd.md) | [Plugin technical design](computer-use-plugin-technical-design.md) |

Version 1.4 splits the version 1.3 combined documents by repository responsibility. Existing product decisions, W-1, model selection, delivery channels, and release gates remain in force. The plugin repository is proposed; these documents do not create it. The plugin pair can be copied into its `docs/prd/` when it is initialized; sibling links here describe the current review set and must be replaced by pinned cross-repository links on transfer.

## 1. Architecture and ownership

This repository builds artifacts consumed by the host; it does not own a running agent. AiFetchly owns the planner loop, sessions, grants, desktop lease, stop, coordinate transforms, image routing, persistence, runtime installation, and UI. Backend tools are private atomic primitives, invoked only by its supervisor.

There are three independent interfaces: the host planner provider chooses steps; a host-owned grounding-model adapter produces candidate locations; the desktop backend observes the OS and executes authorized input. The plugin owns schemas and test fixtures for their integration, backend source/packaging, and model reference/export pipelines. Schemas and fixtures are shared, not executable host code.

The initial inference runtime stays ONNX Runtime. GUI-Actor-2B is the default; new architectures/configurations need host adapter support and independent qualification. Remote grounding, Ghost's own vision sidecar, recipes, and learning remain outside the product scope. Only installed compatible models are selected between host sessions.

### 1.1 Independent development contract

Pin a released schema/fixture artifact and develop against synthetic backend clients, saved captures, and golden tensors. Standalone tests may invoke native primitives only against controlled test applications; this does not provide a production route around host supervision. End-to-end W-1 and packaged-app permission/stop acceptance require the matching AiFetchly build.

The host and Hub consume artifacts by immutable version and digest, not a checkout of a moving branch. A breaking schema change requires a new contract version and coordinated host support; additive optional fields need tolerant-reader and negative-fixture tests before declaring compatibility. Each release records supported app versions and schema/adapter identities. Do not infer compatibility solely from a plugin version number.

## 2. Repository layout

```text
aifetchly-computer-use/
├── plugin/                        # Manifest, skills, tool descriptions
├── contracts/                     # Versioned JSON Schemas + fixtures shared with the host
│   ├── tools/
│   ├── desktop/                  # Backend capabilities, observations, atomic input, errors
│   ├── grounding/                # Model capabilities, lifecycle, requests/results, compatibility
│   ├── models/                   # Model file-set manifests and compatibility fixtures
│   ├── traces/
│   └── fixtures/transforms/       # Golden geometry cases consumed by host tests
├── adapters/
│   ├── windows/                   # Windows-MCP pin, tool allowlist, launch profile, lock generation
│   └── macos/                     # Backend chosen by spike; Ghost candidate layout below
│       └── ghost-os/
│           ├── upstream.lock      # Exact source commit, dependency pins, toolchain identity
│           ├── patches/           # Reproducible AiFetchly patch set (or lock to a maintained fork)
│           └── tool-allowlist.json # Reviewed backend surface; host also enforces it
├── grounding/
│   ├── reference/                 # PyTorch reference runner (CI and developer machines only)
│   ├── export/                    # PyTorch → ONNX export, quantization, manifest generation
│   ├── parity/                    # Stage-by-stage golden tensors and tolerance checks
│   └── fixtures/                  # Per-model preprocessing, output, absence/ambiguity cases
├── eval/                          # Benchmark datasets metadata, evaluate/replay CLI
├── packaging/
│   ├── windows/
│   └── macos/                     # Build, sign, notarize, archive, checksums, Hub metadata
├── tests/
└── THIRD_PARTY_NOTICES            # Code and model licences, including base-model chains
```

For grounding, PyTorch and Python are used only in CI and on developer machines to export and verify models; customer machines receive ONNX files. The separate Windows-MCP backend still uses managed Python. Do not commit weights, Python distributions, virtualenvs, caches, credentials, or customer traces.

The host and this repository share **schemas and fixtures, not code**. The host consumer generates TypeScript types from or validates them against these JSON Schemas, and host transform tests consume `contracts/fixtures/transforms`.

Executable grounding adapters, including model-specific preprocessing and output decoding, ship in the AiFetchly worker. They are not dynamically imported from this repository or a downloaded model package. Moving them into a shared executable package would require a separate revision of this boundary. The Ghost source/fork is different: it is compiled into the separately versioned native desktop helper and delivered through the Hub.

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

## 4. Windows backend

- Pin a Windows-MCP revision (MIT, actively maintained). The observed docs require Python 3.13+; it is the only Python component in the system.
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

Host requirements remain canonical in the AiFetchly PRD. Plugin contributions support CU-INST-01–10/12–18 through metadata/artifact closure; CU-SESSION-03–06/10–13 and CU-PERM through backend boundaries and dispatch evidence; CU-VISION through contracts/model fixtures; CU-MAC-02/04–05 through native interfaces; and CU-DEBUG through trace/evaluation schemas. These dependencies do not move host implementation into this repository.

## 11. Open decisions

Plugin-owned: Mac backend winner; Windows-MCP extension versus pinned fork and managed uv versus prebuilt Python artifacts; default model quantization/export configuration, opset and provider evidence; absence/ambiguity calibration; any future model licence clearance. Coordinate model hosting, schema/fixture versions, host adapter identities, runtime compatibility, reference hardware and release sequencing with AiFetchly and the Hub.

Host-owned choices such as stop hotkey, planner providers/image crop policy, UI retention defaults and final integrated SLOs remain in the [AiFetchly design](computer-use-aifetchly-technical-design.md#17-limitations-and-open-decisions). No producer default overrides host privacy/authorization policy.

## 12. References

Upstream links refer to moving branches; pin exact revisions when implementing. The Ghost OS repository, developer guide, and tool guide were rechecked on 2026-09-26 for revision 1.3; these upstream capabilities still require packaged-app qualification.

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
