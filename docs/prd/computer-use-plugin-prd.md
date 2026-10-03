# Computer Use Plugin Repository — Product Requirements

## Document information

| Field | Value |
| --- | --- |
| Version | 1.5 |
| Status | Proposed; repository-scoped design. No implementation is claimed |
| Date | 2026-09-27 |
| Implementation owner | `aifetchly-computer-use` |
| Language decision | TypeScript for repository tooling; Python for Windows backend extensions and model engineering; Swift for the Mac helper; JSON Schema for shared contracts |
| Companion document | [Technical design](computer-use-plugin-technical-design.md) |
| Distribution dependency | `aifetchly-hub-go`; separate Hub work, not owned by either implementation repository |

### Document set and revision

| Repository | Product requirements | Technical design |
| --- | --- | --- |
| `aiFetchly` | [AiFetchly PRD](computer-use-aifetchly-prd.md) | [AiFetchly technical design](computer-use-aifetchly-technical-design.md) |
| `aifetchly-computer-use` | [Plugin PRD](computer-use-plugin-prd.md) | [Plugin technical design](computer-use-plugin-technical-design.md) |

Version 1.4 splits the version 1.3 combined documents by repository responsibility. Existing product decisions, W-1, model selection, delivery channels, and release gates remain in force. The plugin repository is proposed; these documents do not create it. The plugin pair can be copied into its `docs/prd/` when it is initialized; sibling links here describe the current review set and must be replaced by pinned cross-repository links on transfer.

Revision 1.5 makes the language/toolchain decision explicit and adds developer workflows, deliverable acceptance, failure cases, CI gates, and executable work packages. Commands and modules in the technical design are implementation requirements for the future repository, not claims that they exist today. The AiFetchly pair remains version 1.4; its host responsibilities are unchanged by these producer details.

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

### 2.4 Language and runtime decision

**Use TypeScript as the primary repository language, with Python and Swift for their specific components.** A single repository does not require one language for every artifact.

| Component | Language / format | Why | Runs on customer machines? |
| --- | --- | --- | --- |
| Contract validation, fixture checks, release-manifest generation, packaging orchestration, evaluation CLI/reporting | TypeScript on Node.js | Fits AiFetchly's TypeScript contracts and keeps cross-platform developer tooling together | These tools are developer/CI programs; they do not add a Node service to the plugin |
| Shared contracts and fixtures | JSON Schema and JSON; Markdown for skills/docs | Python, Swift, TypeScript and the Hub can consume a language-neutral boundary | Schemas/data are consumed by the host; no executable adapter is loaded from them |
| Windows-MCP integration, integrity/window metadata, backend patches | Python | Extend the existing backend in its own language | Yes, only inside the host-managed Windows environment |
| Model reference runner, export, quantization and parity | Python with the pinned model engineering stack | Works with the upstream model implementation and ONNX export pipeline | No; customers receive the resulting ONNX/data files |
| Ghost OS fork or in-house native Mac helper | Swift | Reuses Ghost's implementation and native macOS APIs | Yes, as a compiled, signed native executable |
| Small platform build/signing wrappers | PowerShell on Windows; shell on macOS | Invoke OS packaging tools | Build/release only |

There is no TypeScript MCP gateway, plugin-owned Electron application, new Go service, or additional runtime model server. AiFetchly's TypeScript inference adapter stays in the host. The TypeScript evaluation CLI can invoke a Python reference/export runner on a developer machine; this is not a production inference path.

Keep two independent Python environments: one pinned to the selected Windows-MCP revision, one pinned for model engineering. Do not ship the model engineering environment with Windows-MCP. On 2026-09-27, upstream Windows-MCP's `pyproject.toml` declares Python `>=3.14`; the selected immutable backend revision, rather than an assumed common Python version, determines the shipped interpreter. Ghost's inspected package requires Swift tools 6.2 and macOS 14. See the [toolchain policy](computer-use-plugin-technical-design.md#12-language-and-toolchain-policy) for pinning and validation.

### 2.5 Developer and maintainer workflows

| User | Workflow | Successful outcome |
| --- | --- | --- |
| Contract developer on Windows, macOS, or Linux | Install the Node toolchain, validate schemas and fixtures, run default tests | Works without a GPU, native desktop access, model weights, or either Python environment |
| Windows backend developer | Prepare the pinned backend environment, run adapter unit tests, then opt into native tests against a controlled window | Can inspect AX/capture/input results and stop the test; native failures identify a test case and backend revision |
| Model engineer | Fetch approved weights separately, create a locked model environment, export one configuration, run parity and held-out evaluation | Produces a candidate model file set plus an evidence report; no artifact becomes qualified merely because export succeeded |
| Mac maintainer | Reproduce the selected helper build, run Swift/native tests, and prepare signing/notarization on release CI | Produces a native component with permission/cancellation evidence and stable signing identity |
| Release maintainer | Assemble immutable artifacts and a compatibility manifest, verify them, then hand them to host/Hub consumers | Every claimed platform/model combination links to passing producer and consumer evidence |

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

### 3.5 Developer experience and release completeness

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-PLUGIN-15 | Enforce the language and toolchain boundaries | Node dependencies, Windows Python, model Python, and Swift each have exact recorded versions/locks; no export dependency or TypeScript tooling runtime is included in a customer backend package |
| CU-PLUGIN-16 | Provide a lightweight, documented default workflow | A clean checkout with the pinned Node toolchain can validate contracts, lint/typecheck, and run unit tests without desktop input or model downloads; generated outputs are reproducible and ignored as appropriate |
| CU-PLUGIN-17 | Make backend lifecycle and failure behavior testable | Startup, readiness, bounded requests, disconnect, cancellation, and shutdown have contract cases; an action whose outcome is unknown is never automatically repeated |
| CU-PLUGIN-18 | Use one authoritative contract source across languages | JSON Schema is canonical; generated types and Python/Swift encoders are checked against the same fixtures, including invalid enum, unknown required capability, unsafe numeric geometry, and incompatible version cases |
| CU-PLUGIN-19 | Produce structured evaluation results | Every case records dataset split/revision, fixture hash, configuration identity, expected/actual geometry, timings, and explicit pass/fail/skipped reason; an empty or skipped required suite cannot pass a release gate |
| CU-PLUGIN-20 | Separate CI checks from native qualification | Ordinary PR checks use fixtures; interactive Windows/Mac and GPU qualification run only on suitable runners and are required for affected release targets; missing hardware evidence is shown as unqualified |
| CU-PLUGIN-21 | Version and verify the complete release closure | Manifests enumerate artifact roles, target/launch profile, hashes/sizes, schema/model/backend pins and evidence; a mismatched pin, missing report or wrong-platform file blocks publication/qualification |
| CU-PLUGIN-22 | Provide reproducible implementation work packages | Each phase lists owned paths, dependencies, test commands, outputs, and a completion criterion; the host/Hub handoff identifies an exact artifact version and digest |

## 4. Workflow qualification: W-1 Excel lead list

The product workflow is owned by the [AiFetchly PRD](computer-use-aifetchly-prd.md#31-target-workflow). The plugin must support its observation and input primitives and supply its benchmark fixtures. It does not implement lead-column planning, clipboard ownership, approval policy, or task history.

The initial matrix is Microsoft 365 Apps for Windows Current Channel and Excel 2021, English and Simplified Chinese, local or desktop-open OneDrive/SharePoint `.xlsx`, up to 500 rows and 15 columns on one sheet. Mac workflow claims require separate qualification.

- Read the header, bounded used/visible range, active cell, selection, sheet tabs, cell values, and required ribbon controls via UI Automation; do not replace cell read-back with OCR.
- Provide input primitives for Text formatting, paste, header/table/filter formatting, autofit, and duplicate-email highlighting. Host owns destination checks, TSV/formula escaping, clipboard text restoration, and authorization.
- Provide fixtures for existing/empty/reordered/ambiguous headers, CJK, leading zeros, long IDs, duplicates, formula-like strings, protected/read-only workbooks, and 20/200/500-row runs.
- Treat Save, Share, Close, Delete, Remove Duplicates, Protected View, sign-in, and co-authoring conflicts according to the host's handoff/authorization behavior; no backend recipe may cross these boundaries.

Plugin backend/export checks run independently with synthetic windows, schemas, and saved images. End-to-end W-1 acceptance is jointly executed with the host and remains governed by the host PRD's safety and success gates.

### 4.1 Minimum fixture set and expected behavior

| Fixture family | Required variants | Producer evidence |
| --- | --- | --- |
| Workbook layout | Empty template, populated sheet, reordered headers, unmatched field, duplicate header | Bounded observed headers/selection/cell values and deterministic expected workbook data; ambiguous mapping is left to the host |
| Data preservation | Leading-zero phone/postal/ID, long ID, CJK name, duplicate email, formula-like prefix | Synthetic input and expected displayed/cell values after the host's Text formatting and escaping |
| Vision | Full/collapsed ribbon, filter arrows, gallery swatches, repeated labels, hidden/absent control | Capture dimensions, expected clickable region or absence label, scaling/theme and crop metadata |
| Native state change | Window moved/closed, foreground changed, own window at target, elevated/unknown-integrity target | Old geometry or ownership is rejected; no retargeting to a similarly named window |
| Handoff | Protected View, read-only/protected sheet, IME composition, sign-in or co-authoring conflict | Observable state/error for the host to pause or hand off; no attempt to bypass the condition |

Use 20-, 200-, and 500-row datasets and both English and Simplified Chinese Excel UI for the initial workflow. Fixture manifests enumerate the actual case count and missing matrix cells. Plugin-side benchmark comparison checks the expected output workbook/cells independently of the host's sampled live verification, so a mismatch outside that sample still fails the benchmark. This fixture oracle does not introduce direct workbook writes into the production workflow.

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

### 6.1 Failure acceptance

| Trigger | Required result | Forbidden recovery |
| --- | --- | --- |
| Unsupported contract or backend build | Fail readiness with compatibility evidence | Pretend the closest version is compatible |
| Permission denied, desktop locked, target gone | Typed state/error and host handoff/re-observation | Start an elevated process, interact with a permission dialog, or guess a target |
| AX lookup fails | Unresolved target returns to the host | Call Ghost's own vision sidecar or execute a recipe |
| Invalid crop/coordinate or stale observation | Reject before input | Clamp a guessed click into the window |
| MCP connection lost during input | Report uncertain execution where dispatch cannot be ruled out | Retry typing/clicking on reconnect |
| Stop while a native action is running | Stop further backend dispatch, release held input where possible, support host termination and timestamps | Wait indefinitely for inference/another MCP request to finish |
| Model missing, export/parity divergence, unsupported operator | Mark configuration unqualified with the failing stage | Substitute another model/provider without reporting it |
| Required native/GPU job did not run | Report missing qualification | Count the skipped run as a pass |

### 6.2 Definition of a complete deliverable

Every work package includes its source/configuration, positive and negative tests, schema/fixture changes when applicable, documented local command, and machine-readable result. Every release candidate additionally includes immutable artifacts, licence notices, toolchain/source provenance, supported compatibility tuples, and unresolved limitations. Native binaries are accepted only on their qualified OS/architecture; a passing cross-platform TypeScript suite is insufficient. Product-ready status requires the matching host integration report.

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

### 7.1 Implementation order

1. **P0-A — Repository and contracts:** bootstrap the TypeScript toolchain and independent Python/Swift project boundaries; add canonical schemas, fixture validation and fake transports. Deliver an immutable schema/fixture candidate that AiFetchly can consume immediately.
2. **P0-B — Backend and model spikes:** in bounded work packages, qualify the Windows pin/integrity metadata, export the default model, and compare the Mac candidates. Publish evidence and choose packaging/configuration; failed experiments remain reports, not supported targets.
3. **P1 — Windows backend release:** implement the reviewed atomic surface, lifecycle/failure tests, W-1 observations/fixtures, and platform artifact closure. Complete host accessibility integration before claiming an input-capable release.
4. **P2 — Model and evaluation release:** freeze the qualified model configuration, data/calibration splits, parity tolerances, replay/report formats and file-set manifest. Hand off to the host's built-in adapter/catalog tests.
5. **P3 — Mac backend release:** implement the spike winner, permission diagnostics, bounded input/capture, source packaging and signing/notarization. Complete signed-host native acceptance.
6. **P4 — Release operations:** verify upgrades, failed candidate recovery, artifact reuse, support matrix and compatibility reports. Publish GA only for combinations with complete evidence.

The [technical work-package table](computer-use-plugin-technical-design.md#91-implementation-work-packages) specifies paths, commands and exit criteria. Phases 1 and 2 have independent deliverables; model engineering never blocks development of the accessibility backend.

## 8. Risks and open producer decisions

- Export parity, operator support, memory, and cold-start latency may disqualify a model configuration; Phase 0 measurements choose the default or another exportable grounder.
- A fine-tune licence does not override its base model. GUI-Actor-3B remains blocked until its licence chain is cleared for commercial distribution.
- Ghost maintenance and synchronous input cancellation may require patches large enough to favor the in-house helper. Keep the choice open until the spike reports evidence.
- Decide Windows delivery as managed uv locks versus a prebuilt embeddable-Python artifact together with the host installer consumer; do not mix lock formats.
- Decide immutable model hosting together with the host runtime release pipeline. The host catalog is the install authority regardless of where files are hosted.
- Agree schema compatibility, default quantization/pixel budget, model-specific calibration, reference hardware, and release manifest identities with the host before publishing.

## 9. Sources and related documents

This split preserves the upstream research dates from version 1.3: general sources inspected 2026-09-23; Ghost repository/developer/tool guides rechecked 2026-09-26. No fresh upstream qualification or implementation is claimed. Exact revisions must be pinned for development.

For revision 1.5, the [Windows-MCP Python project](https://github.com/CursorTouch/Windows-MCP/blob/main/pyproject.toml) and [Ghost OS Swift package](https://github.com/ghostwright/ghost-os/blob/main/Package.swift) were checked on 2026-09-27 to establish the toolchain boundaries. Exact production pins are still chosen and tested in Phase 0.

- [Plugin technical design](computer-use-plugin-technical-design.md), [AiFetchly PRD](computer-use-aifetchly-prd.md), [AiFetchly technical design](computer-use-aifetchly-technical-design.md).
- [Windows-MCP](https://github.com/CursorTouch/Windows-MCP), [Ghost OS](https://github.com/ghostwright/ghost-os), [Ghost developer guide](https://github.com/ghostwright/ghost-os/blob/main/CLAUDE.md), [Ghost tool guide](https://github.com/ghostwright/ghost-os/blob/main/GHOST-MCP.md).
- [GUI-Actor](https://github.com/microsoft/GUI-Actor), [GUI-Actor-2B](https://huggingface.co/microsoft/GUI-Actor-2B-Qwen2-VL), [Qwen2.5-VL-3B licence](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/blob/main/LICENSE), [ScreenSpot-Pro](https://github.com/likaixin2000/ScreenSpot-Pro-GUI-Grounding).
- Hub install-plan/native-resource changes are external dependencies in `aifetchly-hub-go`, not plugin runtime code.
