# AI App Navigation Tool — Manual Test Cases

Copy-paste-ready messages for manually testing the AI App Navigation Tool feature.
The tool lets AI Chat route users to internal application pages from natural language.

**Pre-conditions:**
- App is running with `yarn dev`
- AI Chat is enabled in settings (`USER_AI_ENABLED = "true"`)
- Start a fresh AI Chat conversation for each test section

---

## 1. Direct Navigation — Specific Pages

**1.1 — Email Service (exact alias match):**

```
Open email service.
```

*Expected:* App navigates to Email Marketing Service List page (`/emailmarketing/emailservice/list`).

**1.2 — Email Reply Audit (alias match):**

```
Check email reply log.
```

*Expected:* App navigates to AI Auto Reply Audit List page (`/emailmarketing/emailreply/audit/list`).

**1.3 — Email Service via alternate alias:**

```
Open smtp settings.
```

*Expected:* App navigates to Email Marketing Service List page (`/emailmarketing/emailservice/list`).

**1.4 — Email Reply Audit via alternate alias:**

```
Show me the ai replies.
```

*Expected:* App navigates to AI Auto Reply Audit List page (`/emailmarketing/emailreply/audit/list`).

**1.5 — Campaign List:**

```
Go to the campaign list.
```

*Expected:* App navigates to Campaign List page.

**1.6 — Social Account List:**

```
Open social accounts.
```

*Expected:* App navigates to Social Account List page.

**1.7 — Schedule List:**

```
Show me the schedule list.
```

*Expected:* App navigates to Schedule List page.

**1.8 — System Settings:**

```
Open system settings.
```

*Expected:* App navigates to System Settings page.

| Test ID | Input | Expected Navigation Target |
|---------|-------|---------------------------|
| 1.1 | "Open email service." | `Email_Marketing_Service_LIST` |
| 1.2 | "Check email reply log." | `AI_Auto_Reply_Audit_List` |
| 1.3 | "Open smtp settings." | `Email_Marketing_Service_LIST` |
| 1.4 | "Show me the ai replies." | `AI_Auto_Reply_Audit_List` |
| 1.5 | "Go to the campaign list." | Campaign List page |
| 1.6 | "Open social accounts." | Social Account List page |
| 1.7 | "Show me the schedule list." | Schedule List page |
| 1.8 | "Open system settings." | System Settings page |

---

## 2. Ambiguous Queries — Clarification Required

**2.1 — Generic email page:**

```
Open email page.
```

*Expected:* AI responds with clarification options (e.g., "Do you mean Email Service, Email Reply Audit, ...?"). No automatic navigation occurs.

**2.2 — Generic campaign page:**

```
Go to campaign page.
```

*Expected:* AI asks for clarification if multiple campaign pages exist. No automatic navigation occurs.

**2.3 — Vague request:**

```
Open the email thing.
```

*Expected:* AI responds with clarification candidates. No navigation occurs.

| Test ID | Input | Expected |
|---------|-------|----------|
| 2.1 | "Open email page." | Clarification message with candidate list; no navigation |
| 2.2 | "Go to campaign page." | Clarification message or navigates to the only campaign list |
| 2.3 | "Open the email thing." | Clarification message with candidates; no navigation |

---

## 3. Blocked / Excluded Routes

**3.1 — Login page (explicitly excluded):**

```
Open login.
```

*Expected:* AI does NOT navigate to the login page. Responds with safe failure or says login is not supported.

**3.2 — Logout:**

```
Go to logout.
```

*Expected:* AI does NOT navigate. Responds that logout is not available through this tool.

**3.3 — Auth callback:**

```
Open the auth callback page.
```

*Expected:* AI does NOT navigate. Safe failure response.

| Test ID | Input | Expected |
|---------|-------|----------|
| 3.1 | "Open login." | No navigation; safe failure or "not supported" message |
| 3.2 | "Go to logout." | No navigation; safe failure response |
| 3.3 | "Open the auth callback page." | No navigation; safe failure response |

---

## 4. Required-Param Routes (MVP blocked)

**4.1 — Campaign detail/edit:**

```
Open campaign 123.
```

*Expected:* AI does NOT navigate. Responds that detail pages require parameters that cannot be safely resolved, or says the page is not supported.

**4.2 — Email receive detail:**

```
Show me email receive detail 456.
```

*Expected:* No navigation. Safe failure with `needsRouteParams` hint or similar.

**4.3 — Schedule detail:**

```
Open schedule detail 789.
```

*Expected:* No navigation. Safe failure.

| Test ID | Input | Expected |
|---------|-------|----------|
| 4.1 | "Open campaign 123." | No navigation; safe failure |
| 4.2 | "Show me email receive detail 456." | No navigation; safe failure |
| 4.3 | "Open schedule detail 789." | No navigation; safe failure |

---

## 5. Non-Navigation Queries

**5.1 — General question (should NOT trigger navigation):**

```
What is the email service page for?
```

*Expected:* AI answers the question with text. No navigation occurs.

**5.2 — Action request (should NOT trigger navigation):**

```
Send a bulk email.
```

*Expected:* AI responds to the action request (may explain how to do it or say it cannot send emails). No navigation occurs.

**5.3 — Data question:**

```
How many campaigns do I have?
```

*Expected:* AI answers conversationally. No navigation occurs.

**5.4 — Greeting:**

```
Hello, how are you?
```

*Expected:* Normal conversational response. No navigation occurs.

| Test ID | Input | Expected |
|---------|-------|----------|
| 5.1 | "What is the email service page for?" | Text answer; no navigation |
| 5.2 | "Send a bulk email." | Text response; no navigation |
| 5.3 | "How many campaigns do I have?" | Text answer; no navigation |
| 5.4 | "Hello, how are you?" | Conversational reply; no navigation |

---

## 6. Variation Phrasing

**6.1 — "I want to..." phrasing:**

```
I want to open the email service.
```

*Expected:* Navigates to Email Marketing Service List.

**6.2 — "Can you show me..." phrasing:**

```
Can you show me the email reply audit?
```

*Expected:* Navigates to AI Auto Reply Audit List.

**6.3 — "Navigate to..." phrasing:**

```
Navigate to email marketing.
```

*Expected:* Navigates to Email Marketing Service List or clarifies if ambiguous.

**6.4 — "Switch to..." phrasing:**

```
Switch to social accounts.
```

*Expected:* Navigates to Social Account List.

**6.5 — No verb, direct request:**

```
email service
```

*Expected:* Navigates to Email Marketing Service List.

| Test ID | Input | Expected |
|---------|-------|----------|
| 6.1 | "I want to open the email service." | Navigate to Email Marketing Service List |
| 6.2 | "Can you show me the email reply audit?" | Navigate to AI Auto Reply Audit List |
| 6.3 | "Navigate to email marketing." | Navigate or clarify |
| 6.4 | "Switch to social accounts." | Navigate to Social Account List |
| 6.5 | "email service" | Navigate to Email Marketing Service List |

---

## 7. Tool Call Visibility in Chat

**7.1 — Tool call is visible:**

```
Open email service.
```

*Expected:* Chat transcript shows a tool call message (toolbox icon) for `open_app_page`, followed by a tool result message. The navigation also occurs.

**7.2 — Tool call record after navigation:**

Navigate away from the page, then check chat history.

*Expected:* The tool call and result rows are still visible in the chat transcript.

| Test ID | Action | Expected |
|---------|--------|----------|
| 7.1 | Send navigation prompt | Tool call + tool result rows appear in chat transcript |
| 7.2 | Navigate away, scroll chat history | Tool call/result rows still visible |

---

## 8. Renderer Route Validation (Edge Cases)

**8.1 — Stale route name in tool result:**

*This tests the renderer safety check. If you can modify the tool result before it reaches the renderer (e.g., during debugging), inject a non-existent route name.*

*Expected:* Console warning "AI navigation route was not found"; no navigation occurs.

**8.2 — Route with `aiNavigable: false` in metadata:**

```
Open login page.
```

*Expected:* Even if the login route exists in the router, the renderer blocks navigation because `meta.aiNavigable === false`. Console warning "AI navigation route was blocked".

| Test ID | Action | Expected |
|---------|--------|----------|
| 8.1 | Inject non-existent route name | Console warning; no navigation |
| 8.2 | Request excluded route | Console warning; no navigation |

---

## 9. Cross-Conversation Isolation

**9.1 — Navigation does not leak across conversations:**

1. Send "Open email service." in conversation A — verify navigation.
2. Start conversation B.
3. Send "What page am I on?" in conversation B.

*Expected:* Conversation B has no knowledge of the navigation from conversation A. No automatic navigation occurs.

| Test ID | Action | Expected |
|---------|--------|----------|
| 9.1 | Navigate in conv A, then chat in conv B | Conv B is independent; no spillover |

---

## 10. Edge Cases

**10.1 — Empty query:**

```
 .
```

*(A single period or whitespace only)*

*Expected:* AI does not call the tool, or the tool returns a safe failure for empty/invalid input. No navigation.

**10.2 — Very long query:**

```
Open the email marketing service page where I can manage all of my email service accounts and SMTP settings and mailbox configurations for sending emails to my contacts and leads and subscribers.
```

*Expected:* Tool handles long input gracefully. Navigates to Email Marketing Service List or clarifies. No crash.

**10.3 — Special characters:**

```
Open email service <script>alert(1)</script>
```

*Expected:* No XSS or code injection. Tool either navigates to the correct page (ignoring the junk) or returns a safe failure. No console errors.

**10.4 — Non-English query:**

```
打开邮件服务
```

*Expected:* Either navigates (if the matcher supports Chinese) or returns a safe failure. No crash.

| Test ID | Input | Expected |
|---------|-------|----------|
| 10.1 | " . " (whitespace/period) | Safe failure; no navigation |
| 10.2 | Very long email service query | Navigate or clarify; no crash |
| 10.3 | Query with `<script>` tag | No injection; safe failure or correct navigation |
| 10.4 | "打开邮件服务" (Chinese) | Safe failure or navigation; no crash |

---

## Smoke Test Order

If short on time, run these in order — they prove the feature end-to-end:

1. **§1.1** — Exact alias navigates correctly
2. **§1.3** — Alternate alias navigates correctly
3. **§2.1** — Ambiguous query returns clarification (no navigation)
4. **§3.1** — Login page is blocked
5. **§4.1** — Detail page with params is blocked
6. **§5.1** — General question does not trigger navigation
7. **§7.1** — Tool call is visible in chat transcript
8. **§6.1** — Variation phrasing ("I want to...") works

---

## Quick Reference: Which Prompt Tests What

| Prompt | Tests |
|--------|-------|
| §1.1 "Open email service." | Direct navigation, exact alias |
| §1.3 "Open smtp settings." | Alternate alias mapping |
| §2.1 "Open email page." | Ambiguous → clarification |
| §3.1 "Open login." | Excluded route blocked |
| §4.1 "Open campaign 123." | Required-param route blocked |
| §5.1 "What is the email service page for?" | Non-navigation question |
| §6.1 "I want to open the email service." | Variation phrasing |
| §7.1 "Open email service." | Tool call visibility in chat |
| §10.3 "Open email service \<script\>..." | Security / injection test |
