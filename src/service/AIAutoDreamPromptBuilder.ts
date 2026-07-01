import type {
  AIUserMemoryView,
  AIUserMemoryType,
} from "@/entityTypes/aiUserMemoryTypes";
import { isAIUserMemoryType } from "@/entityTypes/aiUserMemoryTypes";
import type { AutoDreamSourcePacket } from "@/service/AIAutoDreamSourceCollector";

const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 8000;
const MAX_SOURCE_MESSAGE_IDS = 100;

export interface AutoDreamCreateEntry {
  type: AIUserMemoryType;
  title: string;
  content: string;
  confidence: number;
  sourceKind: "chat_v2" | "agent_task";
  sourceId: string;
  sourceMessageIds?: string[];
  reason: string;
}

export interface AutoDreamUpdateEntry {
  memoryId: string;
  title?: string;
  content?: string;
  confidence?: number;
  reason: string;
}

export interface AutoDreamArchiveEntry {
  memoryId: string;
  reason: string;
}

export interface ParseResult {
  ok: boolean;
  create: AutoDreamCreateEntry[];
  update: AutoDreamUpdateEntry[];
  archive: AutoDreamArchiveEntry[];
  error?: string;
}

export function buildAutoDreamSystemPrompt(): string {
  return [
    "You consolidate durable user memories for AiFetchly.",
    "Only save facts useful in future sessions.",
    "Allowed types: preference, fact, decision, reference, workflow.",
    "Do not store secrets, credentials, tokens, cookies, passwords, private scraped data, or full transcript text.",
    "Prefer explicit user statements over inferred facts.",
    "Merge duplicates with existing memories.",
    "Archive memories contradicted by newer explicit user statements.",
    "Return JSON only. Schema:",
    `{
  "create": [{ "type": "...", "title": "...", "content": "...", "confidence": 0-100,
                "sourceKind": "chat_v2" | "agent_task", "sourceId": "...", "sourceMessageIds": ["..."], "reason": "..." }],
  "update": [{ "memoryId": "...", "title": "...?", "content": "...?", "confidence": 0-100?, "reason": "..." }],
  "archive": [{ "memoryId": "...", "reason": "..." }]
}`,
  ].join("\n");
}

export function buildAutoDreamUserPrompt(input: {
  activeMemories: AIUserMemoryView[];
  packets: AutoDreamSourcePacket[];
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
    "Existing active memories:",
    memLines,
    "",
    "Source packets:",
    packetLines,
    "",
    "Return JSON only.",
  ].join("\n");
}

export function parseAutoDreamModelOutput(
  raw: string,
  packets: AutoDreamSourcePacket[],
  existing: AIUserMemoryView[]
): ParseResult {
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

  const validSourceIds = new Set(packets.map((p) => p.sourceId));
  const existingIds = new Set(existing.map((m) => m.memoryId));

  const create = filterCreate(parsed, validSourceIds);
  const update = filterUpdate(parsed, existingIds);
  const archive = filterArchive(parsed, existingIds);

  return { ok: true, create, update, archive };
}

function filterCreate(
  parsed: object,
  validSourceIds: Set<string>
): AutoDreamCreateEntry[] {
  const raw = readArray(parsed, "create");
  const out: AutoDreamCreateEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const type = obj.type;
    const title = obj.title;
    const content = obj.content;
    const sourceKind = obj.sourceKind;
    const sourceId = obj.sourceId;
    if (!isAIUserMemoryType(type)) continue;
    if (typeof title !== "string" || !isValidTitle(title)) continue;
    if (typeof content !== "string" || !isValidContent(content)) continue;
    if (isSecretLike(content) || isSecretLike(title)) continue;
    if (sourceKind !== "chat_v2" && sourceKind !== "agent_task") continue;
    if (typeof sourceId !== "string" || !validSourceIds.has(sourceId)) continue;
    const confidence = clampConfidence(obj.confidence);
    const sourceMessageIds = readStringArray(obj.sourceMessageIds);
    const reason =
      typeof obj.reason === "string" ? obj.reason : "auto_dream";
    out.push({
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
): AutoDreamUpdateEntry[] {
  const raw = readArray(parsed, "update");
  const out: AutoDreamUpdateEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const memoryId = obj.memoryId;
    if (typeof memoryId !== "string" || !existingIds.has(memoryId)) continue;
    const title = obj.title;
    const content = obj.content;
    const confidence = obj.confidence;
    const entry: AutoDreamUpdateEntry = {
      memoryId,
      reason: typeof obj.reason === "string" ? obj.reason : "auto_dream",
    };
    if (typeof title === "string" && isValidTitle(title))
      entry.title = title.trim().slice(0, MAX_TITLE_LEN);
    if (
      typeof content === "string" &&
      isValidContent(content) &&
      !isSecretLike(content)
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
): AutoDreamArchiveEntry[] {
  const raw = readArray(parsed, "archive");
  const out: AutoDreamArchiveEntry[] = [];
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

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{10,}/,
  /api[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /password/i,
  /cookie/i,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  /[A-Za-z0-9+/]{40,}={0,2}/,
];

function isSecretLike(s: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(s));
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
