import * as path from "path";
import * as fs from "fs";
import { utilityProcess, MessageChannelMain, app } from "electron";
import { BaseDb } from "@/model/Basedb";
import { SqliteDb } from "@/config/SqliteDb";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { OutboundEmailWorkerEventBridge } from "@/service/outboundEmail/OutboundEmailWorkerEventBridge";
import { broadcastOutboundEmailProgress } from "@/main-process/communication/outboundEmailDelivery-ipc";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import {
  resolvePackagedWorkerPath,
  buildPackagedWorkerEnv,
  getPackagedWorkerPathCandidates,
  type PackagedWorkerPathRuntime,
} from "@/utils/packagedWorkerPath";
import { parseChildMessage } from "@/utils/childProcessMessage";
import { incrementOutboundMetric } from "@/service/outboundEmail/OutboundEmailMetrics";
import type { EmailServiceEntity } from "@/entity/EmailService.entity";
import type { EmailServiceEntitydata } from "@/entityTypes/emailmarketingType";
import type {
  AuthorizedEmailWorkerPayloadV2,
  AuthorizedOutboundEnvelope,
  AuthorizedEmailWorkerEvent,
} from "@/entityTypes/outboundEmailDeliveryTypes";
import type { WorkerStartResult } from "@/service/outboundEmail/OutboundEmailDeliveryService";
import type { OutboundEmailDraftBatchEntity } from "@/entity/OutboundEmailDraftBatch.entity";
import type { OutboundEmailDraftEntity } from "@/entity/OutboundEmailDraft.entity";
import type { OutboundEmailDraftRevisionEntity } from "@/entity/OutboundEmailDraftRevision.entity";
import type { OutboundEmailAuthorizationEntity } from "@/entity/OutboundEmailAuthorization.entity";

/**
 * Minimal shape of a forked Electron utility process (or a test double). The
 * real `utilityProcess.fork` returns a `UtilityProcess` with `pid`,
 * `postMessage`, `on`, `off`, and `kill`; tests inject a fake that records the
 * posted messages without spawning anything.
 */
export interface ForkedChild {
  readonly pid: number | undefined;
  postMessage: (message: string, transferList?: unknown[]) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
  kill: () => void;
}

/**
 * Injectable fork. Mirrors `utilityProcess.fork(modulePath, args, options)` so
 * the production path and the test double share one signature.
 */
export type ForkFn = (
  modulePath: string,
  args: string[],
  options: unknown
) => ForkedChild;

/**
 * Loads a single decrypted email-service row by id. The production default is
 * `EmailServiceModule.getEmailService`, which decrypts the password with
 * `FieldCipher` (AES-256-GCM). The returned row carries the raw password — it
 * crosses to the worker over a MessagePort, never over renderer IPC (§17.1).
 */
export type CredentialLoader = (
  id: number
) => Promise<EmailServiceEntity | undefined>;

export interface OutboundEmailWorkerStarterOptions {
  readonly dbpath?: string;
  /** Injectable fork (tests pass a fake). Omit to use `utilityProcess.fork`. */
  readonly fork?: ForkFn;
  /**
   * Injectable credential loader (tests pass a fake). Defaults to
   * `EmailServiceModule.getEmailService`, which returns the decrypted row.
   */
  readonly credentialLoader?: CredentialLoader;
}

/**
 * Worker starter for the intent-aware outbound-email pipeline (technical design
 * §15.2, §16). This is the trusted main-process adapter the delivery service
 * calls AFTER the idempotent claim transaction commits. It:
 *
 * 1. Builds the versioned v2 payload (`authorized_envelopes`) from the frozen
 *    draft revisions, using each revision's stored `contentHash` as the
 *    envelope hash and the revision's `senderAddress`.
 * 2. Resolves the distinct email-service rows referenced by the revisions and
 *    decrypts each once via the credential loader; the decrypted rows (with
 *    passwords) ride in the payload over a MessagePort — never renderer IPC.
 * 3. Forks the `taskCode.js` utility process, posts `sendAuthorizedEmails`,
 *    marks the attempt `sending` with `workerPid` + `workerStartedAt`, and
 *    wires `child.on("message")` → the worker-event bridge.
 *
 * It performs no SMTP and makes no authorization decisions. Throwing indicates a
 * definite pre-acceptance failure; the delivery service records it as
 * `worker_start_failed` (§15.3).
 */
export class OutboundEmailWorkerStarter extends BaseDb {
  private readonly dbpath: string;
  private readonly forkFn: ForkFn;
  private readonly credentialLoader: CredentialLoader;

  constructor(options: OutboundEmailWorkerStarterOptions = {}) {
    super(options.dbpath ?? "");
    this.dbpath = options.dbpath ?? "";
    this.forkFn = options.fork ?? defaultFork;
    this.credentialLoader = options.credentialLoader ?? defaultCredentialLoader;
    // Rebind the singleton to the real path so the delivery model the starter
    // uses targets the same database as the caller. BaseDb("") fell back to the
    // test temp dir; rebind before touching any model.
    this.sqliteDb = SqliteDb.getInstance(this.dbpath);
  }

  /**
   * Return the `(attemptId, batch, drafts, authorization) => Promise<{started}>`
   * closure the delivery service expects. The starter owns the credential
   * resolution + fork; the delivery service owns the claim transaction.
   */
  toWorkerStarter(): (
    attemptId: number,
    batch: OutboundEmailDraftBatchEntity,
    drafts: ReadonlyArray<{
      draft: OutboundEmailDraftEntity;
      revision: OutboundEmailDraftRevisionEntity;
    }>,
    authorization: OutboundEmailAuthorizationEntity
  ) => Promise<WorkerStartResult> {
    return async (
      attemptId,
      batch,
      drafts,
      _authorization: OutboundEmailAuthorizationEntity
    ) => {
      void _authorization;
      const payload = await this.buildPayload(attemptId, batch, drafts);
      const child = this.forkWorker();

      // Attach the message listener BEFORE posting the payload. Electron's
      // utility-process MessagePort is a non-buffering EventEmitter: the worker
      // may emit synchronously on early failure paths (payload-invalid,
      // batch-too-large, hash-mismatch, duplicate-service) before any SMTP
      // await, so a listener attached after postMessage would drop those events
      // and strand the attempt in `sending`. Wiring first guarantees none are
      // lost.
      this.wireEventBridge(child, attemptId, batch.id);
      this.postPayload(child, payload);

      // Mark the attempt `sending` with the worker's pid + start time. This
      // happens AFTER the fork succeeds so a failed spawn doesn't record a
      // phantom pid. Any throw here propagates to the delivery service, which
      // records `worker_start_failed`.
      const deliveryModel = new OutboundEmailDeliveryModel(this.dbpath);
      await deliveryModel.updateAttemptStatus(attemptId, "sending", {
        workerPid: child.pid ?? null,
        workerStartedAt: new Date(),
      });

      return { started: true };
    };
  }

  // -- payload construction --------------------------------------------------

  /**
   * §15.2 — build the v2 authorized-envelopes payload. The envelope hash is the
   * revision's stored `contentHash` (the canonical envelope hash computed at
   * draft time); the sender address is the revision's frozen sender. Service
   * rows are deduped by id and carry decrypted credentials.
   */
  private async buildPayload(
    attemptId: number,
    batch: OutboundEmailDraftBatchEntity,
    drafts: ReadonlyArray<{
      draft: OutboundEmailDraftEntity;
      revision: OutboundEmailDraftRevisionEntity;
    }>
  ): Promise<AuthorizedEmailWorkerPayloadV2> {
    const envelopes: AuthorizedOutboundEnvelope[] = drafts.map(
      ({ draft, revision }) => ({
        draftId: draft.id,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        recipientAddress: revision.recipientAddress,
        emailServiceId: revision.emailServiceId,
        senderAddress: revision.senderAddress,
        subject: revision.subject,
        bodyText: revision.bodyText,
        bodyHtml: revision.bodyHtml,
        envelopeHash: revision.contentHash,
      })
    );

    const emailServices = await this.resolveEmailServices(drafts);

    const payload: AuthorizedEmailWorkerPayloadV2 = {
      version: 2,
      mode: "authorized_envelopes",
      batchId: batch.id,
      sendAttemptId: attemptId,
      batchHash: batch.batchHash ?? "",
      envelopes,
      emailServices,
    };
    return payload;
  }

  /**
   * Resolve the distinct email-service rows referenced across all revisions,
   * decrypting each once. A referenced service that cannot be loaded is a
   * definite pre-acceptance failure (§15.2): the batch cannot be sent without
   * its credentials, so throw `service_not_found` and let the delivery service
   * record `worker_start_failed` — never send with a missing service.
   */
  private async resolveEmailServices(
    drafts: ReadonlyArray<{
      draft: OutboundEmailDraftEntity;
      revision: OutboundEmailDraftRevisionEntity;
    }>
  ): Promise<EmailServiceEntitydata[]> {
    const distinctIds = Array.from(
      new Set(drafts.map((d) => d.revision.emailServiceId))
    );
    const resolved: EmailServiceEntitydata[] = [];
    for (const id of distinctIds) {
      const service = await this.credentialLoader(id);
      if (!service) {
        throw new Error(
          `service_not_found: email_service ${id} could not be loaded`
        );
      }
      resolved.push({
        id: service.id,
        from: service.from,
        password: service.password,
        host: service.host,
        port: service.port,
        name: service.name,
        ssl: service.ssl,
      });
    }
    return resolved;
  }

  // -- fork + event wiring ---------------------------------------------------

  /**
   * Fork `taskCode.js` (without posting the payload yet). Mirrors the reference
   * fork pattern in `buckEmailTaskModule` (resolve packaged path,
   * `utilityProcess.fork`). The caller attaches the message listener before
   * {@link postPayload} so no early worker event is dropped (§15.4 race fix).
   */
  private forkWorker(): ForkedChild {
    const { childPath, env } = this.resolveForkContext();
    return this.forkFn(childPath, [], {
      stdio: "pipe",
      execArgv: ["puppeteer-cluster:*"],
      env,
    });
  }

  /**
   * Post the `sendAuthorizedEmails` message over the forked child's MessagePort.
   * Electron's `UtilityProcess.postMessage` buffers until the child is ready, so
   * no `spawn` gate is needed (and a `spawn` gate would break test doubles that
   * never emit it).
   */
  private postPayload(
    child: ForkedChild,
    payload: AuthorizedEmailWorkerPayloadV2
  ): void {
    const { port } = this.resolveForkContext();
    child.postMessage(
      JSON.stringify({ action: "sendAuthorizedEmails", data: payload }),
      port ? [port] : []
    );
  }

  /**
   * Resolve the fork context: the entry path, an optional MessagePort to
   * transfer, and the worker env. When a fork is injected (tests), skip the
   * packaged-path resolution and Electron `app` access — the fake ignores both
   * and neither is available outside the Electron runtime.
   */
  private resolveForkContext(): {
    childPath: string;
    port: unknown;
    env: NodeJS.ProcessEnv;
  } {
    if (this.forkIsInjected) {
      return { childPath: "taskCode.js", port: null, env: process.env };
    }
    const childPath = resolveWorkerPath();
    if (!childPath) {
      const runtime = buildRuntime();
      const candidates = getPackagedWorkerPathCandidates(runtime, {
        dirnameRelativePaths: ["taskCode.js"],
        cwdRelativePaths: [path.join(".vite", "build", "taskCode.js")],
      });
      throw new Error(
        `taskCode_path_not_found. Tried: ${candidates.join(", ")}`
      );
    }
    const { port1, port2 } = new MessageChannelMain();
    void port2;
    const env = buildPackagedWorkerEnv({
      extraEnv: {
        ELECTRON_APP_NAME: app.getName(),
        ELECTRON_USER_DATA_PATH: app.getPath("userData"),
      },
    });
    return { childPath, port: port1, env };
  }

  /** True when a fork fn was explicitly injected (test mode). */
  private get forkIsInjected(): boolean {
    return this.forkFn !== defaultFork;
  }

  /**
   * Wire `child.on("message")` to the worker-event bridge. Each message is
   * parsed with `parseChildMessage`; only `OutboundEmailDeliveryEvent` actions
   * are forwarded (the worker also posts legacy `EmailSendSuccess` etc. for
   * other flows). The bridge correlates, persists, and broadcasts — it never
   * throws on a correlation failure.
   */
  private wireEventBridge(
    child: ForkedChild,
    attemptId: number,
    batchId: number
  ): void {
    const bridge = new OutboundEmailWorkerEventBridge(this.dbpath, {
      onBroadcast: broadcastOutboundEmailProgress,
    });
    const onMessage = (message: unknown): void => {
      const parsed = parseChildMessage<AuthorizedEmailWorkerEvent>(message);
      if (parsed.kind === "error") {
        incrementOutboundMetric("worker_message_parse_error", {
          reason: parsed.reason,
        });
        return;
      }
      const { action, data } = parsed.data;
      if (action !== "OutboundEmailDeliveryEvent" || !data) {
        // Not a delivery event — ignore silently (legacy email-send messages).
        return;
      }
      bridge.handleEvent(data).catch((error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(
          `[outbound-starter] bridge.handleEvent failed for attempt ${attemptId} batch ${batchId}: ${msg}`
        );
      });
    };
    child.on("message", onMessage);
  }
}

// -- module-private defaults -----------------------------------------------

/**
 * Production fork: `utilityProcess.fork`. Cast to `ForkedChild` because
 * Electron's `UtilityProcess` has the needed surface but a richer type; we only
 * use `pid`, `postMessage`, `on`, `off`, and `kill`.
 */
const defaultFork: ForkFn = (modulePath, args, options) => {
  const child = utilityProcess.fork(
    modulePath,
    args,
    options as Parameters<typeof utilityProcess.fork>[2]
  );
  return child as unknown as ForkedChild;
};

/**
 * Production credential loader: decrypts via `EmailServiceModule.getEmailService`
 * (FieldCipher AES-256-GCM). Returns `undefined` when the row doesn't exist.
 */
const defaultCredentialLoader: CredentialLoader = (id) =>
  new EmailServiceModule().getEmailService(id);

/** Build the packaged-worker-path runtime from the live process. */
function buildRuntime(): PackagedWorkerPathRuntime {
  const electronProcess = process as NodeJS.Process & {
    resourcesPath?: string;
  };
  return {
    dirname: __dirname,
    cwd: process.cwd(),
    resourcesPath: electronProcess.resourcesPath,
    existsSync: fs.existsSync,
  };
}

/** Resolve the taskCode.js entry path (dev + packaged). */
function resolveWorkerPath(): string | null {
  return resolvePackagedWorkerPath(buildRuntime(), {
    dirnameRelativePaths: ["taskCode.js"],
    cwdRelativePaths: [path.join(".vite", "build", "taskCode.js")],
  });
}
