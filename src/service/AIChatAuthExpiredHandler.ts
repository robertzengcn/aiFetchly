// src/service/AIChatAuthExpiredHandler.ts
//
// Main-process only. Must NOT be imported from renderer/Vue code — it pulls
// Electron BrowserWindow via User.Signout. Renderer-safe auth sentinels live
// in AIChatErrorMapper.ts.

import { User } from "@/modules/user";
import { isAuthExpiredError } from "@/service/AIChatErrorMapper";

/**
 * When the hosted AI session has expired, clear local auth and navigate the
 * renderer to the login page (same path as manual sign-out). Fire-and-forget
 * friendly: callers should not block error reporting on this.
 */
export async function redirectToLoginOnAuthExpired(
  err: unknown
): Promise<void> {
  if (!isAuthExpiredError(err)) {
    return;
  }
  try {
    await new User().Signout();
  } catch (signoutError) {
    console.error(
      "[ai-chat] failed to sign out after auth expiry:",
      signoutError
    );
  }
}
