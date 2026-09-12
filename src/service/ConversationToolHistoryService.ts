/**
 * Builds compact receipts of prior tool_call/tool_result rows so a later
 * chat turn can continue without replaying every payload.
 *
 * Three consumers:
 *  - context assembler: system index + last-N native tool replay
 *  - conversation_tool_history skill: on-demand lookup
 */
import { AIChatModule } from "@/modules/AIChatModule";
import { MessageType } from "@/entityTypes/commonType";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import type { ChatV2MessageMetadata } from "@/entityTypes/aiChatV2Types";
import type { OpenAIChatMessage, OpenAIMessageRole } from "@/api/aiChatApi";
import { conversationToolHistoryInputSchema } from "@/schemas/conversationToolHistory";
import {
  CONVERSATION_TOOL_HISTORY_TOOL_NAME,
  TOOL_HISTORY_INDEX_LIMIT,
  TOOL_HISTORY_INDEX_LINE_CHARS,
  TOOL_HISTORY_LOOKUP_CONTENT_CHARS,
  TOOL_HISTORY_REPLAY_PAIR_LIMIT,
  TOOL_HISTORY_REPLAY_RESULT_CHARS,
  type ConversationToolHistoryLookupResult,
  type ConversationToolHistoryRecord,
  type ConversationToolPair,
  type ConversationToolPairStatus,
} from "@/entityTypes/conversationToolHistoryTypes";

const SECRET_KEY_RE =
  /token|password|secret|cookie|authorization|api[_-]?key|passwd/i;

const INDEX_PREAMBLE = [
  "# Prior tool activity this conversation",
  "Compact receipts of tools already run. Full payloads are not inlined.",
  "Before repeating a side-effecting tool (email send, file write, scrape),",
  `call ${CONVERSATION_TOOL_HISTORY_TOOL_NAME} with tool_call_id or query`,
  "to confirm what already completed.",
  "",
].join("\n");

const SUMMARY_RESULT_KEYS = [
  "task_id",
  "status",
  "path",
  "total",
  "recipient_count",
  "error",
  "truncated",
] as const;

const SUMMARY_ARG_KEYS = [
  "emails",
  "path",
  "query",
  "pattern",
  "email_subject",
] as const;

export function parseToolRowMetadata(
  raw: string | undefined | null
): ChatV2MessageMetadata | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as ChatV2MessageMetadata;
    }
  } catch {
    return null;
  }
  return null;
}

function isBefore(
  aTs: number,
  aId: number,
  bTs: number,
  bId: number
): boolean {
  if (aTs !== bTs) return aTs < bTs;
  return aId < bId;
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

function compactUnknown(value: unknown, maxChars: number): string {
  if (typeof value === "string") {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}…[truncated ${value.length} chars]`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const first = compactUnknown(value[0], Math.min(80, maxChars));
    const extra = value.length > 1 ? ` +${value.length - 1}` : "";
    return `[${first}${extra}]`;
  }
  return "";
}

function compactArgs(
  args: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (isSecretKey(key)) continue;
    if (typeof value === "string" && value.length > 200) {
      out[key] = `${value.slice(0, 80)}…[truncated ${value.length} chars]`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function buildSummary(
  toolName: string,
  status: ConversationToolPairStatus,
  args: Record<string, unknown>,
  result: Record<string, unknown> | null
): string {
  const bits: string[] = [toolName, status];
  for (const key of SUMMARY_ARG_KEYS) {
    if (!(key in args)) continue;
    const text = compactUnknown(args[key], 80);
    if (text) bits.push(`${key}=${text}`);
  }
  if (result) {
    for (const key of SUMMARY_RESULT_KEYS) {
      if (!(key in result)) continue;
      const text = compactUnknown(result[key], 80);
      if (text) bits.push(`${key}=${text}`);
    }
  }
  const line = bits.join(" ");
  if (line.length <= TOOL_HISTORY_INDEX_LINE_CHARS) return line;
  return `${line.slice(0, TOOL_HISTORY_INDEX_LINE_CHARS)}…`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function resultStatus(
  meta: ChatV2MessageMetadata | null
): ConversationToolPairStatus {
  if (!meta) return "success";
  if (meta.toolResultStatus === "error" || meta.success === false) {
    return "error";
  }
  return "success";
}

/**
 * Pair tool_call rows with matching tool_result rows, in chronological order.
 * Orphan results (no call row) and pending calls (no result) are kept.
 */
export function collectConversationToolPairs(
  rows: readonly AIChatMessageEntity[]
): ConversationToolPair[] {
  const sorted = [...rows].sort((a, b) => {
    const t = a.timestamp.getTime() - b.timestamp.getTime();
    return t !== 0 ? t : a.id - b.id;
  });

  const calls = new Map<string, AIChatMessageEntity>();
  const results = new Map<string, AIChatMessageEntity>();
  const order: string[] = [];
  const seen = new Set<string>();

  const remember = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
  };

  for (const row of sorted) {
    const meta = parseToolRowMetadata(row.metadata);
    const toolCallId = meta?.toolCallId;
    if (!toolCallId) continue;
    if (row.messageType === MessageType.TOOL_CALL) {
      if (meta?.toolName === CONVERSATION_TOOL_HISTORY_TOOL_NAME) continue;
      calls.set(toolCallId, row);
      remember(toolCallId);
    } else if (row.messageType === MessageType.TOOL_RESULT) {
      if (meta?.toolName === CONVERSATION_TOOL_HISTORY_TOOL_NAME) continue;
      results.set(toolCallId, row);
      remember(toolCallId);
    }
  }

  const pairs: ConversationToolPair[] = [];
  for (const toolCallId of order) {
    const callRow = calls.get(toolCallId);
    const resultRow = results.get(toolCallId);
    const callMeta = parseToolRowMetadata(callRow?.metadata);
    const resultMeta = parseToolRowMetadata(resultRow?.metadata);
    const toolName =
      callMeta?.toolName ?? resultMeta?.toolName ?? "unknown_tool";
    const args = asRecord(callMeta?.toolArguments);
    const resultObj = resultMeta ? asRecord(resultMeta.toolResult) : null;
    const status: ConversationToolPairStatus = resultRow
      ? resultStatus(resultMeta)
      : "pending";
    const resultContent = resultRow?.content ?? "";
    const anchor = callRow ?? resultRow;
    if (!anchor) continue;
    pairs.push({
      toolCallId,
      toolName,
      arguments: args,
      status,
      summary: buildSummary(toolName, status, args, resultObj),
      resultContent,
      callId: anchor.id,
      callTimestampMs: anchor.timestamp.getTime(),
    });
  }
  return pairs;
}

export function filterPairsAfterBoundary(
  pairs: readonly ConversationToolPair[],
  throughTimestampMs: number | null
): ConversationToolPair[] {
  if (throughTimestampMs === null) return [...pairs];
  return pairs.filter((p) => p.callTimestampMs > throughTimestampMs);
}

export function buildToolHistoryIndexBlock(
  pairs: readonly ConversationToolPair[],
  limit: number = TOOL_HISTORY_INDEX_LIMIT
): string | null {
  if (pairs.length === 0) return null;
  const recent = pairs.slice(-limit);
  const truncated = pairs.length > recent.length;
  const lines = recent.map((p) => `- ${p.summary} [${p.toolCallId}]`);
  const extra = truncated
    ? `\n… ${pairs.length - recent.length} earlier receipts omitted. ` +
      `Call ${CONVERSATION_TOOL_HISTORY_TOOL_NAME} to page them.`
    : "";
  return `${INDEX_PREAMBLE}${lines.join("\n")}${extra}`;
}

function truncateContent(content: string, maxChars: number): {
  content: string;
  truncated: boolean;
} {
  if (content.length <= maxChars) {
    return { content, truncated: false };
  }
  return {
    content: `${content.slice(0, maxChars)}…[truncated ${content.length} chars]`,
    truncated: true,
  };
}

function pairToRecord(
  pair: ConversationToolPair,
  includeContent: boolean,
  contentLimit: number
): ConversationToolHistoryRecord {
  const record: ConversationToolHistoryRecord = {
    tool_call_id: pair.toolCallId,
    tool_name: pair.toolName,
    status: pair.status,
    summary: pair.summary,
    arguments: compactArgs(pair.arguments),
  };
  if (includeContent) {
    const clipped = truncateContent(pair.resultContent, contentLimit);
    return {
      ...record,
      content: clipped.content,
      content_truncated: clipped.truncated,
    };
  }
  return record;
}

function matchesQuery(pair: ConversationToolPair, query: string): boolean {
  const q = query.toLowerCase();
  if (pair.toolName.toLowerCase().includes(q)) return true;
  if (pair.toolCallId.toLowerCase().includes(q)) return true;
  if (pair.summary.toLowerCase().includes(q)) return true;
  return false;
}

export function lookupConversationToolHistory(
  pairs: readonly ConversationToolPair[],
  input: {
    readonly query?: string;
    readonly tool_call_id?: string;
    readonly limit?: number;
    readonly include_content?: boolean;
  },
  executionTimeMs: number
): ConversationToolHistoryLookupResult {
  if (input.tool_call_id) {
    const hit = pairs.find((p) => p.toolCallId === input.tool_call_id);
    if (!hit) {
      return {
        success: false,
        executionTimeMs,
        total: 0,
        truncated: false,
        records: [],
        error: `No tool result found for tool_call_id ${input.tool_call_id}.`,
      };
    }
    return {
      success: true,
      executionTimeMs,
      total: 1,
      truncated: false,
      records: [
        pairToRecord(hit, true, TOOL_HISTORY_LOOKUP_CONTENT_CHARS),
      ],
    };
  }

  const filtered = input.query
    ? pairs.filter((p) => matchesQuery(p, input.query ?? ""))
    : [...pairs];
  const limit = input.limit ?? TOOL_HISTORY_INDEX_LIMIT;
  const recent = filtered.slice(-limit);
  const includeContent = input.include_content === true;
  return {
    success: true,
    executionTimeMs,
    total: filtered.length,
    truncated: filtered.length > recent.length,
    records: recent.map((p) =>
      pairToRecord(p, includeContent, TOOL_HISTORY_LOOKUP_CONTENT_CHARS)
    ),
  };
}

export function pairToOpenAIMessages(
  pair: ConversationToolPair,
  resultCharLimit: number = TOOL_HISTORY_REPLAY_RESULT_CHARS
): OpenAIChatMessage[] {
  const messages: OpenAIChatMessage[] = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: pair.toolCallId,
          type: "function",
          function: {
            name: pair.toolName,
            arguments: JSON.stringify(compactArgs(pair.arguments)),
          },
        },
      ],
    },
  ];
  if (pair.status !== "pending") {
    const clipped = truncateContent(pair.resultContent, resultCharLimit);
    messages.push({
      role: "tool",
      tool_call_id: pair.toolCallId,
      content: clipped.content,
    });
  }
  return messages;
}

export function selectReplayPairs(
  pairs: readonly ConversationToolPair[],
  limit: number = TOOL_HISTORY_REPLAY_PAIR_LIMIT
): ConversationToolPair[] {
  return pairs.slice(-limit);
}

/**
 * Interleave last-N native tool pairs among text history rows so the
 * model sees them in the same chronological place they originally ran.
 */
export function interleaveReplayWithText(input: {
  readonly textRows: readonly AIChatMessageEntity[];
  readonly replayPairs: readonly ConversationToolPair[];
  readonly roleOf: (role: string) => OpenAIMessageRole;
}): OpenAIChatMessage[] {
  const messages: OpenAIChatMessage[] = [];
  let pairIdx = 0;
  for (const text of input.textRows) {
    while (pairIdx < input.replayPairs.length) {
      const pair = input.replayPairs[pairIdx];
      if (!pair) break;
      if (
        !isBefore(
          pair.callTimestampMs,
          pair.callId,
          text.timestamp.getTime(),
          text.id
        )
      ) {
        break;
      }
      messages.push(...pairToOpenAIMessages(pair));
      pairIdx += 1;
    }
    messages.push({
      role: input.roleOf(text.role),
      content: text.content,
    });
  }
  while (pairIdx < input.replayPairs.length) {
    const pair = input.replayPairs[pairIdx];
    if (!pair) break;
    messages.push(...pairToOpenAIMessages(pair));
    pairIdx += 1;
  }
  return messages;
}

export interface ConversationMessageLoader {
  getConversationMessages(
    conversationId: string
  ): Promise<AIChatMessageEntity[]>;
}

export class ConversationToolHistoryService {
  constructor(
    private readonly chat: ConversationMessageLoader = new AIChatModule()
  ) {}

  async lookup(
    conversationId: string,
    rawArgs: unknown
  ): Promise<ConversationToolHistoryLookupResult> {
    const started = Date.now();
    const parsed = conversationToolHistoryInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        success: false,
        executionTimeMs: 0,
        total: 0,
        truncated: false,
        records: [],
        error: "Invalid request.",
      };
    }
    if (!conversationId.trim()) {
      return {
        success: false,
        executionTimeMs: 0,
        total: 0,
        truncated: false,
        records: [],
        error: "Missing conversation id.",
      };
    }
    const rows = await this.chat.getConversationMessages(conversationId);
    const pairs = collectConversationToolPairs(rows);
    return lookupConversationToolHistory(
      pairs,
      parsed.data,
      Date.now() - started
    );
  }
}
