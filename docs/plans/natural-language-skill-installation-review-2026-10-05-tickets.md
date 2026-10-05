# Review tickets: natural-language skill installation (2026-10-05)

From the pre-landing `/review` pass (Codex gpt-6-astra full-branch scan +
parent review). The 10 remediation-range defects were fixed in commit
`72edf8df` (RV1–RV10). The items below are either OLDER branch findings
(predating the R1–R10 remediation, in already-audited commits) or approved
deferrals — each needs its own individually tested fix, not a drive-by.

## P1 — pre-existing (full-branch scan)

1. **Uninstall ownership check** — `SkillInstallationModule.ts:2467`:
   after a same-name replacement, the superseded row keeps the same
   `activationPath`; uninstalling the SUPERSEDED row deletes the
   replacement's files. `SkillActivationService.uninstall` verifies
   generic ownership metadata, not the installation identity. Fix: verify
   the activation's ownership file still names the requested
   installationId before deleting.
2. **Cancel of a held update rolls back the WORKING installation** —
   `SkillInstallationModule.ts:1478`: an update that pauses at
   installing_dependencies has already adopted the existing
   installationId; cancelling (or declining a dependency) runs the
   rollback path against files this session never wrote. Fix: track
   whether the session actually activated files before rolling back.
3. **Restart discovery loses installer identities** —
   `AIFetchlyRuntimeRegistrySync.ts:289`: scanning installer-managed
   directories assigns fresh name-derived installationIds and enables
   everything, so disabled skills resurrect and disable/enable target
   nonexistent runtime ids. Fix: reconcile scanned directories with the
   persisted installation rows (identity + enabled state).
4. **Rollback backups live inside the discovery root** —
   `SkillActivationService.ts:104`: replacement backups sit beside the
   active skill and carry a valid SKILL.md; the config loader scans both
   and a backup can replace the active definition on restart. Fix: store
   backups outside the skills root (or exclude from scanning).
5. **Superseded catalog entry blocks the replacement** —
   `SkillInstallationModule.ts:2774`: same-name replacement disables the
   old row but leaves its catalog entry at the same path;
   `PromptSkillCatalog.replaceSource` then rejects the new entry and the
   session still reports ready. Fix: remove the superseded runtime entry
   and verify registration succeeded before reporting ready.

## P2 — pre-existing (full-branch scan)

6. **Conversation boundary cache bleed** — `AIChatQueryLoop.ts:1970`:
   `installBoundaryDirty` / `activeInstallSession` /
   `manualActionApprovedCache` are instance-wide without a
   conversation-reset; one loop instance serves multiple conversations.
7. **Skill tool-narrowing undone by deferred-catalog filtering** —
   `AIChatQueryLoop.ts:1038`: `filterForRound` receives the original
   tool list and replaces the narrowed set.
8. **Skill handoff message ordering** — `AIChatQueryLoop.ts:2164`: a
   `use_skill` + other-tool round inserts a user-role handoff between
   tool responses; strict providers reject the next request.
9. **Plugin/executable lifecycle dispatch** —
   `SkillInstallationModule.ts:2383`: disable/uninstall only handle the
   prompt-skill paths; plugin/executable rows report success while their
   registered tools stay live.

## Approved deferrals (this review)

10. **Per-candidate command cwd** (D4b): setup commands found in a nested
    candidate's install.md execute from the plan root, not the
    candidate's folder. Needs a plan-contract change: carry a validated
    candidate-relative working directory through planning, approval
    binding, and the runner. Until then, nested instruction commands with
    relative paths can fail or touch the wrong files.
11. **RV7/RV8 module-level regression tests**: the rollback_required
    loop-stop and the incompatible-dependency hold are enforced and
    type-checked but lack dedicated end-to-end tests (driving them needs
    environment-dependent fixtures — e.g. a locally-present-but-old
    binary). Add deterministic fixtures when the test harness grows a
    probe-injection seam.

Coverage notes from the same review: specialist subagents (testing,
maintainability, security, performance, data-migration, api-contract,
design, simplification) all died to the provider 5-hour usage limit
(429) — their lenses were run inline by the parent instead; the Codex
adversarial + structured passes completed. E2E/Playwright and
live-platform runs were not rerun (rebuild `yarn build:e2e` first).
