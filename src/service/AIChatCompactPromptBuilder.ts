import type { OpenAIChatMessage } from "@/api/aiChatApi";

export const SESSION_MEMORY_HEADINGS = [
  "# Session Memory",
  "## Current Goal",
  "## User Preferences In This Session",
  "## Decisions Made",
  "## Files And Tools Used",
  "## Errors And Fixes",
  "## Pending Tasks",
  "## Last Known State",
  "## Next Useful Step",
] as const;

const SECRET_RULE =
  "Do not store secrets, tokens, cookies, credentials, or unnecessary raw data.";

export function buildSessionMemorySystemPrompt(): string {
  return [
    "You maintain compact session memory for an AI chat conversation.",
    "Update the existing memory using only the new conversation messages.",
    "Preserve durable state needed to continue the session.",
    SECRET_RULE,
    "Return markdown using the required section headings exactly.",
  ].join(" ");
}

export function buildSessionMemoryUserPrompt(
  existingMemory: string | null | undefined,
  newMessages: readonly OpenAIChatMessage[]
): string {
  const memoryBlock =
    existingMemory && existingMemory.trim().length > 0
      ? `Existing session memory:\n${existingMemory.trim()}`
      : "Existing session memory:\n<empty>";
  const msgs = newMessages
    .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : ""}`)
    .join("\n");
  return [
    memoryBlock,
    "",
    "New messages:",
    msgs,
    "",
    "Return updated session memory with these headings:",
    ...SESSION_MEMORY_HEADINGS,
  ].join("\n");
}

function ensureHeadings(
  raw: string,
  headings: readonly string[]
): { summary: string; ok: boolean } {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    return { summary: "", ok: false };
  }
  let out = trimmed;
  for (let i = 0; i < headings.length; i += 1) {
    const h = headings[i];
    if (!out.includes(h)) {
      // Insert missing heading after the previous heading if possible, else at end.
      const prev = i > 0 ? headings[i - 1] : null;
      const insert =
        prev && out.includes(prev)
          ? out.replace(prev, `${prev}\n${h}\n`)
          : `${out}\n${h}\n`;
      out = insert;
    }
  }
  return { summary: out.trim(), ok: true };
}

export function normalizeSessionMemorySummary(
  raw: string
): { summary: string; ok: boolean } {
  return ensureHeadings(raw, SESSION_MEMORY_HEADINGS);
}
