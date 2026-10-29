"use strict";
import {
  APPLICATION_LIFECYCLE_GET_STATE,
  APPLICATION_CLOSE_CHOICE_REQUEST,
  APPLICATION_CLOSE_CHOICE_ACK,
  APPLICATION_CLOSE_CHOICE_SUBMIT,
  APPLICATION_LIFECYCLE_STATE_CHANGED,
} from "@/config/channellist";
import type {
  ApplicationCloseChoiceRequest,
  ApplicationCloseChoice,
  ApplicationLifecycleStateSnapshot,
  ApplicationLifecycleStateChangedEvent,
} from "@/entityTypes/applicationLifecycleTypes";

/**
 * Renderer-side application-lifecycle API (technical design §10).
 *
 * All methods go through the whitelisted `window.api` surface (see
 * src/preload.ts). Choices are submitted with the main-issued single-use
 * token; stale tokens are typed rejections handled by the caller.
 */

/** Local view of `window.api.invoke` (avoids widening Window). */
type WindowApiInvoke = (channel: string, data?: unknown) => Promise<unknown>;
type WindowApiReceive = (
  channel: string,
  cb: (...args: unknown[]) => void
) => void;
type WindowApiRemoveListener = (
  channel: string,
  cb: (...args: unknown[]) => void
) => void;

function api(): {
  invoke: WindowApiInvoke;
  receive: WindowApiReceive;
  removeListener: WindowApiRemoveListener;
} {
  const w = window as unknown as {
    api?: {
      invoke: WindowApiInvoke;
      receive: WindowApiReceive;
      removeListener: WindowApiRemoveListener;
    };
  };
  if (!w.api) {
    throw new Error("window.api is not available (preload not loaded?)");
  }
  return w.api;
}

interface Envelope<T> {
  status: boolean;
  msg: string;
  data: T | null;
}

async function invokeEnvelope<T>(channel: string, payload?: unknown): Promise<Envelope<T>> {
  const raw = await api().invoke(channel, payload);
  return (raw ?? { status: false, msg: "no response", data: null }) as Envelope<T>;
}

/** Current lifecycle snapshot (state, phase, background availability). */
export async function getLifecycleState(): Promise<ApplicationLifecycleStateSnapshot | null> {
  const envelope = await invokeEnvelope<ApplicationLifecycleStateSnapshot>(
    APPLICATION_LIFECYCLE_GET_STATE
  );
  return envelope.status ? envelope.data : null;
}

/** Acknowledge that the renderer dialog is visible for this token. */
export async function acknowledgeCloseChoice(token: string): Promise<boolean> {
  const envelope = await invokeEnvelope<{ acknowledged: boolean }>(
    APPLICATION_CLOSE_CHOICE_ACK,
    { token }
  );
  return envelope.status && (envelope.data?.acknowledged ?? false);
}

/** Submit the user's close choice (`hide` / `exit` / `cancel`). */
export async function submitCloseChoice(
  token: string,
  choice: ApplicationCloseChoice
): Promise<{ accepted: boolean; stale: boolean }> {
  const envelope = await invokeEnvelope<{ accepted: boolean; stale: boolean }>(
    APPLICATION_CLOSE_CHOICE_SUBMIT,
    { token, choice }
  );
  return envelope.status && envelope.data
    ? envelope.data
    : { accepted: false, stale: true };
}

/** Structural guard: a close-choice request must carry its required fields. */
function isCloseChoiceRequest(
  value: unknown
): value is ApplicationCloseChoiceRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.token === "string" &&
    typeof v.backgroundAvailable === "boolean" &&
    (v.activeTaskCount === undefined || typeof v.activeTaskCount === "number")
  );
}

/** Structural guard: a state-changed broadcast must carry its required fields. */
function isLifecycleStateChangedEvent(
  value: unknown
): value is ApplicationLifecycleStateChangedEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.state === "string" &&
    typeof v.phase === "string" &&
    typeof v.phaseKey === "string"
  );
}

/** Subscribe to close-choice requests (main → renderer). */
export function onCloseChoiceRequest(
  cb: (request: ApplicationCloseChoiceRequest) => void
): () => void {
  const handler = (...args: unknown[]): void => {
    // Boundary validation: never as-cast the inbound payload — a malformed
    // or shape-changed event is dropped, not passed through.
    if (isCloseChoiceRequest(args[0])) {
      cb(args[0]);
    }
  };
  api().receive(APPLICATION_CLOSE_CHOICE_REQUEST, handler);
  return () => api().removeListener(APPLICATION_CLOSE_CHOICE_REQUEST, handler);
}

/** Subscribe to lifecycle state broadcasts (main → renderer). */
export function onLifecycleStateChanged(
  cb: (event: ApplicationLifecycleStateChangedEvent) => void
): () => void {
  const handler = (...args: unknown[]): void => {
    if (isLifecycleStateChangedEvent(args[0])) {
      cb(args[0]);
    }
  };
  api().receive(APPLICATION_LIFECYCLE_STATE_CHANGED, handler);
  return () =>
    api().removeListener(APPLICATION_LIFECYCLE_STATE_CHANGED, handler);
}
