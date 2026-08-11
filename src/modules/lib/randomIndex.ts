/**
 * Cryptographically secure uniform index selection.
 *
 * Replaces `Math.floor(Math.random() * arr.length)`, which CodeQL flags as
 * `js/insecure-randomness`: `Math.random` is not cryptographically secure and
 * its output can be predicted, which matters when the index selects an
 * account/proxy/credential for a scrape request.
 */
import { randomInt } from "node:crypto";

/**
 * Returns a uniformly distributed integer in `[0, length)`.
 *
 * Uses `crypto.randomInt`, which draws from the OS CSPRNG and avoids modulo
 * bias. Returns 0 for a single-element array. Throws when `length <= 0`
 * (mirror `crypto.randomInt` semantics) — callers must guard against empty
 * arrays before calling.
 */
export function pickRandomIndex(length: number): number {
  if (length <= 0) {
    throw new RangeError(
      `pickRandomIndex requires a positive length, received ${length}`
    );
  }
  // crypto.randomInt(max) returns an int in [0, max).
  return randomInt(length);
}