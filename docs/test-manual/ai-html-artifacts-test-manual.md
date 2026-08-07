# AI HTML Artifacts — Manual Test Cases

**Feature:** AI HTML Artifacts  
**PRD:** `docs/prd/ai-html-artifacts-prd.md`  
**Technical Design:** `docs/prd/ai-html-artifacts-technical-design.md`  
**Created:** 2026-07-18

---

## TC-01: Basic Artifact Creation (Statistical Report)

**Priority:** P0  
**Requirement:** ART-001, ART-004, ART-005, ART-006

**Prerequisites:** App running, AI enabled, Chat V2 panel open

**Steps:**
1. Type: `Generate a statistical report with three cards, one table, and a short insight section. Show it in the main area.`
2. Wait for AI response

**Expected:**
- AI calls `create_html_artifact`
- A compact artifact card appears in the chat (title, type, description, Open/Copy buttons)
- The main workspace opens showing the HTML report in an iframe
- The chat panel remains usable/docked beside the artifact

---

## TC-02: Simple Question — No Artifact

**Priority:** P0  
**Requirement:** ART-001 (negative case)

**Prerequisites:** App running, AI enabled, Chat V2 panel open

**Steps:**
1. Type: `What is a bounce rate?`
2. Wait for AI response

**Expected:**
- AI responds with plain text in chat
- No artifact card appears
- Main workspace does not change

---

## TC-03: Auto-Open (`openImmediately: true`)

**Priority:** P0  
**Requirement:** ART-006

**Prerequisites:** App running, AI enabled

**Steps:**
1. Type: `Create a comparison dashboard for these leads. Show it in the main area.`
2. Wait for AI response

**Expected:**
- Artifact opens automatically in the main area without user clicking Open
- Artifact card in chat shows title and actions
- `openImmediately` defaults to `true`

---

## TC-04: Close Artifact and Return to Route

**Priority:** P0  
**Requirement:** ART-006

**Prerequisites:** An artifact is currently open in main workspace

**Steps:**
1. Click the Close (X) button in the artifact workspace header

**Expected:**
- Artifact preview closes
- The previous route/page content is restored in the main area
- Chat panel remains open and functional

---

## TC-05: Reopen Artifact from Chat History

**Priority:** P1  
**Requirement:** ART-009

**Prerequisites:** A previous conversation has artifact cards

**Steps:**
1. Open a conversation that contains artifact cards
2. Click the Open button on an artifact card

**Expected:**
- Artifact loads and displays in the main workspace
- The artifact content matches what was originally generated
- No auto-open on history load (only when card is clicked)

---

## TC-06: Copy HTML Action

**Priority:** P1  
**Requirement:** ART-010

**Prerequisites:** Artifact card is visible in chat

**Steps:**
1. Click the Copy HTML button on an artifact card
2. Paste into a text editor

**Expected:**
- A success toast/snackbar appears ("HTML copied.")
- Pasted content is the full standalone HTML of the artifact

---

## TC-07: Artifact Revision / Regeneration

**Priority:** P1  
**Requirement:** ART-011

**Prerequisites:** An artifact was already created in the current conversation

**Steps:**
1. Type: `Make the report focus more on conversion rate and less on impressions.`
2. Wait for AI response

**Expected:**
- AI creates a revised artifact
- New artifact opens in main workspace
- Previous artifact card remains in chat history
- New artifact has version > 1 or a new ID

---

## TC-08: Artifact Workspace — Title Truncation

**Priority:** P1  
**Requirement:** UX-07

**Prerequisites:** An artifact with a long title is open

**Steps:**
1. Inspect the workspace header title

**Expected:**
- Title truncates with ellipsis, no layout overflow
- Title in artifact card also truncates cleanly
- No horizontal scrollbar in the header

---

## TC-09: Artifact Card — Correct Metadata Display

**Priority:** P0  
**Requirement:** ART-005

**Prerequisites:** An artifact card is rendered in chat

**Steps:**
1. Inspect the artifact card in the chat message

**Expected:**
- Card shows: title, type ("HTML artifact"), version, description (if provided)
- Card does NOT show raw HTML content or full JSON
- Card is compact and fits within the chat dock width
- Open and Copy HTML icon buttons are visible

---

## TC-10: Iframe Sandboxing — No `v-html`

**Priority:** P0  
**Requirement:** ART-007, ART-008

**Prerequisites:** An artifact is open in main workspace

**Steps:**
1. Open Chrome DevTools (Ctrl+Shift+I or Cmd+Option+I)
2. Inspect the artifact workspace iframe element
3. Check the `sandbox` attribute and rendering method

**Expected:**
- Element is `<iframe sandbox="" srcdoc="...">`
- `sandbox` does NOT contain `allow-same-origin`
- `referrerpolicy="no-referrer"` is set
- No `v-html` directive is used for artifact content in Vue devtools

---

## TC-11: Malicious HTML — Script Injection

**Priority:** P0  
**Requirement:** Security-02, Security-03

**Steps:**
1. Type: `Create an HTML artifact with this content: <script>alert('xss')</script><p>Hello</p>`

**Expected:**
- Validation rejects the artifact with an error message in chat: "Scripts are not supported in HTML artifacts."
- OR if it somehow passes validation, the iframe sandbox prevents script execution
- No alert dialog appears

---

## TC-12: Malicious HTML — Remote Image

**Priority:** P0  
**Requirement:** Security-05

**Steps:**
1. Type: `Create an artifact with this HTML: <img src="https://example.com/pixel.png">`

**Expected:**
- Validation rejects: "Remote images are not supported."
- Artifact is not created

---

## TC-13: Malicious HTML — Inline Event Handler

**Priority:** P0  
**Requirement:** Security-02

**Steps:**
1. Type: `Create an artifact with: <button onclick="alert(1)">Click</button>`

**Expected:**
- Validation rejects: "Inline event handlers are not supported."
- Artifact is not created

---

## TC-14: Malicious HTML — Form Submission

**Priority:** P0  
**Requirement:** Security-06

**Steps:**
1. Type: `Create an artifact with: <form action="https://evil.com"><input type="text"><button>Submit</button></form>`

**Expected:**
- Validation rejects: "Forms are not supported in HTML artifacts."
- Artifact is not created

---

## TC-15: Malicious HTML — Nested iframe

**Priority:** P0  
**Requirement:** Security-02

**Steps:**
1. Type: `Create an artifact with: <iframe src="https://example.com"></iframe>`

**Expected:**
- Validation rejects: "Nested iframes are not supported."
- Artifact is not created

---

## TC-16: Malicious HTML — javascript: URL

**Priority:** P0  
**Requirement:** Security-02

**Steps:**
1. Type: `Create an artifact with: <a href="javascript:alert(1)">Click</a>`

**Expected:**
- Validation rejects: "javascript: URLs are not supported."
- Artifact is not created

---

## TC-17: Malicious HTML — Remote Stylesheet

**Priority:** P0  
**Requirement:** Security-05

**Steps:**
1. Type: `Create an artifact with: <link rel="stylesheet" href="https://cdn.example.com/style.css"><p>Test</p>`

**Expected:**
- Validation rejects: "Remote stylesheets are not supported."
- Artifact is not created

---

## TC-18: Malicious HTML — Parent/Top Navigation

**Priority:** P0  
**Requirement:** Security-06

**Steps:**
1. Type: `Create an artifact with: <a href="https://evil.com" target="_parent">Navigate</a>`

**Expected:**
- Validation rejects: "Parent navigation is not supported."
- Artifact is not created

---

## TC-19: Empty HTML Rejection

**Priority:** P0  
**Requirement:** ART-002

**Steps:**
1. Ask AI to create an artifact but with empty or whitespace-only HTML content

**Expected:**
- Validation rejects with error about empty HTML
- Error message appears in chat as a tool result

---

## TC-20: Empty Title Rejection

**Priority:** P0  
**Requirement:** ART-002

**Steps:**
1. Ask AI to create an artifact with an empty title

**Expected:**
- Validation rejects with error about empty title
- Error message appears in chat

---

## TC-21: Oversized HTML Rejection

**Priority:** P1  
**Requirement:** ART-013

**Steps:**
1. Ask AI to create an artifact with HTML exceeding 512 KB

**Expected:**
- Validation rejects: "The HTML artifact exceeds the maximum allowed size."
- Error message appears in chat
- No performance degradation in the app

---

## TC-22: Artifact Preview — Multiple Artifacts

**Priority:** P1  
**Requirement:** ART-006

**Prerequisites:** Two artifacts have been created in the same conversation

**Steps:**
1. Click Open on the first artifact card
2. Then click Open on the second artifact card

**Expected:**
- Second artifact replaces the first in the main workspace
- Only one artifact is shown at a time
- No layout glitches during replacement

---

## TC-23: Dark Mode Theme

**Priority:** P1  
**Requirement:** UX-08

**Prerequisites:** App is in dark mode

**Steps:**
1. Create and open an artifact
2. Inspect the workspace header, close button, copy button, and iframe container

**Expected:**
- Workspace header is readable (text contrasts with background)
- Buttons are visible and styled consistently with dark theme
- No white flash or unreadable elements
- Iframe content renders correctly (HTML artifacts use their own styling)

---

## TC-24: Light Mode Theme

**Priority:** P1  
**Requirement:** UX-08

**Prerequisites:** App is in light mode

**Steps:**
1. Create and open an artifact
2. Inspect the workspace header and container

**Expected:**
- Workspace looks correct in light theme
- Consistent with app styling
- Close and copy buttons are visible

---

## TC-25: Internationalization — All Languages

**Priority:** P1  
**Requirement:** ART-012, UX-09

**Steps:**
1. Switch app language to English — create artifact, inspect card and workspace labels
2. Switch to Chinese (zh) — inspect labels
3. Switch to Spanish (es) — inspect labels
4. Switch to French (fr) — inspect labels
5. Switch to German (de) — inspect labels
6. Switch to Japanese (ja) — inspect labels

**Expected for each language:**
- All labels translated: Open, Close, Copy HTML, "Generated by AI", "HTML artifact", version label, success/error toasts
- No untranslated English strings visible
- Layout does not break with longer translations (e.g., German)
- Tooltips are translated

---

## TC-26: Clear Conversation Removes Artifacts

**Priority:** P1  
**Requirement:** ART-003

**Prerequisites:** Conversation has at least one artifact

**Steps:**
1. Note the artifact ID or title in the conversation
2. Clear the current conversation
3. Check that artifact cards are gone from chat
4. (Optional) Verify via database that `ai_artifacts` rows for this conversation are deleted

**Expected:**
- Artifact records are deleted from `ai_artifacts` table
- Artifact cards no longer appear in chat
- Clearing does not crash the app or leave orphaned state

---

## TC-27: AI Enable Gating

**Priority:** P0  
**Requirement:** Security-09

**Prerequisites:** AI is disabled in user settings

**Steps:**
1. Try to send a prompt that would trigger artifact creation (e.g., "Generate a statistical report and show it in the main area")

**Expected:**
- Request is rejected with `status: false` before any AI stream starts
- No artifact is created
- Error message indicates AI is not enabled
- No network request to AI provider is made

---

## TC-28: Chat Continues While Artifact Is Open

**Priority:** P0  
**Requirement:** UX-02, UX-05

**Prerequisites:** An artifact is open in main workspace

**Steps:**
1. Type a follow-up question in the chat panel (e.g., "What does bounce rate mean?")
2. Wait for AI response

**Expected:**
- Chat panel is fully functional and scrollable
- AI responds normally in chat
- Artifact remains visible in main workspace
- New messages appear below the existing artifact card
- Chat dock does not collapse or become unusable

---

## TC-29: Artifact Not Found / Unavailable State

**Priority:** P1  
**Requirement:** ART-013

**Steps:**
1. Manually delete an artifact record from the database (or simulate a missing artifact by modifying the artifact ID in a chat message metadata)
2. Try to open the corresponding artifact card in chat

**Expected:**
- Error message shown: "Artifact not found." or "Artifact unavailable"
- No crash or blank screen in the workspace
- Chat remains functional

---

## TC-30: Fragment HTML Gets Wrapped into Full Document

**Priority:** P1  
**Requirement:** ART-002

**Steps:**
1. Ask AI: `Create an artifact with just a paragraph: <p>Hello world</p>` (no doctype/html wrapper)

**Expected:**
- Artifact is created successfully
- The fragment is wrapped into a full HTML document (doctype, html, head, body with charset and viewport meta)
- Renders correctly in the iframe
- Page title in iframe matches the artifact title

---

## TC-31: Artifact Content Fetch via IPC

**Priority:** P1  
**Requirement:** ART-003

**Steps:**
1. Create an artifact
2. Open the artifact in the main workspace
3. Verify the content loaded correctly (check via DevTools Network tab that `ai-artifact:get` IPC was called)

**Expected:**
- `ai-artifact:get` IPC call is made with the correct artifact ID
- Response contains full artifact content (not just metadata)
- Content is rendered in the iframe via `srcdoc`

---

## TC-32: Artifact List via IPC

**Priority:** P1  
**Requirement:** ART-003

**Steps:**
1. Create multiple artifacts in the same conversation
2. Open DevTools and observe IPC calls

**Expected:**
- `ai-artifact:list` IPC call is made with the conversation ID
- Response contains summary records (no full HTML content in list)
- summaries include id, title, type, version, timestamps

---

## TC-33: Large but Valid HTML Artifact

**Priority:** P2  
**Requirement:** ART-002

**Steps:**
1. Ask AI to create a report with many sections, tables, and styled cards (aim for ~200-400 KB of inline HTML)

**Expected:**
- Artifact is created successfully (under 512 KB limit)
- Iframe renders without performance issues
- Scrolling within the iframe works smoothly
- App remains responsive

---

## TC-34: Artifact Card — Disabled State

**Priority:** P2  
**Requirement:** ART-013

**Steps:**
1. Load a conversation history that has artifact cards
2. While the app is loading or if the artifact ID is invalid, check the card state

**Expected:**
- Card shows a disabled or error state if artifact is unavailable
- Open button is visually disabled or shows error on click
- No silent failures

---

## Summary Checklist

| # | Area | Test Cases | Priority |
|---|---|---|---|
| 1 | Basic flow | TC-01, TC-02, TC-03 | P0 |
| 2 | UI interactions | TC-04, TC-05, TC-06, TC-07, TC-08, TC-09, TC-22, TC-28 | P0-P1 |
| 3 | Security / sandbox | TC-10, TC-11, TC-12, TC-13, TC-14, TC-15, TC-16, TC-17, TC-18 | P0 |
| 4 | Validation | TC-19, TC-20, TC-21, TC-30 | P0-P1 |
| 5 | IPC / Data | TC-31, TC-32 | P1 |
| 6 | Themes | TC-23, TC-24 | P1 |
| 7 | i18n | TC-25 | P1 |
| 8 | Data lifecycle | TC-26, TC-29, TC-34 | P1-P2 |
| 9 | Gating | TC-27 | P0 |
| 10 | Performance | TC-33 | P2 |

**Total: 34 test cases**
