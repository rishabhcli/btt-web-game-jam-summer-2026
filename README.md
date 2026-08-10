# BTT Web Game Jam - Summer 2026

> A browser-native time puzzle in which Back, Forward, and discarded history become the game mechanics.

> **Production intent:** this repository is for the complete, reliable system described below. It is not an MVP, disposable demo, or thin hackathon facade. No product name has been assigned; the hackathon title remains the repository heading until the user chooses one.

## Repository status

Tier 0 foundation implementation is in progress. The repository now contains an exact-pinned TypeScript/Vite toolchain, a truthful non-playable browser shell, strict verification configuration, and a repository-owned development-service lifecycle. The eight-room game, deterministic kernel, native-history bridge, ghosts, persistence, production deployment, and release evidence do not exist yet. This foundation is not a playable release and the repository is **not yet in production**.

No command, browser row, or current-worktree observation is a release claim. Promotion requires the committed clean-checkout evidence defined in `GOAL.md` and `evidence/README.md`; until that artifact exists and passes, Tier 0 itself remains incomplete.

| Document | Authority |
|---|---|
| [HACKATHON.md](./HACKATHON.md) | Eligibility, mandatory submission fields, judging criteria, deadlines, links |
| [WINNING_IDEA.md](./WINNING_IDEA.md) | Selected concept, hard technical core, validation, build order, demo and risk analysis |
| [README.md](./README.md) | Product contract, architecture, production and release expectations |
| [AGENTS.md](./AGENTS.md) | Binding implementation rules for every coding agent working in this repository |
| [GOAL.md](./GOAL.md) | Standing execution order, dev-service contract, production clauses, tier ladder, ratchets, and perpetual epoch engine |

If these documents disagree, preserve the external requirements in HACKATHON.md, then the product intent in WINNING_IDEA.md, and resolve the conflict explicitly in an ADR instead of guessing.

## Product contract

Ship a finished, accessible twenty-minute web game whose deterministic world is synchronized with browser history, whose abandoned future branches become predictable ghosts, and whose quality holds across refreshes, mobile back gestures, and supported browsers.

### Intended users

- Players seeking a short authored puzzle experience
- Keyboard, pointer, touch, reduced-motion, and screen-reader-adjacent users
- Judges evaluating creativity, fun, and technical polish

### Canonical workflow

1. Commit an atomic action into deterministic game history
2. Use browser Back/Forward to rewind or replay
3. Branch after rewind and preserve the discarded suffix as a ghost command track
4. Coordinate live player and ghosts under published causality rules
5. Complete eight authored rooms with instant, consequence-free retry

### Explicit non-goals

- Procedural levels, multiplayer, accounts, leaderboards, or backend
- Combat, inventory, dialogue trees, or a level editor
- Framework-managed mutable state as game authority
- Silent ghost path correction
- More rooms at the expense of authored polish

A non-goal may become part of the product only after the core release gates pass and an ADR explains why the additional surface does not weaken correctness, safety, usability, or schedule.

## Production architecture

Static web deployment with deterministic assets and offline-capable save data. Browser support and persistence limits are tested, documented, and never hidden behind a server.

### Planned component boundaries

| Area | Production responsibility |
|---|---|
| `src/engine` | Canonical WorldState, commands, reducer, hashing, fixed-step rules |
| `src/history` | History API bridge, branch graph, snapshots, BFCache/reload recovery |
| `src/ghosts` | Command-track replay, preconditions, desynchronization |
| `src/levels` | Eight data-driven authored rooms and progression |
| `src/render` | Canvas/WebGL view, particles, transitions, quality scaling |
| `src/audio` | Forward/reverse cues, accessible mute, lifecycle |
| `src/input-accessibility` | Keyboard, pointer, touch, reduced motion, semantic help |

Dependencies should flow from applications/adapters toward typed domain packages. Domain logic must remain testable without UI, network, cloud credentials, or third-party services. Infrastructure code may assemble components but must not become the only place where product invariants are enforced.

### Target technology foundation

- TypeScript, Vite, PixiJS or Phaser rendering
- Pure command reducer and branch graph
- IndexedDB snapshots/persistence
- Web Audio synchronized with timeline direction
- Vitest/property tests and Playwright browser-history E2E

Technology choices are constraints, not decorations. A dependency is accepted only when its operational behavior, license, failure modes, supply-chain risk, and replacement boundary are understood.

## Non-negotiable invariants

1. Canonical state changes only through serializable commands
2. Same state, command, and seed always produce the same hash
3. Rendering/interpolation never becomes gameplay authority
4. Ghosts execute recorded commands or visibly desynchronize; they never improvise
5. A new branch preserves the discarded suffix before native forward history disappears
6. Back at the initial game state must not trap the user's browser
7. Every room is completable under every supported input mode

Any change that can violate an invariant requires a written design review, tests demonstrating preservation under failure, and an explicit update to this README and AGENTS.md.

## Security, privacy, and safety

- Do not abuse history to prevent leaving the site
- Persist only local game state and settings
- Audio starts only after interaction and always has a mute control
- Reduced-motion mode preserves all gameplay information

Common controls required across the system:

- secrets come from an approved secret store or local ignored environment file and are never committed, rendered, or logged;
- untrusted files, prompts, provider output, repository content, and external responses are treated as data, never instructions;
- authorization is enforced at the data/action boundary, not only in the UI;
- logs, traces, fixtures, screenshots, and demo assets are scrubbed of credentials and sensitive user data;
- destructive or externally visible actions are previewable, idempotent where possible, auditable, and fail closed;
- dependency and container scanning, lockfiles, least privilege, and an incident/rollback path are release requirements.

## Reliability and operations

Production behavior includes failures, retries, restarts, partial responses, stale data, duplicate delivery, and resource exhaustion. The implementation must therefore provide:

- typed error classes and user-visible failure states rather than catch-all success fallbacks;
- bounded timeouts, cancellation, retry budgets, and backoff for every external or long-running operation;
- idempotency and reconciliation wherever the same work may be delivered twice or its external outcome may be unknown;
- structured, redacted logs; metrics for throughput, latency, error and abstention/refusal; and traces across meaningful boundaries;
- health/readiness checks that validate dependencies without mutating user data;
- documented SLOs and alerts before public production use;
- backup, restore, migration, retention, and cleanup procedures for every persistent store;
- graceful degradation that preserves truth and safety before convenience or visual effects.

## Verification strategy

Project-specific required test surfaces:

- Reducer determinism over generated legal sequences
- Snapshot plus replay equivalence
- Rapid popstate, refresh, BFCache, suspension, and back gesture
- Ghost collision/precondition ordering
- Cross-browser visual/input E2E
- Blind playtest comprehension and completion metrics

Every production path also needs unit tests, property or fuzz tests where state space matters, integration tests at real boundaries, end-to-end tests of the user outcome, accessibility checks, performance budgets, security regression tests, and failure-injection coverage. Mocks belong in test fixtures; the shipped runtime must not depend on a fake service or hardcoded winning example.

Evaluation datasets and fixtures are versioned, provenance-aware, and isolated from tuning when described as held out. A number may appear in the README or submission only when a committed script regenerates it from a committed manifest.

## Performance and accessibility

Performance budgets must be set before optimization and enforced in CI for supported environments. Measure latency distributions, memory, CPU/GPU, network or storage volume, cold start, cancellation, and degraded-device behavior relevant to this product. Do not replace measurements with “feels fast.”

Accessibility is a release gate, not a polish task. The production interface must include semantic structure, keyboard support, visible focus, sufficient contrast, non-color status cues, reduced-motion behavior where relevant, zoom/reflow, readable errors, and an equivalent representation for information conveyed through canvas, charts, audio, maps, camera, or animation.

## Planned repository layout

```text
/
├── README.md                 # Product and operating contract
├── AGENTS.md                 # Binding implementation rules for coding agents
├── HACKATHON.md              # External rules and submission facts
├── WINNING_IDEA.md           # Selected product/technical blueprint
├── src/engine/
├── src/history/
├── src/ghosts/
├── src/levels/
├── src/render/
├── src/audio/
├── src/input-accessibility/
├── tests/                    # Unit, property, integration, E2E, resilience
├── docs/                     # ADRs, threat model, runbooks, evaluation
└── infra/                    # Reproducible deployment and environment policy
```

This is a boundary contract, not a command to create empty directories. Add a directory when it owns working code, tests, and documentation.

## Development command contract

The current Tier 0 command surface is exposed through npm scripts and matching `make` targets. These commands verify the foundation that exists; they do not imply that the planned gameplay or release gates exist.

| Command | Current behavior and boundary |
|---|---|
| `npm run bootstrap` | Requires the exact checked-in Node/npm release-tool versions, installs the lockfile graph with strict install-script policy, invokes Playwright `install-deps` on Linux (which may install required host OS libraries), and installs browser binaries only under `.dev/cache/playwright` |
| `npm run check` | Runs Prettier check, typed ESLint, all TypeScript project references, and the AST ownership-boundary policy |
| `npm test` | Runs the currently implemented unit/property selection and production tooling tests; the suite expands with each tier |
| `npm run test:integration` | Runs real-browser tests marked `@integration` against the isolated E2E service |
| `npm run test:e2e` | Runs Chromium, Firefox, and WebKit with zero retries and an isolated profile; it reuses port 4142 only after exact repository ownership and health validation |
| `npm run test:e2e:preview` | Builds and runs the browser/a11y surface against the production preview on port 4141 |
| `npm run test:e2e:static` | Builds and runs the browser/a11y surface against the static bundle server on port 4143 |
| `npm run build` | Type-checks project references and emits the static Vite artifact to `dist/` |
| `npm run dev:preflight` | Fails closed on any foreign listener in 4140–4149 and validates repository-local development state |
| `npm run dev:up` / `npm run dev:health` / `npm run dev:down` | Starts, proves, and exactly stops the four loopback-only repository services without broad process signals |
| `npm run verify-all` | Preserves a unique pass/fail evidence run, executes the blocking Tier 0 checks and browser/build surfaces, and always performs exact lifecycle cleanup |
| `npm run clean` | Removes only declared generated build, coverage, and browser-test output; it does not erase preserved evidence or PID state |

`eval`, SBOM/release-manifest generation, gameplay/property gates, deployment, and production release commands are added only with their owning tiers. Their absence is an incomplete gate, not an invitation to publish a placeholder command. A new contributor must ultimately be able to move from a clean checkout to a verified local system without tribal knowledge.

## Environment model

- **Local:** isolated developer data, safe fixtures, no real-world side effects by default.
- **Test:** deterministic automated environment with controlled boundary services.
- **Staging:** production-shaped deployment, synthetic/de-identified data, real observability and rollback.
- **Production:** least-privilege credentials, audited configuration, SLOs, incident ownership, backups and change controls.

Configuration is typed, validated at startup, documented, and separated from secrets. Environment-specific branches or code paths are prohibited; behavior changes through validated configuration and capability boundaries.

## Release gates

1. Eight or intentionally cut polished rooms complete end to end
2. No deterministic hash mismatch in fuzz/property suite
3. Supported browser/history lifecycle matrix passes
4. First ghost is discoverable without narration
5. Performance and input latency budgets pass on desktop/mobile
6. Accessibility, audio, save recovery, and leaving-site behavior pass

Common blocking gates also include:

- clean build from a fresh checkout with locked dependencies;
- no critical/high unresolved security findings and no committed secrets;
- migration/rollback and backup/restore rehearsal where state exists;
- passing accessibility and supported-environment matrix;
- complete observability, runbook, known-limitations, privacy, and threat-model documentation;
- no placeholder copy, dead controls, fake metrics, hardcoded demo results, or production TODO paths;
- submission assets and claims generated from the same tested release commit.

## Production milestone policy

Work proceeds in complete vertical slices, but every merged slice must use the final architecture, schemas, security boundaries, telemetry, error model, tests, and documentation expected in production. A smaller completed surface is acceptable; a throwaway implementation that will be replaced later is not.

A feature is not complete when it works once. It is complete when supported inputs, invalid inputs, retries, cancellation, restart, privacy, accessibility, observability, performance, deployment, rollback, and documentation are all accounted for.

## Hackathon delivery

HACKATHON.md contains the live form links and exact requirements. WINNING_IDEA.md contains the selected demo and judging strategy. Production engineering must strengthen that submission, not create a separate demo path. The video, screenshots, hosted build, evaluation numbers, and repository documentation must all describe the same release artifact.

## Contributing

Read AGENTS.md before changing code. Keep changes narrowly scoped, add or update tests with behavior, record architecture/security decisions in ADRs, and never weaken an invariant to make a demo pass. No product name, logo, pricing claim, medical/legal claim, partner claim, or benchmark result should be invented without explicit evidence and user approval.
