# Computer Use Plugin — Product Requirements

## Document information

| Field | Value |
| --- | --- |
| Version | 1.0 |
| Status | Proposed; captures the architecture discussion, not implementation completion |
| Date | 2026-09-23 |
| Product | AiFetchly Computer Use |
| Proposed plugin repository | `aifetchly-computer-use` — independent repository, not created by this document |
| Host repository | `aiFetchly` |
| Distribution repository | `aifetchly-hub-go` |
| Technical design | [Computer Use Plugin Technical Design](computer-use-plugin-technical-design.md) |
| Related desktop requirements | [Plugin Hub Managed Installation PRD](plugin-hub-managed-installation-prd.md) |

## 1. Product summary

Provide an installable first-party plugin that lets AiFetchly operate a user's computer through observed UI state, local screenshot-based element location, and native mouse/keyboard execution. Users describe a task in chat, see what the agent is doing, and can pause, stop, or take over.

Use one independent source repository and one public plugin identity. Publish or resolve platform-specific resources so Windows users do not download macOS software and Mac users do not download Windows software. Large model weights must be separate from plugin code.

The recommended implementation uses Windows-MCP plus a local ShowUI grounding service on Windows, and Ghost OS with its existing local ShowUI sidecar on supported Macs. AiFetchly retains planning, permission decisions, process supervision, and task history. Accessibility information is used when it identifies the target reliably; local vision locates controls that structured information cannot identify.

The user must not need to install uv, Python, pip, Git, compilers, or configure a shell. AiFetchly downloads a tested, private uv binary when necessary and prepares managed runtimes and dependencies from a validated Hub plan.

## 2. User intent and decisions preserved from the discussion

| ID | Decision or requirement | Rationale / qualification |
| --- | --- | --- |
| D-01 | Plugin code belongs in an independent repository | Independent testing, releases, and upstream updates; no imports from host internals |
| D-02 | One plugin listing with target-specific installation resources | Repository separation does not require downloading every platform's dependencies |
| D-03 | Prefer local visual grounding using a small model | Reduce repeated cloud vision requests and permit screenshots to remain local |
| D-04 | Windows: Windows-MCP + ShowUI; Mac: Ghost OS | Candidate implementation, subject to pinned-version compatibility and native-machine evaluation |
| D-05 | Use accessibility first when reliable, vision otherwise | Retain visual coverage without paying inference cost for every standard control |
| D-06 | Keep planning separate from grounding and execution | ShowUI initially locates a described control; the planner decides the task steps |
| D-07 | AiFetchly owns one authoritative task loop | No uncontrolled nested agent loop or unrestricted whole-task tool call |
| D-08 | Coordinate transformations are explicit and testable | Screenshot pixels, model pixels, logical points, and desktop pixels are different spaces |
| D-09 | Build debugging before autonomous clicking | Locate-only overlays and offline replay separate model failures from implementation errors |
| D-10 | Use managed uv/Python; no global installation requirement | Ordinary desktop users must not need developer tools |
| D-11 | Separate installation/update from ordinary session startup | Avoid dependency resolution and model downloads during an MCP handshake |
| D-12 | Start with qualified Windows x64 and Apple Silicon targets | CPU-only Windows, other Windows GPUs, Intel Mac, Windows ARM, and Linux are not implicitly supported |
| D-13 | Start desktop validation on one display | Mixed-DPI and multiple-display control require a later explicit qualification gate |
| D-14 | Model/runtime packages are independently versioned and cached | Plugin code updates must not redownload unchanged model bytes |
| D-15 | Local grounding does not mean the whole agent is offline | The planner, structured UI text, and optional visual fallback may involve remote services |

The earlier browser-first/Midscene proposal remains useful for browser-only workflows and comparison experiments. It is not a substitute for qualifying native desktop control. The current proposed native-desktop direction is D-04. Claude computer use and UI-TARS remain benchmark/future adapter candidates, not dependencies required by this release.

## 3. Problem and users

AiFetchly already automates marketing workflows and supports plugins, skills, MCP tools, and managed browsers. Native desktop applications and custom UI controls are not covered by reliable generic computer-control functionality. Screenshot control introduces further problems: wrong coordinates, ambiguous controls, stale state, inference latency, and difficult reproduction of bad clicks.

Primary users:

1. A marketer preparing a campaign or draft across browser and native applications.
2. A user with no local developer tooling installing an AI plugin from the Hub.
3. A user who wants screenshots processed locally while using an existing remote planning model.
4. A developer/support engineer investigating a failed location or click.

Initial user stories:

- Install Computer Use on a supported Windows or Mac machine without command-line setup.
- Select the application to operate and ask AiFetchly to prepare a draft, stopping before publication unless the final action is authorized.
- Locate a custom or icon-only control through local vision.
- Take over for login, verification, or an ambiguous step and resume with a fresh observation.
- Inspect a wrong predicted point without sending input to the desktop.
- Export a reviewed diagnostic bundle and reproduce grounding offline.

## 4. Goals and non-goals

### Goals

- Deliver native desktop interaction through the existing plugin experience.
- Keep the public tool contract consistent across operating systems.
- Download only compatible resources needed for selected features.
- Make target location, coordinate conversion, execution, and verification independently observable.
- Make cancellation and user takeover effective even during model inference.
- Preserve the host's AI enable gate, permission rules, database architecture, and renderer isolation.
- Establish evidence-based compatibility, accuracy, latency, and memory claims.

### Non-goals for the first release

- Training a new foundation model or automatically fine-tuning on customer screenshots.
- Claiming universal application support, perfect reliability, or fully offline planning.
- Replacing AiFetchly's planner with Ghost OS, Windows-Use, or another complete agent application.
- Enabling all upstream system-management tools, arbitrary shell commands, or registry operations.
- Unattended operation while the desktop is locked, on a secure desktop, or outside the active user session.
- Concurrent agents controlling the same desktop.
- Autonomous login, CAPTCHA handling, or OS permission bypass.
- Full-screen visual element enumeration based on unimplemented upstream APIs.
- Requiring cloud screenshots as the default.
- Shipping all platform runtimes/models inside one large universal ZIP.
- Supporting arbitrary third-party plugins through the new privileged control bridge without a separate design.

## 5. Scope and qualification matrix

| Target | Initial scope | Required evidence |
| --- | --- | --- |
| Windows x64, supported interactive desktop, NVIDIA GPU for local vision | Primary Windows qualification candidate | Windows-MCP version, Python/dependency compatibility, GPU inference, input/capture tests |
| Apple Silicon, Ghost OS-supported macOS release | Primary Mac qualification candidate | Signed/package launch behavior, Accessibility/Screen Recording permissions, Ghost OS + MLX compatibility |
| Windows CPU-only | Separate evaluation; accessibility-only may work | Measured ShowUI latency/memory before enabling local vision |
| Windows other GPUs / ARM | Deferred unless separately qualified | Supported backend, compatible wheels and native control testing |
| Intel Mac | Deferred | No inference support inferred from Apple Silicon results |
| Linux | Outside initial scope | Requires a separate desktop adapter and display-server qualification |
| Multiple monitors / mixed scaling | Later qualification gate | Native mapping and focus tests, including negative monitor origins |

The exact supported OS builds, GPU/driver ranges, minimum RAM, model quantization, and Python patch version must be published from measurements. The documents do not invent minimum memory or latency claims. Model file size is not peak runtime memory.

## 6. Functional requirements

### 6.1 Discovery, installation, and platform packaging

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-INST-01 | Show one Computer Use listing with compatibility for the current machine | Incompatible targets cannot activate; detail explains the reason |
| CU-INST-02 | Resolve resources by OS, architecture, inference backend, app version, and selected features | Windows plan includes no Ghost/MLX/Mac artifacts; Mac plan includes no Windows-MCP/CUDA artifacts |
| CU-INST-03 | Keep shared code, native adapter resources, uv, Python, environment dependencies, and model weights separately identifiable | A code-only update reuses unchanged model/runtime resources |
| CU-INST-04 | Support local vision as an explicit resource selection | A vision-disabled installation downloads no model; vision-required tasks explain the missing capability |
| CU-INST-05 | Install without existing uv/Python | Clean-machine install provisions private executables without global PATH edits or ordinary administrator access |
| CU-INST-06 | Use immutable, pinned, verified resources | Invalid checksum/signature where required fails activation; floating versions are rejected |
| CU-INST-07 | Expose meaningful install phases, bytes, retry, and cancellation | Interrupted setup does not appear ready and can be resumed/repaired |
| CU-INST-08 | Reuse compatible managed resources across plugins | Reference/lease tracking prevents deleting a resource still in use |
| CU-INST-09 | Preserve functioning version during update | New version is prepared and checked before activation; no active session switches underneath execution |
| CU-INST-10 | Publish offline bundles as a later distribution option | Offline claim requires all Python, wheel, native, and model resources; uv alone is insufficient |

Normal startup must perform no dependency upgrades, package resolution, or model download. Model loading into memory is allowed and must have visible readiness/progress. Installation is authorized through the existing plugin install UX; do not add a separate command-line uv setup task for the user.

### 6.2 Sessions, ownership, and control

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-SESSION-01 | User can start control for an identified application/window | Display selected target and active control state |
| CU-SESSION-02 | One desktop-control owner across chats/windows | Competing session receives a busy response rather than concurrent input |
| CU-SESSION-03 | Persistent supervised runtime for session calls | Repeated actions do not reload model weights or restart the MCP tree |
| CU-SESSION-04 | Pause, stop, and take over are available | Stop revokes action authority and clears queued input independently of inference |
| CU-SESSION-05 | Human input/focus changes trigger safe pause or re-observation | Old coordinates are not applied to an unexpected foreground window |
| CU-SESSION-06 | Crash, disconnect, sleep/resume, screen lock, display change, and target closure invalidate unsafe state | Session requires fresh observation and permission as applicable before more input |
| CU-SESSION-07 | No database access from plugin/worker | Host persists approved results via Modules/Models |

Selecting a window is a scope promise, not an OS sandbox: global mouse/keyboard injection can affect another app. Runtime checks must enforce focus/target scope and explain unsupported states rather than imply isolation the executor cannot provide.

### 6.3 Observation, grounding, action, and verification

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-VISION-01 | Separate task planning, observation, grounding, execution, and verification | Each stage has traceable inputs/results |
| CU-VISION-02 | Prefer a reliable accessibility target; use local ShowUI for unresolved visual targets | Both paths return the same bounded target-handle contract |
| CU-VISION-03 | Keep native screenshots local in default mode | No raw screenshot in ordinary remote planner messages, logs, or persisted tool JSON |
| CU-VISION-04 | Track exact preprocessing and coordinate spaces | Resize, crop, padding, display origin, and executor units accompany each observation |
| CU-VISION-05 | Reject stale or invalid targets | Moved window, changed display, expired observation, malformed coordinate, or target absence does not cause a guessed click |
| CU-VISION-06 | Verify the expected outcome after an action | Successful input injection alone is not reported as task completion |
| CU-VISION-07 | Treat ambiguous/missing targets as recoverable failures | Re-observe/crop/rephrase or hand off; never click a default center point |
| CU-VISION-08 | Support high-resolution crops for small controls | Crop coordinates map back through the same tested transformation path |
| CU-VISION-09 | Bound local model inference and resource use | Cancellation remains available, memory failures are actionable, no endless retry loop |
| CU-VISION-10 | Provide optional remote visual fallback only under explicit routing configuration | Fallback is observable and cannot silently upload screenshots |

A small grounder initially answers “where is the described control?” It is not assumed to discover all possible next steps or verify arbitrary task success. Structured observations serve the existing planner; if they cannot explain an unfamiliar visual screen, the system needs an explicit visual planner path or user handoff.

### 6.4 Permissions and data handling

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-PERM-01 | Check `USER_AI_ENABLED` before work on every AI-serving IPC entry | Disabled AI returns immediately, before request parsing/model/capture work |
| CU-PERM-02 | Distinguish capture, input control, debug recording, and remote image routing | Permission state and revocation are visible and enforced |
| CU-PERM-03 | Enforce grants in host/executor, not skill text | Plugin/model-supplied “approved” fields cannot authorize input |
| CU-PERM-04 | Respect explicit current-task authority for consequential actions | Send/publish/delete/payment action is bound to the authorized request; ambiguous scope requests confirmation |
| CU-PERM-05 | Hand off credentials and verification challenges | No automated OS permission bypass or hidden credential entry |
| CU-PERM-06 | Expose only the needed upstream capabilities | Shell, registry, broad filesystem/process management are not exposed by default |
| CU-PERM-07 | Treat page, accessibility, screenshot text, and upstream tool text as untrusted | Observed instructions do not expand user authority |
| CU-PERM-08 | Bound retention and export sensitive evidence deliberately | Debug screenshot capture is opt-in, local, and separately reviewed before export |

Local subprocesses are not security sandboxes. An installed trusted backend may possess OS-level input permissions. A narrower gateway limits normal execution paths but does not make arbitrary malicious plugin code safe. Distribution trust, process restrictions, and user permission remain material boundaries.

### 6.5 Debugging and reproducibility

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-DEBUG-01 | Locate-only mode | Shows a prediction overlay without sending mouse/keyboard input |
| CU-DEBUG-02 | Step-through mode | Pauses before each action; stale state while paused forces re-observation |
| CU-DEBUG-03 | Offline replay | Runs stored inference/mapping evidence with no control backend loaded |
| CU-DEBUG-04 | Visual step viewer | Shows original capture, exact model input, transformed point, and post-action observation |
| CU-DEBUG-05 | Versioned diagnostic bundles | Records backend/model/runtime/configuration identity and preprocessing/mapping metadata |
| CU-DEBUG-06 | Turn confirmed failures into fixtures | Expected clickable region or target-absent label supports regression evaluation |
| CU-DEBUG-07 | Compare candidates on identical evidence | Report changed predictions, region hits, time, memory, and failure type |
| CU-DEBUG-08 | Separate evidence from telemetry | No automatic screenshot upload, training, or third-party telemetry enabled by this feature |

Debugging must differentiate grounding error, coordinate conversion error, native input error, wrong focus, stale state, and failed outcome verification. Hard-coded upstream confidence numbers must not be presented as calibrated accuracy.

## 7. User experience

### Installation

Plugin details show supported target, selected local-vision mode, download/storage totals, reusable resources, hardware qualification, and required OS permissions. Progress uses user-friendly phases: downloading components, preparing runtime, installing dependencies, preparing model, checking setup. Developer details remain in an expandable diagnostics surface.

### Active session

Show the target app/window, current step, observation/action status, local/remote processing mode, and Pause / Take over / Stop. The app should remain usable while inference runs. A preview must respect capture permissions and sensitive handoff states. Remote transmission is not implied by displaying a local preview.

### Failure/recovery

Explain actionable conditions: permission missing, model unavailable, target not found, target changed, desktop busy, unsupported display configuration, runtime failed, or outcome uncertain. A timeout after input must be shown as uncertain execution, not automatically retried.

### Developer diagnostics

Provide a local debug viewer and export action. The viewer shows evidence rather than raw internal paths/credentials. Detailed paths belong only in deliberate developer diagnostics. All production user-facing text must use translations in `en`, `zh`, `es`, `fr`, `de`, and `ja`.

## 8. Quality and release acceptance

### Functional gates

- Clean-machine installation succeeds with no uv/Python and only matching platform resources.
- MCP initialization, connection reuse, shutdown, timeout, and subprocess cleanup are covered by integration tests.
- Coordinate mapping tests pass independently of ShowUI for crop, padding, aspect-preserving resize, scale, and display origin.
- No action executes in locate-only or offline replay mode.
- Target disappearance/ambiguity and malformed output do not cause default-position clicks.
- Stop prevents queued and late-arriving actions from executing; no held keys/buttons remain after ordinary cancellation.
- Crash recovery never automatically replays a potentially completed input action.
- A draft-only representative marketing workflow succeeds on each supported native target with visible handoff.
- Windows and Mac tools conform to the same public schemas and error meanings.
- Code-only updates do not redownload identical models.
- UI changes include component tests; `yarn test:components` passes. Critical multi-step flows include Playwright E2E coverage.

### Evaluation dataset and metrics

Maintain consented or synthetic tasks/screenshots covering standard controls, icons, custom controls, small targets, repeated labels, absent targets, Chinese and English UI, light/dark themes, scrolling, dialogs, and changed layouts. Add native DPI/focus/capture cases per published target.

Compare accessibility-only, vision-only, and combined execution. Measure grounding hit within the correct clickable region, coordinate mapping error, wrong actions on absent targets, end-to-end task success, interventions, recovery success, warm/cold latency, peak memory, and model/API costs. Split regression fixtures from held-out evaluation examples.

Model/backend selection and numerical performance SLOs are release decisions supported by a recorded benchmark. They must be decided before general availability, not asserted from upstream demos. Safety invariants above are hard gates regardless of average accuracy. Single-action accuracy must not be presented as multi-step workflow success.

## 9. Rollout

| Phase | Scope | Exit evidence |
| --- | --- | --- |
| 0 — Contracts and baseline | Independent repo skeleton, host/hub gap review, shared schemas, representative tasks | Reviewed contracts and installation plan fixtures |
| 1 — Read-only diagnostics | Persistent Python MCP, capture, transforms, locate-only, offline replay | No input path in read-only modes; reproducible overlays |
| 2 — Windows pilot | Windows-MCP actions, local ShowUI, one display, host approvals/stop | Native action tests and draft-only workflow benchmark |
| 3 — Mac parity | Ghost OS adapter, existing MLX sidecar, OS permission/setup | Same contract suite and native Mac workflow evidence |
| 4 — Managed distribution | uv bootstrap, Python/environment/model resources, filtering, update/repair | Clean-machine installs on both qualified targets |
| 5 — Expanded support | Mixed-DPI/multi-display, optional offline bundles, more hardware | Independent qualification and updated support matrix |

Phases can overlap where dependencies permit; autonomous actions cannot ship before cancellation, authorization, and coordinate tests. Recording/replaying learned multi-step recipes is a later feature requiring the same per-step checks, not an initial shortcut around them.

## 10. Risks and mitigations

| Risk | Response |
| --- | --- |
| Small model misidentifies an element | Accessibility where reliable, crop/re-observe, absence handling, outcome verification, benchmark |
| Screenshot downscale destroys detail | Preserve aspect ratio; use original-resolution crops; record exact input |
| Wrong click due to unit mismatch | Explicit coordinate transforms and native calibration tests |
| Planner cannot understand visual-only state | Explicit visual fallback or handoff; do not equate grounding with planning |
| Python/inference dependency conflict | Separate pinned environments and native compatibility CI |
| Model cold start or OOM | Visible warm-up, memory qualification, persistent worker, controlled unload |
| Host kills only direct child | Whole-tree supervision and stop channel independent of inference |
| Hub offers all platform resources | Target/feature-specific dependency closure plus client validation |
| Upstream advertised API is incomplete | Source checks, capability discovery, contract tests, pinned revisions |
| Privacy claim exceeds actual routing | Display planner locality and remote fields independently of local vision |
| Misleading confidence scores | Treat upstream heuristic confidence as metadata, never authorization |

## 11. Existing behavior versus required work

The host currently supports plugin-owned stdio commands and starts subprocesses. It does not yet establish this complete computer-use product. The inspected MCP implementation loses mixed image content, disconnects per invocation, and lacks complete initialization handling. Browser screenshots currently return metadata to the model, not image bytes. Transient model-image artifacts and managed-browser handoff/lease services are useful implementation patterns.

The Hub supports managed runtime resources, uv toolchain selection, and platform compatibility. Its environment/model plan projection needs target-specific filtering. Independent native binary resources and optional feature resolution must be designed explicitly; they are not implied by the Python runtime registry. The desktop uv consumer path requires implementation verification.

The detailed evidence and proposed changes are in technical design §2, §5, and §6.

## 12. Dependency and document reconciliation

The older desktop managed-installation PRD disallows public package installation at runtime. The newer Hub uv design adds hash-pinned dependency provisioning during installation. This feature adopts the newer uv-specific provisioner only through a validated installation plan and retains the older rule for ordinary session startup. No arbitrary plugin-authored package commands or source builds are authorized.

Developer `uv.lock` / `uv sync` workflows differ from the Hub's current JSON dependency-lock contract. Release tooling must generate and verify the required Hub lock; do not silently treat the formats as interchangeable. Offline dependency bundles and generic native-tool distribution are extensions to existing Hub capabilities, not already implemented features.

## 13. Open release decisions

1. Exact upstream Windows-MCP and Ghost OS revisions and redistributed license notices.
2. Qualified Windows OS/GPU/driver and macOS versions; exact Python/uv/model revisions.
3. Quantization/backend selection and measured memory/latency thresholds.
4. Native Ghost OS artifact distribution/signing contract in the Hub.
5. Target/feature-specific requirements and model-binding schema extension.
6. Numerical workflow/grounding quality thresholds and stop-latency SLO after pilot measurements.
7. Whether remote visual fallback is included in the first release or remains disabled.
8. Default debug retention and storage cap, with a clear user-facing policy.

These are implementation/qualification decisions, not reasons to fragment the public plugin identity or require manual uv installation.

## 14. Sources and related documents

External sources were inspected during the design discussion on 2026-09-23. They describe upstream capabilities, not measured AiFetchly performance. Pin commit/release identities when implementing.

- [ShowUI repository](https://github.com/showlab/ShowUI) and [grounding/quantization quick start](https://github.com/showlab/ShowUI/blob/main/QUICK_START.md).
- [Windows-MCP](https://github.com/CursorTouch/Windows-MCP): Python, capture/input tools, display metadata, tool allowlists.
- [Ghost OS](https://github.com/ghostwright/ghost-os) and [vision-sidecar implementation](https://github.com/ghostwright/ghost-os/blob/main/vision-sidecar/server.py): accessibility + local ShowUI/MLX.
- [uv installation](https://docs.astral.sh/uv/getting-started/installation/), [scripts](https://docs.astral.sh/uv/guides/scripts/), [locking/syncing](https://docs.astral.sh/uv/concepts/projects/sync/).
- [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle).
- [Midscene](https://midscenejs.com/), [Puppeteer integration](https://midscenejs.com/integrate-with-puppeteer), [UI-TARS](https://github.com/bytedance/UI-TARS-desktop), [Claude computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool): considered alternatives.
- [Desktop managed-installation design](plugin-hub-managed-installation-technical-design.md).
- Hub: `docs/prd/plugin-hub-uv-managed-runtime-prd.md`, `docs/prd/plugin-hub-uv-managed-runtime-technical-design.md`, and `docs/plugin-runtime-requirements-crud.md` in `/home/robertzeng/project/aifetchly-hub-go`.
