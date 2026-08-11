/**
 * Engine rejection model.
 *
 * The canonical simulation never throws to signal a refused command, and it
 * never invents a value to keep a happy path alive. A command is either applied
 * exactly, or it is refused with a stable code that a UI, a ghost replay, and a
 * test can all branch on identically.
 */

/**
 * Stable, serializable rejection codes. These are part of the engine's public
 * contract: they appear in logs, in ghost desynchronization records, and in
 * user-facing copy lookup, so they are versioned like a schema rather than
 * reworded freely.
 */
export const ENGINE_REJECTION_CODES = [
  /** The submitted value is not a command this engine version understands. */
  "COMMAND_MALFORMED",
  /** The command names an actor, object, or switch that does not exist. */
  "SUBJECT_UNKNOWN",
  /** The move would leave the authored room bounds. */
  "OUT_OF_BOUNDS",
  /** The destination tile is solid. */
  "BLOCKED_BY_TERRAIN",
  /** The destination tile is occupied by another body. */
  "BLOCKED_BY_OCCUPANT",
  /** A push was attempted against something that cannot be pushed. */
  "NOT_PUSHABLE",
  /** The actor is not adjacent to the switch it tried to toggle. */
  "OUT_OF_REACH",
  /** The room has already resolved; it accepts no further commands. */
  "ROOM_ALREADY_RESOLVED",
] as const;

export type EngineRejectionCode = (typeof ENGINE_REJECTION_CODES)[number];

/**
 * Whether re-issuing the identical command against the identical state could
 * ever succeed. It cannot: the reducer is pure, so an identical retry is
 * guaranteed to be refused identically. This field exists because callers must
 * classify every failure, and recording "never" explicitly is more honest than
 * omitting the question.
 */
export type EngineRetryability = "never-with-identical-input";

export interface EngineRejection {
  readonly ok: false;
  readonly code: EngineRejectionCode;
  /** Safe to show a player: no identifiers, paths, or internal state. */
  readonly message: string;
  /** Diagnostic detail for logs and tests; never rendered to a player. */
  readonly context: Readonly<Record<string, string | number>>;
  readonly retryability: EngineRetryability;
}

const SAFE_MESSAGES: Readonly<Record<EngineRejectionCode, string>> = {
  COMMAND_MALFORMED: "That action is not something this room understands.",
  SUBJECT_UNKNOWN: "That thing is not in this room.",
  OUT_OF_BOUNDS: "The room ends there.",
  BLOCKED_BY_TERRAIN: "Something solid is in the way.",
  BLOCKED_BY_OCCUPANT: "Someone is already standing there.",
  NOT_PUSHABLE: "That will not move.",
  OUT_OF_REACH: "That is too far away to reach.",
  ROOM_ALREADY_RESOLVED: "This room is already finished.",
};

export function rejection(
  code: EngineRejectionCode,
  context: Readonly<Record<string, string | number>> = {},
): EngineRejection {
  return Object.freeze({
    ok: false,
    code,
    message: SAFE_MESSAGES[code],
    context: Object.freeze({ ...context }),
    retryability: "never-with-identical-input",
  });
}
