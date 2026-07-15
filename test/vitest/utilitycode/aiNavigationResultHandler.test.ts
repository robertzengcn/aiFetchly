/**
 * Tests for the renderer-side AI navigation result handler.
 *
 * @see docs/prd/ai-app-navigation-tool-technical-design.md §12, §17.4
 */
import { describe, it, expect, vi } from "vitest";
import type { Router } from "vue-router";
import { handleAiNavigationToolResult } from "@/views/utils/aiNavigationResultHandler";

interface MockRoute {
  name: string;
  path: string;
  meta?: Record<string, unknown>;
}

function makeRouter(routes: MockRoute[]): Router & { push: ReturnType<typeof vi.fn> } {
  return {
    getRoutes: () => routes,
    push: vi.fn().mockResolvedValue(undefined),
  } as unknown as Router & { push: ReturnType<typeof vi.fn> };
}

describe("handleAiNavigationToolResult", () => {
  it("navigates when the result is valid and the route exists", async () => {
    const router = makeRouter([
      { name: "Email_Marketing_Service_LIST", path: "/emailmarketing/emailservice/list", meta: { aiNavigable: true } },
    ]);
    const handled = await handleAiNavigationToolResult(router, {
      success: true,
      action: "navigate",
      routeName: "Email_Marketing_Service_LIST",
      label: "Email Service",
      confidence: 1,
    });
    expect(handled).toBe(true);
    expect(router.push).toHaveBeenCalledWith({
      name: "Email_Marketing_Service_LIST",
    });
  });

  it("does not navigate when action is not 'navigate'", async () => {
    const router = makeRouter([
      { name: "Email_Marketing_Service_LIST", path: "/x", meta: {} },
    ]);
    const handled = await handleAiNavigationToolResult(router, {
      success: false,
      needsClarification: true,
      message: "Several pages match.",
      candidates: [],
    });
    expect(handled).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("does not navigate when the route is missing from the router", async () => {
    const router = makeRouter([
      { name: "Other", path: "/other", meta: {} },
    ]);
    const handled = await handleAiNavigationToolResult(router, {
      success: true,
      action: "navigate",
      routeName: "Email_Marketing_Service_LIST",
      label: "Email Service",
      confidence: 1,
    });
    expect(handled).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("does not navigate when the route is blocked by metadata", async () => {
    const router = makeRouter([
      { name: "login", path: "/login", meta: { aiNavigable: false } },
    ]);
    const handled = await handleAiNavigationToolResult(router, {
      success: true,
      action: "navigate",
      routeName: "login",
      label: "Login",
      confidence: 1,
    });
    expect(handled).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("does not navigate when the route requires params", async () => {
    const router = makeRouter([
      { name: "EditCampaign", path: "/campaign/edit/:id(\\d+)", meta: {} },
    ]);
    const handled = await handleAiNavigationToolResult(router, {
      success: true,
      action: "navigate",
      routeName: "EditCampaign",
      label: "Edit Campaign",
      confidence: 1,
    });
    expect(handled).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("returns false for non-object input", async () => {
    const router = makeRouter([]);
    const handled = await handleAiNavigationToolResult(router, null);
    expect(handled).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });
});
