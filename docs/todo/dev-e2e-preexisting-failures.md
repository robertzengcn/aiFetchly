# dev E2E pre-existing failures (verified 2026-09-15 on the dev checkout itself)

While merging dev <-> worktree-chat-first-application-shell, the full E2E
suite showed 28 failing specs on the MERGED tree. Spot-verification on the
UNTOUCHED dev checkout reproduces the same failures — they are pre-existing
on dev, NOT merge regressions:

| Spec group | On dev | Notes |
| --- | --- | --- |
| aiChatQueueSteering (8) | FAILED (test-1 verified) | Uses `ai-chat-toggle` (removed when the chat workspace became the default landing) and expects queue pending bubbles in the shell transcript; the shell send path goes through the workspace coordinator, not the pending queue. |
| unifiedPluginDiscovery (6) | FAILED (6/8) | Same-run verification on dev. |
| outbound-email-review (2), conversationReport (2), aiChatLifecycle T-10 (1), ai-chat-generated-image-roundtrip (3+), workspace-shell (1) | FAILED (5 across a combined run; 5 more in roundtrip+shell) | Reproduced on dev directly. |

The chat-first-shell specs themselves (workspace-shell core, gaps, keyboard)
pass 19/19 on the merged tree.
