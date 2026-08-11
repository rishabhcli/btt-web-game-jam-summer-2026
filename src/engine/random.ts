/**
 * Seeded, serializable randomness.
 *
 * Invariant I2 requires that the same state, command, and seed always produce
 * the same hash. That is only achievable if randomness is part of canonical
 * state rather than drawn from the host. This module therefore exposes a pure
 * generator whose entire state is one 32-bit integer that is serialized with
 * the world, and the ownership boundary check forbids `Math.random` and
 * `crypto` anywhere in the pure packages so no other source can be used.
 *
 * Algorithm: SplitMix32. Chosen because every step is expressible with the
 * integer-only `Math` allowlist and `Math.imul`, so it produces bit-identical
 * results on every JavaScript engine without relying on floating point.
 */

import type { CanonicalValue } from "./canonical.js";

const UINT32_MODULUS = 0x1_0000_0000;
const GOLDEN_GAMMA = 0x9e37_79b9;

/** The complete generator state. Serialize this, not the generator object. */
export interface RandomState {
  readonly schemaVersion: 1;
  /** Unsigned 32-bit counter. */
  readonly seed: number;
}

export interface RandomDraw {
  readonly next: RandomState;
  /** Unsigned 32-bit result. */
  readonly value: number;
}

function toUint32(value: number): number {
  return value >>> 0;
}

/**
 * Ingestion guard for a generator state that came from outside the engine — a
 * saved game, a replayed branch, a test fixture. The parameter is `unknown`
 * because a compile-time type is not evidence about a value that was parsed
 * from storage.
 */
export function isRandomState(value: unknown): value is RandomState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { schemaVersion?: unknown; seed?: unknown };
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.seed === "number" &&
    Number.isSafeInteger(candidate.seed) &&
    candidate.seed >= 0 &&
    candidate.seed < UINT32_MODULUS
  );
}

/**
 * Build a generator state from any 32-bit seed. Seeds are authored per room and
 * committed, never sampled from the host.
 */
export function createRandomState(seed: number): RandomState {
  return Object.freeze({ schemaVersion: 1, seed: toUint32(seed) });
}

/**
 * Advance the generator once and return both the next state and the drawn
 * value. There is deliberately no in-place variant: a caller that forgets to
 * thread the next state would silently reuse a draw, which is exactly the class
 * of bug invariant I2 exists to prevent.
 */
export function nextRandom(state: RandomState): RandomDraw {
  const advanced = toUint32(state.seed + GOLDEN_GAMMA);
  let mixed = advanced;
  mixed = toUint32(Math.imul(mixed ^ (mixed >>> 16), 0x21f0_aaad));
  mixed = toUint32(Math.imul(mixed ^ (mixed >>> 15), 0x735a_2d97));
  mixed = toUint32(mixed ^ (mixed >>> 15));
  return Object.freeze({
    next: Object.freeze({ schemaVersion: 1 as const, seed: advanced }),
    value: mixed,
  });
}

/**
 * Project the generator state into the canonical value model.
 *
 * Every piece of canonical state needs an explicit projection rather than being
 * passed to the serializer directly: it forces each new field to be a deliberate
 * addition to the hashed contract instead of leaking in because a type happened
 * to be structurally compatible.
 */
export function randomStateToCanonical(state: RandomState): CanonicalValue {
  return { schemaVersion: state.schemaVersion, seed: state.seed };
}
