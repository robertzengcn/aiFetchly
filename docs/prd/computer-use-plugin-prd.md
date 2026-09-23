# Computer Use Plugin — Product Requirements

## Document information

| Field | Value |
| --- | --- |
| Version | 1.1 |
| Status | Proposed; revised after feasibility review. No implementation is claimed |
| Date | 2026-09-23 |
| Product | AiFetchly Computer Use |
| Proposed plugin repository | `aifetchly-computer-use` — independent repository, not created by this document |
| Host repository | `aiFetchly` |
| Distribution repository | `aifetchly-hub-go` |
| Technical design | [Computer Use Plugin Technical Design](computer-use-plugin-technical-design.md) |
| Related desktop requirements | [Plugin Hub Managed Installation PRD](plugin-hub-managed-installation-prd.md), [Downloadable Local AI Runtimes PRD](downloadable-local-ai-runtimes-prd.md) |

### Revision 1.1 summary

| Area | Version 1.0 | Version 1.1 |
| --- | --- | --- |
| Screenshots and the planner | Screenshots stay local; planner receives structured text only; visual fallback deferred | Two supported planner modes. Local-only stays the default; **visual planner mode is opt-in** and sends screenshots to the configured image-capable model |
| Local grounding model | ShowUI-2B | **GUI-Actor-2B** (Qwen2-VL-2B base, Apache-2.0 + MIT). GUI-Actor-3B is blocked until its base-model licence permits commercial use |
| Inference runtime | PyTorch + CUDA on Windows, MLX sidecar on Mac | **One runtime, ONNX Runtime, on both OSes**, in an app-owned worker. No PyTorch, CUDA toolkit, or MLX on customer machines |
| Mac backend | Ghost OS with its MLX vision sidecar | Chosen by a time-boxed spike: pinned Ghost OS fork vs. a thin in-house Swift helper. Uses the shared ONNX grounder either way |
| Gateway | Python MCP gateway in front of each backend | **No intermediate gateway.** The host owns sessions, target store, transforms, and grants; adapters are thin |
| MCP client | Fix the existing client | Rebuild on the official MCP TypeScript SDK with persistent sessions; delivered first, independently of Computer Use |
| Release shape | Both OSes, Hub schema changes, managed uv, and the debug viewer arrive together | **Thin vertical slice:** named workflows, Windows accessibility-first MVP, local grounder next, Mac after that |

## 1. Product summary

Provide an installable first-party plugin that lets AiFetchly operate native desktop applications on the user's computer. Users describe a task in chat, see what the agent is doing, and can pause, stop, or take over at any time.

The agent observes the target application through its accessibility tree first. When accessibility cannot identify a control, a local grounding model (GUI-Actor-2B running on ONNX Runtime) finds the control in a screenshot. AiFetchly retains planning, permission decisions, session ownership, process supervision, and task history.

By default, screenshots never leave the device: the remote planner sees structured UI text and grounding results only. Users who want higher task success on visually complex apps can turn on **visual planner mode**. In that mode, screenshots of the target window go to the configured image-capable planner model, with explicit consent and a visible indicator.

The first release is a Windows vertical slice built around a small set of named marketing workflows. Local vision follows on Windows, then macOS. The public plugin identity and tool contract stay the same across operating systems.

Users must not need to install Python, uv, pip, Git, compilers, GPU toolkits, or configure a shell. Python is used only where an upstream backend requires it (Windows-MCP), inside a managed private environment.

## 2. Decisions

| ID | Decision or requirement | Rationale / qualification |
| --- | --- | --- |
| D-01 | Adapter, contract, model-export, fixture, and evaluation code lives in an independent repository | Independent testing and upstream updates. Authority-bearing session logic lives in the host (D-18) |
| D-02 | One plugin listing with target-specific installation resources | Windows users download no macOS resources and vice versa |
| D-03 | Local visual grounding uses GUI-Actor-2B | Strongest published small grounder with a commercially usable licence chain (see §5.1) |
| D-04 | Windows: Windows-MCP for accessibility and input. macOS: backend chosen by spike. Both use the shared grounder | Windows-MCP is mature and actively maintained; the Mac candidate is young, so the choice is evidence-based |
| D-05 | Use accessibility first when it identifies the target reliably; use vision otherwise | Avoid inference cost for standard controls while covering custom and icon-only controls |
| D-06 | Keep planning separate from grounding and execution | The grounder answers "where is this control"; the planner decides the steps |
| D-07 | AiFetchly owns one authoritative task loop | No nested agent loop or unrestricted whole-task tool |
| D-08 | Coordinate transformations are explicit and testable | Model pixels, capture pixels, logical points, and desktop pixels are different spaces |
| D-09 | Build locate-only and offline replay before autonomous clicking of vision targets | Separates model errors from implementation errors |
| D-10 | Managed runtimes; no global installation requirement | Ordinary users have no developer tools. Python only for Windows-MCP; none on macOS and none for inference |
| D-11 | Installation and updates are separate from session startup | No dependency resolution or model download during a session handshake |
| D-12 | Initial targets are Windows 10/11 x64 and, later, Apple Silicon | Windows ARM, Intel Mac, and Linux are not implicitly supported |
| D-13 | Start desktop validation on one display | Mixed-DPI and multi-display control need a later qualification gate |
| D-14 | Model and runtime resources are independently versioned and cached | Code updates must not redownload unchanged model bytes |
| D-15 | Local grounding does not make the whole agent offline | The planner and structured UI text may involve remote services in every mode |
| D-16 | Screenshots reach the remote planner only in opt-in visual planner mode | Privacy by default, higher success available by choice |
| D-17 | One inference runtime (ONNX Runtime) on every supported OS | One model export, one preprocessing implementation, one test suite; broad GPU coverage on Windows |
| D-18 | The host owns sessions, target store, transforms, grants, lease, and stop. No intermediate Python gateway | The host is the only real enforcement point; a gateway duplicates state and adds a process hop |
| D-19 | The host MCP client is rebuilt on the official SDK with persistent sessions, as an independent first deliverable | Required for correct protocol handling and model warm reuse; benefits every MCP plugin |
| D-20 | The first release is a thin vertical slice anchored to named workflows | Evidence before breadth; avoids building two platforms and distribution changes at once |
| D-21 | Model weights and their base models must permit commercial distribution | Fine-tune licences do not override base-model licences |

The earlier browser-first/Midscene proposal remains useful for browser-only workflows. Browser automation in AiFetchly continues to use the managed browser; Computer Use targets work the browser cannot do. End-to-end computer-use models (UI-TARS, Claude computer use) are benchmark baselines in Phase 0, not dependencies.

## 3. Problem, users, and target workflows

AiFetchly already automates marketing workflows through plugins, skills, MCP tools, and managed browsers. Native desktop applications and custom UI controls are not covered by reliable, generic computer control. Screenshot control adds its own problems: wrong coordinates, ambiguous controls, stale state, inference latency, and bad clicks that are hard to reproduce.

Primary users:

1. A marketer preparing a campaign or draft across native applications.
2. A user with no developer tooling installing a plugin from the Hub.
3. A privacy-conscious user who wants screenshots processed locally.
4. A developer or support engineer investigating a failed location or click.

### 3.1 Target workflows

Phase 1 is qualified against named workflows, not "any application". Product confirms this list, with evidence of user demand, before Phase 1 starts. The candidates below are placeholders to confirm or replace.

| ID | Candidate workflow | Why native control is needed | Stop point |
| --- | --- | --- | --- |
| W-1 | Draft a message to a contact or group in WeChat for Windows | Desktop client, no browser equivalent for many users | Before Send |
| W-2 | Paste and format a lead list in Microsoft Excel | Native app with a rich accessibility tree | Before Save to a shared location |
| W-3 | Fill a post draft in a native desktop publishing or scheduling client | Custom controls; exercises the vision path | Before Publish |
| W-4 | Export a file from a native design or video tool | Icon-only toolbars; exercises grounding | Before overwrite prompts |

A workflow qualifies for a phase only when it succeeds on the recorded benchmark with visible handoff. Consequential final actions (send, publish, delete, pay) always require the current task's explicit authorization.

### 3.2 User stories

- Install Computer Use on a supported machine without command-line setup.
- Select the application to operate and ask AiFetchly to prepare a draft, stopping before publication unless the final action is authorized.
- Locate a custom or icon-only control through local vision.
- Choose whether screenshots may be sent to the planner, and see which mode is active.
- Stop the agent instantly with a hotkey, even when AiFetchly's window is hidden.
- Take over for login, verification, or an ambiguous step, then resume with a fresh observation.
- Inspect a wrong predicted point without sending input to the desktop.
- Export a reviewed diagnostic bundle and reproduce grounding offline.

## 4. Goals and non-goals

### Goals

- Deliver native desktop interaction through the existing plugin experience.
- Keep the public tool contract identical across operating systems.
- Download only resources compatible with the machine and the selected features.
- Make target location, coordinate conversion, execution, and verification independently observable.
- Make cancellation and takeover effective even during model inference.
- Preserve the AI enable gate, permission rules, database architecture, and renderer isolation.
- Base compatibility, accuracy, latency, and memory claims on recorded evidence.

### Non-goals for the first release

- Training a foundation model or fine-tuning on customer screenshots.
- Claiming universal application support, perfect reliability, or fully offline planning.
- Replacing AiFetchly's planner with Ghost OS, Windows-Use, UI-TARS, or another complete agent.
- Exposing upstream shell, registry, broad filesystem, or process-management tools.
- Operating while the desktop is locked, on the secure desktop, or outside the active user session.
- Controlling windows that run elevated when AiFetchly does not (Windows UIPI blocks this).
- Concurrent agents controlling the same desktop.
- Autonomous login, CAPTCHA handling, or OS permission bypass.
- Visual enumeration of every element on screen.
- Sending screenshots to a remote service unless the user enabled visual planner mode.
- Installing PyTorch, CUDA toolkits, MLX, or compilers on customer machines.
- Shipping GUI-Actor-3B or any model whose licence chain does not permit commercial use.
- Supporting arbitrary third-party plugins through the privileged control path.

## 5. Scope and qualification

### 5.1 Local grounding model

| Model | Base model and licence chain | ScreenSpot-Pro (published, without verifier) | Status |
| --- | --- | --- | --- |
| GUI-Actor-2B | Qwen2-VL-2B-Instruct (Apache-2.0) → GUI-Actor weights (MIT) | 36.7% | **Default**, subject to ONNX export parity and native benchmark |
| GUI-Actor-3B | Qwen2.5-VL-3B-Instruct (**Qwen Research License, non-commercial**) → GUI-Actor weights (MIT) | 42.2% | **Blocked** until a commercial licence from Alibaba Cloud is obtained or legal review clears use |
| GUI-Actor-7B (Qwen2.5-VL) | Qwen2.5-VL-7B-Instruct (Apache-2.0) → MIT | 44.6% | Optional future tier for high-memory machines, after measurement |
| GUI-Actor-Verifier-2B | UI-TARS-2B-SFT → MIT | Adds ~5 points to 2B in published results | Future candidate; licence chain to confirm |
| ShowUI-2B | Qwen2-VL-2B → Apache-2.0 | Single digits in the ScreenSpot-Pro paper | Replaced; kept only as a benchmark comparison |

Published scores come from the model authors and are not AiFetchly measurements. Release decisions use AiFetchly's own fixtures (§8).

GUI-Actor ranks candidate regions by attention; it has no built-in "target absent" answer. Absence handling therefore needs calibrated thresholds, accessibility cross-checks, or the visual planner (CU-VISION-11).

### 5.2 Platform matrix

| Target | Scope | Required evidence |
| --- | --- | --- |
| Windows 10/11 x64, interactive desktop | Phase 1 (accessibility + optional visual planner), Phase 2 (local vision) | Windows-MCP pinned revision, input/capture tests, target workflows |
| Windows local vision on a DirectX 12 GPU (NVIDIA, AMD, Intel) | Phase 2 primary vision configuration | ONNX Runtime DirectML latency, memory, and parity on reference GPUs |
| Windows local vision on CPU only | Enabled only if measured latency meets the budget | Measured CPU latency and memory; otherwise accessibility + visual planner only |
| Apple Silicon, supported macOS release | Phase 3 | Backend spike outcome, Accessibility/Screen Recording attribution, CoreML/CPU inference measurements |
| Windows ARM, Intel Mac, Linux | Deferred | Separate qualification |
| Multiple monitors / mixed scaling | Later gate | Per-display mapping and focus tests, including negative origins |

Exact OS builds, GPU and driver ranges, minimum RAM, quantization, and versions are published from measurements. Model file size is not peak runtime memory.

## 6. Functional requirements

### 6.1 Discovery, installation, and packaging

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-INST-01 | Show one Computer Use listing with compatibility for the current machine | Incompatible targets cannot activate; the detail view explains why |
| CU-INST-02 | Resolve resources by OS, architecture, execution provider, app version, and selected features | A Windows plan contains no Mac helper; a Mac plan contains no Windows-MCP environment or Python |
| CU-INST-03 | Keep code, native adapters, Python environment, ONNX Runtime binding, and model weights separately identifiable | A code-only update reuses unchanged runtime and model resources |
| CU-INST-04 | Local vision is an explicit, optional resource selection | A vision-disabled install downloads no model; vision-required steps explain the missing capability |
| CU-INST-05 | Install without existing Python or uv | Clean-machine install provisions only what the selected target needs, without global PATH edits or administrator rights |
| CU-INST-06 | Use immutable, pinned, verified resources | A checksum or signature failure blocks activation; floating versions are rejected |
| CU-INST-07 | Show install phases, bytes, retry, and cancellation | An interrupted install never appears ready and can be resumed or repaired |
| CU-INST-08 | Reuse compatible managed resources across plugins | Reference tracking prevents deleting a resource in use |
| CU-INST-09 | Preserve the working version during update | The new version is prepared and checked before activation; no session switches mid-execution |
| CU-INST-10 | Offline bundles are a later option | An offline claim requires every runtime, native, and model resource |
| CU-INST-11 | Ship only models whose licence chain permits commercial distribution | Release tooling records base-model and fine-tune licences; a non-commercial licence blocks publication |

Normal startup performs no dependency upgrades, package resolution, or model download. Loading model weights into memory is allowed, with visible readiness.

### 6.2 Sessions, ownership, and control

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-SESSION-01 | The user starts control for an identified application window | The target and active control state are displayed |
| CU-SESSION-02 | One desktop-control owner across chats and windows | A competing session receives `desktop_busy` |
| CU-SESSION-03 | Persistent supervised backends during a session | Repeated actions do not restart backends or reload weights |
| CU-SESSION-04 | Pause, Stop, and Take over are always available | Stop revokes action authority and clears queued input independently of inference |
| CU-SESSION-05 | Human mouse or keyboard input, or an unexpected focus change, pauses automation | Old coordinates are never applied to an unexpected foreground window |
| CU-SESSION-06 | Crash, disconnect, sleep/resume, lock, display change, and target closure invalidate unsafe state | A fresh observation (and permission where applicable) is required before more input |
| CU-SESSION-07 | No database access from plugin or worker processes | The host persists results through Modules and Models |
| CU-SESSION-08 | A global stop hotkey works while any application has focus | Pressing it revokes authority within the stop budget, even when AiFetchly is hidden |
| CU-SESSION-09 | A visible indicator shows that AI is in control | Always-on-top control strip with the target, current step, mode, and Pause / Take over / Stop |
| CU-SESSION-10 | AiFetchly's own windows are never action targets | Actions whose resolved point falls on an AiFetchly window are rejected |

Selecting a window is a scope promise, not an OS sandbox. Global input can affect another application, so runtime checks enforce focus and target scope and explain unsupported states.

### 6.3 Observation, grounding, action, and verification

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-VISION-01 | Separate planning, observation, grounding, execution, and verification | Each stage has traceable inputs and results |
| CU-VISION-02 | Prefer a reliable accessibility target; use the local GUI-Actor grounder for unresolved visual targets | Both paths return the same target-handle contract |
| CU-VISION-03 | Screenshots stay on the device in the default mode | No screenshot in remote planner messages, logs, or persisted tool JSON unless visual planner mode is on |
| CU-VISION-04 | Record exact preprocessing and coordinate spaces | Resize, crop, padding, display origin, and executor units accompany each observation |
| CU-VISION-05 | Reject stale or invalid targets | A moved window, changed display, expired observation, or malformed coordinate never produces a guessed click |
| CU-VISION-06 | Verify the expected outcome after an action | Successful input injection alone is never reported as task completion |
| CU-VISION-07 | Ambiguous or missing targets are recoverable failures | Re-observe, crop, rephrase, or hand off; never click a default point |
| CU-VISION-08 | Support high-resolution crops for small controls | Crop coordinates map back through the same tested transform |
| CU-VISION-09 | Bound local inference and resource use | Cancellation stays available; memory failures are actionable; no endless retry |
| CU-VISION-10 | The grounder runs on ONNX Runtime with the best available execution provider and a CPU fallback | The provider in use is recorded per observation; no silent provider change mid-session |
| CU-VISION-11 | Detect ambiguity and likely absence from grounder output | Close competing regions return `target_ambiguous`; below-threshold activation returns `target_not_found`; thresholds are calibrated on absent-target fixtures |

The grounder answers "where is the described control?" It is not assumed to discover next steps or verify arbitrary success. In local-only mode, when structured observations cannot explain the screen, the agent hands off or suggests visual planner mode.

### 6.4 Planner modes

| Mode | Planner receives | Default | Best for |
| --- | --- | --- | --- |
| Local-only | Structured UI text, grounding results, action outcomes | Yes | Apps with good accessibility; privacy-sensitive work |
| Visual planner (opt-in) | The above plus screenshots of the target window | No | Visually complex apps, custom-drawn UIs, outcome verification |

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-PLAN-01 | Visual planner mode is off until the user turns it on | A setting with consent text; the active mode is shown in the session indicator |
| CU-PLAN-02 | Consent text states where screenshots go | Names the configured provider/model and says screenshots leave the device |
| CU-PLAN-03 | The mode is available only with an image-capable planner model | Otherwise the toggle is disabled with an explanation |
| CU-PLAN-04 | Screenshots are limited to the target window and bounded in size | No full-desktop capture unless the target requires it and the user approved it |
| CU-PLAN-05 | Screenshots are suppressed during handoff and sensitive states | Login, password, and verification steps send no image |
| CU-PLAN-06 | Planner images are transient | Never persisted in tool JSON, chat history, logs, or hook payloads |
| CU-PLAN-07 | The user can turn the mode off mid-session | Takes effect from the next observation |
| CU-PLAN-08 | The mode is recorded per step in diagnostics | Traces show which steps sent an image |

### 6.5 Permissions and data handling

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-PERM-01 | Check `USER_AI_ENABLED` before work on every AI-serving IPC entry | Disabled AI returns immediately, before parsing, capture, or inference |
| CU-PERM-02 | Distinguish capture, input control, debug recording, and visual planner image routing | Each permission's state and revocation are visible and enforced |
| CU-PERM-03 | Enforce grants in the host, not in skill text or adapters | Model- or plugin-supplied "approved" fields cannot authorize input |
| CU-PERM-04 | Consequential actions are bound to explicit current-task authority | Send/publish/delete/payment requires the authorized request; ambiguity asks for confirmation |
| CU-PERM-05 | Hand off credentials and verification challenges | No automated OS permission bypass or hidden credential entry |
| CU-PERM-06 | Expose only needed upstream capabilities | Shell, registry, and broad filesystem/process tools are not reachable |
| CU-PERM-07 | Observed text is untrusted | Page, accessibility, screenshot, and upstream tool text never expand authority |
| CU-PERM-08 | Sensitive evidence retention and export are deliberate | Debug capture is opt-in, local, and reviewed before export |

Local subprocesses are not security sandboxes. A trusted backend with OS input permissions can act outside the gateway. Distribution trust, process restrictions, and user permission remain the real boundaries.

### 6.6 Debugging and reproducibility

| ID | Requirement | Acceptance |
| --- | --- | --- |
| CU-DEBUG-01 | Locate-only mode | Shows a prediction overlay without sending input |
| CU-DEBUG-02 | Step-through mode | Pauses before each action; stale state forces re-observation |
| CU-DEBUG-03 | Offline replay | Reruns stored grounding and mapping with no control backend loaded |
| CU-DEBUG-04 | Visual step viewer | Shows original capture, exact model input, attention heatmap and candidate regions, mapped point, and after-state |
| CU-DEBUG-05 | Versioned diagnostic bundles | Record backend, model, ONNX Runtime version, execution provider, configuration, and transform metadata |
| CU-DEBUG-06 | Confirmed failures become fixtures | Expected clickable region or target-absent label supports regression tests |
| CU-DEBUG-07 | Compare configurations on identical evidence | Report changed predictions, region hits, time, memory, and failure type |
| CU-DEBUG-08 | Evidence is separate from telemetry | No automatic screenshot upload, training, or third-party telemetry |

Debugging must distinguish grounding error, transform error, native input error, wrong focus, stale state, and failed verification. Grounder activation scores are relative, not calibrated probabilities, and must not be shown as accuracy.

## 7. User experience

### Installation

Plugin details show the supported target, whether local vision is selected, download and storage totals, reusable resources, hardware qualification, and required OS permissions. Progress uses user-facing phases: downloading components, preparing runtime, preparing model, checking setup. Developer details stay in an expandable diagnostics area.

### Settings

A Computer Use settings panel offers: local vision on/off, visual planner mode on/off with consent text, the stop hotkey, and debug capture on/off with retention.

### Active session

An always-on-top control strip shows the target app, current step, observation/action status, planner mode (local-only or visual), and Pause / Take over / Stop, plus the stop hotkey hint. A subtle border around the target window indicates AI control. AiFetchly stays usable while inference runs. A local preview respects capture permissions and handoff states; showing a local preview does not imply remote transmission.

### Failure and recovery

Explain actionable conditions: permission missing, model unavailable, target not found, target ambiguous, target changed, desktop busy, elevated window unsupported, unsupported display configuration, runtime failed, or outcome uncertain. A timeout after input is shown as uncertain execution and never retried automatically. In local-only mode, when the screen cannot be understood, the message offers handoff and mentions visual planner mode.

### Developer diagnostics

A local debug viewer and export action show evidence without raw internal paths or credentials. All production text uses translations in `en`, `zh`, `es`, `fr`, `de`, and `ja`.

## 8. Quality and release acceptance

### Functional gates

- Clean-machine installation succeeds with no Python or uv and only matching platform resources.
- MCP initialization, version negotiation, session reuse, shutdown, timeout, and process-tree cleanup pass integration tests.
- The GUI-Actor ONNX export matches the PyTorch reference within recorded tolerances at every pipeline stage, and region hits match on the fixture set.
- Coordinate mapping tests pass independently of the grounder for crop, padding, anisotropic resize, scale, and display origin.
- No input executes in locate-only or offline replay mode.
- Absent, ambiguous, and malformed grounding results never cause a click.
- Stop and the stop hotkey prevent queued and late actions; no keys or buttons remain held after ordinary cancellation.
- Crash recovery never replays a potentially completed input.
- In local-only mode, no screenshot bytes appear in planner requests, logs, persisted tool JSON, or hook payloads.
- Each qualified target workflow (§3.1) succeeds on its phase's platform with visible handoff.
- Windows and Mac adapters conform to the same schemas and error meanings.
- Code-only updates do not redownload identical models.
- UI changes include component tests (`yarn test:components`); critical multi-step flows have Playwright E2E coverage.

### Evaluation dataset and metrics

Maintain consented or synthetic screenshots and tasks covering standard controls, icons, custom controls, small targets, repeated labels, absent targets, Chinese and English UI, light and dark themes, scrolling, dialogs, and changed layouts. Add DPI, focus, and capture cases per target.

Compare, on identical tasks: accessibility-only, grounder-only, and combined target resolution; local-only and visual planner modes; and an end-to-end computer-use model baseline. Measure region hit rate, wrong-action rate on absent targets, transform error, end-to-end task success, interventions, recovery success, warm and cold latency, peak RAM/VRAM, and API cost. Keep regression fixtures separate from held-out evaluation.

### Provisional planning targets

These are starting targets to validate or replace in Phase 0. They are not claims.

| Metric | Provisional target |
| --- | --- |
| Stop acknowledgment after the button or hotkey | ≤ 250 ms; no input dispatched after acknowledgment |
| Warm grounding latency, reference DirectX 12 GPU | ≤ 1.5 s per call |
| Warm grounding latency required to enable CPU-only vision | ≤ 6 s per call |
| Median end-to-end step (observe → plan → ground → act → verify) | ≤ 8 s |
| Wrong-click rate on absent-target fixtures | 0 in the release gate set |

Safety invariants are hard gates regardless of average accuracy. Single-action accuracy is never presented as workflow success.

## 9. Rollout

| Phase | Scope | Exit evidence |
| --- | --- | --- |
| 0 — Foundations and spikes | MCP client rebuilt on the official SDK with persistent sessions (ships independently); shared schemas; confirmed target workflows; GUI-Actor-2B ONNX export and parity spike with execution-provider latency; macOS backend spike; end-to-end model baseline | SDK client merged with tests; parity report; latency and memory on reference hardware; Mac backend decision record; workflow list signed off |
| 1 — Windows MVP, accessibility-first | Windows-MCP in a managed environment; host supervisor, lease, grants, Stop and stop hotkey, control strip; one display; opt-in visual planner; draft-only target workflows | Native action and stop tests; W-1/W-2 benchmark; limited beta |
| 2 — Local vision on Windows | ONNX Runtime grounding worker with GUI-Actor-2B (DirectML and CPU); crops; locate-only, offline replay, trace viewer | Parity and native grounding benchmark; W-3/W-4 benchmark |
| 3 — macOS | Chosen Mac backend; same grounder via CoreML/CPU; permission setup; Hub target-conditional resource resolution | Same contract suite; native Mac workflow evidence |
| 4 — Hardening and GA | Update/repair, clean-machine matrix, published support matrix and SLOs | GA checklist complete |
| 5 — Expansion | Multi-display, Windows ML vendor execution providers, larger grounder tier or verifier, offline bundles | Independent qualification per item |

Autonomous actions never ship before cancellation, authorization, and coordinate tests pass. Local vision (Phase 2) is not a prerequisite for Phase 1, so a failed export spike delays vision without blocking the product. Learned multi-step recipes are a later feature with the same per-step checks.

## 10. Risks and mitigations

| Risk | Response |
| --- | --- |
| GUI-Actor ONNX export fails or diverges from PyTorch | Spike in Phase 0 with stage-by-stage parity tests; if it fails, evaluate another exportable grounder; Phase 1 does not depend on it |
| The grounder picks a region when the target is absent | Calibrated activation threshold, accessibility cross-check, visual planner verification, absent-target fixtures as a hard gate |
| Patch-level precision misses small controls | Crop and re-ground at higher effective resolution |
| DirectML is in maintenance mode | CPU fallback; evaluate Windows ML vendor providers in Phase 5; pin a tested ONNX Runtime |
| CoreML offloads only part of the model | Measure per operator; CPU fallback; static-shape buckets if they help |
| Base-model licence restricts commercial use | Licence-chain check in release tooling; 2B default; 3B blocked |
| Ghost OS maintenance risk | Spike against an in-house helper; pin and own any fork |
| Local-only mode cannot understand visual-only screens | Handoff, and offer visual planner mode |
| Visual planner mode leaks sensitive content | Opt-in consent, target-window crop, suppression during sensitive states, transient images |
| Wrong click due to unit mismatch | Explicit transforms and native calibration tests |
| Model cold start or out-of-memory | Visible warm-up, memory qualification, persistent worker, idle unload |
| Host kills only the direct child | Whole-tree supervision and a stop path independent of inference |
| Hub offers all platform resources | Target-conditional resolution plus client validation |
| Privacy claim exceeds actual routing | Show planner mode and remote processing separately from local vision |

## 11. Open release decisions

1. Final target workflow list and demand evidence (§3.1).
2. First-OS confirmation from usage data (the documents assume Windows).
3. macOS backend: pinned Ghost OS fork vs. in-house Swift helper (Phase 0 spike).
4. Delivery mechanism for the ONNX Runtime binding and model: reuse the existing downloadable local-runtime catalog, or Hub managed resources.
5. Windows-MCP delivery: managed uv environment vs. prebuilt embeddable-Python bundle.
6. Quantization, execution-provider matrix, and reference hardware.
7. GUI-Actor-3B commercial licence (only if the 2B results are insufficient).
8. Visual planner image size, crop policy, and supported providers.
9. Default debug retention and storage cap.
10. Final numerical SLOs replacing the provisional targets.

## 12. Sources and related documents

External sources were inspected on 2026-09-23. They describe upstream capabilities, not measured AiFetchly performance. Pin exact revisions when implementing.

- [GUI-Actor repository](https://github.com/microsoft/GUI-Actor), [GUI-Actor-2B model card](https://huggingface.co/microsoft/GUI-Actor-2B-Qwen2-VL), [GUI-Actor-3B model card](https://huggingface.co/microsoft/GUI-Actor-3B-Qwen2.5-VL), [GUI-Actor-Verifier-2B](https://huggingface.co/microsoft/GUI-Actor-Verifier-2B).
- [Qwen2-VL-2B-Instruct (Apache-2.0)](https://huggingface.co/Qwen/Qwen2-VL-2B-Instruct), [Qwen2.5-VL-3B-Instruct licence (Qwen Research)](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/blob/main/LICENSE).
- [ScreenSpot-Pro benchmark](https://github.com/likaixin2000/ScreenSpot-Pro-GUI-Grounding).
- [ONNX Runtime DirectML execution provider](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html), [Windows ML execution providers](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/supported-execution-providers).
- [Windows-MCP](https://github.com/CursorTouch/Windows-MCP), [Ghost OS](https://github.com/ghostwright/ghost-os).
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle).
- [uv installation](https://docs.astral.sh/uv/getting-started/installation/).
- [UI-TARS](https://github.com/bytedance/UI-TARS-desktop), [Claude computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool), [ShowUI](https://github.com/showlab/ShowUI), [Midscene](https://midscenejs.com/): baselines and alternatives.
- Desktop: [managed installation technical design](plugin-hub-managed-installation-technical-design.md), [downloadable local AI runtimes technical design](downloadable-local-ai-runtimes-technical-design.md).
- Hub: `docs/prd/plugin-hub-uv-managed-runtime-prd.md`, `docs/prd/plugin-hub-uv-managed-runtime-technical-design.md`, `docs/plugin-runtime-requirements-crud.md` in `aifetchly-hub-go`.
