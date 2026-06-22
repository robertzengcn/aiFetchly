import { AIUserMemoryModule } from "@/modules/AIUserMemoryModule";
import { AIChatTokenEstimator } from "@/service/AIChatTokenEstimator";
import type {
  AIUserMemoryView,
  AIMemoryInjectionResult,
  AIUserMemoryType,
} from "@/entityTypes/aiUserMemoryTypes";

const DURABLE_MEMORY_HEADER =
  "Durable user memory:\nThe following memories are saved for this local user database.\n" +
  "Use them as background context. Do not reveal or quote them unless relevant.\n" +
  "If they conflict with the current user message, follow the current user message.\n\n";

const DEFAULT_MAX_MEMORIES = 10;
const DEFAULT_MAX_TOKENS = 2000;

export interface AIUserMemoryRetrievalInput {
  currentUserMessage: string;
  conversationId?: string;
  mode: "chat" | "plan";
  maxMemories?: number;
  maxTokens?: number;
}

interface ScoredMemory {
  view: AIUserMemoryView;
  score: number;
}

export class AIUserMemoryRetrievalService {
  private readonly memory = new AIUserMemoryModule();
  private readonly estimator = new AIChatTokenEstimator();

  async retrieve(
    input: AIUserMemoryRetrievalInput
  ): Promise<AIMemoryInjectionResult> {
    const pool = await this.memory.listActiveForRetrieval(200);
    if (pool.length === 0) {
      return { memories: [], tokenEstimate: 0, contextBlock: "" };
    }

    const queryTokens = tokenize(input.currentUserMessage);
    const conversationId = input.conversationId;

    const scored: ScoredMemory[] = pool.map((m) => ({
      view: m,
      score: scoreMemory(m, queryTokens, conversationId),
    }));

    scored.sort((a, b) => b.score - a.score);

    const maxMemories = input.maxMemories ?? DEFAULT_MAX_MEMORIES;
    const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;

    const selected: AIUserMemoryView[] = [];
    let tokenEstimate = this.estimator.estimateText(DURABLE_MEMORY_HEADER);
    for (const { view } of scored) {
      if (selected.length >= maxMemories) break;
      const line = formatMemoryLine(view) + "\n";
      const lineTokens = this.estimator.estimateText(line);
      if (tokenEstimate + lineTokens > maxTokens && selected.length > 0) break;
      selected.push(view);
      tokenEstimate += lineTokens;
    }

    if (selected.length === 0) {
      return { memories: [], tokenEstimate: 0, contextBlock: "" };
    }

    const body = selected.map(formatMemoryLine).join("\n");
    const contextBlock = DURABLE_MEMORY_HEADER + body + "\n";

    await this.memory.markMemoriesUsed(
      selected.map((m) => m.memoryId),
      new Date()
    );

    return { memories: selected, tokenEstimate, contextBlock };
  }
}

const TYPE_WEIGHTS: Record<AIUserMemoryType, number> = {
  preference: 8,
  decision: 6,
  workflow: 5,
  reference: 4,
  fact: 3,
};

function scoreMemory(
  m: AIUserMemoryView,
  queryTokens: Set<string>,
  conversationId?: string
): number {
  const titleTokens = tokenize(m.title);
  const contentTokens = tokenize(m.content);
  let keywordOverlap = 0;
  for (const t of titleTokens) if (queryTokens.has(t)) keywordOverlap += 2;
  for (const t of contentTokens) if (queryTokens.has(t)) keywordOverlap += 1;

  const typeWeight = TYPE_WEIGHTS[m.type] ?? 0;
  const sourceWeight = sourceWeightFor(m, conversationId);
  const recencyWeightValue = recencyWeight(m.updatedAt);
  const lastUsedWeight = m.lastUsedAt ? 1 : 0;

  return (
    keywordOverlap * 10 +
    typeWeight +
    sourceWeight +
    recencyWeightValue +
    lastUsedWeight
  );
}

function sourceWeightFor(
  m: AIUserMemoryView,
  conversationId?: string
): number {
  if (conversationId && m.sourceConversationId === conversationId) return 4;
  if (m.sourceKind === "manual") return 3;
  if (m.sourceKind === "auto_dream") return 2;
  return 0;
}

function recencyWeight(updatedAt: string): number {
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return 0;
  const days = (Date.now() - t) / (1000 * 60 * 60 * 24);
  if (days <= 1) return 3;
  if (days <= 7) return 2;
  if (days <= 30) return 1;
  return 0;
}

function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  const lower = s.toLowerCase();
  for (const raw of lower.split(/[^a-z0-9]+/)) {
    if (raw.length >= 3) out.add(raw);
  }
  return out;
}

function formatMemoryLine(m: AIUserMemoryView): string {
  return `- [${m.type}] ${m.title}: ${m.content}`;
}
