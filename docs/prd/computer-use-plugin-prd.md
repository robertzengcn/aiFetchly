# Computer Use Plugin Repository — Product Requirements

## Document information

| Field | Value |
| --- | --- |
| Version | 1.4 |
| Status | Proposed; repository-scoped design. No implementation is claimed |
| Date | 2026-09-26 |
| Implementation owner | `aifetchly-computer-use` |
| Companion document | [Technical design](computer-use-plugin-technical-design.md) |
| Distribution dependency | `aifetchly-hub-go`; separate Hub work, not owned by either implementation repository |

### Document set and revision

| Repository | Product requirements | Technical design |
| --- | --- | --- |
| `aiFetchly` | [AiFetchly PRD](computer-use-aifetchly-prd.md) | [AiFetchly technical design](computer-use-aifetchly-technical-design.md) |
| `aifetchly-computer-use` | [Plugin PRD](computer-use-plugin-prd.md) | [Plugin technical design](computer-use-plugin-technical-design.md) |

Version 1.4 splits the version 1.3 combined documents by repository responsibility. Existing product decisions, W-1, model selection, delivery channels, and release gates remain in force. The plugin repository is proposed; these documents do not create it. The plugin pair can be copied into its `docs/prd/` when it is initialized; sibling links here describe the current review set and must be replaced by pinned cross-repository links on transfer.

## 1. Product summary

Build the first-party Computer Use plugin artifacts consumed by AiFetchly: desktop backends, versioned contracts, model exports, test fixtures, evaluation tools, and reproducible release metadata. One plugin identity serves Windows first and Apple Silicon macOS later. Users install through AiFetchly and need no developer tools.

AiFetchly owns the planner, session supervisor, action grants, desktop lease, stop hotkey/control strip, coordinate conversion, executable grounding-model adapters, local runtime installation, persistence, and UI. This repository supplies the inputs to those systems; it does not implement a second agent loop or an application UI. Backend input is reachable only through host-supervised calls.

## 2. Scope, consumers, and boundaries

### 2.1 Deliverables

- Plugin manifest, skill/tool descriptions, target compatibility declarations, and notices.
- Versioned public-tool, desktop-backend, grounding, trace, and model-package schemas with positive/negative conformance fixtures. Shared artifacts contain schemas/data, not dynamically loaded host code.
- Windows-MCP pin, reviewed tool subset, integrity/window-at-point support, dependency locks, build/provision metadata, and native tests.
- Phase 0 macOS backend comparison and, if selected, a maintained Ghost OS fork/patch set, signed/notarized native helper, and tested packaging.
- GUI-Actor reference/export/parity pipeline and immutable ONNX model file sets; future model configurations only after qualification.
- Synthetic Excel W-1 workbooks, labeled screenshot fixtures, geometry cases, evaluation/replay CLI, and evidence reports.

### 2.2 Consumer and distribution boundaries

| Owner | Responsibility | This repository supplies or consumes |
| --- | --- | --- |
| Plugin | Schemas, desktop backend artifacts, model exports, fixtures, producer tests | Own build/test/release pipelines |
| AiFetchly | MCP client, host tool implementation, supervisor, grounding worker/adapters, UI, local AI runtime manager | Consume host-supported contract/adapter/runtime identities; supply compatible artifacts and fixtures |
| Hub | Listing, immutable install plans, platform resolution, managed native/Python resources | Supply plugin/backend metadata; require compatible install-plan support |

Executable grounding adapters stay in AiFetchly, under `src/childprocess/computer-use/`. Publishing a new model architecture cannot inject executable code into the host; it needs a coordinated app release when the host does not already implement it. The plugin owns model exports and the common grounding contract.

### 2.3 Non-goals

- Host frontend components, IPC handlers, database entities, local runtime downloader, or the Electron worker implementation.
- A planner, unrestricted whole-task tool, autonomous recipe engine, authorization service, or remote grounding endpoint.
- Model weights/native executables inside the small common plugin code ZIP, or ONNX/model delivery through Hub managed resources.
- Customer installation of compilers, Homebrew, global Python/uv, PyTorch, CUDA toolkits, or MLX; developer/CI tools are allowed.
- Arbitrary plugin-supplied grounding code, universal app support, concurrent desktop owners, or secure-desktop/privilege bypass.

## 3. Functional requirements

Requirement IDs retained from version 1.3 have one canonical owner: CU-INST-11, CU-MAC-01, and CU-MAC-03 live here. Other original CU requirements remain in the AiFetchly PRD; plugin outputs support them through the acceptance mapping below. CU-PLUGIN IDs describe additional repository deliverables.

### 3.1 Contracts and compatibility

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-PLUGIN-01 | Publish versioned schemas and conformance fixtures independently of backend releases | Public tools, desktop capabilities/observations/actions/errors, grounding lifecycle/results, model packages, and traces have immutable versions and positive/negative fixtures; host can consume them without starting a backend |
| CU-PLUGIN-02 | Preserve the host authority boundary | No raw backend tool is advertised as a planner tool; schemas cannot mint grants or accept model-supplied approval; examples use host target handles for public actions |
| CU-PLUGIN-03 | Support swappable local grounding models through one contract | Capabilities, load/ground/cancel/unload, IDs, image dimensions/crops, transforms, candidate geometry, model-specific scores, typed failures, and complete configuration identity are specified; point-only output without a heatmap is covered |
| CU-PLUGIN-04 | Bind releases to compatible host and artifact versions | Release metadata pins contract/schema versions, supported app versions, backend/model revisions, adapter/processing identities, and hashes; unsupported combinations fail conformance and cannot be marked qualified |

### 3.2 Desktop backends

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-PLUGIN-05 | Package a pinned Windows-MCP backend with a minimal reviewed surface | Accessibility, capture, focus, input and keys work via persistent stdio MCP; shell, registry, broad filesystem/process tools, and telemetry are disabled or unreachable; full dependency lock and notices accompany the artifact |
| CU-PLUGIN-06 | Supply native facts required for host validation | Windows integrity and window-at-point tools plus capture/window/display/foreground metadata return typed units and ownership; unknown/malformed data fail explicitly; geometry and CJK input pass native fixtures |
| CU-PLUGIN-07 | Keep native actions bounded and stoppable | Backend tests cover long input, drag, timeout, held-key/button cleanup, and monotonic dispatch timestamps; no hidden retries, target reselection, or workflow execution escapes a host-authorized atomic call |
| CU-PLUGIN-08 | Resolve the Mac backend through evidence | A time-boxed Ghost fork versus in-house Swift helper report covers AX coverage, CJK, geometry, signing/notarization, cancellation, binary size, and maintenance; select before Phase 3 |
| CU-MAC-01 | Deliver the selected backend as a managed native helper | If Ghost OS wins the spike, plugin CI builds from pinned source and dependencies, retains notices, signs/notarizes, and publishes a verified Hub native component; no customer developer tools or upstream setup wizard |
| CU-MAC-03 | Route every visual lookup through the selected host grounder | In the Ghost fork, explicit vision tools and implicit action fallback cannot start or contact a vision sidecar; recipes and learning tools are disabled |

### 3.3 Models, fixtures, and evaluation

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-INST-11 | Ship only models whose licence chain permits commercial distribution | Release tooling records base-model and fine-tune licences; a non-commercial licence blocks publication |
| CU-PLUGIN-09 | Export the default model as reproducible ONNX artifacts | Exact upstream revision, export toolchain/opset, quantization, tokenizer/preprocessing, graph interfaces, processing/calibration revisions, supported providers, licence chain, and file hashes are recorded; stage-by-stage parity passes before publication |
| CU-PLUGIN-10 | Publish compatible model file sets separately from plugin code | Shards, manifest, health fixture, notices, sizes, immutable URLs and hashes satisfy the host catalog/model package contract; no startup download or executable adapter in the model package |
| CU-PLUGIN-11 | Maintain synthetic/consented regression and held-out evaluation data | W-1 workbooks, absence/ambiguity, distractors, crops, CJK/themes, scaling, and geometry cases are versioned; customer evidence enters fixtures only after review and sanitization |
| CU-PLUGIN-12 | Provide locate-only/offline evaluation and reproducible reports | Replay never starts a desktop backend or sends input; reports identify every artifact/configuration, region hits, absence errors, latency/memory, and comparison arm; missing versions fail rather than substitute |

### 3.4 Distribution and handoff

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-PLUGIN-13 | Build platform-specific artifacts for managed delivery | Windows resources are excluded from Mac packages and vice versa; native executable permissions, signatures and hashes survive extraction; Hub prerequisites and local-runtime model delivery are separate |
| CU-PLUGIN-14 | Deliver a reviewable compatibility release to host and Hub consumers | Include artifact manifest, schema/fixture version, pins/locks, licence notices, parity/backend reports, upgrade notes, and consumer test results; a plugin release does not claim full-product acceptance without AiFetchly integration evidence |

## 4. Workflow qualification: W-1 Excel lead list

The product workflow is owned by the [AiFetchly PRD](computer-use-aifetchly-prd.md#31-target-workflow). The plugin must support its observation and input primitives and supply its benchmark fixtures. It does not implement lead-column planning, clipboard ownership, approval policy, or task history.

The initial matrix is Microsoft 365 Apps for Windows Current Channel and Excel 2021, English and Simplified Chinese, local or desktop-open OneDrive/SharePoint `.xlsx`, up to 500 rows and 15 columns on one sheet. Mac workflow claims require separate qualification.

- Read the header, bounded used/visible range, active cell, selection, sheet tabs, cell values, and required ribbon controls via UI Automation; do not replace cell read-back with OCR.
- Provide input primitives for Text formatting, paste, header/table/filter formatting, autofit, and duplicate-email highlighting. Host owns destination checks, TSV/formula escaping, clipboard text restoration, and authorization.
- Provide fixtures for existing/empty/reordered/ambiguous headers, CJK, leading zeros, long IDs, duplicates, formula-like strings, protected/read-only workbooks, and 20/200/500-row runs.
- Treat Save, Share, Close, Delete, Remove Duplicates, Protected View, sign-in, and co-authoring conflicts according to the host's handoff/authorization behavior; no backend recipe may cross these boundaries.

Plugin backend/export checks run independently with synthetic windows, schemas, and saved images. End-to-end W-1 acceptance is jointly executed with the host and remains governed by the host PRD's safety and success gates.

## 5. Models and platform qualification

| Model | Base model and licence chain | ScreenSpot-Pro (published, without verifier) | Status |
| --- | --- | --- | --- |
| GUI-Actor-2B | Qwen2-VL-2B-Instruct (Apache-2.0) → GUI-Actor weights (MIT) | 36.7% | **Default**, subject to ONNX export parity and native benchmark |
| GUI-Actor-3B | Qwen2.5-VL-3B-Instruct (**Qwen Research License, non-commercial**) → GUI-Actor weights (MIT) | 42.2% | **Blocked** until a commercial licence from Alibaba Cloud is obtained or legal review clears use |
| GUI-Actor-7B (Qwen2.5-VL) | Qwen2.5-VL-7B-Instruct (Apache-2.0) → MIT | 44.6% | Optional future tier for high-memory machines, after measurement |
| GUI-Actor-Verifier-2B | UI-TARS-2B-SFT → MIT | Adds ~5 points to 2B in published results | Future candidate; licence chain to confirm |
| ShowUI-2B | Qwen2-VL-2B → Apache-2.0 | Single digits in the ScreenSpot-Pro paper | Replaced; kept only as a benchmark comparison |

Published scores come from the model authors and are not AiFetchly measurements. Release decisions use the repository's fixtures and the [integrated AiFetchly acceptance gates](computer-use-aifetchly-prd.md#8-quality-and-release-acceptance).

GUI-Actor ranks candidate regions by attention; it has no built-in "target absent" answer. Absence handling therefore needs calibrated thresholds, accessibility cross-checks, or the visual planner (host CU-VISION-11).



Initial production inference uses ONNX Runtime; PyTorch is reference/export tooling on developer machines and CI only. GUI-Actor is the default, not a fixed public-tool dependency. A second test adapter demonstrates contract interchangeability; a second production grounder is not required for Phase 2. Every new production model needs independent licence, export, absence/ambiguity, resource, native accuracy, and cancellation qualification. Scores and thresholds are model-specific; attention heatmaps are optional.

Windows 10/11 x64 ships first; Apple Silicon macOS follows in Phase 3. If Ghost OS is selected, the inspected upstream requires macOS 14+ and Swift 6.2+ for source builds. Windows ARM, Intel Mac, Linux, mixed-DPI/multi-display control, larger grounders, verifiers, and offline bundles require later independent gates. DirectML/CPU and CoreML/CPU are measured with the host runtime; model file size is not peak memory.

## 6. Acceptance and evidence

- Schemas and fixtures pass producer conformance and the host consumer suite at the same pinned version; mismatched or malformed contracts fail closed.
- Native backends pass tool allowlist, protocol, CJK, window ownership, scale/crop, freshness metadata, bounded-action, and stop/cleanup tests.
- Ghost, if selected, never starts or contacts its vision sidecar after AX/action failure; recipes/learning are unreachable. Signed packaged-app permission and cancellation acceptance is jointly verified with AiFetchly.
- Model exports pass recorded per-stage tolerances and final region-hit agreement. Absent/ambiguous targets and invalid output cannot produce an accepted click in host integration.
- Artifact closure, hashes, licences, platform resources, executable permissions, signatures/notarization, and upgrade compatibility are verified before release.
- Offline replay cannot execute desktop input. Comparisons use identical evidence and report region hits/latency/memory rather than equating raw scores across models.

The [host quality targets](computer-use-aifetchly-prd.md#8-quality-and-release-acceptance) remain provisional until measured. Backend observation and dispatch timings and model reports feed that harness; this repository does not independently redefine the ≤250 ms stop acknowledgment, no-input-after-stop invariant, inference budgets, or W-1 success targets.

## 7. Repository rollout and dependencies

| Phase | Plugin-owned work | Host/Hub dependency and exit |
| --- | --- | --- |
| 0 | Repository skeleton, schema/fixture release, Windows pin and integrity prototype, export/parity/provider spike, Mac comparison, W-1 benchmark | Agree contract and package interfaces with AiFetchly; report limitations and default configuration; host MCP SDK work ships independently |
| 1 | Windows backend package/lock, minimal tool surface, native conformance and Excel fixtures | Host supervisor/safety/UI plus Hub environment delivery pass W-1 accessibility integration |
| 2 | Qualified GUI-Actor file set, processing/calibration metadata, reference/parity/replay tooling, grounding contract fixtures | Host catalog v2, ONNX binding, built-in adapter/selector consume the release and pass local-vision integration |
| 3 | Chosen Mac helper; Ghost patches if selected; CI signing/notarization and target package | Hub native-component resolution plus host permissions/geometry/stop acceptance |
| 4 | Upgrade, repair/reinstall artifact evidence, support matrix, reproducible release reports | Joint clean-machine matrix and published measured SLOs |
| 5 | Qualified larger models/verifier, multi-display backend metadata, offline artifact bundles | Separate host/Hub feature support and qualification per item |

A failed model export delays vision, not the Windows accessibility slice. A plugin artifact release is independent of host code releases but usable only within its declared compatibility range. No backend/model replacement occurs during an active host session.

## 8. Risks and open producer decisions

- Export parity, operator support, memory, and cold-start latency may disqualify a model configuration; Phase 0 measurements choose the default or another exportable grounder.
- A fine-tune licence does not override its base model. GUI-Actor-3B remains blocked until its licence chain is cleared for commercial distribution.
- Ghost maintenance and synchronous input cancellation may require patches large enough to favor the in-house helper. Keep the choice open until the spike reports evidence.
- Decide Windows delivery as managed uv locks versus a prebuilt embeddable-Python artifact together with the host installer consumer; do not mix lock formats.
- Decide immutable model hosting together with the host runtime release pipeline. The host catalog is the install authority regardless of where files are hosted.
- Agree schema compatibility, default quantization/pixel budget, model-specific calibration, reference hardware, and release manifest identities with the host before publishing.

## 9. Sources and related documents

This split preserves the upstream research dates from version 1.3: general sources inspected 2026-09-23; Ghost repository/developer/tool guides rechecked 2026-09-26. No fresh upstream qualification or implementation is claimed. Exact revisions must be pinned for development.

- [Plugin technical design](computer-use-plugin-technical-design.md), [AiFetchly PRD](computer-use-aifetchly-prd.md), [AiFetchly technical design](computer-use-aifetchly-technical-design.md).
- [Windows-MCP](https://github.com/CursorTouch/Windows-MCP), [Ghost OS](https://github.com/ghostwright/ghost-os), [Ghost developer guide](https://github.com/ghostwright/ghost-os/blob/main/CLAUDE.md), [Ghost tool guide](https://github.com/ghostwright/ghost-os/blob/main/GHOST-MCP.md).
- [GUI-Actor](https://github.com/microsoft/GUI-Actor), [GUI-Actor-2B](https://huggingface.co/microsoft/GUI-Actor-2B-Qwen2-VL), [Qwen2.5-VL-3B licence](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/blob/main/LICENSE), [ScreenSpot-Pro](https://github.com/likaixin2000/ScreenSpot-Pro-GUI-Grounding).
- Hub install-plan/native-resource changes are external dependencies in `aifetchly-hub-go`, not plugin runtime code.
