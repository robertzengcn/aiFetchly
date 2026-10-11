/**
 * GroundingAdapterRegistry — the compile-time map from approved adapter IDs
 * to app-bundled implementations (design §5.9.1).
 *
 * Catalog metadata can NEVER introduce executable adapters: a model package
 * resolves only through an ID present in this table, and the worker rejects
 * every other ID with `adapter_not_found`. Adding an architecture requires
 * a host implementation and an app release (D-27, §7.4).
 */
import type { GroundingAdapterCapabilities } from "@/entityTypes/computerUseTypes";
import { GuiActorOnnxAdapter } from "@/childprocess/computer-use/grounding/GuiActorOnnxAdapter";
import {
  TestGroundingAdapter,
  TEST_GROUNDING_ADAPTER_ID,
} from "@/childprocess/computer-use/grounding/TestGroundingAdapter";
import type { GroundingModelAdapter } from "@/childprocess/computer-use/grounding/GroundingModelAdapter";

export const GROUNDING_ADAPTER_IDS = [
  "gui-actor-onnx",
  TEST_GROUNDING_ADAPTER_ID,
] as const;

export type GroundingAdapterId = (typeof GROUNDING_ADAPTER_IDS)[number];

type AdapterConstructor = new () => GroundingModelAdapter;

const REGISTRY: Record<GroundingAdapterId, AdapterConstructor> = {
  "gui-actor-onnx": GuiActorOnnxAdapter,
  [TEST_GROUNDING_ADAPTER_ID]: TestGroundingAdapter,
};

/** Static capability table for selection/compatibility checks (§5.9.3). */
export function capabilitiesOf(
  adapterId: string
): GroundingAdapterCapabilities | null {
  const constructor = REGISTRY[adapterId as GroundingAdapterId];
  if (!constructor) return null;
  // Capabilities are static constants on every adapter implementation.
  return (new constructor() as unknown as {
    capabilities: GroundingAdapterCapabilities;
  }).capabilities;
}

/** Instantiate a registered adapter, or null for an unknown id. */
export function createAdapter(adapterId: string): GroundingModelAdapter | null {
  const constructor = REGISTRY[adapterId as GroundingAdapterId];
  return constructor ? new constructor() : null;
}

/** Whether this app build knows the adapter at all. */
export function isRegisteredAdapter(adapterId: string): boolean {
  return adapterId in REGISTRY;
}
