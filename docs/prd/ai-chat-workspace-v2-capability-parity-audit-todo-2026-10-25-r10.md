# Workspace capability parity — R10 audit and TODO

Date: 2026-10-25. Audited commit: `68e4ad1b515c5d30b12ca710692bfc157632f808`.

**Verdict: no — not all implementable requirements are complete. Three permission-action defects were reproduced against the real renderer store.** The capability families have substantial implementation and test coverage, but permission failure handling and conversation isolation still violate the requirements. Release certification is also outstanding. This is an audit and remediation backlog, not an application fix.

## Baseline and scope

The baseline is the two files named in this request, resolved in the current `workspace-parity` worktree:

- [PRD](ai-chat-workspace-v2-capability-parity-prd.md), SHA-256 `e0192050dcf21250999a7e657fd90d435f670fbc78abc17a04359d393299409c`.
- [Technical design](ai-chat-workspace-v2-capability-parity-technical-design.md), SHA-256 `5ead5c57baeb29a289256bc96683efd1f7c18d981b72365d68b7bf59e20ca897`.

Unlike R9's main-checkout comparison, this audit uses the worktree documents, including their recorded extraction deferral and interactive deny-equals-stop policy. It does not reopen those owner decisions. Main-process stale-denial validation added in R9 remains present; B01 below is a separate renderer fallback defect.

Source review covered submission/command orchestration, selected-conversation state, permission handlers, queue dispatch/identity, schemas, capability composition and existing verification artifacts. The coverage matrix distinguishes reachable implementation from full acceptance certification. No finite review establishes that no other bugs exist. Existing untracked October 20 and R8 reports are preserved.

## Current validation evidence

| Check | Fresh result |
| --- | --- |
| `yarn typecheck` | Passed, exit 0 |
| `yarn vue-typecheck` | Passed, exit 0 |
| `yarn test:components` | Passed, exit 0: 169 files / 1,443 tests |
| Focused permission probes | Reproduced twice: 10 existing tests pass, 3 added assertions fail |
| Three interrupted-run main files, `--maxWorkers=2` | Passed, exit 0: 3 files / 23 tests; failures did not reproduce |
| Full main, module and Electron release gates | Not certified by this audit |

Session logs: `/tmp/workspace-parity-r10-{typecheck,vue-typecheck,components,probes,main-recheck}.log`. These are transient; the important results and executable probe code are recorded in this report.

The three focused probes executed the production Pinia store with mocked IPC responses and real selection handshakes. All ten existing permission cases passed; all three added expected-behavior assertions failed. This establishes renderer control-flow defects, not a live Electron race reproduction. Reproduction code is preserved below so the findings do not depend on ephemeral `/tmp` files.

A full main suite and selected Electron acceptance suite were started before the environment interruption. Their final exit statuses were not recovered, and their temporary logs disappeared; neither is counted as passed. The partial main output included failures in `PortableMemoryPrivacyReview.test.ts`, `OutboundEmailDeliveryService.test.ts`, and `OutboundEmailDraft.model.test.ts`. All three subsequently passed a fresh reduced-concurrency rerun (23 tests). The interrupted broad-run failures remain unclassified validation observations, not three additional confirmed product bugs; this rerun does not establish a green full main gate. The earlier R9 report records a green full Electron run of 188 passed / 2 skipped; that is historical evidence, not a fresh R10 result.

## Requirement coverage and completion assessment

“Covered” means an implementation and relevant existing tests were identified; it does not certify every clause or platform. No family with an outstanding defect is marked complete.

| Requirement range | Implementation / evidence | Current assessment |
| --- | --- | --- |
| FR-SUB-001–009 | `AiChatCenterSurface.performOrdinarySend`, `selectedConversation.sendMessage`, shared attachment builder; center, attachment parity, identity and rejected-send tests | Covered; no additional submission defect established in this audit |
| FR-CMD-001–009 | `useChatCommandRouting`, goal/skill/loop ports and approval dialog; `useChatCommandRouting.test.ts`, command E2E matrix | Covered; expanded prompts route through ordinary durable send |
| FR-QUE-001–014 | Workspace start IPC calls queue submission; `AIChatWorkspaceRunDispatchBridge`, source-id run lookup; identity, scheduler, terminal-ordering and queue/steering tests | Covered; fresh full integration/restart gate still required |
| FR-PLN-001–009 | Center decision/continuation and recovery handlers; deterministic continuation identity; center and plan acceptance tests | Covered; R9 retry-mode fix present |
| FR-PER-001–008 | Shared approval card, selected store, trusted grant/deny/resume IPC | **Incomplete: B01–B03**, especially FR-PER-007 and selected-conversation ownership |
| FR-OUT-001–010 | Dedicated outbound card/dialog and delivery service; outbound components and E2E spec | Covered; R9 attempted/settled re-approval fix present; main-gate observation needs disposition |
| FR-IMG-001–015 | Center preflight/chooser/batch staging, semantic image actions, reference drafts; image editing/batch/roundtrip specs | Covered; full journey certification not rerun here |
| FR-RPT-001–009 | Single/conversation report dialogs and session report state; report/center tests | Covered; R9 conversation-report markers retained |
| FR-VOI-001–010 | `useAiChatVoice`, shared composer and runtime dialog; voice component/journey tests | Covered in deterministic tests; real runtime/device evidence outstanding |
| FR-WSP-001–010 | `useConversationWorkspace`, badge/trust/context/memory panels and watcher services | Covered; real platform/workspace review still outstanding |
| FR-REC-001–008 | Presenter retry/recovery state, localized center details and context panel | **Incomplete for isolation: B03 / FR-REC-007**; other recovery paths covered by existing suites |
| FR-LIF-001–006 | Selection generations, bounded presenter and summary routing, parked clear/delete guards | **Incomplete: B01 and B03** violate cross-conversation isolation |
| FR-SKL-001–006 | Shared installation card/manager, command skill invocation; install state/manager/center suites | Covered; R9 ordered refresh and error handling present |
| FR-BRW-001–006 | Workspace start/session/handoff surfaces and shared APIs; corresponding component suites | Covered deterministically; authenticated lifecycle certification outstanding |
| FR-HIS-001–005 | History drawer, selected-context store, opaque schema fields and acknowledgement handling; history/selected-context suites | Covered under rollout flag; full archive/compaction journey not rerun here |
| FR-INT-001–005 | Shared memory/Auto Dream, workspace requests, live navigation, task cancellation, reasoning preference | Covered; certification and privacy review remain separate gates |
| A11Y-001–010 | Component accessibility and shell keyboard tests | Partial evidence; full focus/announcement/platform/zoom review remains open |
| PRD §13 / §16 | Semantic transcript/specialized cards; six-language runtime/parity tests | Existing coverage; no fresh exhaustive visual or linguistic certification |
| PRD §14; design invariants | AI gate before workspace start parsing, strict schemas, module delegation and durable queue identities | Targeted review only; full security review remains open; B01 demonstrates an action-ownership defect |
| PRD rollout/DoD; design §26 | Rollout adapters, retained V2 rollback, previous release evidence | **Not complete** until defects and remaining validation/certification gates close |

## Implementable defect TODOs

### B01 — P1: delayed Deny failure cancels a different conversation

- [ ] Remove the unvalidated generic-stop fallback from permission denial. Capture the originating conversation, run/tool identity and selection generation before awaiting IPC. A failed/stale decision must retain its retry path; any allowed cancellation must be validated by the main-process owner against that captured claim.
- **Requirements:** FR-LIF-001/002, FR-PER-005/007, design §12.2 and selected-conversation ownership.
- **Locations:** `src/views/store/selectedConversation.ts:1606` (`denyToolPermission`), `:1654` (`await stopActiveRun()`), `:1409` (`stopActiveRun` reads the current selection). `src/service/AIChatCoordinator.ts:526` confirms cancellation without a run ID targets the current run for the supplied conversation.
- **Reproduce:** select conversation A with a permission card; start Deny and leave its IPC unresolved; select running conversation B; reject A's IPC. The store catches the rejection, rewrites its current presenter, then calls the generic Stop action using B's ID.
- **Observed:** `cancelChatRun({ conversationId: "conv-2" })` was called once. Expected: no cancellation of B.
- **Impact:** unrelated work can be stopped by an old decision. This is distinct from R9's fixed main-process stale-tool check: a transport rejection takes the renderer fallback before that safeguard can protect the generic cancellation.
- **Closure tests:** delayed denial rejection, `{handled:false}`, duplicate/stale actions, A→B→A selection, and a newer run in A. Assert authoritative cancellation target/count, preserved card on failure and unchanged B transcript/runtime. Extend store tests and a controlled Electron selection-race journey.

### B02 — P1: failed authoritative denial is displayed as success

- [ ] Check both `result.ok` and `result.handled` before replacing a permission card with a denied receipt. On failure, preserve/restore the actionable decision and show a safe localized error. Do not convert failure into a generic cancellation.
- **Requirements:** FR-PER-007; FR-PER-006's validated-stop policy; design §12.2.
- **Locations:** `src/views/store/selectedConversation.ts:1619`; `src/main-process/communication/ai-chat-v2-ipc.ts` `handleDenyToolPermission` legitimately returns `{ok: cancelled, handled:true}` or the scheduled engine's `{ok: result.ok, handled:true, error}`.
- **Reproduce:** resolve the Deny IPC with `{ok:false, handled:true, error:"Cancellation failed"}`.
- **Observed:** the store removes `metadata.toolResult` and displays the denied receipt. The expected `needsPermissionPrompt === true` becomes `undefined`; no retry error is presented.
- **Impact:** a user is told a denial completed although the owner did not confirm it, and loses the actionable card while the work may remain parked.
- **Closure tests:** failed interactive cancellation, failed scheduled denial, transport exception, null response, successful valid denial and idempotent stale no-op. Assert failed decisions remain actionable and do not mutate unrelated runs. Existing tests that explicitly expect stopping after IPC failure must be corrected to the authoritative failure contract, not used as proof of correctness.

### B03 — P2: delayed Grant error appears in another conversation

- [ ] Scope grant completion/error mutations to the originating conversation and generation. Retain the failure with A for reconstruction; do not write A's failure into B's selected error banner. Apply the guard to both unsuccessful responses and exceptions.
- **Requirements:** FR-PER-007/008, FR-REC-007/008, FR-LIF-002.
- **Locations:** `src/views/store/selectedConversation.ts:1540`, especially unconditional `errorMessage.value = errMsg` at `:1581` and `:1590` after awaited resume IPC.
- **Reproduce:** begin Grant in A; select B while IPC is pending; return `{ok:false,error:"Conversation A permission failed"}`.
- **Observed:** B's `errorMessage` becomes `Conversation A permission failed`; expected B's error to remain null. The probe uses a harmless synthetic message; it does not claim an observed credential leak.
- **Impact:** cross-conversation error contamination and loss of correct failure ownership. Both response and exception paths lack a post-await selection/generation guard.
- **Closure tests:** failed response and rejection after A→B and A→B→A, same-chat newer-run changes, success after switch, and restoration of A's retryable decision. Ensure background attention remains bounded.

### D01 — P3: permission journey wording contradicts the adopted policy

- [ ] Reconcile PRD §17.4 step 5 with FR-PER-006. The journey still says denial returns a result to the model without distinguishing interactive from scheduled turns; FR-PER-006 explicitly adopts validated stop for interactive turns and continuation for scheduled loops.
- This is a documentation inconsistency, not a request to reverse the recorded owner decision. Acceptance tests should distinguish the two cases and require failures to stay retryable in both.

## Validation and release TODOs

- [ ] **T01 — Implementable:** add the B01–B03 regressions in `selectedConversation.permission.test.ts`, then fix the store and include the critical cross-conversation Electron case. Do not commit deliberately failing temporary audit probes as normal CI tests.
- [ ] **T02 — Implementable:** obtain fresh completed `yarn testmain` and relevant Electron results after fixes. The three partial-run files passed their isolated rerun; capture complete broad-run diagnostics if the failures recur before assigning cause. Run the PRD-required module/integration and full Electron gates on the final implementation revision; archive exit statuses, counts, skips and any flakes.
- [ ] **V01 — Environment-dependent:** real microphone, native voice runtime/model, transcription, auto-send and playback/cancel evidence on supported devices. Mocked voice tests are useful but insufficient.
- [ ] **V02 — Mixed automated/manual:** complete keyboard/focus/escape/announcement tests, 200% zoom and narrow-width review, reduced motion and screen-reader/platform certification. Automated coverage and much of the review are implementable; physical platform/assistive-device certification needs the appropriate environment.
- [ ] **V03 — Mixed code review/external setup:** perform the complete security review (AI gates, permission identity, email authorization, reports, workspace paths, images, background redaction and worker/database boundaries). This review is agent-actionable work, not inherently a hardware blocker. Authenticated managed-browser start/handoff/verification/expiry/reload certification separately requires configured accounts/environment.
- [ ] **V04 — Time/owner-dependent:** record the 14-day soak, ≥500 accepted submissions, ≥99.5% eligible acceptance, ≥99% exercised restart recovery, no disqualifying duplicate/cross-conversation/authorization incidents, and required owner sign-offs. Keep V2 rollback until the separate removal decision.

Recommended order: repair B01/B02 together at the authoritative denial boundary, fix B03 with consistent action ownership, add regressions, reconcile D01, complete T02, then finish release certification. Broadly passing existing tests cannot close the three reproduced defects.

## Reproducible focused probes

Copy `test/vitest/main/components/store/selectedConversation.permission.test.ts` to a temporary sibling named `R10AuditProbes.temp.test.ts`, append the following code, and run:

```bash
yarn test:components test/vitest/main/components/store/R10AuditProbes.temp.test.ts
```

The original file supplies the imports, mocks, `seedStore`, `permissionResult` and `TEXTS`. At the audited revision the original ten tests pass and these three assertions fail. Remove the temporary sibling after the probe; no production files need changing.

```typescript
describe("R10 permission ownership", () => {
  it("keeps a failed denial retryable", async () => {
    const perm = permissionResult("r10-deny", { toolCallId: "tc-r10" });
    await seedStore([perm]);
    windowInvokeMock.mockResolvedValue({ ok: false, handled: true, error: "Cancellation failed" });
    await useSelectedConversationStore().denyToolPermission(perm, TEXTS);
    expect(useSelectedConversationStore().messages.find((m) => m.id === perm.id)?.metadata?.toolResult?.needsPermissionPrompt).toBe(true);
  });

  it("does not cancel B after A's denial rejects", async () => {
    const perm = permissionResult("r10-switch", { toolCallId: "tc-r10-switch" });
    await seedStore([perm]);
    let rejectInvoke!: (reason: Error) => void;
    windowInvokeMock.mockImplementation(() => new Promise((_resolve, reject) => { rejectInvoke = reject; }));
    const pending = useSelectedConversationStore().denyToolPermission(perm, TEXTS);
    vi.mocked(selectConversation).mockResolvedValue({ conversationId: "conv-2", acceptedGeneration: 2, messages: [], nextBefore: null, hasOlder: false, runtimeStatus: "running", activeRunId: "run-2", title: "Other chat" });
    await useSelectedConversationStore().loadSelection("conv-2");
    rejectInvoke(new Error("ipc down"));
    await pending;
    expect(cancelChatRunMock).not.toHaveBeenCalled();
  });

  it("does not show A's grant error in B", async () => {
    const perm = permissionResult("r10-grant", { toolCallId: "tc-r10-grant" });
    await seedStore([perm]);
    let resolveInvoke!: (value: unknown) => void;
    windowInvokeMock.mockImplementation(() => new Promise((resolve) => { resolveInvoke = resolve; }));
    const pending = useSelectedConversationStore().grantToolPermission(perm, TEXTS);
    vi.mocked(selectConversation).mockResolvedValue({ conversationId: "conv-2", acceptedGeneration: 2, messages: [], nextBefore: null, hasOlder: false, runtimeStatus: "running", activeRunId: "run-2", title: "Other chat" });
    await useSelectedConversationStore().loadSelection("conv-2");
    resolveInvoke({ ok: false, error: "Conversation A permission failed" });
    await pending;
    expect(useSelectedConversationStore().errorMessage).toBeNull();
  });
});
```
