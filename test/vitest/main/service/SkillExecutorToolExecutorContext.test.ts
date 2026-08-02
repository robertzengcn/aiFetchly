import { describe, expect, it, vi } from "vitest";
import { SkillExecutor } from "@/service/SkillExecutor";
import { ToolExecutor } from "@/service/ToolExecutor";

describe("SkillExecutor nested ToolExecutor permission context", () => {
  it("forwards resume-approved permission context to search_maps_businesses", async () => {
    const executeSpy = vi
      .spyOn(ToolExecutor, "execute")
      .mockResolvedValueOnce({ success: true, businesses: [] });

    try {
      const result = await SkillExecutor.execute(
        "search_maps_businesses",
        {
          platform: "google",
          query: "dentist",
          location: "New York",
          max_results: 5,
        },
        {
          conversationId: "conv-permission-resume",
          toolCallId: "call-permission-resume",
          skipPermissionCheck: true,
        }
      );

      expect(result.success).toBe(true);
      expect(executeSpy).toHaveBeenCalledOnce();
      expect(executeSpy.mock.calls[0][0]).toBe("search_maps_businesses");
      expect(executeSpy.mock.calls[0][3]).toMatchObject({
        toolCallId: "call-permission-resume",
        skipPermissionCheck: true,
      });
    } finally {
      executeSpy.mockRestore();
    }
  });
});
