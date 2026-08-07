import { describe, expect, it } from "vitest";
import { formatGoogleMapsWorkerExitDiagnostic } from "@/utils/googleMapsWorkerDiagnostics";

describe("Google Maps worker exit diagnostics", () => {
  it("includes exit code, signal, stderr, and recent stdout", () => {
    const diagnostic = formatGoogleMapsWorkerExitDiagnostic({
      code: 1,
      signal: null,
      stderr: "Error: Cannot find module 'sanitize-html'",
      stdout: "[GoogleMapsWorker] Received start message",
    });

    expect(diagnostic).toContain("code=1");
    expect(diagnostic).toContain("signal=null");
    expect(diagnostic).toContain("Cannot find module 'sanitize-html'");
    expect(diagnostic).toContain("Received start message");
  });
});
