import { describe, expect, it } from "vitest";
import { AtMentionRankingService } from "@/service/aiChatAtMentions/AtMentionRankingService";
import type { AtMentionRankCandidate } from "@/service/aiChatAtMentions/AtMentionRankingService";

const ranking = new AtMentionRankingService();

function rankPaths(
  query: string,
  candidates: AtMentionRankCandidate[],
  limit = 50
): string[] {
  return ranking.rank(query, candidates, limit).map((c) => c.relativePath);
}

describe("AtMentionRankingService.rank", () => {
  it("ranks the closest basename match first", () => {
    const candidates = [
      { relativePath: "src/services/auth.ts", kind: "file" as const },
      { relativePath: "auth.ts", kind: "file" as const },
      { relativePath: "docs/auth-notes.md", kind: "file" as const },
    ];
    const result = rankPaths("auth", candidates);
    // The exact short file "auth.ts" is the strongest match.
    expect(result[0]).toBe("auth.ts");
    // Everything is returned.
    expect(result).toHaveLength(3);
  });

  it("ranks relative-path prefix above deeper substring matches", () => {
    const candidates = [
      { relativePath: "docs/misc.md", kind: "file" as const },
      { relativePath: "src/main.ts", kind: "file" as const },
      { relativePath: "src/util.ts", kind: "file" as const },
    ];
    const result = rankPaths("src", candidates);
    expect(result[0]).toBe("src/main.ts");
    // both src/* files rank above docs/misc.md
    expect(result).toContain("src/util.ts");
    expect(result.indexOf("src/main.ts") < result.indexOf("docs/misc.md")).toBe(
      true
    );
  });

  it("ranks directories first when the query ends with /", () => {
    const candidates = [
      { relativePath: "src/service.ts", kind: "file" as const },
      { relativePath: "src/service", kind: "directory" as const },
    ];
    const result = ranking.rank("src/service/", candidates, 50);
    expect(result[0].kind).toBe("directory");
  });

  it("shorter paths win ties over longer ones", () => {
    const candidates = [
      { relativePath: "a/very/deeply/nested/path.ts", kind: "file" as const },
      { relativePath: "shallow.ts", kind: "file" as const },
    ];
    // neither matches query "zzz" — both score 0, shorter wins
    expect(rankPaths("zzz", candidates)).toEqual([
      "shallow.ts",
      "a/very/deeply/nested/path.ts",
    ]);
  });

  it("respects the limit", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      relativePath: `f${i}.ts`,
      kind: "file" as const,
    }));
    expect(ranking.rank("f", candidates, 3)).toHaveLength(3);
  });
});
