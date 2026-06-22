# AI Chat V2 — Manual Test Prompts

Copy-paste-ready messages for manually testing the AI Chat V2 features.
Replace bracketed placeholders `[...]` with real data before sending.

---

## 1. Compact Memory Tests

**Setup message (send first to build context, then click the compact button):**

```
Let's have a long planning discussion. I'm launching a new email marketing campaign
for a SaaS tool. Ask me 8-10 clarifying questions one at a time about my audience,
goals, budget, tone, KPIs, sending frequency, sender domain, and segment strategy.
After each answer, acknowledge briefly and ask the next question.
```

*After ~10 exchanges, click the compact (collapse) button in the header.*

**Post-compact verification message:**

```
Based on our conversation so far, summarize my campaign goals and audience in 2 sentences.
Then suggest one improvement.
```

*Expected:* Model still knows the prior content (proves the compact summary is being used).

| Test ID | Action | Expected |
|---------|--------|----------|
| 1.1 | Click compact button after long conversation | Spinner → success snackbar → CTX badge recalculates |
| 1.4 | Click compact during streaming | Button disabled |
| 1.5 | Disable AI in settings, click compact | Error message, no compaction |
| 1.7 | Observe CTX % before / after compact | Drops significantly after compact |
| 1.8 | Scroll history after compact | All messages still visible |
| 1.9 | Send post-compact verification message | Model references prior topics correctly |

---

## 2. Plan Mode Tests (Manual — select "Plan" in dropdown first)

**2.1 Trigger plan submission:**

```
I want to extract contact info from 3 websites: example.com, acme.io, and foobar.co.
Build me a step-by-step plan covering scraping approach, rate limits, data validation,
and how results will be stored.
```

**2.4 Reject test — after plan appears, click "Reject" and paste:**

```
The plan is missing a step for handling CAPTCHAs. Please add a fallback strategy
that retries with a proxy pool before giving up.
```

**2.5 / 2.6 Request changes — click "Request Changes" and paste:**

```
Add a verification step where extracted emails are validated with a DNS MX lookup
before being saved. Also include estimated time per step.
```

*Repeat to verify version increments v1 → v2 → v3.*

**2.8 Question card trigger (ambiguous request):**

```
Help me grow my business using AI.
```

*Expected:* Model asks clarifying questions via the question card (radio/checkbox options).

| Test ID | Action | Expected |
|---------|--------|----------|
| 2.1 | Send plan request | Plan approval card with v1 chip, title, objective, markdown body, 3 buttons |
| 2.3 | Click "Approve" | Green chip; message "Plan approved. Please begin executing..." → streaming |
| 2.4 | Reject with feedback | Textarea appears; submit disabled until text entered → badge → Rejected |
| 2.5 | Request changes | Returns to Draft; new version generated |
| 2.6 | Repeat 2.5 | Version chip increments v1 → v2 → v3 |
| 2.7 | Observe header badge | Cycles through all states with correct icons/colors |
| 2.8 | Send ambiguous request | Question card with options renders below messages |
| 2.9 | Try toggling mode mid-stream | Dropdown disabled |

---

## 3. Auto Enter Plan Mode Tests (stay in "Chat" mode)

**3.1 Trigger auto-plan (complex multi-step):**

```
I need to build a complete lead enrichment pipeline. Here are 5 target companies:
Stripe, Notion, Linear, Vercel, and Framer. For each one, research their key decision
makers in marketing/sales, find verified emails, cross-reference with LinkedIn, score
each lead A/B/C, then draft a personalized cold email per lead. Give me a structured
plan before executing anything.
```

*Expected:* Mode auto-switches to Plan; Draft badge appears; rationale may show.

**3.1b Alternative auto-plan trigger (ambiguous + high-stakes):**

```
I want to refactor my entire email outreach system to use AI personalization at scale.
Design a migration plan that doesn't break my existing campaigns.
```

**3.2 Auto-plan disabled test:** Set `USER_AI_AUTO_PLAN = "false"` in settings, then resend 3.1.

*Expected:* No auto-switch to Plan mode.

**3.3 Already-in-plan block:** Switch to Plan manually, then send:

```
Actually, before we plan, enter plan mode for this.
```

*Expected:* Model gets error "Already in Plan Mode"; no duplicate plan.

| Test ID | Action | Expected |
|---------|--------|----------|
| 3.1 | Send complex request in Chat mode | Auto-switches to Plan; Draft badge |
| 3.2 | Disable USER_AI_AUTO_PLAN, resend | Stays in Chat mode |
| 3.3 | Manually in Plan, trigger EnterPlanMode | Error returned to model |
| 3.4 | Auto-enter then close conversation before submit | Orphan draft auto-cancelled |
| 3.6 | Auto-enter → approve → execution | Full lifecycle Draft → Approval → Approved → Completed |

---

## 4. Subagent Tests

**4.1 Successful invocation (single specialist):**

```
Use the lead researcher agent to research Acme Corp (acme.io). I need: CEO name,
CTO name, their LinkedIn profiles, and any public email addresses. Return a single
lead record with a confidence score.
```

**4.7 Multiple subagents in one turn:**

```
Run lead research on these 3 companies in parallel using the lead researcher agent:
- Stripe (stripe.com)
- Notion (notion.so)
- Linear (linear.app)

For each, return: company name, 2 key decision makers with titles, LinkedIn URLs,
and confidence score. Present as a table.
```

**4.2 Failure trigger (bad input):**

```
Use the lead researcher agent on this company: [leave blank / type "???"].
I expect a clean failure with an error message.
```

**4.8 Long-running subagent:**

```
Use the lead researcher agent to do deep research on "OpenAI" — find 5 decision
makers, verify each email, cross-reference 3 sources per person, and rate confidence.
Take your time; I want thoroughness over speed.
```

**4.9 Subagent inside plan execution:** Approve a plan from §3.1, then during execution send:

```
Before drafting emails, run the lead researcher agent again on Vercel to double-check
the CTO's current title — I heard they may have changed roles.
```

| Test ID | Action | Expected |
|---------|--------|----------|
| 4.1 | Single agent invocation | Tool call message (toolbox icon) + tool result with status completed |
| 4.2 | Blank/invalid input | Tool result shows alert-circle, status failed |
| 4.3 | Click chevrons on Arguments/Details | JSON collapses/expands correctly |
| 4.7 | 3 companies in one turn | Multiple sequential tool call/result pairs |
| 4.8 | Slow agent | Typing indicator between call/result; no UI freeze |
| 4.9 | Subagent during plan execution | Tool messages interleave with execution stream |

---

## 5. Context Badge Tests

**5.1 / 5.2 Push context high:**

```
Generate a 3000-word essay about the history of email marketing, from 1990 to today,
including major platforms, regulations (CAN-SPAM, GDPR), and trends. Be detailed.
```

*Watch the CTX badge climb during streaming.*

**5.1 Critical (≥95%) trigger:** Send the above 3–4 times in a row without compacting, then:

```
Summarize everything above in one paragraph.
```

*Expected:* Badge turns red near 95%+.*

| Test ID | Action | Expected |
|---------|--------|----------|
| 5.1 | Observe color tones | <50% gray · 50–79% blue · 80–94% amber · ≥95% red |
| 5.2 | Watch during streaming | Percentage climbs live |
| 5.3 | Hover badge | Tooltip "{used} / {total} tokens ({percent}%)" |
| 5.4 | Use unknown model | Falls back to DEFAULT_CONTEXT_WINDOW |

---

## 6. Cross-Feature Integration

**6.1 Compact during plan:** Enter Plan mode, submit plan from §2.1, while Awaiting Approval click compact.

*Expected:* Either button disabled or plan state preserved post-compact.

**6.3 Auto-plan → subagent full loop:**

```
Build a lead enrichment pipeline for Framer. Auto-plan it first, then once I approve,
use the lead researcher agent to actually execute the research for 2 key people.
```

**6.4 Compact then auto-plan:** Run §1 setup → compact → send:

```
Based on what we discussed, auto-plan a rollout strategy for the email campaign
in 3 phases.
```

*Expected:* Plan grounded in compacted summary (references your real audience/goals).*

| Test ID | Scenario | Expected |
|---------|----------|----------|
| 6.1 | Compact during plan | Button blocked OR plan state preserved |
| 6.2 | Plan → subagents | Tool messages interleave correctly |
| 6.3 | Auto-plan → subagent | Full lifecycle works end-to-end |
| 6.4 | Compact then auto-plan | Plan references compacted context |
| 6.5 | Disconnect mid-subagent | Retry indicator "Reconnecting… (attempt X/Y)" |
| 6.6 | Server error mid-stream | Stream status shows error; can retry |

---

## Quick-Reference: Which Message Tests What

| Message | Tests |
|---------|-------|
| §1 setup + compact click | Compact memory lifecycle |
| §2.1 | Manual plan submission, approval card |
| §2.4 reject text | Reject with feedback flow |
| §2.5 changes text | Request changes + versioning |
| §2.8 "Help me grow..." | Question card (clarification) |
| §3.1 lead pipeline | Auto enter plan mode |
| §4.1 single agent | Subagent success |
| §4.7 three companies | Multiple subagents |
| §4.2 blank input | Subagent failure |
| §5.1 long essay | Context badge color tones |
| §6.3 combined | Auto-plan + subagent integration |
