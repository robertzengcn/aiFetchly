# Feature Specification: AI Skills System

**Feature Branch**: `001-skill-system`
**Created**: 2026-04-03
**Status**: Draft
**Input**: User description: "Add AI Skills System for aiFetchly - a unified skill framework enabling the AI chat to execute built-in, user-authored, and marketplace-sourced capabilities during conversations"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - AI Invokes Built-in Skill During Chat (Priority: P1)

A user is chatting with the AI assistant and asks it to search Google for marketing agencies in Berlin. The AI recognizes the intent, calls the Google Search skill, and returns structured results directly in the conversation — without the user needing to leave the chat or trigger the tool manually.

**Why this priority**: This is the foundational capability. Without a working tool-call execution loop, no skills can function at all. It unblocks all other stories.

**Independent Test**: Can be fully tested by sending any message that triggers a tool call from the AI, verifying the tool executes and the AI incorporates the result in its response. Delivers immediate value — users can ask the AI to search, analyze, or extract data within the chat.

**Acceptance Scenarios**:

1. **Given** the user is in an active AI chat session, **When** the user sends a message like "Search Google for marketing agencies in Berlin", **Then** the AI calls the google_search tool, the tool executes successfully, and the AI responds with structured search results incorporated into its answer
2. **Given** the AI calls a tool during streaming, **When** the tool execution encounters an error, **Then** the error is returned to the AI as a tool result (not crashing the stream), and the AI informs the user about the failure gracefully
3. **Given** the AI calls a tool that requires main-process execution (e.g., file access), **When** the tool is dispatched via IPC, **Then** the result is returned to the AI within 2 seconds and the conversation continues seamlessly

---

### User Story 2 - Unified Skill Registry Powers AI Tool Discovery (Priority: P1)

All available skills (built-in tools, MCP tools) are registered in a single unified registry. When the user starts a chat, the AI automatically knows which tools are available based on what is enabled in the registry. The user doesn't need to configure tool availability manually.

**Why this priority**: The registry is the single source of truth that makes the execution loop work. Without it, there is no consistent way to discover, validate, or dispatch skill invocations.

**Independent Test**: Can be tested by verifying that the registry enumerates all built-in tools and that the AI receives the correct tool definitions when starting a chat. Delivers value by ensuring the AI always has accurate knowledge of its capabilities.

**Acceptance Scenarios**:

1. **Given** the skill registry contains all built-in tools, **When** the AI chat session starts, **Then** the AI receives a complete and accurate list of available tools with their names, descriptions, and parameter schemas
2. **Given** a tool name is provided by the AI in a tool_call event, **When** the registry is consulted, **Then** the tool is either found with its full definition or rejected as unknown
3. **Given** the existing MCP tool system is running, **When** the registry enumerates skills, **Then** MCP tools appear alongside built-in tools without any changes to the MCP integration

---

### User Story 3 - Skill Execution Isolation and Permissions (Priority: P2)

A power user writes a custom JavaScript skill that fetches data from a competitor analysis API. When the AI tries to invoke this skill, the system runs it in an isolated sandbox with no access to the filesystem, Electron APIs, or Node.js internals. The user is prompted to approve the skill's network access before it runs.

**Why this priority**: Security is critical but builds on top of the core execution loop. User-authored skills cannot be safely supported without sandboxing and permissions, but built-in skills work without them.

**Independent Test**: Can be tested by importing a user-authored skill, verifying it runs in isolation (cannot access filesystem/process), and confirming that permission prompts appear for high-risk operations. Delivers value by enabling safe third-party skill execution.

**Acceptance Scenarios**:

1. **Given** a user-authored skill is registered, **When** the AI invokes it, **Then** the skill executes in a sandboxed environment with no access to filesystem, process, or Electron APIs
2. **Given** a skill requires network access, **When** it runs for the first time, **Then** the user sees a confirmation prompt asking to allow network access
3. **Given** a skill with the "pure" permission category, **When** the AI invokes it, **Then** it executes immediately without any confirmation prompt
4. **Given** a sandboxed skill runs beyond the 30-second timeout, **When** the timeout is reached, **Then** the skill execution is terminated and an error result is returned to the AI

---

### User Story 4 - Import and Manage External Skills (Priority: P2)

A user downloads a skill package (a zip file) from a marketplace and imports it through the Skills management page. The system validates the manifest, displays the required permissions, and installs the skill. The user can then enable, disable, or uninstall the skill at any time.

**Why this priority**: Marketplace import extends the skill ecosystem but requires both the execution loop and security infrastructure to be in place first. It grows the platform's capability surface area significantly.

**Independent Test**: Can be tested by creating a valid skill package zip, importing it through the UI, verifying it appears in the skill list, and confirming the AI can invoke it in chat. Delivers value by making the skill system extensible.

**Acceptance Scenarios**:

1. **Given** the user has a valid skill package zip file, **When** they import it through the Skills page, **Then** the manifest is validated, permissions are displayed, and the skill is installed and available immediately
2. **Given** an imported skill is listed on the Skills page, **When** the user disables it, **Then** the skill no longer appears in the AI's available tools and cannot be invoked
3. **Given** the user imports a skill package with an invalid manifest, **When** validation runs, **Then** a clear error message explains what is wrong and the import is rejected
4. **Given** an imported skill is installed, **When** the user restarts the application, **Then** the skill persists and remains available without re-importing

---

### User Story 5 - Skills Management Page (Priority: P3)

The user opens the Skills management page from the settings navigation. They see all installed skills organized by source (built-in, user-authored, marketplace), with the ability to view details, check permissions, toggle enable/disable, and import new skills. MCP tools are accessible as a tab within this page.

**Why this priority**: The management UI is essential for usability but can be deferred while the core execution and security infrastructure is built. The system is functional without a polished management page.

**Independent Test**: Can be tested by navigating to the Skills page, verifying all installed skills are listed with correct metadata, and performing enable/disable/import actions. Delivers value by giving users control over their skill ecosystem.

**Acceptance Scenarios**:

1. **Given** multiple skills are installed, **When** the user opens the Skills management page, **Then** all skills are listed with name, source, status, and permission category
2. **Given** the user clicks on a skill in the list, **When** the detail view opens, **Then** the description, parameters, permissions, version, and author are displayed
3. **Given** a skill requires confirmation at runtime, **When** the AI invokes it in chat, **Then** an inline approval card appears in the chat with "Allow Once", "Always Allow", and "Deny" options

---

### Edge Cases

- What happens when the AI calls a tool that was just disabled mid-conversation? The system should return a "tool not found" error to the AI gracefully.
- How does the system handle a tool_call with invalid or missing parameters? The registry should validate arguments against the schema and return a structured error.
- What happens when a sandboxed skill attempts to access filesystem or process objects? The sandbox must block the access and return an error without crashing.
- How does the system handle duplicate skill names from different sources? Built-in names are reserved; imported skills with colliding names must be rejected or prompted for update.
- What happens when the AI calls multiple tools in a single message? Each tool_call must be processed independently with its own result.
- What happens when a skill execution exceeds the memory limit? The sandbox must terminate the skill and return an error result.
- How does the system handle a corrupted or partially extracted skill package? The import must validate the full package atomically and clean up on failure.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST complete the full tool-call execution loop: AI requests a tool, the tool executes, and the result is returned to the AI within the same conversation stream
- **FR-002**: System MUST provide a unified skill registry that serves as the single source of truth for all available skills, their definitions, and their execution handlers
- **FR-003**: System MUST validate all tool names and parameters against the registry before executing any skill
- **FR-004**: System MUST support three execution tiers: renderer (pure computation), main process (filesystem, OS operations), and sandboxed (isolated execution for untrusted code)
- **FR-005**: System MUST run user-authored and marketplace skills in an isolated sandbox with no access to filesystem, process, Node.js require, or Electron APIs
- **FR-006**: System MUST enforce a configurable memory limit (default 64MB) and execution timeout (default 30 seconds) on sandboxed skills
- **FR-007**: System MUST classify each skill into a permission category: pure, network, filesystem, or automation
- **FR-008**: System MUST auto-allow execution of pure-category skills without user confirmation
- **FR-009**: System MUST require explicit user approval before executing filesystem or automation-category skills
- **FR-010**: System MUST prompt for confirmation on the first network access to each domain, with a "Remember my choice" option
- **FR-011**: System MUST persist granted permissions so that approved actions do not re-prompt on subsequent executions
- **FR-012**: System MUST allow users to revoke any granted permission at any time through the Skills management interface
- **FR-013**: System MUST support importing external skill packages from zip files with manifest validation
- **FR-014**: System MUST validate skill manifests for required fields (name, version, description, runtime, entry, parameters), unique names, and valid version format before installation
- **FR-015**: System MUST display skill permissions to the user during installation and require approval before completing the import
- **FR-016**: System MUST persist installed skills across application restarts
- **FR-017**: System MUST make imported skills available immediately after installation without requiring an application restart
- **FR-018**: System MUST provide a Skills management page where users can browse, enable, disable, and uninstall skills
- **FR-019**: System MUST integrate the existing MCP tool system into the unified registry without requiring changes to MCP configuration or behavior
- **FR-020**: System MUST show inline approval cards in the chat when a skill requires runtime permission confirmation
- **FR-021**: System MUST log all skill executions with tool name, sanitized arguments, success/failure status, and duration
- **FR-022**: System MUST return tool execution errors as structured results to the AI rather than crashing the conversation stream
- **FR-023**: System MUST migrate all existing built-in tools from the static configuration into the unified registry
- **FR-024**: System MUST reject arguments containing tokens, cookies, passwords, or suspicious patterns (input sanitization)

### Key Entities

- **Skill**: A named, versioned capability that the AI can invoke. Composed of a manifest (metadata) and executable logic. Attributes include name, description, version, parameter schema, execution tier, permission category, source type, and enabled status.
- **Skill Manifest**: The metadata definition file for a skill, declaring its name, version, description, author, runtime type, entry point, parameter schema, and required permissions.
- **Permission Grant**: A record of user-approved permissions for a specific skill, including the permission category, scope (e.g., specific domains for network access), and whether the grant is persistent or one-time.
- **Installed Skill**: A persisted record of an imported skill, including its manifest, granted permissions, enabled status, and installation/update timestamps.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When the AI invokes any built-in skill during a chat conversation, the full round-trip (tool call to tool result) completes in under 2 seconds
- **SC-002**: Users can search, scrape, and extract data through AI chat using tool calls without encountering errors or broken streams in 95% of interactions
- **SC-003**: User-authored skills execute in an isolated environment with zero access to filesystem, process, or Electron APIs (verified by security audit)
- **SC-004**: Permission prompts appear for 100% of high-risk skill executions (filesystem, automation categories) and never appear for pure-category skills
- **SC-005**: A valid skill package can be imported and made available in under 5 seconds
- **SC-006**: 95% of skill import attempts with valid packages succeed without errors
- **SC-007**: Users can enable, disable, or uninstall any imported skill and the change takes effect immediately in AI chat without restarting the application
- **SC-008**: All existing functionality (MCP tools, built-in tools) continues to work identically during and after the migration to the skills system

## Assumptions

- The existing SSE streaming infrastructure for AI chat events (tool_call, tool_result) is stable and can be extended
- User-authored skills will be JavaScript/TypeScript only in the initial release (Python support deferred)
- The existing Token service pattern can be reused for storing permission grants
- The application already has SQLite available for persisting installed skill data
- All built-in tools in the static configuration can be represented as registry entries without breaking their current functionality
- The isolated-vm library is acceptable as the sandboxing technology for user-authored JavaScript skills
- Developer Mode (skip all permission prompts) is a power-user feature and should be off by default
- Skill packages will be distributed as standard zip files with a skill.json manifest at the root

## Scope Boundaries

### In Scope

- Tool-call execution loop in the AI chat
- Unified skill registry for built-in, MCP, and imported skills
- Three execution tiers (renderer, main, sandboxed)
- Permission system with four categories
- Skill import from zip files
- Skills management UI page
- Inline chat approval cards

### Out of Scope

- Online marketplace browsing and discovery (future phase)
- Skill versioning and auto-update
- Skill dependency resolution
- Python skill runtime support
- Digital signature verification for skill packages
- Community skill sharing or rating system
