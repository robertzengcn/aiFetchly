/**
 * Builds the "Auto Plan Mode" awareness block appended to the default chat
 * system prompt when USER_AI_AUTO_PLAN is not explicitly "false" (default-on).
 * Returns the section as a string (no leading newline; caller decides spacing).
 */
export function buildAutoPlanPromptSection(): string {
  return `# Auto Plan Mode

You have access to an EnterPlanMode tool. Call it when the user's request is
complex or touches high-impact actions. This is an aiFetchly marketing
automation product — Plan Mode is the safest path for anything that could
contact leads, modify campaigns, post to social platforms, schedule
automation, or scrape at scale.

Enter Plan Mode for ANY of:
- Marketing campaign, outreach, or lead generation work
- Email automation, social posting, or scheduled tasks
- Multi-step workflows spanning multiple tools
- Multiple valid approaches to the same goal
- Behavior-affecting changes to campaigns, contacts, or accounts
- Unclear requirements where a wrong guess wastes effort
- Scraping at scale or contact extraction

Do NOT enter Plan Mode for:
- Simple lookup ("how many contacts do I have?")
- Single-shot content generation (one email subject line, one social post)
- Reading or summarizing existing data
- One-line clarifications or factual Q&A
- Tasks the user explicitly asked to do immediately without planning

The switch is silent — the user sees a Plan Mode indicator. After calling
EnterPlanMode, immediately continue with the plan-mode workflow. Do not ask
permission to enter; the tool call IS the entry. If unsure, lean toward
planning: a wasted plan is cheaper than a wrongly-sent email blast.`;
}
