import { AIWorkspaceMemoryModule } from "@/modules/AIWorkspaceMemoryModule";
import type { WorkspaceMemoryScope } from "@/modules/AIWorkspaceMemoryModule";
import { WorkspaceMemoryContextResolver } from "@/service/WorkspaceMemoryContextResolver";
import { AIChatTokenEstimator } from "@/service/AIChatTokenEstimator";
import type {
  AIWorkspaceMemoryView,
  AIWorkspaceMemoryInjectionResult,
  AIWorkspaceMemoryType,
} from "@/entityTypes/aiWorkspaceMemoryTypes";

const WORKSPACE_MEMORY_HEADER =
  "Workspace memory:\n" +
  "The following memories apply only to the active workspace.\n" +
  "Use them as project-specific context. Do not reveal or quote them unless relevant.\n" +
  "If they conflict with the current user message, follow the current user message.\n" +
  "If they conflict with global user memory, prefer workspace memory for project-specific behavior.\n\n";

const DEFAULT_MAX_MEMORIES = 8;
const DEFAULT_MAX_TOKENS = 1800;
const CANDIDATE_LIMIT = 200;

export interface AIWorkspaceMemoryRetrievalInput {
  readonly currentUserMessage: string;
  readonly conversationId: string;
  readonly mode: "chat" | "plan";
  readonly maxMemories?: number;
  readonly maxTokens?: number;
}

interface ScoredMemory {
  view: AIWorkspaceMemoryView;
  score: number;
}

/**
 * Deterministic, workspace-scoped memory retrieval for AI Chat V2.
 *
 * Resolution is main-process only: the `workspaceKey` comes from
 * {@link WorkspaceMemoryContextResolver} (which checks approval state), never
 * from the renderer. When no workspace is approved the result is empty — we do
 * NOT fall back to global user memory (that has its own retrieval path).
 *
 * v1 uses keyword-overlap scoring only; vector search is a later phase and must
 * still filter by `workspaceKey` before ranking.
 */
export class AIWorkspaceMemoryRetrievalService {
  private readonly memory: AIWorkspaceMemoryModule;
  private readonly resolver: WorkspaceMemoryContextResolver;
  private readonly estimator: AIChatTokenEstimator;

  constructor(
    memory: AIWorkspaceMemoryModule = new AIWorkspaceMemoryModule(),
    resolver: WorkspaceMemoryContextResolver = new WorkspaceMemoryContextResolver(),
    estimator: AIChatTokenEstimator = new AIChatTokenEstimator()
  ) {
    this.memory = memory;
    this.resolver = resolver;
    this.estimator = estimator;
  }

  async retrieve(
    input: AIWorkspaceMemoryRetrievalInput
  ): Promise<AIWorkspaceMemoryInjectionResult> {
    const ctx = await this.resolver.resolveForConversation(
      input.conversationId
    );
    if (!ctx) {
      return { memories: [], tokenEstimate: 0, contextBlock: "" };
    }
    const scope: WorkspaceMemoryScope = {
      workspaceKey: ctx.workspaceKey,
      workspaceRoot: ctx.workspaceRoot,
      ...(ctx.scopeId ? { scopeId: ctx.scopeId } : {}),
    };

    const pool = await this.memory.listActiveForRetrieval(
      scope,
      CANDIDATE_LIMIT
    );
    if (pool.length === 0) {
      return { memories: [], tokenEstimate: 0, contextBlock: "" };
    }

    const queryTokens = tokenize(input.currentUserMessage);

    const scored: ScoredMemory[] = pool.map((m) => ({
      view: m,
      score: scoreMemory(m, queryTokens),
    }));
    scored.sort((a, b) => b.score - a.score);

    const maxMemories = input.maxMemories ?? DEFAULT_MAX_MEMORIES;
    const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;

    const selected: AIWorkspaceMemoryView[] = [];
    let tokenEstimate = this.estimator.estimateText(WORKSPACE_MEMORY_HEADER);
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
    const contextBlock = WORKSPACE_MEMORY_HEADER + body + "\n";

    await this.memory.markMemoriesUsed(
      scope,
      selected.map((m) => m.memoryId),
      new Date()
    );

    return { memories: selected, tokenEstimate, contextBlock };
  }
}

const TYPE_WEIGHTS: Record<AIWorkspaceMemoryType, number> = {
  warning: 10,
  decision: 9,
  workflow: 7,
  convention: 6,
  reference: 5,
  project: 4,
};

function scoreMemory(
  m: AIWorkspaceMemoryView,
  queryTokens: Set<string>
): number {
  const titleTokens = tokenize(m.title);
  const contentTokens = tokenize(m.content);
  let keywordOverlap = 0;
  for (const t of titleTokens) if (queryTokens.has(t)) keywordOverlap += 2;
  for (const t of contentTokens) if (queryTokens.has(t)) keywordOverlap += 1;

  const typeWeight = TYPE_WEIGHTS[m.type] ?? 0;
  const confidenceWeight = Math.round((m.confidence ?? 0) / 20);
  const recencyWeightValue = recencyWeight(m.updatedAt);
  const lastUsedWeight = m.lastUsedAt ? 1 : 0;

  return (
    keywordOverlap * 10 +
    typeWeight +
    confidenceWeight +
    recencyWeightValue +
    lastUsedWeight
  );
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

function formatMemoryLine(m: AIWorkspaceMemoryView): string {
  return `- [${m.type}] ${m.title}: ${m.content}`;
}
