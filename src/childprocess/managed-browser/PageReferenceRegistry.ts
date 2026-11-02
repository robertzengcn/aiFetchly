import { MANAGED_BROWSER_REFERENCE_REGISTRY } from "@/config/managedBrowser";

/**
 * Page reference registry (technical design §14.3, §7.2).
 *
 * Stores `ref -> element handle` ONLY inside the worker. Refs are opaque
 * random tokens (`e_7q3m2k`), never selectors. Every entry is bound to the
 * page revision that produced it; any navigation, reload, or registry reset
 * invalidates all refs (FR-TOOL-001..003).
 *
 * PRD D-FR-15a: refs are scoped per observation epoch. Whole observations are
 * evicted (never part of one), observations referenced by pending decisions,
 * approvals, or handoffs can be PINNED, and a pinned observation's TTL runs
 * from the moment it is unpinned — so a 5-minute approval wait or a 60-minute
 * handoff can no longer evict the refs a pending action needs.
 *
 * Element handles are an opaque type parameter at this layer so the registry
 * is unit-testable without Puppeteer.
 */

export interface ReferenceEntry<TElement> {
  readonly ref: string;
  readonly element: TElement;
  readonly pageRevision: number;
  readonly role: string;
  readonly name: string;
  readonly frameId: string | null;
  readonly createdAt: number;
}

export type LookupResult<TElement> =
  | { readonly status: "ok"; readonly entry: ReferenceEntry<TElement> }
  | { readonly status: "stale_revision"; readonly currentRevision: number }
  | { readonly status: "unknown_ref" }
  | { readonly status: "expired" };

export interface DisposableElement {
  dispose(): Promise<void>;
}

/** Bucket of refs produced by ONE observation snapshot (one epoch). */
interface ObservationBucket {
  readonly observationId: string;
  readonly refs: Set<string>;
  /** Pending observations are treated as pinned until committed. */
  committedAt: number | null;
  pinned: boolean;
  createdAt: number;
}

function randomRefSuffix(length = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/** Anonymous bucket for callers that never open an observation epoch. */
const LEGACY_BUCKET_ID = "legacy";

export class PageReferenceRegistry<
  TElement extends DisposableElement = DisposableElement
> {
  private readonly entries = new Map<string, ReferenceEntry<TElement>>();
  private readonly observations = new Map<string, ObservationBucket>();
  private revision: number;
  private readonly now: () => number;
  private currentObservationId: string | null = null;

  constructor(initialRevision = 1, now: () => number = Date.now) {
    this.revision = initialRevision;
    this.now = now;
  }

  public get currentRevision(): number {
    return this.revision;
  }

  /**
   * Open an observation epoch: every register() call until commitObservation
   * files its ref under this observation id. A pending (uncommitted)
   * observation is implicitly pinned — its refs survive until commit.
   */
  public beginObservation(observationId: string): void {
    this.expire();
    this.currentObservationId = observationId;
    if (!this.observations.has(observationId)) {
      this.observations.set(observationId, {
        observationId,
        refs: new Set<string>(),
        committedAt: null,
        pinned: false,
        createdAt: this.now(),
      });
    }
    this.enforceObservationBounds();
  }

  /** Mark an observation epoch complete: its unpinned TTL starts now. */
  public commitObservation(observationId: string): void {
    const bucket = this.observations.get(observationId);
    if (bucket && bucket.committedAt === null) {
      bucket.committedAt = this.now();
    }
    if (this.currentObservationId === observationId) {
      this.currentObservationId = null;
    }
    this.enforceObservationBounds();
  }

  /** Keep an observation's refs alive across pending approvals/handoffs. */
  public pinObservation(observationId: string): boolean {
    const bucket = this.observations.get(observationId);
    if (!bucket) {
      return false;
    }
    bucket.pinned = true;
    return true;
  }

  /** Unpin: the observation's unpinned TTL restarts from now. */
  public unpinObservation(observationId: string): boolean {
    const bucket = this.observations.get(observationId);
    if (!bucket) {
      return false;
    }
    bucket.pinned = false;
    // The unpinned TTL restarts from now (technical design 7.2).
    bucket.committedAt = this.now();
    this.enforceObservationBounds();
    return true;
  }

  /** Register an element and return its opaque ref for this revision. */
  public register(input: {
    element: TElement;
    role: string;
    name: string;
    frameId?: string | null;
  }): string {
    this.expire();
    if (this.entries.size >= MANAGED_BROWSER_REFERENCE_REGISTRY.maxEntries) {
      // Drop the oldest entry to stay bounded (never splits an observation:
      // voidEntry removes the ref from its bucket, and the bounds sweep will
      // evict that whole observation next).
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.voidEntry(oldest);
      }
    }
    const ref = `e_${randomRefSuffix()}`;
    this.entries.set(ref, {
      ref,
      element: input.element,
      pageRevision: this.revision,
      role: input.role,
      name: input.name,
      frameId: input.frameId ?? null,
      createdAt: this.now(),
    });
    const observationId = this.currentObservationId ?? LEGACY_BUCKET_ID;
    let bucket = this.observations.get(observationId);
    if (!bucket) {
      bucket = {
        observationId,
        refs: new Set<string>(),
        committedAt: observationId === LEGACY_BUCKET_ID ? this.now() : null,
        pinned: false,
        createdAt: this.now(),
      };
      this.observations.set(observationId, bucket);
    }
    bucket.refs.add(ref);
    return ref;
  }

  /**
   * Look up a ref, optionally requiring the revision that produced it.
   * Compares role/name before action to reduce wrong-target clicks. Pinned
   * and pending observations never expire here.
   */
  public lookup(
    ref: string,
    expectedRevision?: number,
    expectFingerprint?: { readonly role: string; readonly name: string }
  ): LookupResult<TElement> {
    if (expectedRevision != null && expectedRevision !== this.revision) {
      return { status: "stale_revision", currentRevision: this.revision };
    }
    const entry = this.entries.get(ref);
    if (!entry) {
      return { status: "unknown_ref" };
    }
    const bucket = this.bucketOfRef(ref);
    const pinnedOrPending =
      bucket === null || bucket.pinned || bucket.committedAt === null;
    // The whole observation shares one TTL anchor: its commit time (or
    // registration for legacy callers). Unpinning restarts that anchor.
    if (
      !pinnedOrPending &&
      bucket !== null &&
      this.now() - (bucket.committedAt ?? entry.createdAt) >
        MANAGED_BROWSER_REFERENCE_REGISTRY.entryTtlMs
    ) {
      this.voidObservation(bucket.observationId);
      return { status: "expired" };
    }
    if (
      expectFingerprint &&
      (expectFingerprint.role !== entry.role ||
        expectFingerprint.name !== entry.name)
    ) {
      return { status: "unknown_ref" };
    }
    return { status: "ok", entry };
  }

  /** Invalidate all refs and dispose handles (navigation/reload). */
  public reset(nextRevision: number): number {
    for (const ref of [...this.entries.keys()]) {
      this.voidEntry(ref);
    }
    this.observations.clear();
    this.currentObservationId = null;
    this.revision = nextRevision;
    return this.revision;
  }

  /** Drop expired observations (whole observations, never parts). */
  public expire(): void {
    const ttl = MANAGED_BROWSER_REFERENCE_REGISTRY.entryTtlMs;
    const now = this.now();
    for (const bucket of [...this.observations.values()]) {
      if (bucket.pinned || bucket.committedAt === null) {
        continue;
      }
      if (now - bucket.committedAt > ttl) {
        this.voidObservation(bucket.observationId);
      }
    }
    this.enforceObservationBounds();
  }

  public get size(): number {
    return this.entries.size;
  }

  /** Number of live observation epochs (test/introspection seam). */
  public get observationCount(): number {
    return this.observations.size;
  }

  public isPinned(observationId: string): boolean {
    const bucket = this.observations.get(observationId);
    return bucket?.pinned === true;
  }

  private bucketOfRef(ref: string): ObservationBucket | null {
    for (const bucket of this.observations.values()) {
      if (bucket.refs.has(ref)) {
        return bucket;
      }
    }
    return null;
  }

  /**
   * PRD D-FR-15a bounds: at most MAX_UNPINNED_OBSERVATIONS committed
   * unpinned observations (oldest evicted whole), and a hard total cap.
   * Pinned observations are never evicted by these bounds.
   */
  private enforceObservationBounds(): void {
    const unpinned = [...this.observations.values()]
      .filter((b) => !b.pinned && b.committedAt !== null)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (
      let i = 0;
      i + MANAGED_BROWSER_REFERENCE_REGISTRY.maxUnpinnedObservations <
      unpinned.length;
      i++
    ) {
      this.voidObservation(unpinned[i].observationId);
    }
    if (this.observations.size <= MANAGED_BROWSER_REFERENCE_REGISTRY.maxObservations) {
      return;
    }
    const droppable = [...this.observations.values()]
      .filter((b) => !b.pinned && b.committedAt !== null && b.observationId !== this.currentObservationId)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const bucket of droppable) {
      if (this.observations.size <= MANAGED_BROWSER_REFERENCE_REGISTRY.maxObservations) {
        break;
      }
      this.voidObservation(bucket.observationId);
    }
  }

  private voidObservation(observationId: string): void {
    const bucket = this.observations.get(observationId);
    if (!bucket) {
      return;
    }
    this.observations.delete(observationId);
    for (const ref of bucket.refs) {
      this.voidEntry(ref);
    }
  }

  private voidEntry(ref: string): void {
    const entry = this.entries.get(ref);
    this.entries.delete(ref);
    if (entry) {
      void entry.element.dispose().catch(() => {
        /* disposal best-effort */
      });
    }
  }
}
