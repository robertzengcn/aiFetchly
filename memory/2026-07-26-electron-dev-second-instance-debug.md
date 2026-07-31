# Electron Development Second-Instance Debug

- **Symptom:** Sending `List my proxies` caused a second AiFetchly window/process to appear. The log showed `Starting inspector ... address already in use` and `[dev] Skipping single-instance lock`.
- **Root cause:** `makeSingleInstance()` returned immediately whenever `NODE_ENV` was not production. A second Electron process could therefore open the same profile, register duplicate IPC/background services, and contend for the inspector port. `proxy_list` did not launch a window; it exposed the unsafe startup policy.
- **Fix:** Removed the development-mode bypass. Added `acquireSingleInstanceLock()` so every non-MAS process requests the Electron lock and quits when another process owns it.
- **Evidence:** The helper tests verify both first-process acquisition and second-process termination. Focused test run passed 33 tests with TypeScript reporting no errors.
- **Regression test:** `test/vitest/main/singleInstanceGuard.test.ts`.
- **Related:** The existing HMR guard still prevents duplicate initialization within one process. The pre-existing `src/modules/RagSearchModule.ts` worktree change was left untouched.
- **Status:** DONE
