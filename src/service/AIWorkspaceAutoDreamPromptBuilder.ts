import type {
  AIWorkspaceMemoryView,
  AIWorkspaceMemoryType,
} from "@/entityTypes/aiWorkspaceMemoryTypes";
import { isAIWorkspaceMemoryType } from "@/entityTypes/aiWorkspaceMemoryTypes";
import type { WorkspaceAwareAutoDreamSourcePacket } from "@/service/AIAutoDreamSourceCollector";
import { looksSecretlike } from "@/service/MemorySecretFilter";

const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 8000;
const MAX_SOURCE_MESSAGE_IDS = 100;

export interface WorkspaceAutoDreamCreateEntry {
  workspaceKey: string;
  type: AIWorkspaceMemoryType;
  title: string;
  content: string;
  confidence: number;
  sourceKind: "chat_v2" | "agent_task";
  sourceId: string;
  sourceMessageIds?: string[];
  reason: string;
}

export interface WorkspaceAutoDreamUpdateEntry {
  memoryId: string;
  title?: string;
  content?: string;
  confidence?: number;
  reason: string;
}

export interface WorkspaceAutoDreamArchiveEntry {
  memoryId: string;
  reason: string;
}

export interface WorkspaceAutoDreamParseResult {
  ok: boolean;
  create: WorkspaceAutoDreamCreateEntry[];
  update: WorkspaceAutoDreamUpdateEntry[];
  archive: WorkspaceAutoDreamArchiveEntry[];
  error?: string;
}

export function buildWorkspaceAutoDreamSystemPrompt(): string {
  return [
    "You consolidate workspace memories for AiFetchly.",
    "Only save memories useful for future work in the provided workspace.",
    "Allowed types: project, decision, workflow, convention, reference, warning.",
    "Do not store secrets, credentials, tokens, cookies, passwords, private scraped data, raw file contents, or full transcript text.",
    "Do not store facts that can be read directly from source files.",
    "Prefer explicit user statements over inferred facts.",
    "Merge duplicates with existing memories.",
    "Archive memories contradicted by newer explicit user statements.",
    "Every create item MUST include the workspaceKey provided for this run.",
    "Return JSON only. Schema:",
    `{
  "create": [{ "workspaceKey": "...", "type": "...", "title": "...", "content": "...", "confidence": 0-100,
                "sourceKind": "chat_v2" | "agent_task", "sourceId": "...", "sourceMessageIds": ["..."], "reason": "..." }],
  "update": [{ "memoryId": "...", "title": "...?", "content": "...?", "confidence": 0-100?, "reason": "..." }],
  "archive": [{ "memoryId": "...", "reason": "..." }]
}`,
  ].join("\n");
}

export function buildWorkspaceAutoDreamUserPrompt(input: {
  workspaceKey: string;
  workspaceRoot: string;
  activeMemories: AIWorkspaceMemoryView[];
  packets: WorkspaceAwareAutoDreamSourcePacket[];
}): string {
  const memLines = input.activeMemories.length
    ? input.activeMemories
        .map(
          (m) =>
            `- id=${m.memoryId} type=${m.type} title="${m.title}" content="${m.content}"`
        )
        .join("\n")
    : "(none)";

  const packetLines = input.packets
    .map((p) => {
      const msgs = p.messages
        .map((m) => `    [${m.role}] ${m.content}`)
        .join("\n");
      const tools = p.toolCalls?.length
        ? p.toolCalls
            .map(
              (t) =>
                `    tool ${t.toolName} status=${t.status}${
                  t.resultSummary ? ` summary=${t.resultSummary}` : ""
                }`
            )
            .join("\n")
        : "";
      return `Source ${p.sourceKind} id=${p.sourceId} title="${p.title}" updatedAt=${p.updatedAt}\n${msgs}\n${tools}`;
    })
    .join("\n\n");

  return [
    `Workspace key: ${input.workspaceKey}`,
    `Workspace root: ${input.workspaceRoot}`,
    "",
    "Existing active memories:",
    memLines,
    "",
    "Source packets:",
    packetLines,
    "",
    "Return JSON only.",
  ].join("\n");
}

export function parseWorkspaceAutoDreamModelOutput(
  raw: string,
  validWorkspaceKeys: ReadonlySet<string>,
  existing: AIWorkspaceMemoryView[]
): WorkspaceAutoDreamParseResult {
  const cleaned = stripCodeFence(raw).trim();
  if (!cleaned) {
    return { ok: false, create: [], update: [], archive: [], error: "empty" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return {
      ok: false,
      create: [],
      update: [],
      archive: [],
      error: err instanceof Error ? err.message : "invalid_json",
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      create: [],
      update: [],
      archive: [],
      error: "not_object",
    };
  }

  const existingIds = new Set(existing.map((m) => m.memoryId));

  const create = filterCreate(parsed, validWorkspaceKeys);
  const update = filterUpdate(parsed, existingIds);
  const archive = filterArchive(parsed, existingIds);

  return { ok: true, create, update, archive };
}

function filterCreate(
  parsed: object,
  validWorkspaceKeys: ReadonlySet<string>
): WorkspaceAutoDreamCreateEntry[] {
  const raw = readArray(parsed, "create");
  const out: WorkspaceAutoDreamCreateEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const workspaceKey = obj.workspaceKey;
    if (
      typeof workspaceKey !== "string" ||
      !validWorkspaceKeys.has(workspaceKey)
    ) {
      continue;
    }
    const type = obj.type;
    const title = obj.title;
    const content = obj.content;
    const sourceKind = obj.sourceKind;
    const sourceId = obj.sourceId;
    if (!isAIWorkspaceMemoryType(type)) continue;
    if (typeof title !== "string" || !isValidTitle(title)) continue;
    if (typeof content !== "string" || !isValidContent(content)) continue;
    if (looksSecretlike(content) || looksSecretlike(title)) continue;
    if (sourceKind !== "chat_v2" && sourceKind !== "agent_task") continue;
    if (typeof sourceId !== "string") continue;
    const confidence = clampConfidence(obj.confidence);
    const sourceMessageIds = readStringArray(obj.sourceMessageIds);
    const reason =
      typeof obj.reason === "string" ? obj.reason : "auto_dream";
    out.push({
      workspaceKey,
      type,
      title: title.trim().slice(0, MAX_TITLE_LEN),
      content: content.trim().slice(0, MAX_CONTENT_LEN),
      confidence,
      sourceKind,
      sourceId,
      sourceMessageIds: sourceMessageIds.slice(0, MAX_SOURCE_MESSAGE_IDS),
      reason,
    });
  }
  return out;
}

function filterUpdate(
  parsed: object,
  existingIds: Set<string>
): WorkspaceAutoDreamUpdateEntry[] {
  const raw = readArray(parsed, "update");
  const out: WorkspaceAutoDreamUpdateEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const memoryId = obj.memoryId;
    if (typeof memoryId !== "string" || !existingIds.has(memoryId)) continue;
    const title = obj.title;
    const content = obj.content;
    const confidence = obj.confidence;
    const entry: WorkspaceAutoDreamUpdateEntry = {
      memoryId,
      reason: typeof obj.reason === "string" ? obj.reason : "auto_dream",
    };
    if (typeof title === "string" && isValidTitle(title) && !looksSecretlike(title))
      entry.title = title.trim().slice(0, MAX_TITLE_LEN);
    if (
      typeof content === "string" &&
      isValidContent(content) &&
      !looksSecretlike(content)
    )
      entry.content = content.trim().slice(0, MAX_CONTENT_LEN);
    if (confidence !== undefined) entry.confidence = clampConfidence(confidence);
    out.push(entry);
  }
  return out;
}

function filterArchive(
  parsed: object,
  existingIds: Set<string>
): WorkspaceAutoDreamArchiveEntry[] {
  const raw = readArray(parsed, "archive");
  const out: WorkspaceAutoDreamArchiveEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const memoryId = obj.memoryId;
    if (typeof memoryId !== "string" || !existingIds.has(memoryId)) continue;
    out.push({
      memoryId,
      reason: typeof obj.reason === "string" ? obj.reason : "auto_dream",
    });
  }
  return out;
}

function readArray(parsed: object, key: string): unknown[] {
  const v = (parsed as Record<string, unknown>)[key];
  return Array.isArray(v) ? v : [];
}

function readStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function isValidTitle(s: string): boolean {
  const t = s.trim();
  return t.length >= 1 && t.length <= MAX_TITLE_LEN;
}

function isValidContent(s: string): boolean {
  const t = s.trim();
  return t.length >= 1 && t.length <= MAX_CONTENT_LEN;
}

function clampConfidence(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function stripCodeFence(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("```")) {
    const end = s.lastIndexOf("```");
    if (end > 3) {
      const inner = s.slice(3, end);
      const nl = inner.indexOf("\n");
      return nl >= 0 ? inner.slice(nl + 1) : inner;
    }
  }
  return s;
}
