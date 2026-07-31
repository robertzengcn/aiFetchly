/**
 * Tests for AIAppNavigationToolService (the open_app_page built-in skill core).
 *
 * @see docs/prd/ai-app-navigation-tool-technical-design.md §10, §17.3
 */
import { describe, it, expect } from "vitest";
import { AIAppNavigationToolService } from "@/service/AIAppNavigationToolService";

describe("AIAppNavigationToolService", () => {
  const service = new AIAppNavigationToolService();

  describe("valid navigation", () => {
    it("returns a navigate command for 'open email service'", () => {
      const result = service.openAppPage({ query: "open email service" });
      expect(result.success).toBe(true);
      expect(result).toMatchObject({
        success: true,
        action: "navigate",
        routeName: "Email_Marketing_Service_LIST",
      });
    });

    it("returns a navigate command for 'check email reply log'", () => {
      const result = service.openAppPage({ query: "check email reply log" });
      expect(result).toMatchObject({ routeName: "AI_Auto_Reply_Audit_List" });
    });

    it("honors preferredRouteName from a prior clarification", () => {
      const result = service.openAppPage({
        query: "email",
        preferredRouteName: "Email_Marketing_Service_LIST",
      });
      expect(result).toMatchObject({
        success: true,
        routeName: "Email_Marketing_Service_LIST",
      });
    });
  });

  describe("invalid input", () => {
    it("returns a safe failure for missing query", () => {
      const result = service.openAppPage({});
      expect(result.success).toBe(false);
      expect(result).not.toMatchObject({ needsClarification: true });
    });

    it("returns a safe failure for a non-string query", () => {
      const result = service.openAppPage({ query: 123 });
      expect(result.success).toBe(false);
    });

    it("returns a safe failure for an empty query", () => {
      const result = service.openAppPage({ query: "   " });
      expect(result.success).toBe(false);
    });
  });

  describe("safety", () => {
    it("fails safely for a login query (no navigation)", () => {
      const result = service.openAppPage({ query: "open login" });
      expect(result.success).toBe(false);
      // Login must never produce a navigate command.
      if (result.success) {
        expect(result.action).not.toBe("navigate");
      }
    });

    it("returns needsRouteParams for a detail-page request", () => {
      const result = service.openAppPage({ query: "open campaign detail" });
      expect(result.success).toBe(false);
      expect(result).toMatchObject({ needsRouteParams: true });
    });

    it("returns needsRouteParams for a request with a record id", () => {
      const result = service.openAppPage({ query: "open campaign 123" });
      expect(result.success).toBe(false);
      expect(result).toMatchObject({ needsRouteParams: true });
    });

    it("never returns an arbitrary URL in any result variant", () => {
      const inputs = [
        { query: "open email service" },
        { query: "open email page" },
        { query: "https://example.com" },
        { query: "open https://evil.com page" },
        { query: "file:///etc/passwd" },
      ];
      for (const input of inputs) {
        const result = service.openAppPage(input);
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain("http://");
        expect(serialized).not.toContain("https://");
        expect(serialized).not.toContain("file://");
        expect(serialized).not.toContain("www.");
      }
    });
  });
});
