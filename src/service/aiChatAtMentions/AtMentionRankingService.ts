import type { ChatV2AtMentionKind } from "@/entityTypes/aiChatAtMentionTypes";

/** A candidate path awaiting ranking. */
export interface AtMentionRankCandidate {
  readonly relativePath: string;
  readonly kind: ChatV2AtMentionKind;
}

/**
 * Deterministic ranking of mention candidates (technical design §8.5).
 *
 * Sort order (highest score first, then tie-breakers):
 *  1. exact relative path > basename prefix > path-segment prefix > substring
 *  2. directory before file when the query ends with `/`
 *  3. shorter relative path first
 *  4. lexical path
 *
 * Pure and synchronous; heavily unit tested.
 */
export class AtMentionRankingService {
  rank<T extends AtMentionRankCandidate>(
    query: string,
    candidates: readonly T[],
    limit: number
  ): T[] {
    const q = query.trim().toLowerCase();
    const directoryFirst = q.endsWith("/");

    const scored = candidates.map((candidate) => ({
      candidate,
      score: this.score(q, candidate),
    }));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (directoryFirst && a.candidate.kind !== b.candidate.kind) {
        return a.candidate.kind === "directory" ? -1 : 1;
      }
      const al = a.candidate.relativePath.length;
      const bl = b.candidate.relativePath.length;
      if (al !== bl) return al - bl;
      return a.candidate.relativePath.localeCompare(b.candidate.relativePath);
    });

    return scored.slice(0, Math.max(0, limit)).map((s) => s.candidate);
  }

  private score(q: string, candidate: AtMentionRankCandidate): number {
    if (!q) return 0;
    const rel = candidate.relativePath.toLowerCase();
    const base = basename(rel);

    let score = 0;
    if (rel === q) {
      score += 10_000;
    } else if (rel.startsWith(q)) {
      score += 1_000;
    }
    if (base === q) {
      score += 5_000;
    } else if (base.startsWith(q)) {
      score += 500;
    }
    if (rel.split("/").some((segment) => segment.startsWith(q))) {
      score += 200;
    }
    if (rel.includes(q)) {
      score += 50;
    }
    return score;
  }
}

function basename(rel: string): string {
  const trimmed = rel.endsWith("/") ? rel.slice(0, -1) : rel;
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}
