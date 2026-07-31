# Skill Management Toggle Debug

**Symptom:** Disabling a skill in the Skill Management page appeared to work in the UI, but `/skills` in AiChat V2 still listed the skill.

**Root cause:** `skill:list-installed`, `skill:toggle`, and `skill:uninstall` were registered with `registerAiValidatedHandler`. When AI was unavailable or disabled, the toggle request returned `{ status: false }` before changing the database. The Vue page had already flipped the local `v-model` value and did not rollback or show the failure, so the table could show a disabled state while the persisted skill row remained enabled. AiChat V2 then correctly listed the still-enabled skill.

**Fix:** Skill management read/toggle/uninstall IPC handlers now use the non-AI-gated `registerValidatedHandler`. Successful toggles immediately update runtime registration: disabling unregisters the skill, enabling reloads the persisted skill. The handler broadcasts a config-change event, and the settings page restores the previous toggle state plus shows an error if the update fails.

**Evidence:**
- `yarn testmain test/vitest/main/ipc/skills-ipc.test.ts --run` passed 3 tests.
- `yarn testmain test/vitest/main/service/skillsRegistryEnablement.test.ts --run` passed 4 tests.
- `yarn tsc-result --pretty false` passed.

**Regression test:** `test/vitest/main/ipc/skills-ipc.test.ts`

**Status:** DONE
