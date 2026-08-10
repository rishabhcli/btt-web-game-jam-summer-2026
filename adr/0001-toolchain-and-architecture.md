# ADR-0001: Toolchain and deterministic client architecture

- **Status:** Accepted for implementation; not yet verified in a release
- **Decision date:** 2026-08-09
- **Scope:** Tier 0 foundation, client architecture, rendering, persistence, and
  verification
- **Production status:** Not yet in production

## Context

The product contract requires a static, browser-native puzzle game in which
native Back and Forward navigation operates on a deterministic world. The
browser will discard its native forward stack when a player branches, so
correctness cannot be delegated to rendering state, a game framework scene
graph, or the History API. The repository also needs a strict, reproducible
command surface before feature work starts.

This decision records the initial architecture. It does not claim that the
toolchain, dependencies, browser behavior, deployment, or release gates have
been verified. Those claims require lockfile, test, clean-checkout, and
production evidence that does not exist yet.

## Decision drivers

1. Preserve all seven domain invariants in `AGENTS.md` as enforceable contracts.
2. Make reducer and replay behavior testable without a browser or renderer.
3. Exercise real History API, IndexedDB, refresh, and BFCache behavior in real
   browser engines.
4. Keep the deployed artifact static and keep save data local.
5. Keep rendering replaceable and non-authoritative.
6. Make unsupported and failure states explicit rather than silently changing
   the game mechanic.
7. Keep dependency, bundle, licensing, and supply-chain cost measurable.

## Decision

### Toolchain and package contract

- Use **TypeScript** with the strictest practical compiler settings from the
  first implementation: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noPropertyAccessFromIndexSignature`, `useUnknownInCatchVariables`, and
  `noFallthroughCasesInSwitch`. Production code may not use unchecked `any` as a
  boundary escape hatch.
- Use **Vite** to build a static ESM browser artifact. Vite is build and local
  development infrastructure, not a source of gameplay state.
- Use **npm** with `package-lock.json`; clean environments install with
  `npm ci`. CI, `.nvmrc`, package engines, bootstrap, and canonical verification
  all require Node.js 24.19.0 and npm 11.17.0 exactly. Direct dependency
  versions are pinned in package metadata and the lockfile. Runtime upgrades are
  explicit lockstep changes with regenerated evidence, never a silently wider
  semver range.
- Use ESLint plus TypeScript-aware rules for source policy, Prettier for stable
  formatting, and an AST-based boundary check built on the existing TypeScript
  compiler API. Boundary enforcement must fail verification rather than rely on
  review convention.
- Keep one public command for each required operation and one `verify-all`
  composition. A command is not advertised as passing until it has actually run
  from the relevant checkout.

### Runtime architecture

- Use **PixiJS** as the Canvas/WebGL rendering adapter. PixiJS receives
  immutable render projections and emitted domain events; Pixi display objects,
  frame time, tweens, particles, and interpolation can never become canonical
  game state.
- Keep the canonical model in a pure **TypeScript command reducer**. A
  versioned, serializable `WorldState`, a versioned serializable command, and an
  explicit seed are the only inputs that may change canonical state. The result
  includes the next state and typed events.
- Use integer or fixed-step domain values and stable entity ordering. State
  serialization and hashing must be canonical and algorithm-versioned before any
  save format is treated as compatible.
- Maintain the branch graph as game authority. `history.pushState` stores only a
  small opaque, versioned node identifier. The game captures a discarded suffix
  in its own graph before a new native history entry destroys the browser's
  forward stack.
- Use **IndexedDB** for versioned branch nodes, snapshots, local progression,
  and settings. Access goes through a narrow persistence adapter; browser
  database objects never enter the domain. A thin `idb` wrapper is preferred
  over a larger object-mapping framework, subject to lockfile review.
- Use a runtime schema library at browser and persistence ingestion boundaries.
  The initial choice is **Zod**, subject to exact-version lockfile and bundle
  review. Parsed domain values, rather than Zod objects or unvalidated records,
  cross the boundary.
- Use the native **Web Audio API** behind an audio adapter. Audio begins only
  after user interaction and every audio-only cue has a visual equivalent.
- Keep semantic HTML controls, status, help, and non-visual equivalents outside
  the canvas. Canvas is a view, not the sole accessibility surface.

### Ownership and allowed dependency direction

The composition root may assemble all adapters. Every other dependency points
inward toward explicit domain contracts:

```text
input-accessibility ----> typed domain ports <---- history + persistence
                                 |
                                 v
levels ----------------> engine <--------------- ghosts
                                 |
                        immutable projections/events
                                 |
                      render (PixiJS) + audio (Web Audio)
```

The following rules are build failures:

- `src/engine` imports no browser global, persistence API, PixiJS object, audio
  object, framework state, or application composition code.
- `src/levels` contains data and validated level contracts; it does not mutate
  runtime engine state.
- `src/ghosts` executes recorded domain commands through declared preconditions;
  it does not import rendering or path-correction behavior.
- `src/history` translates browser navigation and persistence records into
  validated application requests; it does not reimplement reducer policy.
- `src/render`, `src/audio`, and `src/input-accessibility` depend on ports or
  immutable projections. Domain packages do not depend back on them.
- Third-party SDK values stop at their adapter. No catch-all `utils` module or
  circular ownership edge is allowed.

### Verification architecture

- Use **Vitest** for deterministic unit and module integration tests.
- Use **fast-check** for command-state-machine, serialization, replay, snapshot,
  and invariant property tests. Every randomized run records a reproducible seed
  and the configured case count.
- Use **Playwright** for real-browser History API, IndexedDB, refresh, BFCache,
  navigation-spam, input, accessibility, and recovery flows. The test web server
  binds only to `127.0.0.1:4142` under the repository's reserved port contract.
- Use axe through the Playwright adapter for automated accessibility rules while
  retaining manual keyboard, screen-reader, zoom, reduced-motion, and
  color-vision checks as distinct evidence.
- Keep a headless room solver or correctness oracle independent of PixiJS so
  room completion and renderer non-authority can be tested without a canvas.
- Treat browser-engine and physical-device results separately. An emulated
  viewport is not evidence of a mobile browser gesture or device performance.

## Failure model

| Failure                                                      | Required behavior                                                                                                               | Prohibited behavior                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| History API absent, restricted, or behaviorally incompatible | Enter a designed unsupported state, explain the mechanic limitation, and permit leaving the page                                | Cosmetic in-game undo presented as native history support      |
| Rapid or overlapping `popstate` events                       | Freeze new commands, coalesce deterministically to the final requested graph node, then install one canonical state             | Applying concurrent transitions in arrival-frame order         |
| IndexedDB unavailable or quota exceeded                      | Refuse durable-save claims and enter a visible session-only mode when safe                                                      | Reporting a saved state that was not durably written           |
| Persisted record is malformed or from an unsupported schema  | Quarantine or reject the record with a stable error; preserve recoverable raw data and offer a safe reset path                  | Partially hydrating malformed state                            |
| Crash/reload while creating a branch                         | Recover through an atomic/versioned persistence protocol and either expose the old branch or a declared recovery state          | Losing the suffix silently or inventing a branch               |
| Replay hash mismatch                                         | Stop accepting canonical actions for that timeline, retain diagnostic identifiers, and expose a truthful recovery/refusal state | Continuing from whichever state looks plausible                |
| Ghost precondition failure                                   | Transition the ghost to visible `desynchronized` state at the failed command                                                    | Teleporting, retargeting, pathfinding, or skipping the command |
| Renderer initialization or context failure                   | Preserve canonical state and show an accessible error/fallback surface                                                          | Making the renderer's partial scene authoritative              |
| Audio context blocked or suspended                           | Keep gameplay correct, show visual equivalents, and expose mute/audio status                                                    | Autoplay retries or missing gameplay information               |
| Two tabs share a database                                    | Detect ownership/version conflicts and follow an explicitly tested policy before writes                                         | Last-writer-wins corruption hidden from either tab             |

Stable error codes, safe messages, retryability, correlation identifiers, and
redacted internal context are part of each boundary contract, not later polish.

## Persistence and migration

IndexedDB is the only authoritative persistent owner for local save state. The
schema must have an explicit integer version, migration functions, and a tested
rollback or roll-forward recovery policy. Browser history entries remain small
references, so clearing local storage can make an entry unavailable; that case
is a designed recovery state. Snapshot writes, branch capture, and active-node
updates must use transactions with an explicitly tested crash boundary.

No account, cloud save, leaderboard, or first-party backend is introduced by
this ADR. A future client-side error/telemetry destination required by `GOAL.md`
section 5 needs its own threat analysis and ADR. It may not receive save
contents or raw player input by default.

## Dependency, license, maintenance, and security consequences

- PixiJS is expected to be the dominant browser dependency. Tree shaking and
  production output must be measured; an npm tarball size is not a browser
  bundle measurement. A numeric bundle budget becomes a claim only when a
  committed command enforces and regenerates it.
- `idb` and Zod are accepted only as adapter conveniences. If measured size or
  schema behavior is disproportionate, their narrow boundaries allow replacement
  with native IndexedDB and project-owned parsers.
- Playwright downloads and executes browser binaries in development/CI; those
  binaries are not part of the deployed game but materially affect cache size
  and supply-chain review.
- The registry-declared direct licences observed during Tier 0 are MIT, ISC,
  Apache-2.0, and MPL-2.0. Registry metadata is not a legal or security audit.
  Exact transitive licences, MPL-2.0 obligations, advisories, integrity hashes,
  and SBOM output must be checked after installation and again for every
  release.
- No dependency is approved merely because it is popular or recently published.
  Maintenance recency is evidence of activity, not evidence of correctness.

The intended direct dependency register and the gaps still awaiting a lockfile
are recorded in `docs/dependencies.md`.

## Alternatives considered

### Phaser instead of PixiJS

Phaser provides more complete scene, physics, input, and lifecycle systems. That
convenience creates a larger risk that framework scene state or timing becomes
gameplay authority. PixiJS is chosen as the narrower rendering layer. Phaser
remains reversible only if a future measurement shows a clear benefit and its
state is kept behind the same render port.

### Custom Canvas/WebGL renderer

A custom renderer minimizes framework surface but creates shader, batching,
asset-lifecycle, accessibility-overlay, and cross-browser maintenance work that
does not strengthen the central mechanic. It is rejected initially. The render
port preserves this as a later option.

### Framework-managed mutable state

Rejected because it directly violates canonical-state and renderer-non-authority
invariants and makes deterministic replay dependent on lifecycle timing.

### `localStorage` for saves

Rejected as the primary store because writes are synchronous, records are small,
and multi-record transactional branch/snapshot updates are unavailable.
`localStorage` may not silently become a fallback durable store.

### Dexie or another database abstraction

Not selected initially. It offers useful schema and query facilities, but the
required data model is small enough that a thin IndexedDB adapter has a smaller
API and migration surface. Reconsider only with measured complexity evidence.

### A server or cloud-authoritative game state

Rejected by the explicit product scope and offline/local-save contract. It would
add latency, privacy, auth, outage, and operating surfaces without improving the
browser-history mechanic.

### Jest or browser mocks instead of Vitest and Playwright

Rejected. Vitest aligns with Vite's TypeScript/ESM toolchain, while Playwright
is needed because History API, BFCache, browser navigation, and real IndexedDB
cannot be established by a DOM mock. Test doubles remain limited to unit tests
and must model failures as well as success.

## Consequences

### Positive

- The deterministic core can run headlessly and independently of frame rate.
- Browser-specific behavior is isolated and can be refused honestly.
- Rendering, storage helpers, and build tooling remain replaceable.
- Static deployment remains possible while retaining real browser integration
  tests.
- Property-test replay failures can be reproduced from a seed and command
  stream.

### Negative and risks

- The project owns branch graph, history coordination, canonical serialization,
  hashing, and migration correctness rather than inheriting them from a game
  engine.
- Browser history and BFCache behavior still require a real cross-browser/device
  matrix; this ADR is not evidence that the mechanic works.
- PixiJS bundle and GPU/context behavior may exceed later budgets.
- Client-only telemetry and cross-tab ownership need careful privacy and
  concurrency design in subsequent ADRs.
- Zod and `idb` add runtime code and supply-chain surface that must justify
  their measured cost.

## Reversibility

- Replace PixiJS by implementing the same immutable render projection/event
  port; no persisted format should mention PixiJS.
- Replace `idb` with native IndexedDB behind the persistence adapter and migrate
  only the versioned schema, not domain objects.
- Replace Zod at ingestion boundaries by preserving parsed domain contracts and
  stable error codes.
- Replace Vite by emitting equivalent static ESM assets and retaining the
  command contract, port contract, and clean-checkout verification.
- Change the hash or serialization algorithm only by adding an algorithm version
  and a migration/compatibility test; never reinterpret an old hash silently.

Rollback before persistent releases is removal of the new toolchain and
adapters. After save data exists, rollback must preserve or explicitly migrate
all supported schema versions and is therefore a tested release operation, not a
file revert.

## Acceptance evidence still required

This decision is implemented only when all of the following are real artifacts:

1. clean-checkout lockfile install and `verify-all` output;
2. boundary checker tests that demonstrate both allowed and rejected imports;
3. exact direct/transitive licence, advisory, integrity, provenance, and SBOM
   reports;
4. measured production bundle composition;
5. Vitest/fast-check seeds and case counts for every invariant;
6. Playwright results across the declared support matrix; and
7. a version-bump migration and recovery drill for IndexedDB.

No CI URL, test result, bundle metric, security result, browser support claim,
or production claim is asserted by this ADR.
