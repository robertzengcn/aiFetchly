<template>
  <!-- F21: live browser-batch control card. Renders nothing while no
       batch is running (finished batches linger briefly for review). -->
  <BrowserTaskBatchCard
    v-if="activeBatch !== null"
    :batch-id="activeBatch.batchId"
    :tasks="activeBatch.tasks"
    @return-now="onReturnNow"
    @pause="onPause"
    @take-control="onTakeControl"
    @resume="onResume"
    @stop="onStop"
  />

  <!-- B02/A-FR-03: account-picker card (multi-account sign-in).
       Renders the pending picker of THIS conversation only. -->
  <BrowserAccountPickerCard
    v-if="activePickerRequest !== null"
    :site-domain="activePickerRequest.siteDomain"
    :accounts="activePickerRequest.candidates"
    @selected="onAccountPicked"
    @other="onAccountPickerOther"
  />

  <!-- B03/S-FR-04: extra-domain confirmation card (post sign-in).
       Renders the pending proposal of THIS conversation only. -->
  <BrowserSiteConfirmCard
    v-if="activeSiteConfirmRequest !== null"
    :site-id="activeSiteConfirmRequest.siteId"
    :registrable-domain="activeSiteConfirmRequest.registrableDomain"
    :proposed-domains="activeSiteConfirmRequest.proposedDomains"
    @applied="onSiteDomainsApplied"
    @cancelled="onSiteConfirmCancelled"
  />

  <!-- M-FR-04/W08: batch confirmation card. The batch preview of THIS
       conversation only; confirming starts the batch, denying refuses it. -->
  <BrowserBatchConfirmCard
    v-if="activeBatchConfirmRequest !== null"
    :tasks="activeBatchConfirmRequest.tasks"
    @confirmed="onBatchConfirmed"
    @denied="onBatchDenied"
  />

  <!-- N07/B01: live credential card (no-account / username-only sign-in).
       Renders the pending request of THIS conversation only — a request
       opened in another chat never renders here (A-FR-05). -->
  <BrowserCredentialCard
    v-if="activeCredentialRequest !== null"
    :request-id="activeCredentialRequest.requestId"
    :conversation-id="activeCredentialRequest.conversationId"
    :site-domain="activeCredentialRequest.siteDomain"
    :mode="activeCredentialRequest.mode"
    :prefill-username="activeCredentialRequest.prefillUsername"
    :password-only="activeCredentialRequest.passwordOnly"
    @submitted="clearCredentialRequest"
    @handoff="clearCredentialRequest"
    @cancelled="clearCredentialRequest"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import BrowserTaskBatchCard from "./BrowserTaskBatchCard.vue";
import BrowserCredentialCard from "./BrowserCredentialCard.vue";
import BrowserAccountPickerCard from "./BrowserAccountPickerCard.vue";
import BrowserSiteConfirmCard from "./BrowserSiteConfirmCard.vue";
import BrowserBatchConfirmCard from "./BrowserBatchConfirmCard.vue";
import {
  browserBatchReturnNow,
  onManagedBrowserBatchEvent,
  onManagedBrowserAccountPickerRequest,
  onManagedBrowserCredentialRequest,
  onManagedBrowserSiteConfirmRequest,
  onManagedBrowserBatchConfirmRequest,
  onManagedBrowserBatchConfirmCancelled,
  pauseBrowserTask,
  resumeBrowserTask,
  stopBrowserTask,
  submitBrowserAccountPicker,
  submitBrowserSiteConfirm,
  submitBrowserBatchConfirm,
  type BrowserBatchEvent,
  type BrowserCredentialRequestEvent,
  type BrowserAccountPickerRequestEvent,
  type BrowserSiteConfirmRequestEvent,
  type BrowserBatchConfirmRequestEvent,
} from "@/views/api/managedBrowser";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

interface BrowserBatchTaskRow {
  taskId: string;
  /** A05/M-FR-08: the LIVE session id when the lane has one. */
  sessionId?: string;
  label: string;
  state:
    | "running"
    | "waiting_for_user"
    | "queued"
    | "paused"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted"
    // W02: partial endings are their own state, never failed.
    | "partial";
  summary?: string;
}

interface BatchState {
  batchId: string;
  conversationId: string;
  tasks: BrowserBatchTaskRow[];
  finishedAt: number | null;
}

// P1/M-FR-08: MULTIPLE batches are retained — starting batch B never
// discards running batch A. The card shows the newest UNFINISHED batch of
// the ACTIVE conversation only (never another chat's rows).
const props = defineProps<{ conversationId: string | null }>();
const batches = ref(new Map<string, BatchState>());

const activeBatch = computed<BatchState | null>(() => {
  let newest: BatchState | null = null;
  for (const batch of batches.value.values()) {
    // A missing conversation prop (null/undefined) disables the filter.
    if (props.conversationId != null && batch.conversationId !== props.conversationId) {
      continue;
    }
    if (batch.finishedAt !== null) {
      continue;
    }
    if (newest === null) {
      newest = batch;
    }
  }
  return newest;
});
const finishedBatches = new Map<string, number>();
// B01: pending credential requests are kept PER CONVERSATION — the newest
// request of the active conversation renders; switching chats shows that
// chat's own card, never another conversation's.
const credentialRequests = ref(new Map<string, BrowserCredentialRequestEvent>());

const activeCredentialRequest = computed<BrowserCredentialRequestEvent | null>(() => {
  let newest: BrowserCredentialRequestEvent | null = null;
  for (const request of credentialRequests.value.values()) {
    if (props.conversationId != null && request.conversationId !== props.conversationId) {
      continue;
    }
    newest = request;
  }
  return newest;
});

function clearCredentialRequest(): void {
  const active = activeCredentialRequest.value;
  if (active !== null) {
    credentialRequests.value.delete(active.requestId);
  }
}

// B02: pending account-picker requests, kept per conversation like the
// credential cards so switching chats never shows another chat's picker.
const pickerRequests = ref(new Map<string, BrowserAccountPickerRequestEvent>());

const activePickerRequest = computed<BrowserAccountPickerRequestEvent | null>(
  () => {
    let newest: BrowserAccountPickerRequestEvent | null = null;
    for (const request of pickerRequests.value.values()) {
      if (
        props.conversationId != null &&
        request.conversationId !== props.conversationId
      ) {
        continue;
      }
      newest = request;
    }
    return newest;
  }
);

function clearPickerRequest(): void {
  const active = activePickerRequest.value;
  if (active !== null) {
    pickerRequests.value.delete(active.requestId);
  }
}

async function onAccountPicked(accountId: number): Promise<void> {
  const active = activePickerRequest.value;
  if (active === null) {
    return;
  }
  await submitBrowserAccountPicker({
    requestId: active.requestId,
    conversationId: active.conversationId,
    accountId,
    cancelled: false,
  });
  clearPickerRequest();
}

async function onAccountPickerOther(): Promise<void> {
  const active = activePickerRequest.value;
  if (active === null) {
    return;
  }
  // "Use another account": no saved account fits — the in-job wait resolves
  // with accountId null and the sign-in opens the handoff dialog.
  await submitBrowserAccountPicker({
    requestId: active.requestId,
    conversationId: active.conversationId,
    accountId: null,
    cancelled: false,
  });
  clearPickerRequest();
}

// B03: pending extra-domain confirmation proposals, per conversation like
// the other cards.
const siteConfirmRequests = ref(
  new Map<string, BrowserSiteConfirmRequestEvent>()
);

const activeSiteConfirmRequest =
  computed<BrowserSiteConfirmRequestEvent | null>(() => {
    let newest: BrowserSiteConfirmRequestEvent | null = null;
    for (const request of siteConfirmRequests.value.values()) {
      if (
        props.conversationId != null &&
        request.conversationId !== props.conversationId
      ) {
        continue;
      }
      newest = request;
    }
    return newest;
  });

function clearSiteConfirmRequest(): void {
  const active = activeSiteConfirmRequest.value;
  if (active !== null) {
    siteConfirmRequests.value.delete(active.requestId);
  }
}

async function onSiteDomainsApplied(payload: {
  siteId: number;
  domains: string[];
}): Promise<void> {
  const active = activeSiteConfirmRequest.value;
  if (active === null) {
    return;
  }
  await submitBrowserSiteConfirm({
    requestId: active.requestId,
    conversationId: active.conversationId,
    siteId: active.siteId,
    domains: payload.domains,
    cancelled: false,
  });
  clearSiteConfirmRequest();
}

async function onSiteConfirmCancelled(): Promise<void> {
  const active = activeSiteConfirmRequest.value;
  if (active === null) {
    return;
  }
  await submitBrowserSiteConfirm({
    requestId: active.requestId,
    conversationId: active.conversationId,
    siteId: active.siteId,
    domains: [],
    cancelled: true,
  });
  clearSiteConfirmRequest();
}

// M-FR-04/W08: pending batch confirmations, per conversation like the
// other cards. The batch does not start until the user confirms.
const batchConfirmRequests = ref(
  new Map<string, BrowserBatchConfirmRequestEvent>()
);

const activeBatchConfirmRequest =
  computed<BrowserBatchConfirmRequestEvent | null>(() => {
    let newest: BrowserBatchConfirmRequestEvent | null = null;
    for (const request of batchConfirmRequests.value.values()) {
      if (
        props.conversationId != null &&
        request.conversationId !== props.conversationId
      ) {
        continue;
      }
      newest = request;
    }
    return newest;
  });

function clearBatchConfirmRequest(): void {
  const active = activeBatchConfirmRequest.value;
  if (active !== null) {
    batchConfirmRequests.value.delete(active.requestId);
  }
}

async function onBatchConfirmed(): Promise<void> {
  const active = activeBatchConfirmRequest.value;
  if (active === null) {
    return;
  }
  await submitBrowserBatchConfirm({
    requestId: active.requestId,
    conversationId: active.conversationId,
    confirmed: true,
    cancelled: false,
  });
  clearBatchConfirmRequest();
}

async function onBatchDenied(): Promise<void> {
  const active = activeBatchConfirmRequest.value;
  if (active === null) {
    return;
  }
  await submitBrowserBatchConfirm({
    requestId: active.requestId,
    conversationId: active.conversationId,
    confirmed: false,
    cancelled: true,
  });
  clearBatchConfirmRequest();
}

const LABEL_FALLBACK = "Browser task";

function applyEvent(event: BrowserBatchEvent): void {
  if (event.phase === "started") {
    finishedBatches.delete(event.batchId);
    batches.value.set(event.batchId, {
      batchId: event.batchId,
      conversationId: event.conversationId,
      tasks: [],
      finishedAt: null,
    });
    return;
  }
  if (event.phase === "task") {
    const batch = batches.value.get(event.batchId);
    if (!batch || !event.taskId) {
      return;
    }
    const tasks = batch.tasks;
    const existing = tasks.find((task) => task.taskId === event.taskId);
    const row: BrowserBatchTaskRow = {
      taskId: event.taskId,
      sessionId: event.sessionId,
      label:
        event.label ??
        `${t("browserTasks.taskRunning") || LABEL_FALLBACK} ${event.taskId}`,
      state: event.state ?? "running",
      summary: event.summary,
    };
    if (existing) {
      // R04/M-FR-08: a SPARSE update (a wait-state transition, a queued
      // retry) carries only the changed fields — assigning the whole row
      // cleared the live session and the real label on every partial
      // event that omitted them.
      if (event.sessionId !== undefined) {
        existing.sessionId = event.sessionId;
      }
      if (event.label !== undefined) {
        existing.label = row.label;
      }
      existing.state = row.state;
      if (event.summary !== undefined) {
        existing.summary = event.summary;
      }
    } else {
      tasks.push(row);
    }
    return;
  }
  if (event.phase === "finished" && batches.value.has(event.batchId)) {
    const batch = batches.value.get(event.batchId)!;
    batch.finishedAt = Date.now();
    finishedBatches.set(event.batchId, Date.now());
  }
}

let unsubscribe: (() => void) | null = null;
let unsubscribeCredential: (() => void) | null = null;
let unsubscribePicker: (() => void) | null = null;
let unsubscribeSiteConfirm: (() => void) | null = null;
let unsubscribeBatchConfirm: (() => void) | null = null;
// R07/M-FR-04: cards retired WITHOUT a user decision (parent Stop, TTL).
let unsubscribeBatchConfirmCancelled: (() => void) | null = null;
let pruneTimer: number | null = null;

onMounted(() => {
  unsubscribe = onManagedBrowserBatchEvent(applyEvent);
  unsubscribeCredential = onManagedBrowserCredentialRequest(
    (request) => {
      // B01: requests arrive with their owner conversation; keep every
      // pending request so a second conversation's card does not clobber
      // this one. The main-process TTL resolves the wait after 10 minutes.
      credentialRequests.value.set(request.requestId, request);
    }
  );
  unsubscribePicker = onManagedBrowserAccountPickerRequest((request) => {
    pickerRequests.value.set(request.requestId, request);
  });
  unsubscribeSiteConfirm = onManagedBrowserSiteConfirmRequest((request) => {
    siteConfirmRequests.value.set(request.requestId, request);
  });
  unsubscribeBatchConfirm = onManagedBrowserBatchConfirmRequest((request) => {
    batchConfirmRequests.value.set(request.requestId, request);
  });
  unsubscribeBatchConfirmCancelled = onManagedBrowserBatchConfirmCancelled(
    (event) => {
      // R07: the main process retired the request (parent Stop / TTL) —
      // the card disappears immediately instead of a stray submit hitting
      // an already-consumed request.
      batchConfirmRequests.value.delete(event.requestId);
    }
  );
  pruneTimer = window.setInterval(() => {
    // Finished batches linger 30s for review, then the card disappears.
    for (const [batchId, finishedAt] of finishedBatches) {
      if (Date.now() - finishedAt > 30_000) {
        finishedBatches.delete(batchId);
        batches.value.delete(batchId);
      }
    }
    // B01: drop credential cards past the main-process TTL (10 min) so a
    // dead request never lingers in the UI.
    for (const [requestId, request] of credentialRequests.value) {
      if (Date.now() - request.createdAt > 10 * 60_000) {
        credentialRequests.value.delete(requestId);
      }
    }
    // B02: same TTL sweep for account pickers.
    for (const [requestId, request] of pickerRequests.value) {
      if (Date.now() - request.createdAt > 10 * 60_000) {
        pickerRequests.value.delete(requestId);
      }
    }
    // B03: same TTL sweep for site-confirm proposals.
    for (const [requestId, request] of siteConfirmRequests.value) {
      if (Date.now() - request.createdAt > 10 * 60_000) {
        siteConfirmRequests.value.delete(requestId);
      }
    }
    // W08: same TTL sweep for batch confirmations.
    for (const [requestId, request] of batchConfirmRequests.value) {
      if (Date.now() - request.createdAt > 10 * 60_000) {
        batchConfirmRequests.value.delete(requestId);
      }
    }
  }, 5_000);
});

onBeforeUnmount(() => {
  unsubscribe?.();
  unsubscribeCredential?.();
  unsubscribePicker?.();
  unsubscribeSiteConfirm?.();
  unsubscribeBatchConfirm?.();
  unsubscribeBatchConfirmCancelled?.();
  if (pruneTimer !== null) {
    window.clearInterval(pruneTimer);
  }
});

/**
 * R04/M-FR-07: a FAILED control IPC is never silently swallowed — the
 * row's summary carries the refusal so the user sees the control did
 * NOT happen (previously `{ ok: false }` resolved to nothing visible).
 */
function noteControlFailure(taskId: string | undefined, reason: string): void {
  if (!taskId) {
    return;
  }
  for (const batch of batches.value.values()) {
    const row = batch.tasks.find((task) => task.taskId === taskId);
    if (row) {
      row.summary = `${reason} (control refused)`;
      return;
    }
  }
}

async function onReturnNow(batchId: string): Promise<void> {
  const result = await browserBatchReturnNow({ batchId });
  if (!result.ok) {
    console.warn("[browser-cards] return-now refused:", result);
  }
}

async function onPause(payload: { taskId: string; sessionId?: string }): Promise<void> {
  const result = await pauseBrowserTask(payload);
  if (!result.ok) {
    noteControlFailure(payload.taskId, result.reason ?? "pause failed");
  }
}

// B13/C-FR-04: Take control routes through the SAME pause-or-take-control
// handler (both layers: session user-control + loop control gate).
async function onTakeControl(payload: { taskId: string; sessionId?: string }): Promise<void> {
  const result = await pauseBrowserTask(payload);
  if (!result.ok) {
    noteControlFailure(payload.taskId, result.reason ?? "take control failed");
  }
}

async function onResume(payload: {
  taskId: string;
  sessionId?: string;
  instructions?: string;
}): Promise<void> {
  const result = await resumeBrowserTask(payload);
  if (!result.ok) {
    noteControlFailure(payload.taskId, result.reason ?? "resume failed");
  }
}

async function onStop(payload: { taskId: string; sessionId?: string }): Promise<void> {
  const result = await stopBrowserTask(payload);
  if (!result.ok) {
    noteControlFailure(payload.taskId, result.reason ?? "stop failed");
  }
}
</script>
