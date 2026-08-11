/**
 * Canonical serialization.
 *
 * `JSON.stringify` preserves object insertion order, so two structurally equal
 * states authored in different orders would serialize differently and hash
 * differently. Invariant I2 requires the opposite, so this module defines one
 * total order over a restricted value model and refuses everything outside it.
 *
 * The restriction is the point: a value that cannot be canonically serialized
 * must never reach canonical state, and finding out at serialization time is
 * far too late if the reducer already accepted it.
 */

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export class CanonicalSerializationError extends Error {
  public readonly code = "CANONICAL_VALUE_UNSUPPORTED";
  public readonly path: string;

  public constructor(message: string, path: string) {
    super(`CANONICAL_VALUE_UNSUPPORTED at ${path}: ${message}`);
    this.name = "CanonicalSerializationError";
    this.path = path;
  }
}

/**
 * Compare by UTF-16 code unit. `localeCompare` is prohibited in pure packages
 * because its result depends on host locale data, which would make the hash
 * differ between a developer machine and a player's browser.
 */
function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function quote(value: string): string {
  let out = '"';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (character === '"') out += '\\"';
    else if (character === "\\") out += "\\\\";
    else if (character === "\n") out += "\\n";
    else if (character === "\r") out += "\\r";
    else if (character === "\t") out += "\\t";
    else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else out += character;
  }
  return `${out}"`;
}

function writeNumber(value: number, path: string): string {
  // Only exact integers are admitted. Floating point is excluded outright
  // because its last bit can differ across engines, and grid coordinates are
  // integers by design (see ADR-0001).
  if (!Number.isSafeInteger(value)) {
    throw new CanonicalSerializationError(
      "only safe integers may enter canonical state",
      path,
    );
  }
  // `-0` and `0` are the same integer but stringify differently.
  return value === 0 ? "0" : String(value);
}

function isCanonicalArray(
  value: CanonicalValue,
): value is readonly CanonicalValue[] {
  return Array.isArray(value);
}

function write(value: CanonicalValue, path: string): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return writeNumber(value, path);
  if (typeof value === "string") return quote(value);
  if (isCanonicalArray(value)) {
    return `[${value
      .map((entry, index) => write(entry, `${path}[${String(index)}]`))
      .join(",")}]`;
  }
  const keys = Object.keys(value).sort(compareCodeUnits);
  return `{${keys
    .map((key) => {
      const entry = value[key];
      if (entry === undefined) {
        throw new CanonicalSerializationError(
          "undefined has no canonical form; omit the key or use null",
          `${path}.${key}`,
        );
      }
      return `${quote(key)}:${write(entry, `${path}.${key}`)}`;
    })
    .join(",")}}`;
}

/**
 * Serialize a canonical value to its single canonical string form. Structurally
 * equal inputs always produce byte-identical output regardless of key order.
 */
export function canonicalize(value: CanonicalValue): string {
  return write(value, "$");
}
