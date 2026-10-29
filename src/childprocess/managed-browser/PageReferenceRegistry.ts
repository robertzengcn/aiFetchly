import { MANAGED_BROWSER_REFERENCE_REGISTRY } from "@/config/managedBrowser";

/**
 * Page reference registry (technical design §14.3).
 *
 * Stores `ref -> element handle` ONLY inside the worker. Refs are opaque
 * random tokens (`e_7q3m2k`), never selectors. Every entry is bound to the
 * page revision that produced it; any navigation, reload, or registry reset
 * invalidates all refs (FR-TOOL-001..003).
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

function randomRefSuffix(length = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export class PageReferenceRegistry<
  TElement extends DisposableElement = DisposableElement
> {
  private readonly entries = new Map<string, ReferenceEntry<TElement>>();
  private revision: number;
  private readonly now: () => number;

  constructor(initialRevision = 1, now: () => number = Date.now) {
    this.revision = initialRevision;
    this.now = now;
  }

  public get currentRevision(): number {
    return this.revision;
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
      // Drop the oldest entry to stay bounded.
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
    return ref;
  }

  /**
   * Look up a ref, optionally requiring the revision that produced it.
   * Compares role/name before action to reduce wrong-target clicks.
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
    if (
      this.now() - entry.createdAt >
      MANAGED_BROWSER_REFERENCE_REGISTRY.entryTtlMs
    ) {
      this.voidEntry(ref);
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
    this.revision = nextRevision;
    return this.revision;
  }

  /** Drop expired entries proactively. */
  public expire(): void {
    const now = this.now();
    for (const [ref, entry] of this.entries) {
      if (
        now - entry.createdAt >
        MANAGED_BROWSER_REFERENCE_REGISTRY.entryTtlMs
      ) {
        this.voidEntry(ref);
      }
    }
  }

  public get size(): number {
    return this.entries.size;
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
