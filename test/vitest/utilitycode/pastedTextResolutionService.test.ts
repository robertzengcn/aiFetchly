import { describe, expect, it } from "vitest";
import { PastedTextResolutionService } from "@/service/pastedText/PastedTextResolutionService";
import { UnresolvedPastedTextError } from "@/service/pastedText/UnresolvedPastedTextError";

describe("PastedTextResolutionService", () => {
  it("throws when a pasted-text placeholder has no matching contents", async () => {
    const service = new PastedTextResolutionService();
    await expect(
      service.resolveMessage("[Pasted text #1]", undefined)
    ).rejects.toBeInstanceOf(UnresolvedPastedTextError);
  });
});
