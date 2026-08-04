# AI Skill Authoring Technical Design

## Goal

Allow users to ask the AI assistant to create a new AiFetchly skill that the assistant can use in future conversations.

The first version should create documentation-only skills from `SKILL.md` guidance. This satisfies the product goal while avoiding the risk of letting AI-generated JavaScript or Python execute immediately.

## Recommended Flow

1. User asks the AI to create a skill.
2. The AI calls a built-in tool such as `create_skill_draft`.
3. AiFetchly generates a draft skill package containing `SKILL.md`.
4. The user previews the skill name, description, generated instructions, and permissions.
5. The user explicitly approves installation.
6. AiFetchly reuses the existing `skill:import` path.
7. `SkillImportService.importFromZip()` validates, installs, stores metadata, and hot-registers the skill.
8. The new skill appears in the installed skills list and future AI tool lists.

## Existing Code To Reuse

- `src/config/skillsRegistry.ts`
  - Add a built-in `create_skill_draft` tool to the `BUILT_IN_SKILLS` list.
  - The tool should create a draft only, not install it silently.

- `src/service/SkillImportService.ts`
  - `importFromZip()` already supports packages with only `SKILL.md`.
  - It builds a documentation-only JavaScript wrapper, validates zip safety, writes metadata to SQLite, and hot-registers the skill.

- `src/main-process/communication/skills-ipc.ts`
  - New skill-authoring IPC handlers should use `registerAiValidatedHandler`.
  - This preserves the required `USER_AI_ENABLED` gate before doing AI work.

- `src/schemas/ipc/skills.ts`
  - Add Zod schemas for new draft creation and optional install endpoints.

- `src/entityTypes/skillTypes.ts`
  - The existing `SkillManifest` supports JavaScript and Python executable skills.
  - Keep executable skill generation out of the initial version.

## Proposed Service

Create `src/service/AISkillAuthoringService.ts`.

Responsibilities:

- Normalize and validate skill names.
- Generate a concise `SKILL.md` with required YAML frontmatter.
- Save drafts under `app.getPath("userData")/skill_drafts/<draftId>/`.
- Create a zip package from the draft folder.
- Return draft metadata, preview content, and `zipPath`.

Suggested input:

```ts
interface CreateSkillDraftRequest {
  name: string;
  description: string;
  skillMarkdown: string;
  supportedFileTypes?: string[];
}
```

Suggested output:

```ts
interface CreateSkillDraftResult {
  draftId: string;
  name: string;
  description: string;
  skillMarkdown: string;
  zipPath: string;
}
```

## Built-In Tool Contract

Add a built-in AI tool named `create_skill_draft`.

Parameters:

- `name`: lowercase skill name requested by the user, normalized server-side.
- `description`: model-facing description of when to use the skill.
- `skill_markdown`: full `SKILL.md` content.
- `supported_file_types`: optional list such as `[".csv", ".xlsx"]`.

Behavior:

- Validate all fields.
- Write the draft package.
- Return a preview and `zipPath`.
- Do not install the skill automatically.

## User Approval

The UI should show a review step before installation:

- Skill name.
- Description.
- Generated `SKILL.md`.
- Supported file types.
- Permission category, expected to be `pure` for documentation-only skills.
- Install button.

The install button can call the existing `skill:import` IPC channel with the generated zip path.

## Security Model

Version 1 should only support documentation-only skills.

Do not allow AI-generated executable JavaScript or Python in the initial release. Executable skills need additional controls:

- Diff preview.
- Explicit permission review.
- Sandbox execution.
- Dependency hash checks.
- Clear user approval for every filesystem, network, automation, or shell capability.

## Implementation Notes

- Keep all database writes inside the existing model/module/import path.
- Do not add direct database access to IPC handlers.
- Use `registerAiValidatedHandler` for any AI-facing IPC endpoint.
- Keep generated skill packages small and reject path traversal or invalid names.
- Reuse `SkillImportService.importFromZip()` instead of creating a parallel installer.

## First Milestone

Implement documentation-only skill generation:

1. Add `AISkillAuthoringService`.
2. Add `create_skill_draft` built-in tool.
3. Add optional `skill:create-draft` IPC endpoint for settings UI.
4. Add preview UI in the skills settings page or AI chat approval flow.
5. Reuse `skill:import` for final install.
6. Add tests for draft generation, name validation, zip contents, and import compatibility.

