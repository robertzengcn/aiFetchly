# Skill toggle `enable` parameter compatibility

**Date:** 2026-07-25

**Symptom:** Disabling a skill from the skill management page returned `[skill:toggle] Missing required params: enable`.

**Root cause:** The active runtime could still submit the legacy `enable` field while the current `SKILL_TOGGLE` IPC schema only accepted `enabled`. Strict Zod validation rejected the payload before `SkillManagementModule.toggleSkill()` ran.

**Fix:** `skillToggleInputSchema` now normalizes legacy `enable` payloads into canonical `{ skillName, enabled }` before strict validation. The shared IPC validation wrapper now accepts schemas whose raw input is `unknown`, which allows Zod preprocess/transform schemas while preserving parsed handler types.

**Verification:** Added a regression test proving `SKILL_TOGGLE` accepts the legacy `enable` payload and still calls `toggleSkill(skillName, false)`.
