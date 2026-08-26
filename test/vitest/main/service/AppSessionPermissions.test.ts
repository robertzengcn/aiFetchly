import { describe, expect, it } from "vitest";
import {
  APP_SESSION_PERMISSIONS,
  isAppPermissionCheckAllowed,
  isAppPermissionRequestAllowed,
} from "@/service/AppSessionPermissions";

describe("AppSessionPermissions", () => {
  it("allows clipboard-sanitized-write for Clipboard API copy", () => {
    expect(APP_SESSION_PERMISSIONS.has("clipboard-sanitized-write")).toBe(true);
    expect(isAppPermissionRequestAllowed("clipboard-sanitized-write")).toBe(
      true
    );
    expect(isAppPermissionCheckAllowed("clipboard-sanitized-write")).toBe(true);
  });

  it("does not treat the invalid clipboard-sanitized name as allowed", () => {
    expect(isAppPermissionRequestAllowed("clipboard-sanitized")).toBe(false);
    expect(isAppPermissionCheckAllowed("clipboard-sanitized")).toBe(false);
  });

  it("allows clipboard-read and other renderer session permissions", () => {
    expect(isAppPermissionRequestAllowed("clipboard-read")).toBe(true);
    expect(isAppPermissionCheckAllowed("clipboard-read")).toBe(true);
    expect(isAppPermissionRequestAllowed("fullscreen")).toBe(true);
    expect(isAppPermissionRequestAllowed("openExternal")).toBe(true);
  });

  it("denies unexpected permissions such as geolocation", () => {
    expect(isAppPermissionRequestAllowed("geolocation")).toBe(false);
    expect(isAppPermissionCheckAllowed("geolocation")).toBe(false);
  });

  it("allows microphone media and denies camera on request", () => {
    expect(isAppPermissionRequestAllowed("media", { mediaTypes: ["audio"] })).toBe(
      true
    );
    expect(
      isAppPermissionRequestAllowed("media", { mediaTypes: ["video"] })
    ).toBe(false);
    expect(
      isAppPermissionRequestAllowed("media", { mediaTypes: ["audio", "video"] })
    ).toBe(false);
  });

  it("denies camera on permission check when mediaType is video", () => {
    expect(isAppPermissionCheckAllowed("media", { mediaType: "audio" })).toBe(
      true
    );
    expect(isAppPermissionCheckAllowed("media", { mediaType: "video" })).toBe(
      false
    );
    expect(isAppPermissionCheckAllowed("media")).toBe(true);
  });
});
