# Feature Specification: AI-Assisted Email Template Creation

**Feature Branch**: `001-ai-email-template`
**Created**: 2025-02-16
**Status**: Draft
**Input**: User description: "I plan to use ai to help user to create email template"

## Clarifications

### Session 2025-02-16

- Q: When the user clicks the "AI Generate Template" button and the textarea appears, what should happen to the existing template editing interface? → A: Inline expansion - Textarea expands below the button, keeping existing template fields visible
- Q: When the AI generation panel expands with the textarea, what configuration options should be displayed immediately versus being hidden behind advanced settings? → A: Balanced layout - Textarea + tone dropdown + template type dropdown visible by default, with RAG toggle hidden in expandable "Advanced" section
- Q: During AI generation, how should the system display progress to the user? → A: Streaming output - Display generated text character-by-character or word-by-word as it arrives from the AI service
- Q: When the user has already generated a template and clicks the "Generate" button again, what should happen? → A: Replace with confirmation - Show confirmation dialog "Replace current generated template?" before regenerating
- Q: For the "Refine existing template" feature, how should users access this refinement mode? → A: Same panel, auto-detect - System automatically enters refinement mode when template already has content, no explicit checkbox needed

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate New Email Template with AI (Priority: P1)

Marketing users need to create email templates from scratch without writing content manually. They provide a description of their email campaign needs, and the system generates a complete email template with subject line and body content.

**Why this priority**: This is the core value proposition - users can create professional email templates in seconds rather than spending hours writing and formatting. It delivers immediate time savings and enables users who struggle with writing to still run effective campaigns.

**Independent Test**: Can be fully tested by creating a new template, entering a prompt like "cold outreach for SaaS product", and receiving a complete email with subject and body that includes appropriate template variables.

**Acceptance Scenarios**:

1. **Given** user is on email template detail page, **When** user clicks "Generate with AI" button, **Then** system expands inline generation panel with textarea, tone dropdown, and template type dropdown visible, keeping existing template fields visible
2. **Given** user has entered a campaign description, **When** user selects tone and template type, **Then** system generates email subject and body containing valid template variables
3. **Given** AI has generated template content, **When** generation completes, **Then** system populates template title and content fields and collapses the inline generation panel
4. **Given** generated template content, **When** user reviews and saves template, **Then** template is stored and available for use in email campaigns
5. **Given** AI generation is in progress, **When** content streams in, **Then** user sees generated text appearing character-by-character in real-time in a preview area within the generation panel
6. **Given** user has already generated template content, **When** user clicks "Generate" button again, **Then** system displays confirmation dialog asking "Replace current generated template?" and only proceeds if user confirms

---

### User Story 2 - Generate with Contextual Knowledge (Priority: P2)

Marketing users need AI-generated emails that reference their brand guidelines, past successful templates, product information, and industry best practices. The system retrieves relevant contextual information from the knowledge base to enhance generation quality.

**Why this priority**: This dramatically improves output quality and personalization, making AI-generated templates more effective and aligned with the user's brand. It's valuable but not essential for basic functionality.

**Independent Test**: Can be tested by uploading brand documents to knowledge base, enabling "Use knowledge base" toggle, generating a template, and verifying that generated content references brand-specific terminology, style, or product details.

**Acceptance Scenarios**:

1. **Given** user has uploaded brand documents and past templates to knowledge base, **When** user expands "Advanced" section and enables RAG toggle, **Then** system searches knowledge base for relevant context before generating template
2. **Given** knowledge base contains past successful templates, **When** user generates new template, **Then** generated content reflects similar tone and structure to successful templates
3. **Given** knowledge base contains product descriptions, **When** user generates promotional email, **Then** generated content includes accurate product details and benefits
4. **Given** no relevant documents found in knowledge base, **When** generation proceeds, **Then** system generates template without contextual enhancement

---

### User Story 3 - Refine Existing Template with AI (Priority: P3)

Marketing users need to iterate on existing templates by asking AI to improve, rewrite, or adjust the tone and content. Users open an existing template and the system automatically detects it has content, entering refinement mode without manual configuration.

**Why this priority**: This enhances the workflow by enabling rapid iteration and A/B testing of variations. It's valuable for optimization but secondary to initial creation.

**Independent Test**: Can be tested by opening an existing template with content, clicking "Generate with AI", providing modification instructions like "make it more casual", and receiving updated content that maintains template structure but changes tone.

**Acceptance Scenarios**:

1. **Given** user has existing template with content open, **When** user clicks "Generate with AI" button, **Then** system auto-detects existing content and enters refinement mode, sending current template content to AI as context
2. **Given** system is in refinement mode, **When** AI generates updated content, **Then** system preserves template variable placement while modifying surrounding text
3. **Given** user is not satisfied with refinement, **When** user requests additional changes, **Then** system can iterate multiple times on same template
4. **Given** refined template content, **When** user saves template, **Then** system stores updated version while preserving original if user chooses
5. **Given** user is in refinement mode but wants to start over, **When** user clicks "Start fresh (ignore existing content)", **Then** system clears existing template content and switches to new template generation mode

---

### User Story 4 - Enhanced Variable System (Priority: P1)

Marketing users need access to a comprehensive set of template variables for personalization including recipient name, company name, unsubscribe links, and campaign context. The system validates that AI-generated templates use only valid variables.

**Why this priority**: This is foundational for email personalization and compliance. Without proper variables, templates cannot be effectively used in campaigns. This fixes an existing gap where some variables are defined but never populated.

**Independent Test**: Can be tested by generating templates with AI, verifying that only approved variables are used, and then sending test emails to confirm that all variables are correctly replaced with actual values.

**Acceptance Scenarios**:

1. **Given** AI generates template content, **When** generation completes, **Then** system validates that all variables match approved variable list
2. **Given** template contains variables like {$receiver_name} and {$company_name}, **When** email is sent, **Then** system replaces variables with actual recipient data
3. **Given** template includes {$unsubscribe_link}, **When** email is sent, **Then** system replaces variable with functional unsubscribe URL
4. **Given** AI attempts to use undefined variable, **When** validation detects invalid variable, **Then** system either auto-corrects to valid variable or flags error to user

---

### User Story 5 - AI Feature Access Control (Priority: P1)

The system must respect user subscription plans by only enabling AI template generation for users who have AI features enabled. Users without AI access should see clear upgrade messaging.

**Why this priority**: This is critical for business model compliance and revenue protection. Without proper gating, the feature would be available to free users who should be paying for it.

**Independent Test**: Can be tested by checking AI feature status for different user account types, verifying that disabled users cannot generate templates and see appropriate upgrade prompts.

**Acceptance Scenarios**:

1. **Given** user has AI features disabled, **When** user attempts to generate template, **Then** system displays upgrade prompt and prevents generation
2. **Given** user has AI features enabled, **When** user attempts to generate template, **Then** system proceeds with generation without additional prompts
3. **Given** AI feature is disabled mid-generation, **When** generation request reaches server, **Then** system returns error indicating feature not available
4. **Given** user clicks "Generate with AI" without access, **When** upgrade prompt displays, **Then** prompt clearly explains AI template generation benefits and links to upgrade page

---

### Edge Cases

- What happens when AI service is temporarily unavailable or times out?
  - System displays clear error message and offers option to retry or continue without AI
- How does system handle AI-generated content that exceeds character limits for email providers?
  - System validates length and either truncates with warning or prompts user to edit
- What happens when user provides very vague prompts (e.g., "write an email")?
  - System provides prompt guidance and suggestions for better input
- How does system handle inappropriate or policy-violating content in AI generation?
  - System filters and blocks inappropriate content with clear error message
- What happens when RAG knowledge base is empty or contains no relevant documents?
  - System proceeds with generation using only user prompt and system prompt
- How does system handle concurrent template generation requests from same user?
  - System queues requests or prevents multiple simultaneous generations to avoid confusion
- What happens when generated template contains malformed HTML or broken formatting?
  - System validates HTML structure and either auto-repairs or flags issues to user
- What happens when user clicks "Generate with AI" when the inline panel is already open?
  - System focuses the existing textarea without re-expanding; if panel is collapsed, it re-expands with previous content preserved
- What happens when user expands the "Advanced" section, changes settings, then collapses it again?
  - System preserves Advanced section settings (RAG toggle, refinement mode) even when collapsed, maintaining user's configuration choices
- What happens when user wants to stop generation mid-stream?
  - System provides a "Stop generating" button during streaming that cancels the request and keeps whatever content has been generated so far
- What happens when user regenerates template but cancels the confirmation dialog?
  - System keeps the previously generated template content unchanged and returns to the generation panel without starting new generation
- What happens when user regenerates, confirms, but the new generation fails partway through?
  - System displays error message and offers option to keep previous content or retry generation; previous content remains available until user explicitly confirms replacement
- What happens when user opens a template with minimal content (e.g., just a title)?
  - System auto-detects refinement mode if body content exists; if only title exists, system treats as new template generation
- What happens when user wants to switch from refinement mode back to generation mode (ignore existing content)?
  - System provides an option in the generation panel: "Start fresh (ignore existing content)" that clears existing content and switches to generation mode

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide AI email template generation interface that expands inline below the "Generate with AI" button on the email template detail page, keeping existing template fields visible
- **FR-002**: System MUST display prompt textarea, tone selector, and template type selector as visible fields in the expanded panel
- **FR-003**: System MUST provide an expandable "Advanced" section in the generation panel containing the RAG knowledge base toggle
- **FR-004**: System MUST accept user prompt describing desired email template content and purpose
- **FR-005**: System MUST allow users to select tone from predefined options: formal, casual, friendly, professional
- **FR-006**: System MUST allow users to select template type from predefined options: cold_outreach, follow_up, newsletter, promotion, custom
- **FR-007**: System MUST generate email subject line and body content based on user inputs
- **FR-008**: System MUST include only pre-approved template variables in generated content
- **FR-009**: System MUST validate all generated variables against approved variable list before displaying to user
- **FR-010**: System MUST provide option to use knowledge base (RAG) for contextual enhancement
- **FR-011**: System MUST search knowledge base for relevant documents when RAG is enabled
- **FR-012**: System MUST automatically detect when a template has existing content and enter refinement mode, sending current template content to AI as context for improved results
- **FR-013**: System MUST check user's AI feature access status before processing generation request
- **FR-014**: System MUST prevent template generation for users without AI feature enabled
- **FR-015**: System MUST display upgrade prompt when non-authorized user attempts generation
- **FR-016**: System MUST replace template variables with actual values during email sending
- **FR-017**: System MUST support extended variable set: {$send_time}, {$sender}, {$receiver_email}, {$receiver_name}, {$url}, {$description}, {$company_name}, {$campaign_name}, {$unsubscribe_link}
- **FR-018**: System MUST stream generated content to the UI in real-time, displaying text as it arrives from the AI service (character-by-character or word-by-word)
- **FR-019**: System MUST provide a "Stop generating" button during streaming that cancels the AI request and preserves partially generated content
- **FR-020**: System MUST allow users to edit AI-generated content before saving
- **FR-021**: System MUST maintain all existing manual template creation functionality
- **FR-022**: System MUST support all 6 languages (English, Chinese, Spanish, French, German, Japanese) for UI elements
- **FR-023**: System MUST log all generation requests for analytics and debugging
- **FR-024**: System MUST display confirmation dialog when user attempts to regenerate a template that already has AI-generated content, asking "Replace current generated template?" before proceeding
- **FR-025**: System MUST provide "Start fresh" option in refinement mode that clears existing template content and switches to new template generation mode

### Key Entities

- **AI Template Generation Request**: Contains user prompt, selected tone, template type, RAG flag, refinement mode flag, and optional existing template content
- **AI Template Generation Response**: Contains generated title, content, description, list of variables used, and status
- **Template Variable**: Approved variable name with description of what data it replaces during sending (e.g., {$receiver_name} → recipient's first name)
- **Knowledge Base Document**: User-uploaded content including past templates, brand guidelines, product descriptions, and industry best practices
- **Email Template**: Stored template with title, content, metadata about when/how it was created (manually or AI-generated)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can generate complete email template (subject + body) in under 30 seconds from prompt to completion
- **SC-002**: 90% of AI-generated templates contain only valid template variables without requiring corrections
- **SC-003**: 80% of users rate AI-generated templates as "ready to use" or "requires only minor edits"
- **SC-004**: Templates generated with RAG enabled show 25% higher use of brand-specific terminology compared to non-RAG
- **SC-005**: 95% of generation attempts complete successfully without timeouts or errors
- **SC-006**: Users without AI access cannot bypass restriction (100% enforcement)
- **SC-007**: Time savings: Users reduce template creation time by 60% compared to manual writing
- **SC-008**: All extended variables ({$receiver_name}, {$company_name}, {$unsubscribe_link}, etc.) are correctly populated during email sending with 100% accuracy

## Assumptions

1. Remote AI server is accessible and has capacity to handle template generation requests
2. RAG knowledge base has been indexed and contains relevant documents for context
3. User accounts have existing AI feature flags that can be checked via Token service
4. Email template detail UI exists and can accommodate new AI generation button/dialog
5. Existing variable replacement infrastructure can be extended to support new variables
6. Internationalization system is functional and can accommodate new translation keys
7. User's subscription plan determines AI feature access (this check is already implemented for other AI features)
8. Generated templates will be stored using existing email template persistence mechanisms
9. AI service will return structured JSON responses that can be parsed and validated
10. Network latency to AI server is acceptable (under 10 seconds for generation)

## Dependencies

1. Remote AI server must implement dedicated endpoint for email template generation (Option A) or support streaming chat with system prompts (Option B)
2. RAG search module must be functional and accessible from IPC handlers
3. Token service must provide AI feature status check functionality
4. Existing template variable system must be documented to understand approved variable list
5. Email sending infrastructure must be able to provide data for extended variables (receiver name, company name, unsubscribe URL)

## Open Questions

None - all requirements are clear enough to proceed with planning
