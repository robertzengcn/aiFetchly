# Browser Decision Acceleration — Desktop PRD

## Document information

| Item | Value |
| --- | --- |
| Status | Proposed implementation contract; no feature is implemented by this document |
| Version / date | 1.0 / 2026-10-30 |
| Repository / owners | AiFetchly / Desktop, AI Runtime, Browser Automation, QA |
| Baseline inspected | `c01e6cd9c` |
| Companion | [Desktop technical design](browser-decision-acceleration-technical-design.md) |
| Server requirements | [Server PRD](../../../aifetchserver/doc/decision-model-routing-prd.md) |
| Wire authority | [Server technical design, contract v1](../../../aifetchserver/doc/decision-model-routing-technical-design.md#5-public-contract-v1) |

“Must” defines required behavior. Numerical limits and performance targets marked proposed are initial engineering defaults, not measured results or commercial promises. Existing browser security and account policies continue to apply. This document explicitly extends browser AI availability to a user's configured provider; it does not unlock unrelated hosted AI features.

## 1. Problem and evidence

Browser automation currently requires repeated generative-model decisions. Each round can resend conversation context, tool definitions, and page observations. This increases latency and cost, particularly for routine clicking, filtering, and filling.

Verified implementation facts:

- `src/service/AIChatQueryLoop.ts` dispatches repeated completion requests with the current messages and exposed tools; tool results enter the transcript. Existing context budgeting/compaction already bounds this behavior, but does not eliminate repeated inference.
- `src/childprocess/managed-browser/WorkerSession.ts` returns `observation: null` after an action program. The model can need an additional observation tool round before deciding the next action. Batching means this is not necessarily two calls for every individual action.
- `BrowserObservationService.ts` provides sanitized semantic observations, registered references, and bounded text. The current budgets are 120 interactive elements, 12,000 text characters, and 64 KiB serialized observation size.
- `ManagedBrowserAiToolService.ts` already enforces target-based risk checks, exact-program approvals, challenge handoff, and cancellation. Its AI gate currently checks hosted entitlement.
- `AIProviderResolver.ts` already routes chat to hosted or user-managed providers. The persisted name `local` includes remote third-party endpoints.

These facts establish potential overhead, not a measured production bottleneck. Instrumentation must establish the actual baseline before claiming savings.

## 2. Product outcome

Let an LLM establish the task, constraints, and reusable text values. Let a fast decision engine select routine operations and observed targets. Keep execution on the desktop and invoke an LLM only for planning, necessary text generation, ambiguous decisions, recovery, and final verification when deterministic checks are insufficient.

The decision engine must work with:

1. AiFetchly-hosted Jev or hosted Laya through the AI server.
2. A user-managed native decision API, including a compatible hosted Laya service.
3. An ordinary user-managed OpenAI-compatible chat API through a compact chat-based decision adapter.

Native discriminative inference and chat-based decision generation are distinct implementations. Structured JSON from a chat model does not make it a discriminative model or guarantee equivalent latency/calibration.

## 3. Users and primary stories

| User | Story | Required result |
| --- | --- | --- |
| Hosted subscriber | Search a site and apply filters without waiting for a full chat round per action | Bounded fast loop; normal browser visibility and progress |
| Custom-provider user | Run the same task through my chosen endpoint and credentials | Direct desktop-to-provider requests; no silent hosted requests |
| Advanced user | Use a cheaper browser model while retaining a stronger planning model | Optional real model override on the same provider |
| Native-model user | Configure a dedicated Jev/Laya-compatible endpoint | Native capability validation and typed decisions |
| User facing login | Complete sign-in or a challenge myself | Existing handoff; no automated credential entry |
| Operator | Explain failures and actual task cost | Correlated task/step/attempt records with redacted metadata |

## 4. Scope and non-goals

### In scope

- A single managed-browser task runner exposed through `browser_execute_task`.
- Existing Puppeteer worker, session lifecycle, accounts, and browser dependencies.
- Post-action observation, compact candidates, provider adapters, budgets, and capability discovery.
- Reusable planned field values, bounded field-text helper, recovery, and outcome verification.
- Provider-aware browser availability; configuration UI, progress, stop, approval, and handoff behavior.
- Hosted and custom-provider parity for browser tasks, with route-specific capabilities and honest limitations.
- Offline tests, local fixture E2E, shadow evaluation, and phased deployment.

### Out of scope for v1

- Moving authenticated Chrome sessions, cookies, or DOM handles to the server.
- Replacing Puppeteer, rewriting legacy scrapers, or reusing the legacy selector-generating scrape-assist protocol as this contract.
- Training/deploying a local desktop model, automatically downloading weights, or automatically provisioning GPU services.
- Universal iframe, shadow-root, canvas, multi-tab, upload, or arbitrary widget support. Unsupported interactions use existing authorized paths or handoff.
- Exposing model-generated selectors, coordinates, scripts, shell commands, or arbitrary tools in the accelerated path.
- Automatically publishing, sending, deleting, or bypassing approvals because a model is confident.
- Changing subscription eligibility of embeddings, keywords, email generation, or other hosted-only services.

## 5. Confirmed design decisions

| ID | Decision |
| --- | --- |
| D-01 | Desktop owns the browser and execution authority; inference returns proposals only. |
| D-02 | The runner executes multiple browser steps inside one outer chat tool invocation. Intermediate observations are not appended to main chat history by default. |
| D-03 | Browser decisions, text helpers, recovery, and verification follow the user's selected provider boundary. No automatic custom-to-hosted fallback. |
| D-04 | Support hosted, user-native, and user-chat decision adapters behind one desktop interface. |
| D-05 | Default custom decisions use the configured chat provider/model; optionally select another real model on that provider. |
| D-06 | A native endpoint is explicitly configured/tested. OpenAI compatibility alone does not imply `/systemone` support. |
| D-07 | Token checks happen where the final provider request is constructed: AI server for hosted calls, desktop for direct custom calls. |
| D-08 | Capability discovery is advisory; every request is validated. Routing uses evaluated quality, language, options, budgets, health, cost, and latency. |
| D-09 | Stale state, approval, handoff, uncertain inference, and unsupported inputs have distinct outcomes. They do not all trigger LLM recovery. |
| D-10 | `DONE` requires independent verification. Unknown mutation effects are inspected and never blindly replayed. |

## 6. Functional requirements

### 6.1 Admission and provider ownership

- **D-FR-01:** Check provider-aware AI availability before request parsing, network calls, session creation, or work admission. Hosted requires `USER_AI_ENABLED`; custom requires enabled/valid user configuration. Retain managed-browser release/settings gates and account/platform policies.
- **D-FR-02:** Resolve and freeze a provider/configuration revision for a task segment. Cancel pending inference if provider settings change; discard late results and require fresh admission before resuming through a new provider.
- **D-FR-03:** Keep user API keys in main-process secret storage. Never send them to the renderer, browser worker, AI server, or an unrelated provider.
- **D-FR-04:** Host-specific aliases such as `small` must be resolved locally to a configured real model before custom requests. Native protocols must not receive chat aliases.

### 6.2 Task lifecycle

- **D-FR-05:** Accept a goal, explicit constraints, and completion criteria. Establish a bounded plan and known value bindings once, using the selected chat provider when planning is needed.
- **D-FR-06:** Run observe → prepare candidates → decide → validate → execute → observe without reentering the main chat loop after each step.
- **D-FR-07:** Stream concise progress through existing job/event mechanisms. Keep a task associated with its conversation, tool call, browser session, provider revision, and cancellation owner.
- **D-FR-08:** Preserve the single controlled browser/session limits. Serialize mutation commands and prevent the old browser tools and the runner from controlling the same session concurrently.
- **D-FR-09:** Stop on cancellation, deadline, step/model-call budget exhaustion, challenge, denied permission, unsupported interaction, or unresolved execution effect. Preserve useful partial results and a truthful terminal reason.
- **D-FR-10:** After restart/crash, do not automatically resume mutations. Saved task metadata can explain interruption; resuming requires a live session and fresh observation/admission.

### 6.3 Observations and candidates

- **D-FR-11:** Return a fresh sanitized observation after an action program where possible. Detect challenges before presenting a ready next-step state; update the main-process observation/revision cache before subsequent risk classification.
- **D-FR-12:** Expose observed IDs, roles, names, allowed operations, relevant control state, and bounded native options. Exclude secret values and retain the untrusted-page-content boundary.
- **D-FR-13:** Prefer focused controls, active dialogs, visible suggestions, and task-relevant regions. Maintain coverage through bounded scrolling/reobservation. Do not assume the first controls in document order contain the target.
- **D-FR-14:** For small-budget models, shortlist candidates without silently dropping critical goal/constraint information. Include an escalation route when no offered candidate fits. Measure shortlist recall independently.
- **D-FR-15:** Handle disabled, detached, occluded, changed, sensitive, and unsupported controls explicitly. Revalidate live targets immediately before input.

### 6.4 Decisions and field values

- **D-FR-16:** V1 operations are `CLICK`, `FILL`, `SELECT`, `SCROLL_UP`, `SCROLL_DOWN`, `WAIT`, `DONE`, and `ESCALATE`. Offer only operations supported by the observed page/executor.
- **D-FR-17:** Native adapters may ask operation and operation-specific target questions in one request. Consume only the selected operation's target. `SELECT` chooses an observed option ID, not generated text.
- **D-FR-18:** Chat adapters send compact task state and a constrained output request, preferring verified JSON Schema support, then tool calling, then JSON with strict validation. Unsupported formatting features must not cause unlimited repair calls.
- **D-FR-19:** Never treat a chat model's self-reported confidence as calibrated native uncertainty. Report unknown uncertainty honestly and rely on schema/candidate checks, evaluated policy, and recovery.
- **D-FR-20:** Resolve a selected field to an existing plan binding only when the mapping is unambiguous. Otherwise use a bounded field-text helper. Validate text length/type and reject secret/credential entry through this path.
- **D-FR-21:** Reuse a helper result after a stale read only when its complete helper input is identical and no corresponding mutation could have executed. Arbitrary cached field text must not survive a changed goal, field, context, or provider revision.

### 6.5 Usability checks and recovery

| Condition | Required behavior |
| --- | --- |
| Structurally valid, supported, sufficiently reliable decision | Revalidate page/target and pass through local risk/permission checks |
| Stale observation / detached target before execution | Observe again; spend a new decision within remaining budgets |
| Missing candidates / relevant state omitted | Gather bounded additional observation; escalate if coverage remains inadequate |
| Selected model cannot fit the request | Route only within allowed provider policy, or return input-budget failure |
| Uncertain operation or selected target | Bounded alternative decision model if allowed, then LLM recovery |
| Approval required | Pause with exact action/program digest and revision; never ask an LLM to approve |
| Login, credential, CAPTCHA, security challenge | Existing user handoff |
| Execution effect unknown | Reconcile observed outcome; never automatically retry the mutation |
| Repetition or no progress | LLM recovery with specific evidence; stop if recovery is exhausted |
| `DONE` | Fresh independent check of completion criteria |

- **D-FR-22:** LLM recovery receives the current subgoal, trusted constraints, fresh relevant observation, ambiguous candidates, and recent action outcomes. It may select an observed target, revise a bounded subgoal, request richer observation, or identify needed user input.
- **D-FR-23:** Recovery may not recursively create unbounded browser agents, reset task budgets, invent selectors/code, or override execution policy. The loop returns to the fast path after recovery.
- **D-FR-24:** Verification uses deterministic URL/control/result predicates where possible. An optional selected-provider LLM verifier is separately budgeted and cannot use the decision's `DONE` assertion as proof.

## 7. Settings and user experience

Extend the existing AI Provider settings with a simple browser-decision section:

- “Use my chat provider” is the default for custom-provider mode.
- Optional browser decision model override; show that it must exist at that provider.
- An advanced native decision profile allows endpoint, optional separate credential, model/checkpoint, protocol, and explicit limits. It is inert until selected.
- Connection tests report chat/structured-output/native capabilities separately. A passing `/models` or chat test does not certify native decisions or browser accuracy.
- Use “Fast browser decisions” as user-facing wording; expose model/protocol details only where users configure or diagnose them.
- Show progress, pause/approval/handoff, partial result, cancellation, and clear terminal errors. Do not expose raw probabilities or internal prompts in ordinary task flow.
- A provider configuration change must clearly interrupt/rebind an active task rather than silently redirecting page data.
- All added UI text needs English, Chinese, Spanish, French, German, and Japanese translations. All changed UI requires component tests in the same implementation change; critical flows also need Playwright coverage.

## 8. Proposed budgets and performance objectives

| Budget | Proposed default / hard ceiling | Notes |
| --- | --- | --- |
| Active task runtime | 120 s / 240 s | User approval/handoff waiting uses separate existing time limits |
| Executed leaf steps | 30 / 100 | Includes recovery-directed browser actions |
| Decision requests | 45 / 120 | Includes stale retries and alternatives at the logical request level; upstream attempts also bounded |
| LLM recovery calls | 2 / 3 | Planning, field helpers, and verification are separately counted |
| Field helper calls | 4 / 10 | Reuse trusted plan bindings before invoking a helper |
| Planner / optional LLM verifier | 1 each | Additional planning requires recovery budget |
| Hosted decision request timeout | 3 s / 10 s | Capped by remaining task time |
| Direct custom request timeout | 10 s / 30 s | Accommodates slower hardware; measured end-to-end |
| Upstream attempts per decision request | 2 total | No nested retry multiplication |
| Consecutive equivalent failures | 3 | Consistent with existing action-program ceiling |

Proposed pilot objectives: reduce median task time by at least 50% and expensive generative-model calls by at least 70% on eligible multi-step tasks, relative to the measured baseline, without a material task-success regression. These are go/no-go targets to validate, not expected universal improvements. Before qualification, predeclare the acceptable success-rate margin (proposed maximum regression 5 percentage points) and confidence method. A 50–100-task pilot is exploratory; if confidence intervals do not resolve that margin, collect more evidence before promotion. Any execution-policy bypass blocks release regardless of average task success. Record p95 latency and cost per verified successful task, calculated as all-attempt cost divided by verified successes, including the cost of failed tasks.

## 9. Evaluation and acceptance

Run paired evaluations with identical goals, initial states, task budgets, and independent outcome checks:

1. Current application.
2. Existing model plus improved action/observation flow.
3. Hybrid runner with Jev.
4. Hybrid runner with hosted Laya.
5. Hybrid runner with representative custom chat providers/models.

Start with 50–100 held-out tasks spanning search, forms, filters, pagination, navigation, and extraction. Include all six supported UI languages and mixed-language pages, slow pages, large candidate sets, ambiguous labels, overlays, stale nodes, challenges, provider failures, and cancellation. Split by website/template and task family; avoid tuning on the held-out set. Use repeated runs and report sample sizes/uncertainty. A single-step accuracy number is insufficient because errors compound across a task.

| Acceptance ID | Evidence |
| --- | --- |
| D-AC-01 | Hosted/custom requests and recovery reach only the selected provider boundary |
| D-AC-02 | Unsubscribed custom-provider user can run eligible browser tasks; hosted-only APIs remain gated |
| D-AC-03 | Post-action observation updates both worker result and main cached descriptors/revision |
| D-AC-04 | No decision can execute a target outside its bound observation or invent an option |
| D-AC-05 | Consequential actions retain exact-program approval, including custom mode and full-access chat |
| D-AC-06 | Stale pre-action failures can reobserve; unknown mutation effects never replay automatically |
| D-AC-07 | Stop cancels inference, helper/recovery, and worker execution; late responses cannot act |
| D-AC-08 | Native and chat adapters have honest uncertainty/usage attribution and model-specific budgets |
| D-AC-09 | Every successful task has fresh independent verification; partial failures are not shown as success |
| D-AC-10 | UI tests, E2E, six-language translations, and performance evaluation pass agreed release gates |
| D-AC-11 | Old servers/providers without decision metadata work through explicit supported paths without a hosted leak |

## 10. Delivery phases and rollback

1. **Baseline:** add timing/call-cost instrumentation and fix post-action observation. Preserve the old tool path for comparison.
2. **Runner:** implement the desktop contract, session lease, state machine, mock decision client, verification, cancellation, and progress.
3. **Provider parity:** deliver hosted decision client and custom chat-decision client together; include provider-aware gating and settings.
4. **Native pilot:** add user-native profiles, Jev adapter compatibility, hosted Laya shadow evaluation, and versioned calibration.
5. **Controlled rollout:** enable selected eligible tasks, monitor successful-task cost and regressions, expand only after evidence.
6. **Specialization:** if useful, fine-tune Laya with permitted, reviewed browser traces and recalibrate; this is a separate training project.

Provide global and per-engine feature switches. Disabling acceleration returns future tasks to existing browser tools; active tasks cancel safely. Rollback never automatically redirects custom users to hosted AI. New settings are additive and old configuration remains readable.

## 11. Risks, dependencies, and evidence limits

- Laya's small default budgets, large option-set degradation, domain accuracy, and calibration must be tested for browser tasks. Provider hosting does not remove those model constraints.
- Short input does not guarantee easy decisions. Candidate count, labels, language, and task ambiguity affect eligibility.
- The reference `jev-ultrafast` project uses hosted Jev, not redistributable Jev weights. Its measured browser protocol reduction is relevant inspiration, not an AiFetchly benchmark.
- Its 7.073-second Flights report includes 17 Jev requests and 90,558 Jev input tokens. The reported tiny text-helper charge excludes Jev/browser costs. Optimize total cost per verified task, not token count alone.
- Headed browser state, network, provider queues, and field generation can dominate latency even when decision inference is fast.
- Hosting gateway/proxy forwarding for new server endpoints must be verified before hosted launch; work in other repositories is an external dependency, not assigned here.

## 12. Related documentation and sources

- [Existing managed browser PRD](puppeteer-managed-social-browser-prd.md) and [design](puppeteer-managed-social-browser-technical-design.md).
- [Custom provider PRD](local-ai-provider-chat-prd.md) and [design](local-ai-provider-chat-technical-design.md).
- [TypeSafe models and limits](https://docs.typesafe.ai/models), [confidence](https://docs.typesafe.ai/confidence), [speculative fan-out](https://docs.typesafe.ai/patterns/fan-out).
- [Laya model card and documented limitations](https://huggingface.co/convaiinnovations/laya).
- [Reference runtime and measurement boundaries](https://github.com/browser-use/jev-ultrafast/blob/main/docs/performance.md).

External model facts were reviewed on 2026-10-30. Capabilities and prices must be revalidated when implementing or changing providers; they are not hardcoded product promises.
