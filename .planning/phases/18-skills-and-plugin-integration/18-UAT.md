---
status: testing
phase: 18-skills-and-plugin-integration
source: [18-VERIFICATION.md]
started: 2026-07-13T14:00:00+08:00
updated: 2026-07-13T14:00:00+08:00
---

## Current Test

number: 1
name: SC1 — End-to-end local skill execution
expected: |
  A sample skill at ~/.aifetchly/skills/<name>/manifest.json is discovered on
  startup (or after /reload-config), registered through the existing
  SkillRegistry, exposed as an OpenAI tool schema, and invoking it as an AI tool
  executes via SkillWorkerClient (utility process) with the per-call
  SkillPermissionService permission prompt firing. Skill code is NEVER imported
  into the Electron main process.
awaiting: user response

## Tests

### 1. SC1 — End-to-end local skill execution

**Requirement:** SKL-01 (success criterion 1)

**Steps:**
1. Create `~/.aifetchly/skills/sample-skill/manifest.json` with a valid manifest
   (name, version, entry, runtime `js` or `python`) + the entry file.
2. Restart the app (or run `/reload-config`).
3. Confirm `/status` reflects the new skill count.
4. Invoke the skill as an AI tool from AiChatV2.
5. Observe: the SkillPermissionService permission prompt fires; execution runs
   via the SkillWorkerClient utility process (not in main); result returns to chat.

**Expected:** Skill discovered → validated → registered → tool-exposed → executed
via SkillExecutor/SkillWorkerClient → permission-gated. No skill code loaded as
arbitrary code into main.

**Result:** [pending]

### 2. SC2 — Live plugin command/agent promotion

**Requirement:** SKL-02 (success criterion 2)

**Steps:**
1. Import a test plugin (via the plugin import UI) whose install dir contains
   `commands/review.md` (valid CMD-06 frontmatter: name, description, type:
   prompt, body) and `agents/researcher.md` (valid AGT-02 frontmatter).
2. Enable the plugin.
3. Type `/` in the AiChatV2 composer and confirm `review` appears as a suggestion
   with the `plugin` source badge.
4. Confirm the agent is listable via `/agents` (or the agent discovery UI) with
   the `plugin` badge.
5. Disable/uninstall the plugin and confirm the command/agent reconcile away.

**Expected:** `/review` active under source `plugin:<name>` (rank 3, lowest);
agent listable under `plugin:<name>`; disable/uninstall reconciles both away.

**Result:** [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
