# Browser Vision Assist and Simple CAPTCHA Solving — Desktop PRD

## Document information

| Item | Value |
| --- | --- |
| Status | Proposed implementation contract; no feature is implemented by this document |
| Version / date | 1.0 / 2026-11-03 |
| Repository / owners | AiFetchly / Desktop, AI Runtime, Browser Automation, QA |
| Baseline inspected | `074a3644f` |
| Companion | [Desktop technical design](browser-vision-assist-technical-design.md) |
| Extends | [Browser Decision Acceleration PRD 1.1](browser-decision-acceleration-prd.md) and its [technical design](browser-decision-acceleration-technical-design.md) |
| Related foundations | [Managed browser PRD](puppeteer-managed-social-browser-prd.md), [Computer Use PRD](computer-use-aifetchly-prd.md) (local grounding model, coordinate transforms) |

“Must” defines required behavior. Numerical limits marked *proposed* are initial engineering defaults, not measured results. Every existing managed-browser safety rule (risk classification, approvals, password-field safety, handoff, ownership, provider boundary) continues to apply unless this document explicitly changes it. §13 lists the exact changes to the Browser Decision Acceleration PRD.

## 1. Problem and evidence

Browser use today relies only on a text observation of the page: a list of interactive elements with roles and names plus bounded visible text. That works for ordinary forms and links, but it fails in three recurring situations:

1. **Every CAPTCHA stops the task.** Any challenge, even a four-character text code or an arithmetic question, sends the browser to the user. Users who run many browser tasks find this repetitive, and unattended sub-agent batches stall until someone notices.
2. **The page has content the element list cannot describe.** Canvas widgets, icon-only buttons without labels, image-based menus, maps, players, and custom sliders appear as unnamed `generic` elements or not at all. The decision model then guesses or escalates.
3. **When a task gets stuck, nothing can look at the page.** Repeated failures, overlays, and “I clicked but nothing happened” cases end in recovery calls that see the same text observation that already failed.

Verified implementation facts at `074a3644f`:

- **No model can see the browser.** `ManagedBrowserAiToolService.captureScreenshot` returns metadata only (“bytes are not returned to the model”). `ManagedBrowserModule.captureSessionScreenshot` refuses to capture in `handoff`, `user_login_in_progress`, `verifying_manual_login`, `login_required`, `challenge_detected`, and `challenge_resolving`.
- **Screenshots carry no geometry.** `WorkerSession.captureScreenshot` returns JPEG bytes (quality 75, viewport only, `fullPage: false`) without the viewport size, device pixel ratio, scroll position, observation ID, or page revision, so no point in the image can be mapped back to the page.
- **Observations have no element boxes.** `CollectedElementRecord` in `BrowserObservationService.ts` has role, name, input type, value, state, and `visible`, but no bounding rectangle.
- **Every challenge goes straight to handoff.** `WorkerSession.detectAndReportChallenge` sends `CHALLENGE_DETECTED`, then immediately transitions to `handoff` and sends `HANDOFF_REQUIRED` with reason `captcha_sensitive_flow`. The runtime already defines a `challenge_resolving` state with edges to `ready`, `verifying_login`, and `handoff`, but nothing enters it.
- **Challenge classification is coarse.** `ChallengeDetector.ts` uses URL/title/text regular expressions and reports only `captcha_image`, `captcha_invisible`, `robot_verification`, credential kinds, or `ambiguous`. It cannot tell a simple text-code CAPTCHA from a reCAPTCHA image grid. Flow classification defaults to `unknown`, which the existing policy treats as sensitive.
- **The only automated resolution path is an external provider.** `CaptchaResolutionPolicy.decideCaptchaResolution` allows 2captcha only for non-login, explicitly authorized domains with disclosure consent and one attempt. `ManagedBrowserModule.runChallengePolicy` notes that applying the solved token in the page is not built yet.
- **The decision contract is text-only.** `ChatCompletionDecisionClient` sends `messages: { role, content: string }[]`. `BrowserDecisionInput` has no image field and the operation set has no point-based action.
- **Reusable pieces already exist:**
  - Provider configuration already records a per-provider `vision` capability (`supported` / `unsupported` / `unknown`, `aiProviderTypes.ts`).
  - The chat loop already has a transient, non-persisted image handoff: a tool returns `modelArtifacts`, and `AIChatQueryLoop` appends a model-only multimodal message for the next round (`buildImageArtifactHandoffMessage`, used by `attach_local_images`).
  - `ComputerUseCoordinateTransforms.ts` already maps normalized model output through crop and anisotropic resize back to capture pixels and rejects out-of-image points.
  - A local grounding model (GUI-Actor 2B ONNX, `GuiActorOnnxAdapter`) and its worker client (`ComputerUseGroundingClient`) already answer “where is this described control in this image?”
  - The AI server already accepts screenshots (`scrape_assist`, `puppeteer_recovery`), validates them (`screenshot_upload_max_bytes`, default 5 MB), and selects image-capable models (`APISettingsService.get_multimodal_fallback_candidates`).
- **The hosted browser decision endpoint does not exist yet** in `aifetchserver`; `HostedDecisionClient` maps the 404 to `hosted_decision_unavailable`, and `browser_execute_task` currently returns `unavailable` in hosted mode before starting the runner, so only the custom chat route runs the task runner today. Vision support for hosted decisions is therefore part of building that endpoint, not a retrofit.
- **Packaging constraint:** `sharp` is deliberately excluded from the packaged base app (`forge.config.js`, slim installer), while `@napi-rs/canvas` ships and Electron `nativeImage` is always available (`ElectronNativeImageCodec`).

## 2. Product outcome

Give the browser AI eyes when, and only when, text is not enough, without giving it a way to click anywhere it likes:

1. A **visual frame** is a screenshot plus the exact page geometry at capture time. It can be attached to a decision, a recovery call, a verification, or the main chat model.
2. The model sees **numbered marks** over the elements it already knows about and answers with a mark number. That number maps to an existing element reference, so the normal execution path runs and no coordinate is involved.
3. When the target has no element reference, the model proposes a **normalized point**. The desktop converts it, checks what is really under it, snaps it to a known element if possible, and applies the same risk, approval, and effect rules as any click.
4. **Simple CAPTCHAs** (text codes, arithmetic questions, checkbox widgets, and, by opt-in, sliders and click-in-order puzzles) are solved by the user's selected AI model inside a bounded, privileged solver. Anything else, any failure, and any model refusal hands off to the user exactly as today.
5. Users can see and stop what the AI is doing at any time. Images never persist.

## 3. Users and primary stories

| User | Story | Required result |
| --- | --- | --- |
| Frequent browser-task user | A site shows a four-character text CAPTCHA every few searches | The AI reads and enters it; I only see a short “AI solved a verification check” notice |
| Sub-agent batch user | Three parallel tasks hit simple CAPTCHAs | Each task solves its own challenge without waiting for me; hard challenges still queue for me |
| Cautious user | I do not want page images sent to any AI | Vision and CAPTCHA solving stay off; behavior is identical to today |
| User on a canvas-heavy site | The control I need is an icon with no label | The AI recognizes it in the screenshot and clicks it, with the same approvals as other clicks |
| User watching a stuck task | The AI keeps clicking a button that does nothing | The AI looks at the page, notices the cookie overlay covering it, and closes the overlay |
| Main-chat user | “What does the page look like now?” | The chat model can request a view of the browser and describe it |
| Custom-provider user | My endpoint's model cannot read images | Vision features show as unavailable for my model; nothing is sent to the hosted server instead |
| Operator | Why did an AI click land on the wrong element? | Each point action records its frame identity, mapped point, hit-test result, and snap decision (no image) |

## 4. Scope and non-goals

### In scope

- Visual frames with geometry, masking of sensitive regions, cropping, resizing, and numbered marks.
- Element bounding boxes in observations.
- Vision triggers, budgets, and attachment to decisions, recovery, verification, and the outer chat model.
- Decision contract extension: `visual` input, `CLICK_POINT`, `DRAG_POINT`, `REQUEST_VISUAL`, and visually read `FILL` values.
- Host-side point mapping, freshness checks, hit-testing (including into iframes), snapping to known elements, risk classification, and approval fingerprints derived from the hit element.
- Optional local grounding (GUI-Actor) as a locator and as a cross-check.
- Finer CAPTCHA subtype detection, a privileged `ChallengeSolverService`, a `vision_llm` resolution mode, bounded attempts, refusal handling, and verification.
- Settings, disclosure, progress UI, translations, and tests.
- Hosted server requirements for vision decisions (implementation lives in `aifetchserver`).

### Out of scope for v1

- Solving reCAPTCHA or hCaptcha **image-grid** challenges, audio challenges, or invisible/score-based challenges (reCAPTCHA v3, invisible Turnstile) with an LLM. These keep the existing 2captcha path (where authorized) or handoff.
- Any CAPTCHA in `payment` or `security` flows, and any OTP, passkey, password, or account-recovery prompt. These always hand off.
- Spoofing browser fingerprints or simulating human behavior to defeat bot detection, beyond the ordinary smooth pointer movement a drag needs to register. Rotating proxies to get past challenges stays forbidden (P-FR-05).
- Rephrasing prompts, switching models, or splitting images to get around a model's refusal.
- Sending images to the hosted server when the user selected a custom provider, or to any provider without vision capability.
- Persisting screenshots in tool results, transcripts, task records, logs, crash reports, or the server's `screenshot_store`.
- Full-page or multi-tab visual analysis; canvas games; drawing or handwriting input; file uploads by vision.
- Shipping a new local model or making GUI-Actor mandatory.

## 5. Confirmed design decisions

| ID | Decision |
| --- | --- |
| VD-01 | Text-first. Vision is attached only on defined triggers or explicit requests, never on every step by default. |
| VD-02 | A model never executes a coordinate. The desktop maps it, verifies freshness, hit-tests, snaps to a known element where possible, and classifies risk from what is actually under the point. |
| VD-03 | Marks first. When the target is a known element, the model answers with a mark that resolves to an existing reference; point actions are the fallback for unreferenced targets. |
| VD-04 | Images are transient: held in main-process memory for a bounded time, sent only to the selected provider for one request, and never persisted. |
| VD-05 | Sensitive regions (password, OTP, payment-card, and sign-in-filled fields) are masked before an image leaves the main process. CAPTCHA images are cropped to the challenge region. |
| VD-06 | Vision follows the same provider boundary as decisions (D-03). It requires a vision-capable route; there is no fallback to hosted inference and no silent downgrade to sending text in place of a required image. |
| VD-07 | Coordinates are exchanged as normalized integers from 0 to 1000 over the sent image. Pixel coordinates from models are not accepted. |
| VD-08 | LLM CAPTCHA solving is opt-in, limited to an allowlist of simple subtypes, bounded by attempts per challenge, task, and domain, and never used in `payment` or `security` flows. |
| VD-09 | CAPTCHA solving runs in the `challenge_resolving` state through a privileged main-process solver with a restricted command set confined to the challenge region. The outer chat model and the task runner still cannot act during challenge states. |
| VD-10 | The worker independently verifies that a challenge is gone; the solver's or model's “solved” claim is never proof. |
| VD-11 | A model refusal ends automated solving for that challenge immediately and hands off. |
| VD-12 | Point-action approvals bind to a semantic fingerprint built from the hit element (operation, role, name, tag, frame origin) and the site — never from the model's description. Like existing approvals, it excludes the frame ID and page revision, so re-capturing the same target consumes the same approval once; both are recorded for diagnostics. |
| VD-13 | Local grounding is optional. It improves privacy and accuracy when installed but is never required for vision to work. |
| VD-14 | Resolution order for an eligible challenge is: vision solver → authorized external provider → handoff. Each step that is not eligible is skipped, and every failure ends in handoff. |

## 6. Functional requirements

### 6.1 Visual frames

- **V-FR-01:** The worker must capture a *visual frame*: a viewport-only screenshot plus, measured in the same page task, the CSS viewport width and height, device pixel ratio, `visualViewport.scale`, scroll position, observation ID, page revision, and capture time. Full-page capture is not allowed.
- **V-FR-02:** The worker must verify that the image size equals the CSS viewport size multiplied by the device pixel ratio (±1 px). On mismatch, or when `visualViewport.scale` is not 1 (pinch zoom), the frame is rejected with a typed reason.
- **V-FR-03:** Observations must include each visible element's bounding box in CSS viewport pixels, plus its frame (top document in v1, iframe boxes as opaque regions).
- **V-FR-04:** The main process must crop (optional), resize to a known size (proposed longest edge 1280 px for full frames, 768 px for challenge crops), mask sensitive regions, draw numbered marks for visible candidate elements, and re-encode as JPEG within a byte budget. It must record the full transform needed to map points back.
- **V-FR-05:** Marks must use the observation's candidate set. The legend sent with the image lists `mark → role, name` only; references stay main-process-side.
- **V-FR-06:** Frames are stored in memory only, keyed by session, with a short time-to-live (proposed 60 s) and a small per-session cap (proposed 4). A new navigation, a pause/takeover, a handoff, or session stop invalidates all frames for that session.

### 6.2 Privacy: masking, cropping, retention

- **V-FR-07:** Before any image leaves the main process, it must have opaque fills over: password inputs, OTP/one-time-code inputs, inputs with `autocomplete` values for credentials or payment cards, fields whose value summary is `[credential]`, and any region the worker flags as sensitive. Masking is computed from element boxes measured in the same capture.
- **V-FR-08:** No frame may be captured while a sensitive field has focus or while the session is in `login_required`, `user_login_in_progress`, `verifying_manual_login`, or `handoff`. In `challenge_resolving`, only the solver may capture, and only the challenge region.
- **V-FR-09:** Images must never appear in tool results, chat transcripts, task records, notices, logs, telemetry, crash reports, or the renderer, except the existing ephemeral session thumbnail. Diagnostics may record frame ID, sizes, transform, byte count, and hash.
- **V-FR-10:** The settings and first-use disclosure must state that page screenshots (masked, sometimes cropped) are sent to the active AI provider when vision is used.

### 6.3 When vision is used

- **V-FR-11:** The task runner must attach a visual frame only on these triggers: a decision `ESCALATE` or “no candidate fits”; three equivalent failures; the no-progress check; a large share of unnamed or `generic` candidates, a large canvas, or a visible iframe region in the observation; a decision `REQUEST_VISUAL`; and a `DONE` whose completion criteria cannot be verified deterministically.
- **V-FR-12:** Each trigger may attach at most one frame per decision. Vision has its own task budget (proposed 6 frames default, 12 hard). Exhausting it means the task continues text-only or hands off; it never fails the task by itself.
- **V-FR-13:** The outer chat model may request a view through a `browser_view` tool when the active chat provider supports vision. The image reaches the model through the existing transient image handoff and is not persisted. When the provider lacks vision, the tool is hidden from the catalog.

### 6.4 Decisions with vision

- **V-FR-14:** The decision input gains an optional `visual` object: the image, its size, the mark legend, the frame ID, and `coordinate_space: "normalized_1000"`. The system prompt must explain marks and require a mark whenever the target is marked.
- **V-FR-15:** New operations: `CLICK_POINT` (point and short target description), `DRAG_POINT` (start, end, and description), and `REQUEST_VISUAL`. `FILL` may carry `value_source: "visual_read"` for text read from the image. They are offered only when the route supports vision and, for point operations, only when a frame is attached.
- **V-FR-16:** A `CLICK` whose target came from a mark is identical to any other `CLICK` and must take the normal reference-validation path.
- **V-FR-17:** Chat adapters send images as OpenAI-compatible multipart content. In custom mode, vision availability comes from the provider's recorded `vision` capability (`LocalAIProviderConfig.capabilities.vision`); `unknown` is treated as unavailable until a connection test proves support. In hosted mode it comes from the server's advertised decision capabilities. Today nothing consumes the recorded `vision` capability (even `attach_local_images` is not gated on it), so this PRD introduces the first consumer.
- **V-FR-18:** Visually read `FILL` values must pass the existing field-text validation, are limited to 64 characters for challenge answers, and are rejected for credential and sensitive fields.

### 6.5 Point actions

- **G-FR-01:** A point action must reference a frame that belongs to the same session, has not expired, and matches the current page revision, scroll position, viewport size, and device pixel ratio when re-measured immediately before input. Otherwise the action fails before dispatch as `frame_stale`, and the runner re-captures and re-decides.
- **G-FR-02:** The desktop must map the normalized point to CSS viewport pixels through the recorded transform. Points in padding or outside the image are rejected, never clamped.
- **G-FR-03:** The worker must hit-test the mapped point (`elementFromPoint`), descending into same-origin and cross-origin iframes (up to depth 3), and report a sanitized descriptor of the hit element: tag, role, accessible name (bounded), input type, frame origin, and whether it is a registered reference.
- **G-FR-04:** If the hit element or a close ancestor (up to 3 levels) is a registered reference for the current observation, the action must run as a normal reference action.
- **G-FR-05:** The hit element, not the model's description, drives risk classification. Sensitive inputs refuse with handoff; consequential targets require approval bound to VD-12; targets in a cross-origin frame have a minimum risk class of `reversible_write`.
- **G-FR-06:** The worker must wait for the hit element's position to stay stable (proposed two reads 100 ms apart, up to 500 ms) before input, and must refuse if it keeps moving.
- **G-FR-07:** Failures after input dispatch are `effectUnknown` (D-FR-26). A point action is never automatically replayed.
- **G-FR-08:** `DRAG_POINT` applies G-FR-01 to G-FR-06 to the start point, requires the end point to be inside the same frame and viewport, and moves the pointer in a smooth, bounded path (proposed 20–40 steps over 400–900 ms).
- **G-FR-09:** Every point action records diagnostics: frame ID, normalized point, mapped CSS point, hit descriptor, snap result, risk class, and outcome.

### 6.6 Local grounding

- **G-FR-10:** When the GUI-Actor runtime is installed and healthy, the desktop may use it to locate a target from the model's description (when the model gave a description without a point), and to cross-check a model point: if both points hit different elements, the action is not executed and the runner re-captures or escalates.
- **G-FR-11:** Grounding runs through the existing `ComputerUseGroundingClient` and local runtime lease. It never receives credentials and never runs while the frame would be disallowed by V-FR-08.

### 6.7 Simple CAPTCHA solving

- **CP-FR-01:** Challenge detection must add a subtype: `text_image`, `arithmetic`, `checkbox_widget`, `slider`, `click_order`, `image_grid`, `invisible`, or `unknown`, plus the challenge region box and the private references the solver needs (answer input, submit control, challenge image, widget frame, slider handle). Detection must cover English and Chinese wording (for example `验证码`, `拖动滑块`, `依次点击`).
- **CP-FR-02:** When automatic resolution may apply, the worker must hold the session in `challenge_detected` and wait for a main-process directive (proposed 2 s timeout). Without a directive, or when the feature is off, it hands off exactly as today.
- **CP-FR-03:** The resolution policy must add a `vision_llm` mode evaluated before the existing external-provider branch. It is eligible only when all of these hold:
  - the global kill switch and the user setting are on and the disclosure version is accepted;
  - the kind is `captcha_image` or `robot_verification`, and the subtype is enabled;
  - the flow is not `payment` or `security`;
  - the active route supports vision;
  - attempt limits are not exhausted;
  - the session is not under user control and the task is not paused.

  `login` and `unknown` flows are eligible because the image stays with the user's own AI provider and is cropped and masked.
- **CP-FR-04:** Default subtype eligibility: `text_image`, `arithmetic`, and `checkbox_widget` are on when the feature is on. `slider` and `click_order` require a separate opt-in. `image_grid`, `invisible`, and `unknown` are never eligible for `vision_llm` in v1.
- **CP-FR-05:** The solver runs in `challenge_resolving`. Its commands are limited to observing the challenge, capturing the challenge region, filling the answer input, clicking the challenge's own controls, pressing Enter in the answer input, and point actions whose mapped point lies inside the challenge region (with a small margin). It cannot navigate, run scripts, or touch anything outside the challenge.
- **CP-FR-06:** Attempt limits (proposed): 2 per challenge ID, 3 per task, and 5 per registrable domain per rolling hour. Each refresh of a challenge image counts as a new attempt, not a new challenge.
- **CP-FR-07:** If the challenge's submit control would also submit a consequential form (for example a comment with a CAPTCHA field), the risk classifier applies; unless that exact action is already approved, the solver requests approval or hands off.
- **CP-FR-08:** After each attempt, the worker re-runs detection. The challenge counts as solved only if detection no longer finds it and the page left the challenge state; the session then moves to `ready` (or `verifying_login` in a login flow) with a fresh observation and a new page revision.
- **CP-FR-09:** On refusal, unparseable output after the adapter's bounded retry, attempt exhaustion, timeout (proposed 45 s per challenge), or a new challenge kind appearing, the solver stops and the session hands off with a specific reason (“AI could not solve the verification after 2 attempts”, “The AI model declined to solve this verification”).
- **CP-FR-10:** When `vision_llm` is ineligible or fails, the existing external-provider ladder still runs (VD-14) and remains unchanged.

### 6.8 Interaction with runners, tools, pause, and sub-agents

- **CP-FR-11:** The task runner must wait for the solver outcome before entering its existing handoff wait. Solver time counts as active task time; user handoff time does not (D-21).
- **CP-FR-12:** Existing browser tools (`browser_observe`, `browser_run_actions`) that meet a challenge must wait for the solver outcome (bounded by the solver timeout) and then return either a fresh observation with a `challenge_auto_solved` notice or today's handoff result.
- **CP-FR-13:** Pause, Take control, and Stop must interrupt the solver at its next safe point; Stop aborts its in-flight model request. A paused or taken-over session never resumes solving on its own.
- **CP-FR-14:** Sub-agent tasks use the same solver. Their notices are routed to the parent conversation with the task label (M-FR-08), and results report `user_interventions` only for real handoffs, plus a separate `auto_challenges` count.

### 6.9 Hosted server requirements

- **H-FR-01:** The hosted decision endpoint must accept the `visual` field, validate it with the existing screenshot validation (size cap, data-URL format), and route image-bearing requests only to image-capable model settings (`MULTIMODAL` / `VISION`).
- **H-FR-02:** The server must not persist decision images (including in `screenshot_store`) and must exclude them from request logs; it may log size and hash.
- **H-FR-03:** Image tokens must be counted in usage and cost; hosted entitlement checks apply where the final provider request is built (D-07).
- **H-FR-04:** The server must return a typed `model_refused` reason when the upstream model declines, so the desktop can hand off without retrying.

## 7. Settings and user experience

Settings (browser section of AI provider settings):

- **“Let AI view the browser screen when needed”** (vision assist): default off during rollout, then default on for vision-capable routes after qualification. Shows whether the current route supports vision.
- **“Let AI solve simple verification checks (CAPTCHA)”**: default off; requires vision assist; first enable shows the disclosure.
  - Sub-options: “Also try slider and click-in-order puzzles” (default off), and a per-domain “never auto-solve on this site” list.
- **“Use the local vision model to double-check clicks”**: shown when the GUI-Actor runtime is installed.

In chat and task UI:

- **Session card and task row:** show “AI is looking at the page” when a frame is attached and “AI is solving a verification check (1/2)” while solving. Take control and Stop stay available throughout.
- **Notices:** a short notice when a challenge was solved automatically, and today's handoff dialog with a specific reason when it was not.
- **Point clicks:** when a point action needs approval, the approval card names the element that was actually hit (role and name), not the model's wording.

All new UI text needs English, Chinese, Spanish, French, German, and Japanese translations. All changed UI requires component tests in the same change; the CAPTCHA solve flow and a point-action flow need Playwright coverage on local fixture pages.

## 8. Proposed budgets

| Budget | Default / hard | Notes |
| --- | --- | --- |
| Visual frames per task | 6 / 12 | Exhaustion continues text-only or hands off |
| Frame time-to-live | 60 s | Also invalidated by navigation, pause, handoff |
| Frames held per session | 4 | Oldest evicted unless pinned by a pending decision or approval |
| Full-frame longest edge | 1280 px | Challenge crops: 768 px |
| Encoded image size | ≤ 600 KB full frame, ≤ 200 KB crop | JPEG quality stepped down, then size |
| Point-action freshness | ≤ 5 s since capture, zero scroll/viewport drift | Otherwise `frame_stale` |
| Hit-element stability wait | ≤ 500 ms | Two reads 100 ms apart must match |
| `browser_view` calls per chat round | 1 | Shared with the chat image cap |
| CAPTCHA attempts | 2 per challenge, 3 per task, 5 per domain per hour | Then handoff |
| Solver timeout | 45 s per challenge | Counts as active task time |
| Directive wait in worker | 2 s | Then handoff (today's behavior) |
| Local grounding call | ≤ 8 s | Otherwise skipped (cross-check) or escalate (locator) |

Proposed qualification objectives (to validate, not promises): on the fixture and held-out sets, at least 90% of point actions hit the intended element, 0 point actions hit a different element without being rejected first, at least 85% success on `text_image` and `arithmetic`, at least 70% on `checkbox_widget`, and at least a 30% relative reduction in `escalated` task outcomes on vision-trigger task families.

## 9. Evaluation and acceptance

Evaluation sets:

1. **Local fixture pages** (deterministic, offline): text-code CAPTCHA with known answers in Latin and CJK fonts; arithmetic question; fake checkbox widget in a cross-origin iframe; fake slider; canvas-only button; icon-only toolbar; modal overlay over a target; target inside nested iframes; auto-scrolling page; animated target; password field next to a CAPTCHA.
2. **Geometry matrix:** device pixel ratio 1, 1.25, 1.5, 2; browser zoom 90%, 110%, 125%; scrolled pages; crops at image edges.
3. **Held-out real-page screenshots** with labeled target boxes, for click accuracy (scored offline, no live clicks).
4. **Provider matrix:** hosted vision model, one custom vision model, one custom non-vision model, and local grounding on/off.

| Acceptance ID | Evidence |
| --- | --- |
| V-AC-01 | Every frame's transform maps mark centers back inside their element boxes on the whole geometry matrix |
| V-AC-02 | A sentinel password and OTP never appear unmasked in any image sent to a provider |
| V-AC-03 | No image bytes appear in tool results, transcripts, task records, logs, notices, or server storage |
| V-AC-04 | A custom non-vision route never sends an image and never routes to hosted; vision features show as unavailable |
| V-AC-05 | `browser_view` images reach only the next model round and are absent after reload and compaction |
| G-AC-01 | A point action after scroll, resize, navigation, or a stale frame is refused before dispatch and re-captured |
| G-AC-02 | A point landing on an overlay, a password field, or a different element than the cross-check is not executed |
| G-AC-03 | A point on a registered element snaps to the normal reference path |
| G-AC-04 | A point on a consequential element requests approval naming the hit element; reobservation with the same hit does not loop |
| G-AC-05 | Post-dispatch failures are `effect_unknown` and never replayed |
| CP-AC-01 | Text-code and arithmetic fixtures are solved within limits; the session returns to `ready` with a fresh observation |
| CP-AC-02 | Image-grid, invisible, payment-flow, security-flow, OTP, and passkey fixtures always hand off without any model call |
| CP-AC-03 | A model refusal hands off immediately with the refusal reason and no second request |
| CP-AC-04 | The solver cannot click outside the challenge region, navigate, or run scripts; the outer model cannot act during `challenge_resolving` |
| CP-AC-05 | Attempt limits per challenge, task, and domain hold across refreshes and parallel sub-agents |
| CP-AC-06 | A solver “solved” result with the challenge still present hands off |
| CP-AC-07 | Pause and Stop interrupt the solver; Stop cancels its in-flight request |
| CP-AC-08 | With the feature off, every challenge produces exactly today's events and handoff |
| X-AC-01 | UI tests, Playwright flows, six-language key parity, and qualification objectives meet the agreed release gates |

## 10. Delivery phases and rollback

1. **Geometry foundation:** element boxes in observations, `CAPTURE_VISUAL_FRAME`, the frame composer (crop, resize, mask, marks), the in-memory frame store, and geometry tests.
2. **Vision for decisions:** `visual` input, multipart chat adapter, vision triggers and budget in the runner, mark-to-reference clicks only. No point actions yet.
3. **Main-chat view:** the `browser_view` tool through the transient image handoff; marks usable with `browser_run_actions`.
4. **Simple CAPTCHA:** subtype detection, worker directive wait, `vision_llm` policy mode, `ChallengeSolverService` for `text_image`, `arithmetic`, and `checkbox_widget`, settings, disclosure, and UI.
5. **Point actions:** `CLICK_POINT` and `DRAG_POINT` with mapping, freshness, hit-testing, snapping, risk, and approvals; optional GUI-Actor cross-check; opt-in `slider` and `click_order`.
6. **Hosted parity:** server endpoint vision support (H-FR-01 to H-FR-04) and hosted qualification.
7. **Controlled rollout:** enable per route after qualification; monitor click accuracy, solve rate, refusal rate, escalation reduction, cost per verified task.

Kill switches: `AIFETCHLY_BROWSER_VISION_ENABLED` (vision assist), `AIFETCHLY_BROWSER_VISION_CAPTCHA_ENABLED` (solver), and `AIFETCHLY_BROWSER_POINT_ACTIONS_ENABLED` (point operations). Each is absent → disabled, like existing kill switches. Disabling vision returns every path to text-only. Disabling the solver restores today's challenge events and handoff exactly (CP-AC-08). Active solves cancel safely and hand off.

## 11. Risks, dependencies, and evidence limits

- **Model refusals:** some hosted frontier models decline CAPTCHA requests. Mitigated by VD-11 and by routing hosted challenge solving only to model settings that the server operator qualified for it; refusal rates are reported per model.
- **Behavior-scored widgets:** checkbox widgets and sliders score input behavior and browser signals, so a correct click can still fail or escalate. Expected; bounded by attempts and handoff.
- **Account and site risk:** automated challenge solving can violate a site's terms and can flag accounts. Mitigated by opt-in, per-site exclusion, per-domain rate limits, no proxy rotation, and handoff on failure. The disclosure must say so.
- **Coordinate errors:** device pixel ratio, provider resizing, scroll, layout shifts, animations, and iframes can each misplace a click. Mitigated by the geometry contract (technical design §5), freshness checks, hit-testing, snapping, the stability wait, and the optional cross-check.
- **Privacy:** screenshots contain more than the text observation (other people's names, images, messages). Mitigated by masking, cropping, opt-in, transient handling, and disclosure.
- **Cost and latency:** each frame adds roughly 1,000–1,500 input tokens and image upload time. Mitigated by triggers and budgets; cost per verified task must be reported.
- **Prompt injection through images:** a page can render text instructing the model. The image is treated like untrusted page content; it cannot change constraints, approvals, or risk, and point actions are host-validated.
- **Local grounding resources:** GUI-Actor on CPU can be slow; it stays optional with a time limit.
- **Server dependency:** hosted vision decisions require the not-yet-built decision endpoint.

## 12. Privacy and data disclosure

| Data | Hosted mode | Custom-provider mode |
| --- | --- | --- |
| Masked viewport screenshots with numbered marks | Sent to the AiFetchly AI server and its upstream vision model for one request; not stored | Sent only to the user's endpoint, if its model supports vision |
| Cropped CAPTCHA images | Same, only when CAPTCHA solving is enabled | Same |
| Mark legend (roles and names) | Same as today's candidate names | Same |
| Password, OTP, payment-card fields | Masked in images; never sent as text | Same |
| Local grounding inputs | Stay on the device | Stay on the device |
| Diagnostics | Frame IDs, sizes, transforms, hashes, hit descriptors — no images | Same |

This replaces the “Screenshots” row of the Browser Decision Acceleration PRD §12 table.

## 13. Changes to the Browser Decision Acceleration PRD

| Location | Change |
| --- | --- |
| §4 out of scope: “CAPTCHA solving” | Narrowed: simple CAPTCHA subtypes may be solved under §6.7 of this PRD; image grids, invisible challenges, and all OTP/2FA/payment/security challenges remain out of scope |
| §4 out of scope: “Exposing model-generated selectors, coordinates, …” | Narrowed: normalized points from a model are allowed only through the host-validated point actions of §6.5; selectors, scripts, and pixel coordinates remain excluded |
| §4 out of scope: canvas and iframe support | Bounded support through vision and point actions; universal support remains out of scope |
| §6.5 table, “CAPTCHA, security challenge” row | “Eligible simple CAPTCHA: solver (§6.7 here), then handoff on failure. Others: user handoff.” |
| D-FR-16 operation set | Adds `CLICK_POINT`, `DRAG_POINT`, `REQUEST_VISUAL` when the route supports vision |
| §12 “Screenshots” row | Replaced by §12 of this PRD |
| C-FR-02 | A detected challenge first goes through the solver when eligible; the blocking handoff applies when it fails |

## 14. Glossary

| Term | Meaning |
| --- | --- |
| Visual frame | A viewport screenshot plus the geometry needed to map any point in it back to the page |
| Marks (Set-of-Mark) | Numbered boxes drawn over known elements in the image so the model can answer with a number |
| Normalized point | An `(x, y)` pair of integers from 0 to 1000 over the image that was sent |
| Hit-test | Asking the page which element is under a point (`elementFromPoint`) |
| Snap | Converting a point action into a normal reference action when the hit element is known |
| Grounding model | A model that returns where a described control is in an image (GUI-Actor) |
| Challenge region | The bounding box of the CAPTCHA widget or form the solver may act in |
| Device pixel ratio (DPR) | Screen pixels per CSS pixel; screenshots are in screen pixels, mouse input is in CSS pixels |

## 15. Open questions

| ID | Question | Proposed default |
| --- | --- | --- |
| VQ-01 | Default for vision assist after rollout | On for vision-capable routes; CAPTCHA solving stays opt-in |
| VQ-02 | Should hosted challenge solving use a dedicated model setting on the server? | Yes, an operator-selected setting tagged for challenge use |
| VQ-03 | Do CAPTCHA solves count against a plan quota differently from other decisions? | Same as decisions; agree with server owners |
| VQ-04 | Should `login` flows be eligible by default once the feature is on? | Yes, with cropping and masking; revisit after pilot |
| VQ-05 | Per-domain exclusion list: user-only, or also seeded? | User-only in v1 |

## 16. Related documentation and sources

- [Browser Decision Acceleration PRD](browser-decision-acceleration-prd.md) and [design](browser-decision-acceleration-technical-design.md).
- [Managed browser PRD](puppeteer-managed-social-browser-prd.md) and [design](puppeteer-managed-social-browser-technical-design.md) (challenge policy §18.3).
- [Computer Use PRD](computer-use-aifetchly-prd.md) and [design](computer-use-aifetchly-technical-design.md) (grounding contract, coordinate spaces §11).
- AI server: `aifetchserver/services/scrape_assist.py` (screenshot attachments), `aifetchserver/api/scrape_assist.py` (`_normalize_and_validate_screenshot`), `aifetchserver/services/api_settings.py` (`get_multimodal_fallback_candidates`), and `docs/image-qa-tool.md` in the server repository.

Provider image-resizing behavior and model refusal behavior change over time; revalidate per provider and model before qualification.
