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

/** Subscribe to close-choice requests (main → renderer). */
export function onCloseChoiceRequest(
  cb: (request: ApplicationCloseChoiceRequest) => void
): () => void {
  const handler = (...args: unknown[]): void => {
    const payload = args[0] as ApplicationCloseChoiceRequest | undefined;
    if (payload && typeof payload.token === "string") {
      cb(payload);
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
    const payload = args[0] as ApplicationLifecycleStateChangedEvent | undefined;
    if (payload && typeof payload.state === "string") {
      cb(payload);
    }
  };
  api().receive(APPLICATION_LIFECYCLE_STATE_CHANGED, handler);
  return () =>
    api().removeListener(APPLICATION_LIFECYCLE_STATE_CHANGED, handler);
}
