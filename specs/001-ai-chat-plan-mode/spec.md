# Feature Specification: AI Chat Plan Mode and AskUserQuestion Workflow

**Feature Branch**: `001-ai-chat-plan-mode`
**Created**: 2026-06-14
**Status**: Draft
**Input**: User description: "Add plan mode and AskUserQuestion to solve complex marketing problems. Reference successful agent architectures such as Claude Code plan mode, but adapt it to aiFetchly, where chat memory and plan content are saved in SQLite and the application is mainly for marketing rather than coding. Add a chatbox UI option to enter plan mode."

## Overview

aiFetchly's AI chat currently supports OpenAI-compatible streaming, tool calls, skill permission prompts, conversation history, and SQLite-backed chat memory. This feature adds a first-class **Plan Mode** that lets users ask the AI to solve complex problems through an explicit planning workflow before any high-impact action is executed. The default product context is marketing automation, but Plan Mode must also handle non-marketing goals with a domain-appropriate plan structure.

Plan Mode is inspired by Claude Code's plan-mode architecture, but must be adapted to aiFetchly's product domain:

- Claude Code plans implementation work and uses file-based session plans; aiFetchly plans marketing work and must save plan artifacts in SQLite.
- Claude Code primarily gates file edits and shell operations; aiFetchly must gate marketing actions such as sending emails, posting content, scraping at scale, creating scheduled tasks, modifying campaigns, or performing browser automation on user accounts.
- Claude Code uses terminal-oriented `AskUserQuestion` and `ExitPlanMode`; aiFetchly must render structured question and approval cards inside the Vue chat UI.
- Claude Code is coding-centric; aiFetchly's plan content must be domain-adaptive. Marketing-related plans should cover audience, channel strategy, assets, compliance, execution steps, metrics, and stop criteria. Non-marketing plans should use general planning sections and omit irrelevant marketing sections.

The feature introduces:

- A user-selectable Plan Mode option in the AI chatbox UI.
- A durable SQLite-backed planning state machine per conversation.
- An `AskUserQuestion` tool for structured requirement clarification.
- A `SubmitPlanForApproval` workflow for final plan review and approval.
- Plan-version persistence, approval history, and resumability across app restarts.
- Strict plan-mode tool gating until the user approves the final plan.

## Goals

- Help users turn vague or complex requests into clear, executable plans, with stronger marketing guidance when the goal is marketing-related.
- Prevent accidental execution of high-impact actions before the user understands and approves the strategy, especially marketing automation actions that contact leads or modify external accounts.
- Give the AI a structured workflow for complex problems instead of responding with shallow one-shot advice.
- Store plan state and plan content in SQLite so users can resume, review, and audit previous planning sessions.
- Integrate naturally into the existing `AiChatV2` chat experience without forcing users into a separate planning page.

## Non-Goals

- This feature does not build a full campaign execution engine by itself.
- This feature does not replace existing skill permission prompts; it adds a higher-level planning approval gate.
- This feature does not add autonomous execution of approved plans in the first release unless existing tools already support the required actions.
- This feature does not use filesystem plan files as the source of truth.
- This feature does not require Claude Code compatibility; Claude Code is only a reference architecture.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - User Chooses Plan Mode from AI Chat (Priority: P1)

A marketing user opens the AI chat and wants help with a complex task, such as "create a campaign to find and email local dental clinics". The user selects Plan Mode from the chat UI before sending the message. The AI enters a structured planning workflow instead of immediately executing tools.

**Why this priority**: Plan Mode must be explicit and discoverable. Users need a simple way to choose deeper planning when a task is complex or risky.

**Independent Test**: Can be tested by selecting Plan Mode in the chatbox, sending a complex marketing request, and verifying that the request reaches the backend with `mode: "plan"` and the AI responds in planning workflow.

**Acceptance Scenarios**:

1. **Given** the user is viewing the AI chat, **When** the user selects Plan Mode in the chatbox UI, **Then** the next message is sent with `mode: "plan"`.
2. **Given** Plan Mode is selected, **When** the user sends a message, **Then** the UI displays a visible Plan Mode indicator for the active conversation.
3. **Given** the user starts a new conversation, **When** the chat resets, **Then** the default mode is normal chat unless the user has configured Plan Mode as default.
4. **Given** the user opens conversation history, **When** a conversation has an active or approved plan, **Then** the conversation item indicates that it contains a plan.
5. **Given** the user switches from Plan Mode to Chat Mode before sending, **When** they send a message, **Then** the message is handled as normal chat and does not create a plan state.

---

### User Story 2 - AI Clarifies Requirements with AskUserQuestion (Priority: P1)

A user asks for a complex plan but omits key constraints such as target audience, channel, budget, owner, timeline, compliance boundaries, or success criteria. The AI uses `AskUserQuestion` to ask structured questions with clear options instead of guessing.

**Why this priority**: The quality of any plan depends on user-specific constraints. Structured clarification prevents generic, low-value plans.

**Independent Test**: Can be tested by sending an ambiguous Plan Mode request and verifying that an inline question card appears, the question is persisted in SQLite, and the user's answer resumes the same plan workflow.

**Acceptance Scenarios**:

1. **Given** the AI needs information only the user can answer, **When** it calls `AskUserQuestion`, **Then** the chat renders a structured question card with 1-3 questions.
2. **Given** a question card is displayed, **When** the user selects an option, **Then** the answer is saved in SQLite and returned to the AI as a tool result.
3. **Given** the user selects "Other", **When** they type a custom answer, **Then** the custom answer is saved and passed back to the AI.
4. **Given** the app restarts while a question is pending, **When** the user reopens the conversation, **Then** the pending question card is restored from SQLite.
5. **Given** multiple clarifications are needed, **When** the AI asks questions, **Then** the system batches related questions into one card and avoids asking questions answerable from existing conversation context.

---

### User Story 3 - AI Produces a Plan for Approval (Priority: P1)

After gathering enough context, the AI creates a structured, domain-appropriate plan and submits it for user approval. The plan is saved to SQLite and displayed in a plan approval card. The user can approve, reject, or request changes.

**Why this priority**: Approval is the core safety and trust boundary. Users must be able to inspect the plan before execution tools are unlocked.

**Independent Test**: Can be tested by completing a Plan Mode conversation and verifying that the final plan is stored in SQLite, rendered in the UI, and remains available after reload.

**Acceptance Scenarios**:

1. **Given** the AI has enough context to finish planning, **When** it calls `SubmitPlanForApproval`, **Then** the backend saves a plan record with status `awaiting_approval`.
2. **Given** a plan is awaiting approval, **When** the UI receives the plan event, **Then** it renders a plan approval card with the full plan content.
3. **Given** the user approves the plan, **When** approval is submitted, **Then** the plan status changes to `approved` and execution tools become eligible according to normal permission rules.
4. **Given** the user rejects the plan, **When** rejection is submitted, **Then** the plan status changes to `rejected` and execution tools remain blocked.
5. **Given** the user requests changes, **When** change feedback is submitted, **Then** the AI receives the feedback and creates a new plan version instead of overwriting the previous version.

---

### User Story 4 - Plan Mode Blocks High-Impact Tools Until Approval (Priority: P1)

The AI may need to research, inspect existing data, or reason during planning, but must not execute high-impact actions before approval. The system enforces this in backend tool policy, not only in prompts.

**Why this priority**: Marketing automation actions can contact real leads, alter campaigns, consume quotas, or affect external accounts. Prompt-only safety is insufficient.

**Independent Test**: Can be tested by forcing a tool call to a blocked skill while plan status is not approved and verifying that the tool executor returns a structured blocked result.

**Acceptance Scenarios**:

1. **Given** a conversation is in Plan Mode and no plan is approved, **When** the AI attempts to send email, **Then** the tool call is blocked with a plan-mode approval-required result.
2. **Given** a conversation is in Plan Mode and no plan is approved, **When** the AI attempts to modify a campaign or schedule, **Then** the tool call is blocked.
3. **Given** a conversation is in Plan Mode, **When** the AI calls read-only or pure tools, **Then** the tool may execute if permitted by existing skill permission rules.
4. **Given** a plan is approved, **When** the AI calls an execution tool, **Then** the plan-mode gate passes but normal skill permission prompts still apply.
5. **Given** a tool is blocked by Plan Mode, **When** the result is returned to the AI, **Then** the AI can explain that approval is required rather than failing the stream.

---

### User Story 5 - User Resumes Planning Across Sessions (Priority: P2)

A user starts a plan, closes the app, and returns later. The conversation, active plan, pending questions, and plan approval state are restored from SQLite.

**Why this priority**: Complex planning often takes multiple sessions. Durable state is required for user trust and product usefulness.

**Independent Test**: Can be tested by creating a pending question or awaiting approval plan, restarting the app, opening the conversation, and verifying the same workflow state is restored.

**Acceptance Scenarios**:

1. **Given** a plan is in `draft` or `awaiting_question`, **When** the app restarts, **Then** the conversation restores the active plan state.
2. **Given** a plan is `awaiting_approval`, **When** the user reopens the conversation, **Then** the approval card is visible and actionable.
3. **Given** a plan has multiple versions, **When** the user opens plan history, **Then** previous versions are available for review.
4. **Given** a conversation is cleared, **When** the user confirms clearing, **Then** associated draft plan state is archived or deleted according to product policy.

---

### User Story 6 - Plan Content Adapts to the User's Goal (Priority: P2)

The AI's final plan is not a generic coding-style checklist. It uses a general planning structure for non-marketing goals and adds marketing-specific sections only when the user's goal involves marketing, lead generation, outreach, scraping, campaigns, social media, or email automation.

**Why this priority**: aiFetchly is a marketing automation product, but users may ask the chat assistant to plan non-marketing work. Plan Mode must feel native to marketing users without forcing irrelevant marketing headings into unrelated plans.

**Independent Test**: Can be tested by sending representative marketing and non-marketing requests, then verifying the saved plan uses relevant sections and omits irrelevant ones.

**Acceptance Scenarios**:

1. **Given** the user asks for an outreach campaign, **When** the AI submits a plan, **Then** it includes target audience, offer, channel strategy, lead source, email assets, compliance notes, metrics, and stop criteria.
2. **Given** the user asks for social media automation, **When** the AI submits a plan, **Then** it includes platform strategy, content themes, posting cadence, account safety, and success metrics.
3. **Given** the plan involves scraping or contact extraction, **When** the AI submits a plan, **Then** it identifies data sources, allowed scope, rate-limit concerns, compliance risks, and user approvals needed.
4. **Given** the user asks for a non-marketing plan, such as organizing a team workflow or planning a product decision, **When** the AI submits a plan, **Then** it uses general sections such as objective, context, assumptions, options, execution steps, risks, decisions needed, and success criteria without forcing audience, channels, offer, or campaign assets.

## Required Plan Mode Workflow

The AI should follow a workflow similar to Claude Code's plan mode, adapted to aiFetchly and the user's actual goal:

1. **Understand**
   - Restate the user's objective.
   - Identify missing constraints.
   - Decide whether planning is needed. If the user explicitly selected Plan Mode, remain in Plan Mode.

2. **Explore**
   - Review existing conversation history.
   - Use safe read-only tools if needed, such as listing available skills, inspecting existing campaign summaries, reading knowledge-base context, or researching public data if permitted.
   - Do not execute high-impact actions, especially marketing automation actions that contact leads, mutate campaigns, modify schedules, or change external accounts.

3. **Clarify**
   - Use `AskUserQuestion` when user-only information is required.
   - Ask concrete, decision-oriented questions.
   - Prefer 1-3 questions per card.
   - Do not ask questions that can be answered from existing chat, saved plan data, or safe read-only context.

4. **Design**
   - Produce a structured plan with assumptions and tradeoffs.
   - Use marketing-specific sections only when the user's objective is marketing-related.
   - Include risks, required approvals, and success metrics.
   - Explicitly identify which actions are safe to execute after approval.

5. **Review**
   - Check the plan against user intent, app capabilities, compliance constraints, and available tools.
   - Avoid unsupported actions or label them as manual steps.

6. **Submit**
   - Call `SubmitPlanForApproval`.
   - Save plan content and structured JSON in SQLite.
   - Render the approval card to the user.

7. **Exit or Iterate**
   - If approved, conversation can move to approved execution mode.
   - If rejected or changed, remain in Plan Mode and create a new plan version.

## Plan Content Template

Every final plan SHOULD include the universal sections below when relevant. Marketing-specific sections are required only when the user's goal relates to marketing, lead generation, outreach, scraping, campaigns, social media, email automation, or other aiFetchly marketing workflows.

### Universal Sections

1. **Objective**
   - Clear goal.
   - Primary success metric or desired outcome.

2. **Context**
   - Current situation.
   - Relevant constraints.
   - Known facts from the conversation or safe read-only context.

3. **Assumptions**
   - Explicit assumptions the AI is making.
   - What should be confirmed before execution.

4. **Options or Approach**
   - Recommended approach.
   - Alternative approaches when there are meaningful tradeoffs.
   - Why the recommended path is preferred.

5. **Inputs Needed**
   - Data, documents, preferences, accounts, or decisions required.
   - Required user-provided constraints.

6. **Execution Steps**
   - Ordered steps the system or user will perform.
   - Tool-backed steps versus manual steps.

7. **Deliverables**
   - Artifacts, outputs, or decisions the plan should produce.
   - Tool-backed deliverables versus manual deliverables.

8. **Risks and Safety**
   - Operational, compliance, data, account, financial, or user-impact risks.
   - Mitigations and approval points.

9. **Approval Checkpoints**
   - Actions requiring explicit approval.
   - Tool categories that remain permission-gated.

10. **Measurement**
    - Metrics to track.
    - Expected baseline.
    - Review cadence.

11. **Stop Criteria**
    - When to pause or cancel the plan.
    - Failure thresholds.
    - Rollback or cleanup steps.

### Marketing-Specific Sections

When the goal is marketing-related, the plan SHOULD also include these sections when relevant:

1. **Audience**
   - Target customer profile.
   - Exclusions or disallowed audiences.

2. **Offer and Positioning**
   - Core value proposition.
   - Messaging angle.
   - Proof points or differentiators.

3. **Channels**
   - Email, social, search, maps, website analysis, or other channels.
   - Why each channel is appropriate.

4. **Marketing Data and Inputs**
   - Lead sources.
   - Existing campaign assets.
   - Knowledge-base documents.
   - Contact enrichment or scraping scope.

5. **Marketing Assets to Generate**
   - Email templates.
   - Subject lines.
   - Social posts.
   - Search keywords.
   - Landing-page copy or notes.

6. **Marketing Compliance and Account Safety**
   - Consent, unsubscribe, anti-spam, platform rules, account safety, and rate limits.
   - External account risks.
   - Data handling risks.

## Requirements *(mandatory)*

### Functional Requirements

#### Chat UI and User Control

- **FR-001**: System MUST provide a Plan Mode option in the AI chat UI, visible near the composer or header of `AiChatV2`.
- **FR-002**: System MUST allow the user to choose between normal Chat Mode and Plan Mode before sending a message.
- **FR-003**: System MUST send the selected mode to the main process as part of the chat stream request.
- **FR-004**: System MUST display a visible Plan Mode indicator when the active conversation is in Plan Mode.
- **FR-005**: System MUST show plan status in the conversation UI when a conversation has an active, awaiting approval, approved, or rejected plan.
- **FR-006**: System MUST preserve existing AI chat v2 behavior for normal Chat Mode.

#### Plan State and Persistence

- **FR-007**: System MUST persist plan state in SQLite, not local component state or filesystem plan files.
- **FR-008**: System MUST store plan records separately from chat messages while allowing plan-related display messages in `ai_chat_messages`.
- **FR-009**: System MUST support plan statuses: `draft`, `awaiting_question`, `awaiting_approval`, `approved`, `rejected`, `executing`, `completed`, and `cancelled`.
- **FR-010**: System MUST support plan versioning so requested changes create a new version instead of overwriting previous plan content.
- **FR-011**: System MUST associate each plan with one conversation ID.
- **FR-012**: System MUST restore active plan state when loading conversation history.
- **FR-013**: System MUST expose IPC handlers for retrieving active plan state, plan versions, pending questions, and approval status.

#### AskUserQuestion Tool

- **FR-014**: System MUST register an `AskUserQuestion` tool for Plan Mode.
- **FR-015**: `AskUserQuestion` MUST accept 1-3 questions per call.
- **FR-016**: Each question MUST include a short `header`, a full `question`, and 2-4 selectable `options`.
- **FR-017**: Each option MUST include a `label` and `description`.
- **FR-018**: System MUST support optional `multiSelect` questions.
- **FR-019**: UI MUST always offer an "Other" path for custom user answers.
- **FR-020**: System MUST persist pending questions in SQLite before rendering them to the user.
- **FR-021**: System MUST resume the AI stream after the user answers a question.
- **FR-022**: System MUST return answered question data to the AI as a structured tool result.
- **FR-023**: System MUST prevent the AI from using `AskUserQuestion` to ask for final plan approval; final approval MUST use `SubmitPlanForApproval`.

#### SubmitPlanForApproval Workflow

- **FR-024**: System MUST register a `SubmitPlanForApproval` tool for Plan Mode.
- **FR-025**: `SubmitPlanForApproval` MUST save the final plan markdown and structured plan JSON in SQLite.
- **FR-026**: System MUST set plan status to `awaiting_approval` after the plan is submitted.
- **FR-027**: UI MUST render an approval card showing the plan content and available actions.
- **FR-028**: User MUST be able to approve, reject, or request changes to the plan.
- **FR-029**: Approval MUST persist `approvedAt` and any approving metadata.
- **FR-030**: Rejection MUST persist rejection state and optional user feedback.
- **FR-031**: Change requests MUST be passed back to the AI and produce a new plan version.

#### Plan Mode Tool Gating

- **FR-032**: System MUST enforce Plan Mode tool restrictions in backend execution logic, not only through prompt instructions.
- **FR-033**: Before plan approval, system MUST allow safe reasoning, pure tools, read-only tools, `AskUserQuestion`, and `SubmitPlanForApproval`.
- **FR-034**: Before plan approval, system MUST block tools that send emails, create or modify scheduled tasks, post to social platforms, modify campaigns, mutate contacts, perform state-changing browser automation, or execute shell/system operations.
- **FR-035**: After plan approval, plan-mode gating MUST allow execution tools to proceed to normal skill permission checks.
- **FR-036**: A blocked tool call MUST return a structured tool result explaining that plan approval is required.
- **FR-037**: Existing skill permission prompts MUST still apply after plan approval.
- **FR-038**: System MUST log plan-mode blocked tool calls for audit/debugging.

#### AI Prompting and Workflow Control

- **FR-039**: System MUST inject a Plan Mode system prompt when request mode is `plan` or the conversation has active plan state.
- **FR-040**: The Plan Mode prompt MUST instruct the AI to follow the required workflow: Understand, Explore, Clarify, Design, Review, Submit, Exit/Iterate.
- **FR-041**: The Plan Mode prompt MUST require domain-appropriate plan sections and MUST include marketing-specific sections only when the user's objective is marketing-related.
- **FR-042**: The Plan Mode prompt MUST instruct the AI not to execute high-impact tools before plan approval.
- **FR-043**: System MUST prefer backend-enforced tool allowlists over relying on model compliance.
- **FR-044**: System MUST support continuing Plan Mode after app restart or stream interruption using persisted plan/question state.

#### UI Components

- **FR-045**: System MUST add a mode selector to `AiChatV2` or `AiChatV2Composer`.
- **FR-046**: System MUST add a question card component for `AskUserQuestion`.
- **FR-047**: System MUST add a plan approval card component for submitted plans.
- **FR-048**: System MUST render plan-related messages in the message list without breaking existing tool call and permission card rendering.
- **FR-049**: System MUST show plan status badges such as `Planning`, `Question`, `Awaiting approval`, `Approved`, and `Rejected`.
- **FR-050**: System MUST support viewing previous plan versions from the active conversation.
- **FR-051**: System MUST use translations for all new user-facing UI text in English, Chinese, Spanish, French, German, and Japanese.

#### AI Feature Access Control

- **FR-052**: All Plan Mode IPC handlers serving AI functions MUST check AI enable first using `Token` and `USER_AI_ENABLED`.
- **FR-053**: If AI is disabled, Plan Mode handlers MUST return immediately with `{ status: false, msg: "...", data: null }` or stream an error completion before parsing request data.
- **FR-054**: Users without AI access MUST NOT be able to create, continue, approve for execution, or resume AI-generated plans.

#### Architecture Compliance

- **FR-055**: Database logic MUST live in Model and Module classes, never directly in IPC handlers.
- **FR-056**: Plan entities and question entities MUST be accessed through model classes in `src/model/`.
- **FR-057**: Plan business logic MUST live in module classes in `src/modules/`.
- **FR-058**: IPC handlers in `src/main-process/communication/` MUST call modules and sanitize request/response data.
- **FR-059**: Worker processes MUST NOT access plan SQLite tables directly.

## Proposed Data Model

### AIChatPlanEntity

Represents a durable plan attached to a chat conversation.

Fields:

- `id`: primary key
- `planId`: stable unique plan identifier
- `conversationId`: associated AI chat v2 conversation
- `status`: `draft | awaiting_question | awaiting_approval | approved | rejected | executing | completed | cancelled`
- `title`: user-facing plan title
- `objective`: concise objective statement
- `currentVersion`: integer
- `createdAt`: timestamp
- `updatedAt`: timestamp
- `approvedAt`: nullable timestamp
- `rejectedAt`: nullable timestamp
- `metadata`: JSON text for future extensibility

### AIChatPlanVersionEntity

Represents immutable plan content versions.

Fields:

- `id`: primary key
- `planId`: parent plan identifier
- `version`: integer
- `planMarkdown`: full readable plan
- `planJson`: structured plan data
- `changeReason`: nullable user feedback or AI-generated summary
- `createdAt`: timestamp
- `createdBy`: `assistant | user | system`

### AIChatPlanQuestionEntity

Represents a durable structured clarification prompt.

Fields:

- `id`: primary key
- `questionId`: stable unique question identifier
- `planId`: parent plan identifier
- `conversationId`: associated conversation
- `status`: `pending | answered | cancelled`
- `questionsJson`: serialized questions payload
- `answersJson`: nullable serialized answers payload
- `createdAt`: timestamp
- `answeredAt`: nullable timestamp

### AIChatPlanApprovalEntity *(optional for v1, recommended for audit)*

Represents approval or rejection events.

Fields:

- `id`: primary key
- `planId`: parent plan identifier
- `version`: approved/rejected version
- `decision`: `approved | rejected | changes_requested`
- `feedback`: nullable text
- `createdAt`: timestamp
- `metadata`: JSON text

## Proposed IPC/API Surface

### Request Extensions

Extend `ChatV2StreamRequest`:

```typescript
interface ChatV2StreamRequest {
  conversationId?: string;
  message: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  mode?: "chat" | "plan";
}
```

### New IPC Channels

- `ai-chat-v2:plan-state`
  - Returns active plan, status, latest version, and pending question for a conversation.

- `ai-chat-v2:answer-question`
  - Saves answers for a pending `AskUserQuestion` card and resumes the AI stream.

- `ai-chat-v2:approve-plan`
  - Approves a submitted plan version.

- `ai-chat-v2:reject-plan`
  - Rejects a submitted plan version.

- `ai-chat-v2:request-plan-changes`
  - Saves user feedback and resumes planning to create a new version.

- `ai-chat-v2:plan-versions`
  - Lists versions for a plan.

### New Stream Events

Extend `ChatV2StreamEventType` with:

- `plan_state`
- `ask_user_question`
- `plan_submitted`
- `plan_approved`
- `plan_rejected`
- `plan_blocked_tool`

## Proposed Tool Schemas

### AskUserQuestion

```json
{
  "questions": [
    {
      "header": "Audience",
      "question": "Which audience should this campaign target?",
      "multiSelect": false,
      "options": [
        {
          "label": "Local clinics",
          "description": "Focus on small local dental and healthcare clinics."
        },
        {
          "label": "SaaS teams",
          "description": "Focus on software companies with marketing teams."
        }
      ]
    }
  ]
}
```

Rules:

- `questions` length must be 1-3.
- `header` should be 12 characters or fewer when practical.
- `question` must be clear and user-answerable.
- `options` length must be 2-4.
- UI appends an "Other" option.
- Tool is only enabled in Plan Mode.

### SubmitPlanForApproval

```json
{
  "title": "Dental Clinic Outreach Campaign",
  "objective": "Generate qualified leads from local dental clinics through compliant email outreach.",
  "planMarkdown": "...",
  "planJson": {
    "goal": "...",
    "audience": "...",
    "channels": ["email", "local business search"],
    "executionSteps": [],
    "risks": [],
    "metrics": []
  }
}
```

Rules:

- `title`, `objective`, and `planMarkdown` are required.
- `planJson` should follow the domain-adaptive plan template when possible.
- Tool creates a new plan version and sets status to `awaiting_approval`.
- Tool is only enabled in Plan Mode.

## Tool Policy

### Allowed Before Plan Approval

- Pure reasoning tools.
- Read-only tools that do not mutate user data or external accounts.
- Listing available skills.
- Retrieving existing chat/plan state.
- Safe knowledge-base retrieval.
- `AskUserQuestion`.
- `SubmitPlanForApproval`.

### Blocked Before Plan Approval

- Email sending.
- Email campaign creation or mutation.
- Schedule creation or mutation.
- Social media posting.
- Browser automation that logs into or changes external accounts.
- Contact mutation, deletion, or bulk import.
- High-volume scraping or extraction jobs.
- Shell execution.
- System dependency installation.
- Filesystem writes.
- Any tool categorized as `automation`, `filesystem`, or `shell` unless explicitly allowlisted as plan-safe.

### After Plan Approval

Plan Mode no longer blocks execution tools for the approved conversation and plan version, but normal skill permission checks still apply.

## UI/UX Requirements

### Mode Selector

Preferred placement: composer area in `AiChatV2Composer`, because it affects the next message.

Acceptable placement: header in `AiChatV2`, if the product treats mode as conversation-level state.

Control behavior:

- Two-state segmented control: `Chat` and `Plan`.
- Plan mode tooltip: "Use for complex marketing tasks that need clarification, strategy, and approval before execution."
- When Plan Mode is selected, composer placeholder changes to a planning-oriented prompt.

### Question Card

The question card must show:

- Card title, e.g. "AI needs your input".
- One or more questions.
- Option buttons or radio controls.
- "Other" custom text input.
- Submit button.
- Disabled/loading state while saving answer.

### Plan Approval Card

The plan approval card must show:

- Plan title and status.
- Plan markdown content.
- Version number.
- Actions: `Approve`, `Request changes`, `Reject`.
- Optional collapsible structured data preview for advanced users.

### Conversation History

Conversation list items should indicate:

- Has active plan.
- Awaiting approval.
- Approved.
- Rejected.

## Edge Cases

- What happens if the user sends a new normal chat message while a plan question is pending?
  - The system should either answer in normal chat without resuming the plan or prompt the user to answer/cancel the pending question first. V1 should block new Plan Mode turns until pending question is resolved.

- What happens if the AI calls `AskUserQuestion` outside Plan Mode?
  - The tool should return an error that it is only available in Plan Mode.

- What happens if the AI calls `SubmitPlanForApproval` outside Plan Mode?
  - The tool should return an error that it is only available in Plan Mode.

- What happens if the user approves an old plan version after a newer version exists?
  - Approval should only be allowed for the latest awaiting-approval version.

- What happens if the app crashes during a pending question?
  - On restart, the pending question is loaded from SQLite and shown again.

- What happens if the app crashes after plan submission but before UI displays the approval card?
  - On reload, plan state is `awaiting_approval` and the approval card is restored.

- What happens if plan approval succeeds but an execution tool still requires permission?
  - The existing skill permission approval card appears. Plan approval does not bypass skill-level permissions.

- What happens if the user clears the conversation?
  - Product should decide whether to hard-delete or archive associated plans. V1 should clear plan state with the conversation to match user expectation.

- What happens if the model produces invalid `planJson`?
  - The backend should save `planMarkdown`, reject or sanitize invalid `planJson`, and return a tool error if required fields are missing.

- What happens if AI access is disabled mid-plan?
  - All plan IPC handlers and resume actions must fail fast with an AI-disabled message.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can enter Plan Mode from the chat UI and send a Plan Mode request in 100% of supported desktop environments.
- **SC-002**: Plan state, plan versions, pending questions, and approval decisions persist across app restart with 100% reliability in automated tests.
- **SC-003**: `AskUserQuestion` question cards render and resume the AI stream successfully in 95% of tested planning interactions.
- **SC-004**: High-impact tools are blocked before plan approval in 100% of automated policy tests.
- **SC-005**: Approved plans unlock eligible execution tools while preserving normal skill permission prompts in 100% of tested flows.
- **SC-006**: Final submitted plans use domain-appropriate sections in 90% of sampled AI-generated plans, including required marketing sections for marketing-related plans and omitting irrelevant marketing sections for non-marketing plans.
- **SC-007**: Users can request changes and receive a new plan version without losing previous versions in 100% of versioning tests.
- **SC-008**: All new UI text has translations in English, Chinese, Spanish, French, German, and Japanese.

## Assumptions

- AI chat v2 remains the primary surface for this feature.
- Existing OpenAI-compatible streaming and tool-call flow can be extended with plan-specific tools.
- Existing skill registry and skill executor can support mode-aware tool policy.
- SQLite is the source of truth for chat and plan memory.
- Plan Mode is conversation-scoped in V1.
- Normal Chat Mode remains default for new conversations.
- Users understand that approval of a plan is not the same as permission to execute every tool; skill permissions may still appear.

## Dependencies

- Existing `AIChatV2Module` and `AIChatModule` for chat persistence.
- Existing `ai-chat-v2-ipc.ts` streaming flow.
- Existing `SkillRegistry` and `SkillExecutor`.
- Existing skill permission cards and resume-after-permission flow.
- Existing Vue chat components:
  - `AiChatV2.vue`
  - `AiChatV2Composer.vue`
  - `AiChatV2Messages.vue`
  - `AiChatV2Message.vue`
- Existing i18n files:
  - `src/views/lang/en.ts`
  - `src/views/lang/zh.ts`
  - `src/views/lang/es.ts`
  - `src/views/lang/fr.ts`
  - `src/views/lang/de.ts`
  - `src/views/lang/ja.ts`

## Architecture Notes

### Recommended Backend Components

- `AIChatPlan.entity.ts`
- `AIChatPlanVersion.entity.ts`
- `AIChatPlanQuestion.entity.ts`
- `AIChatPlan.model.ts`
- `AIChatPlanVersion.model.ts`
- `AIChatPlanQuestion.model.ts`
- `AIChatPlanModule.ts`
- `PlanModeToolPolicy.ts`
- `PlanModePromptBuilder.ts`

### Recommended Frontend Components

- `AiChatV2ModeSelector.vue`
- `AiChatV2QuestionCard.vue`
- `AiChatV2PlanApprovalCard.vue`
- `AiChatV2PlanStatusBadge.vue`

### IPC Handler Guidance

All new AI plan IPC handlers must:

1. Check AI enable first.
2. Parse and validate request data.
3. Call module methods for database/business logic.
4. Return sanitized responses.
5. Never access TypeORM repositories directly.

## Open Questions

- Should Plan Mode be a per-message selection or a persistent conversation mode?
  - Recommendation: V1 should treat it as conversation-scoped once a plan is active, but the selector controls the next message when no active plan exists.

- Should users be able to edit plan markdown directly before approval?
  - Recommendation: V1 should support "Request changes" feedback instead of direct editing. Direct editing can be added later.

- Should approved plans trigger automatic execution?
  - Recommendation: V1 should not auto-execute. Approval should unlock execution, then the AI should ask or proceed only when the user's next instruction clearly requests execution.

- Should rejected plans be retained?
  - Recommendation: Retain rejected plans for conversation audit/history unless the user clears the conversation.

- Should Plan Mode be available for scheduled AI message tasks?
  - Recommendation: Defer. Scheduled tasks lack an interactive user for `AskUserQuestion`, so Plan Mode should initially require an interactive chat session.
