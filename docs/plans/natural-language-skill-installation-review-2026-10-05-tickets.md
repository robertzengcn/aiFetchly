# Review tickets: natural-language skill installation (2026-10-05)

From the pre-landing `/review` pass (Codex gpt-6-astra full-branch scan +
parent review). STATUS UPDATE 2026-10-06: **everything below is fixed**
except item 11 (deferred test debt). Fix commits, newest last:

- `72edf8df` — remediation-range RV1–RV10 (command-hash baseline,
  shellSplit, migration 0004, policy long-forms/newline, rollback stop,
  incompatible hold, neutral probe cwd, AI gate)
- `2805a2af` — tickets 1–5 (identity-bound uninstall incl. the
  ownership-file/carried-identity repair, held-update cancel/decline,
  restart identity+enabled reconcile, backups outside the discovery
  root, supersede unregistration + verified registration)
- `b4eeda08` — tickets 6–9 (conversation-scoped install boundary,
  narrowing applied after catalog filtering, handoffs after the tool
  batch, plugin/executable lifecycle dispatch)
- `00a4ad17` — ticket 10 / D4b + the two nested-instruction P2s
  (candidate-qualified instruction paths survive dedup; per-candidate
  command working directories with a containment guard)

## Fixed — former P1s (pre-existing, full-branch scan)

1. **Uninstall ownership check** — uninstall is now identity-bound
   (ownership file records the INSTALLATION id — it previously recorded
   the session id — and the D2 prior-row adoption rewrites it); linked
   rows bind to the recorded link target.
2. **Cancel/decline of a held update** — rollback runs only when THIS
   session's own event history shows it reached activation.
3. **Restart discovery identities** — the loader reconciles scanned
   installer directories with persisted rows (identity + enabled);
   pre-fix backup directories beside a skill are skipped.
4. **Rollback backups** — stored under `~/.aifetchly/skill-backups`,
   outside the discovery root.
5. **Superseded catalog entry** — the supersede loop unregisters the old
   runtime entry + deactivates its invocations; registerPromptSkill
   verifies actual registration before ready.

## Fixed — former P2s

6. **Conversation boundary cache bleed** — the install boundary (session
   + manual-action approval) is conversation-scoped and invalidated on
   switch.
7. **Narrowing order** — allowed-tools narrowing applies to the final
   catalog-filtered set.
8. **Handoff ordering** — prompt-skill/image handoffs append after the
   whole tool batch (contiguous tool responses).
9. **Plugin/executable lifecycle** — disable/enable route to the
   InstalledSkill registry; uninstall routes to Plugin/SkillManagement
   with typed failures.

## Fixed — former deferral

10. **Per-candidate command cwd (D4b)** — see `00a4ad17` above.

## Still deferred

11. **RV7/RV8 dedicated e2e tests**: the rollback_required loop-stop and
    the incompatible-dependency hold are enforced and covered by
    unit-level guards, but lack deterministic end-to-end tests — driving
    them needs a probe-injection seam (a locally-present-but-old binary
    fixture). Add when the test harness grows that seam.

Coverage notes from the review: specialist subagents all died to the
provider 5-hour usage limit (429) — lenses run inline instead; Codex
adversarial + structured passes completed. E2E/Playwright and
live-platform runs were not rerun (rebuild `yarn build:e2e` first).
