/**
 * Electron session permission policy for the renderer.
 *
 * Chromium's Clipboard API (`navigator.clipboard.writeText`) checks
 * `clipboard-sanitized-write` via both the permission *check* and *request*
 * handlers. Denying either produces:
 *   NotAllowedError: Failed to execute 'writeText' on 'Clipboard': Write permission denied.
 *
 * `clipboard-sanitized-write` only allows plain text (not HTML/images).
 */

export const APP_SESSION_PERMISSIONS: ReadonlySet<string> = new Set([
  "clipboard-sanitized-write",
  "clipboard-read",
  "fullscreen",
  "window-management",
  "openExternal",
]);

export interface AppPermissionRequestDetails {
  readonly mediaTypes?: readonly string[];
}

export interface AppPermissionCheckDetails {
  readonly mediaType?: string;
}

function requestWantsCamera(
  details: AppPermissionRequestDetails | undefined
): boolean {
  return details?.mediaTypes?.includes("video") ?? false;
}

export function isAppPermissionRequestAllowed(
  permission: string,
  details?: AppPermissionRequestDetails
): boolean {
  // Voice feature (PRD §16): allow microphone; deny camera.
  if (permission === "media") {
    return !requestWantsCamera(details);
  }
  return APP_SESSION_PERMISSIONS.has(permission);
}

export function isAppPermissionCheckAllowed(
  permission: string,
  details?: AppPermissionCheckDetails
): boolean {
  if (permission === "media") {
    return details?.mediaType !== "video";
  }
  return APP_SESSION_PERMISSIONS.has(permission);
}
