# Skill Enablement Catalog Debug

**Symptom:** After disabling plugins and skills, `/skills` still listed hundreds of installed documentation-only skills in the AI chat.

**Root cause:** Persisted plugin-owned skills were reloaded with `SkillImportService.registerImportedSkill(manifest, skillDir)` and lost their `pluginOwner` metadata. `SkillRegistry.getAllToolFunctions()` only filtered disabled plugin skills when `pluginOwner` was present. The registry also did not consult `installed_skills.enabled`, so stale registered skills could remain visible after DB state changed.

**Fix:** Runtime tool enumeration now builds an enablement snapshot from installed skills and enabled plugins, hides disabled installed skill rows, and falls back to persisted `InstalledSkill.pluginName` when in-memory metadata is stale. Persisted skill loading now passes plugin ownership into runtime registration. `SkillExecutor` blocks direct execution of disabled skills.

**Evidence:**
- `yarn testmain test/vitest/main/service/skillsRegistryEnablement.test.ts --run` passed 4 tests.
- `yarn testmain test/vitest/main/service/SkillImportService.local.test.ts --run` passed 4 tests.
- `yarn testmain test/vitest/main/service/LocalSkillSourceAdapter.test.ts --run` passed 6 tests.
- `yarn tsc-result --pretty false` passed.

**Regression test:** `test/vitest/main/service/skillsRegistryEnablement.test.ts`

**Status:** DONE
