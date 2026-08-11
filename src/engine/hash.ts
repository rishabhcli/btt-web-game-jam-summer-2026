/**
 * Canonical state hashing.
 *
 * This is the machine-checkable form of invariant I2: the same state, command,
 * and seed always produce the same hash. Every rewind, branch replay, snapshot
 * restore, and cross-browser determinism test compares these strings, so the
 * algorithm is versioned and must never change silently.
 *
 * Algorithm: FNV-1a over the UTF-8 bytes of the canonical serialization,
 * computed as two interleaved 32-bit lanes so the whole computation stays
 * inside the integer-only `Math` allowlist that the ownership boundary permits.
 * The result is rendered as `v1:` plus 16 lowercase hex digits.
 */

import { canonicalize, type CanonicalValue } from "./canonical.js";

export const STATE_HASH_ALGORITHM = "fnv1a64-canonical-json";
export const STATE_HASH_VERSION = 1;

const OFFSET_BASIS_HIGH = 0xcbf2_9ce4;
const OFFSET_BASIS_LOW = 0x8422_2325;
// The 64-bit FNV prime is 0x100000001b3 == 2^40 + 0x1b3, so a multiply splits
// into `hash * 0x1b3` plus `hash * 2^40`, both computable in 32-bit lanes.
const PRIME_LOW = 0x0000_01b3;
const TWO_POW_32 = 0x1_0000_0000;

/**
 * Encode a JavaScript string to UTF-8 bytes without `TextEncoder`. Doing it
 * explicitly keeps the hash independent of any host encoder behaviour and makes
 * lone-surrogate handling an authored decision rather than an inherited one.
 */
function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (
      codePoint >= 0xd800 &&
      codePoint <= 0xdbff &&
      index + 1 < value.length
    ) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = (codePoint - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        index += 1;
      }
    }
    // A lone surrogate is replaced rather than emitted, matching the WHATWG
    // encoder, so an unpaired half can never make the hash host-dependent.
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) codePoint = 0xfffd;

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

function toHex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

/** FNV-1a 64 over bytes, carried through two 32-bit lanes. */
function fnv1a64(bytes: readonly number[]): string {
  let high = OFFSET_BASIS_HIGH;
  let low = OFFSET_BASIS_LOW;
  for (const byte of bytes) {
    low = (low ^ byte) >>> 0;

    // hash * 0x1b3: the low lane keeps 32 bits and carries the rest upward.
    // `low * PRIME_LOW` stays below 2^41, so the product and its carry are
    // exact in a double and never need floating-point rounding.
    const nextLow = Math.imul(low, PRIME_LOW) >>> 0;
    const carry = Math.floor((low * PRIME_LOW) / TWO_POW_32);
    // hash * 2^40 (mod 2^64) contributes nothing to the low lane and exactly
    // `low << 8` to the high lane, because the old high lane shifts past 2^64.
    const nextHigh =
      (Math.imul(high, PRIME_LOW) + carry + ((low << 8) >>> 0)) >>> 0;
    low = nextLow;
    high = nextHigh;
  }
  return `${toHex32(high)}${toHex32(low)}`;
}

/**
 * Hash any canonical value. The version prefix is part of the string so a
 * persisted hash can never be compared against one produced by a different
 * algorithm without the mismatch being obvious.
 */
export function hashCanonical(value: CanonicalValue): string {
  return `v${String(STATE_HASH_VERSION)}:${fnv1a64(utf8Bytes(canonicalize(value)))}`;
}
