/**
 * Unit tests for the recoverable large tool results rollout flag helpers
 * (technical design §13.4).
 *
 * The three flags DEFAULT ON and fail OPEN on an unreadable Token store:
 * the feature shipped through its audit (T01–T18 closed), so a fresh install
 * must have tool_result_read/search working without an operator step. The
 * explicit value "false" is the per-install opt-out; any other value
 * (including an unreadable store) keeps the feature enabled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const flagStore: Record<string, string> = {};
// When true, Token.getValue throws to simulate an unreadable encrypted store.
let storeUnreadable = false;

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      if (storeUnreadable) {
        throw new Error("encrypted store unreadable");
      }
      return flagStore[name] ?? "";
    }
    setValue(name: string, value: string) {
      flagStore[name] = value;
    }
  },
}));

import {
  isToolOutputCaptureEnabled,
  isToolOutputModelRefsEnabled,
  isToolOutputUiEnabled,
  enableToolResultFlags,
} from "@/config/featureFlags";
import { TOOL_RESULT_FLAGS } from "@/config/toolResultConfig";

beforeEach(() => {
  // Wipe between tests so each starts from the default-ON state.
  for (const key of Object.keys(flagStore)) delete flagStore[key];
  storeUnreadable = false;
});

afterEach(() => {
  for (const key of Object.keys(flagStore)) delete flagStore[key];
  storeUnreadable = false;
});

describe("tool-result rollout flags — default ON + explicit opt-out", () => {
  it("all three flags are on when the Token store has no value", () => {
    expect(isToolOutputCaptureEnabled()).toBe(true);
    expect(isToolOutputModelRefsEnabled()).toBe(true);
    expect(isToolOutputUiEnabled()).toBe(true);
  });

  it("the explicit value 'false' opts out", () => {
    flagStore[TOOL_RESULT_FLAGS.capture] = "false";
    flagStore[TOOL_RESULT_FLAGS.modelRefs] = "false";
    flagStore[TOOL_RESULT_FLAGS.ui] = "false";
    expect(isToolOutputCaptureEnabled()).toBe(false);
    expect(isToolOutputModelRefsEnabled()).toBe(false);
    expect(isToolOutputUiEnabled()).toBe(false);
  });

  it("a non-'false' value (e.g. '1', 'yes') does NOT opt out", () => {
    flagStore[TOOL_RESULT_FLAGS.capture] = "1";
    flagStore[TOOL_RESULT_FLAGS.modelRefs] = "yes";
    flagStore[TOOL_RESULT_FLAGS.ui] = "0";
    expect(isToolOutputCaptureEnabled()).toBe(true);
    expect(isToolOutputModelRefsEnabled()).toBe(true);
    expect(isToolOutputUiEnabled()).toBe(true);
  });

  it("flags are independent (capture ≠ modelRefs ≠ ui)", () => {
    flagStore[TOOL_RESULT_FLAGS.capture] = "false";
    expect(isToolOutputCaptureEnabled()).toBe(false);
    expect(isToolOutputModelRefsEnabled()).toBe(true);
    expect(isToolOutputUiEnabled()).toBe(true);

    flagStore[TOOL_RESULT_FLAGS.modelRefs] = "false";
    expect(isToolOutputModelRefsEnabled()).toBe(false);
    expect(isToolOutputUiEnabled()).toBe(true);
  });

  it("enableToolResultFlags writes 'true' (explicit re-enable after opt-out)", () => {
    flagStore[TOOL_RESULT_FLAGS.capture] = "false";
    flagStore[TOOL_RESULT_FLAGS.modelRefs] = "false";
    flagStore[TOOL_RESULT_FLAGS.ui] = "false";
    enableToolResultFlags();
    expect(isToolOutputCaptureEnabled()).toBe(true);
    expect(isToolOutputModelRefsEnabled()).toBe(true);
    expect(isToolOutputUiEnabled()).toBe(true);
  });
});

describe("tool-result rollout flags — fail-open on store error", () => {
  it("returns true when Token.getValue throws", () => {
    storeUnreadable = true;
    // The shared Token mock throws on getValue; the feature must fail OPEN so
    // a storage hiccup does not silently disable an audited feature.
    expect(isToolOutputCaptureEnabled()).toBe(true);
    expect(isToolOutputModelRefsEnabled()).toBe(true);
    expect(isToolOutputUiEnabled()).toBe(true);
  });
});
