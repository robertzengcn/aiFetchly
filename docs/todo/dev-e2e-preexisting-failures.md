# dev E2E pre-existing failures (verified 2026-09-15 on the dev checkout itself)

While merging dev <-> worktree-chat-first-application-shell, the full E2E
suite showed 28 failing specs on the MERGED tree. Spot-verification on the
UNTOUCHED dev checkout reproduces the same failures — they are pre-existing
on dev, NOT merge regressions.

**RESOLVED 2026-09-22** — every group below is green on merged dev (full
suite: 68 passed / 6 skipped / 0 failed). Fixes landed in product code
wherever the shell was missing a surface the legacy dock owned:

| Spec group | Status | Resolution |
| --- | --- | --- |
| aiChatQueueSteering (8) | ✅ 8/8 | Shell sends unified with the durable queue: coordinator `busySubmit` delegation + terminal-driven re-drain/hold (`notifyExternalTurnTerminal`), `forceQueue` rows, steering `applied` lifecycle broadcast, queue-turn events routed to the workspace detail channel, composer sends allowed while streaming (PRD §7.1), delivered user rows re-appended at bubble swap (`9a5e7b8d`, `62b2450a`). Spec: mid-stream steering timing (the request log records on completion, not arrival), approve-for-me for permission-gated tools, sidebar selection with collapsed-group expansion. |
| unifiedPluginDiscovery (6) | ✅ 8/8 | Community-plugin IPC registration restored; harness port isolation (`AIFETCHLY_E2E_RENDERER_ORIGIN`) + `gotoRoute` auth-bounce retries (`f8f63967`). |
| outbound-email-review (2) | ✅ 2/2 | `OutboundEmailBatchCard` surfaced in the workspace transcript (the AD-003 authorization surface) via shared `outboundBatchCardModel`; spec shell-aware roots (`7b977937`). |
| conversationReport (2) | ✅ 2/2 | Report button + dialog wired into `AiChatCenterSurface`'s workspace strip; spec locates whichever root is mounted (`d418e024`). |
| aiChatLifecycle T-10 (1) | ✅ 4/4 | malformed-sse retry was delegated to the queue; the delivered-row swap keeps the user message visible (`62b2450a`). |
| ai-chat-generated-image-roundtrip (5) | ✅ 5/5 | Presenter maps the complete event's image payload to transcript tiles; fake-server `imagePartHashes` redaction restored (merge loss); `generatedImageSeed` helpers shell-aware (`c8ebebfd`). |
| workspace-shell (1) | ✅ 8/8 | new-chat-from-Plugins cured by the harness/shell fixes above. |
| appLaunch T-01 | ✅ 2/2 | URL assertion follows the harness renderer-origin override instead of hardcoding port 5173. |

Main-suite failures fixed alongside (`cd3f9f31`): empty-string IPC payloads
parse to undefined input for no-schema channels; the ai-chat-v2-ipc engine
singleton resets between tests.

## Still deferred

- **ai-chat-generated-image-batch-live (3)** — skipped with reason: the
  >3-reference batch confirmation dialog (and the legacy
  ambiguity/inference offers) are legacy-dock surfaces the shell excluded;
  its preflight rejects over-limit references with a notice. Porting the
  batch surface to the shell is the remaining work.
