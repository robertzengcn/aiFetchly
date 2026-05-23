/**
 * Tests for ObserveExecuteLoop (runObserveExecuteLoop).
 */
import { describe, it, expect, vi } from "vitest";
import { runObserveExecuteLoop } from "@/childprocess/utils/ObserveExecuteLoop";

describe("ObserveExecuteLoop", () => {
  describe("runObserveExecuteLoop", () => {
    it("should return goal_achieved on first round when status is goal_achieved", async () => {
      const requestAiSupport = vi.fn().mockResolvedValue({
        success: true,
        requestType: "observe_execute" as const,
        data: {
          session_id: "s1",
          status: "goal_achieved" as const,
          actions: [],
        },
      });
      const executeAction = vi.fn();

      const result = await runObserveExecuteLoop(
        {
          goal: "Find search box",
          pageUrl: "https://example.com",
          pageContent: "<html></html>",
          maxIterations: 3,
        },
        { requestAiSupport, executeAction }
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("goal_achieved");
      expect(requestAiSupport).toHaveBeenCalledTimes(1);
      expect(executeAction).not.toHaveBeenCalled();
    });

    it("should return give_up when status is give_up", async () => {
      const requestAiSupport = vi.fn().mockResolvedValue({
        success: true,
        requestType: "observe_execute" as const,
        data: {
          session_id: "s1",
          status: "give_up" as const,
          actions: [],
        },
      });

      const result = await runObserveExecuteLoop(
        {
          goal: "Find search box",
          pageUrl: "https://example.com",
          pageContent: "",
          maxIterations: 3,
        },
        { requestAiSupport, executeAction: vi.fn() }
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("give_up");
    });

    it("should stop when requestAiSupport returns success false", async () => {
      const requestAiSupport = vi.fn().mockResolvedValue({
        success: false,
        requestType: "observe_execute" as const,
        errorMessage: "API error",
      });

      const result = await runObserveExecuteLoop(
        {
          goal: "Recover",
          pageUrl: "https://example.com",
          pageContent: "",
        },
        { requestAiSupport, executeAction: vi.fn() }
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("API error");
    });

    it("should handle actions_needed status correctly", async () => {
      const requestAiSupport = vi
        .fn()
        .mockResolvedValueOnce({
          success: true,
          requestType: "observe_execute" as const,
          data: {
            session_id: "s1",
            status: "actions_needed" as const,
            actions: [
              {
                action_id: "a1",
                type: "click",
                selector: ".button",
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          success: true,
          requestType: "observe_execute" as const,
          data: {
            session_id: "s1",
            status: "goal_achieved" as const,
            actions: [],
          },
        });

      const executeAction = vi.fn().mockResolvedValue({
        action_id: "a1",
        success: true,
        element_found: true,
      });

      const result = await runObserveExecuteLoop(
        {
          goal: "Click button",
          pageUrl: "https://example.com",
          pageContent: "",
          maxIterations: 3,
        },
        { requestAiSupport, executeAction }
      );

      expect(requestAiSupport).toHaveBeenCalledTimes(2);
      expect(executeAction).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("goal_achieved");
    });

    it("should reach max iterations and return error", async () => {
      const requestAiSupport = vi.fn().mockResolvedValue({
        success: true,
        requestType: "observe_execute" as const,
        data: {
          session_id: "s1",
          status: "actions_needed" as const,
          actions: [
            {
              action_id: "a1",
              type: "click",
              selector: ".button",
            },
          ],
        },
      });

      const result = await runObserveExecuteLoop(
        {
          goal: "Test",
          pageUrl: "https://example.com",
          pageContent: "",
          maxIterations: 2, // Lower than default
        },
        {
          requestAiSupport,
          executeAction: vi.fn().mockResolvedValue({
            action_id: "a1",
            success: true,
            element_found: true,
          }),
        }
      );

      expect(requestAiSupport).toHaveBeenCalledTimes(3); // Initial + 2 iterations
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("Max observe-execute iterations");
    });

    it("should handle action execution errors and continue loop", async () => {
      const requestAiSupport = vi.fn().mockResolvedValue({
        success: true,
        requestType: "observe_execute" as const,
        data: {
          session_id: "s1",
          status: "actions_needed" as const,
          actions: [
            {
              action_id: "a1",
              type: "click",
              selector: ".button",
            },
          ],
        },
      });

      const executeAction = vi.fn().mockResolvedValue({
        action_id: "a1",
        success: false,
        element_found: false,
        error: "Element not found",
      });

      const result = await runObserveExecuteLoop(
        {
          goal: "Click button",
          pageUrl: "https://example.com",
          pageContent: "",
          maxIterations: 5, // Lower than default for faster test
        },
        { requestAiSupport, executeAction }
      );

      expect(executeAction).toHaveBeenCalledTimes(5); // 5 iterations with 1 action each
      expect(requestAiSupport).toHaveBeenCalledTimes(5); // Initial + 4 more iterations
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("Max observe-execute iterations");
    });
  });
});
