# Progress journal

> Append-only. Do not rewrite or delete an earlier entry when later evidence
> changes its conclusion. Times are local Pacific time unless marked UTC.

## 2026-08-09 21:27 PDT — Goal entry and initial development-contract probe

### Production state

Not yet in production. No implementation or release evidence was present at this
probe.

### Work performed

- Read the goal objective attachment.
- Read `HACKATHON.md`, `WINNING_IDEA.md`, `README.md`, `AGENTS.md`, and
  `GOAL.md` in the required authority order.
- Ran the standing-directive development commands against the repository state
  that existed at the time.

### Commands and observed outcomes

```text
npm run dev:preflight  -> exit 1: Missing script: "dev:preflight"
npm run dev:up         -> exit 1: script unavailable
npm run dev:health     -> exit 1: script unavailable
```

The output was observed in the local terminal only. It is not a CI result and
was not promoted to a release evidence artifact.

### What became true

- The initial `dev:preflight` failure is recorded instead of being rounded up to
  a working dev contract.
- `GOAL.md` section 10 selected the failing development-health gate and Tier 0
  as the first work. Parallel ownership assigned the executable development
  contract to another workstream and the foundation documents to this
  workstream.

### Risks, migration, rollback, blockers

- Risk: downstream browser and release verification remains impossible until the
  reserved-port services exist and pass real readiness probes.
- Migration: none.
- Rollback: none; this entry records an observation.
- External blockers: none.

### Next selected item

Continue the lowest incomplete tier, Tier 0: record the architecture decision,
dependency risks, support truth, assumptions, blocker protocol, evidence
protocol, and journal without claiming the executable contract already works.

## 2026-08-09 21:30 PDT — Tier 0 foundation-document slice

### Production state

Not yet in production. This is documentation and decision infrastructure, not
proof of implementation, browser support, CI, deployment, or real usage.

### Work performed

- Recorded ADR-0001 for TypeScript, Vite, PixiJS, deterministic reducer/domain
  boundaries, IndexedDB, Vitest, fast-check, and Playwright.
- Created the intended direct dependency register with licence, maintenance,
  security-history, native/binary, and cost fields.
- Created an evidence protocol and an honest zero-support baseline matrix.
- Created append-only assumption, external-blocker, and progress ledgers.
- Queried current npm registry metadata for intended direct dependencies; the
  observed versions remain reconnaissance, not selected versions.

### Commands and evidence

```text
npm view <package> version license time.modified dist.unpackedSize --json
node --version
npm --version
git --version
```

- npm metadata was summarized in `docs/dependencies.md` with the query date and
  explicit limitations.
- Local tools observed: Node v26.5.1, npm 11.17.0, Git 2.54.0. These workstation
  versions are not release support claims; CI coordination selected Node 24.
- `evidence/README.md` defines artifact provenance requirements. It is protocol
  documentation, not evidence that a release gate passed.
- No CI URL, clean-checkout result, security scan, SBOM, bundle metric, browser
  result, or production metric was produced or claimed.

### What became true

- The initial architecture and its rejected alternatives, failure model,
  consequences, and reversal paths are reviewable.
- Intended direct dependencies have explicit acceptance gaps rather than
  implicit approval.
- The support matrix distinguishes candidates from supported configurations and
  currently claims no supported release configuration.
- Decisions made under uncertainty have named, cheap verification paths.

### Risks, migration, rollback, blockers

- Risks: exact dependency versions/transitives remain unknown until install;
  security and licence review is unrun; renderer cost and browser behavior are
  unmeasured; dependency register must be reconciled with the eventual lockfile.
- Migration: none; no persistent schema exists.
- Rollback: delete the newly added foundation documents before implementation,
  or supersede ADR-0001 with a later ADR once persisted compatibility exists.
- External blockers: none.

### Next selected item

`GOAL.md` section 10 still selects the failing `dev:health` gate first. Complete
and run the reserved-port development contract, then reconcile this register
with the exact installed dependency graph and run the Tier 0 clean-checkout
gates.

## 2026-08-09 21:40 PDT — Dependency reconciliation and document verification

### Production state

Not yet in production. This verification covers the owned Tier 0 documents only.

### Work performed

- Reconciled the dependency register against the concurrently created
  `package.json`, lockfile root, and installed direct graph.
- Recorded all 17 exact-pinned direct runtime and development packages,
  including accessibility and coverage tooling.
- Queried exact selected-package metadata and ran one-time local npm advisory
  probes. Their raw output is not archived release evidence.
- Formatted and mechanically checked all seven owned documents.
- Re-ran `dev:preflight` after its package script appeared; at that instant it
  still failed because `scripts/dev-services.mjs` had not yet been created. This
  was an in-progress parallel-work observation, not a release result.

### Commands and observed evidence

```text
npm ls --depth=0 --json
npm view <package>@<selected-version> version license time.modified dist.unpackedSize --json
npm audit --json
npm audit --omit=dev --json
npx prettier --check <seven-owned-document-paths>
git diff --check -- <seven-owned-document-paths>
node <inline package/register reconciliation check>
npm run dev:preflight
```

- The reconciliation check reported 17 direct dependencies and no missing
  register entry.
- Prettier reported that all owned files matched project style.
- `git diff --check` emitted no error for the owned paths.
- Both one-time local npm audit commands exited successfully and named no
  current advisory in the resolved graph. Per `docs/dependencies.md`, this is
  not a historical-security claim or archived release evidence.
- The final preflight probe in this workstream failed with `MODULE_NOT_FOUND`
  for the concurrently unfinished `scripts/dev-services.mjs`; `dev:up` and
  `dev:health` were therefore not run by this chained probe.

### What became true

- ADR-0001, the exact direct dependency register, honest support baseline,
  assumption and blocker ledgers, progress journal, and evidence protocol exist
  and agree with the package graph observed at handoff.
- No CI URL, browser support, test metric, bundle metric, production state, or
  release suitability has been invented.

### Risks, migration, rollback, blockers

- Risks: parallel toolchain files were still changing; root must rerun current
  gates after all workstreams settle. Transitive licence/provenance/SBOM and
  real bundle/browser results remain open.
- Migration: none.
- Rollback: remove or supersede these new source documents; no persisted player
  data exists.
- External blockers: none.

### Next selected item

`GOAL.md` section 10 still selects a real `dev:preflight`, `dev:up`, and
`dev:health` pass. After the parallel implementation lands, rerun those commands
and then the clean-checkout Tier 0 verification; append their real evidence
rather than editing this observation.

## 2026-08-09 22:29 PDT — Reserved-port development lifecycle made truthfully healthy

### Production state

Not yet in production. This work proves only the repository-local development
lifecycle on the current workstation; it is not clean-checkout, CI, browser
history, gameplay, deployment, or production evidence.

### Work performed

- Added the exact `ports.env` allocation and `.dev/` isolation required by
  `GOAL.md` section 0A.
- Implemented bounded `dev:preflight`, `dev:up`, `dev:health`, and `dev:down`
  lifecycle commands with atomic PID records, exact process identity, foreign
  listener refusal, loopback-only service arguments, structured per-service
  logs, and exact-PID-only shutdown.
- Implemented a bounded loopback static bundle server with real build readiness,
  request/path/range limits, traversal and symlink-escape rejection, security
  headers, and graceful shutdown.
- Added distinct service identity headers and multi-path readiness probes for
  Vite development, production preview, browser-history E2E, and the static
  bundle.
- Added read-only preflight checks for reserved ports 4144-4149; they remain
  unallocated.
- Exercised failure paths discovered under shared-machine load: slow `lsof`,
  delayed listener visibility, npm process-title mutation, a provisional
  `npm` leader title, and rollback with no listener. Each caused a fail-closed
  result before a regression fix; only recorded repository-owned PIDs were
  signalled during cleanup.

### Commands and observed evidence

```text
node --test tests/tooling/dev-services.test.mjs
npm run dev:preflight
npm run dev:up
npm run dev:health
```

- Focused tooling suite: 17/17 tests passed after the final provisional-title
  regression fix.
- `dev:preflight` reported all allocated ports 4140-4143 and reserved ports
  4144-4149 free before startup.
- `dev:up` built the current artifact and started four repository-owned services
  on `127.0.0.1` only.
- Final `dev:health` passed 4/4 real HTTP readiness checks: Vite client,
  transformed application entry, game HTML marker, preview HTML, static build
  health, and static game HTML all returned the expected service identity.
- The successful current-worktree output is retained in `.dev/logs/` and PID
  records, which are intentionally ignored local diagnostics rather than
  release evidence.

### What became true

- The standing development service gate is currently green on this workstation.
- The launcher distinguishes a real ready service from a TCP listener or a
  foreign HTTP process and cannot stop an identity it did not record and
  revalidate.
- No service is allocated outside 4140-4143, and the whole exclusive block is
  checked before startup.

### Risks, migration, rollback, blockers

- Risks: the lifecycle is not yet proven from a clean Node 24.19.0 checkout or
  CI; current services expose only the truthful non-playable foundation shell;
  shared-load timing can widen further and must remain bounded/fail-closed.
- Migration: none; no player persistence schema exists.
- Rollback: `npm run dev:down` validates and stops only recorded PIDs; deleting
  the new ignored `.dev/` state after shutdown removes local diagnostics.
- External blockers: none.

### Next selected item

`GOAL.md` section 10 selects the still-incomplete Tier 0 release gate: repair the
hostile-review findings in Playwright, coverage, CI/evidence preservation,
TypeScript/domain boundaries, and the dependency register, then run
`verify-all` from a clean checkout.

## 2026-08-10 03:25 PDT — Lifecycle ownership hardening and stale-evidence correction

### Production state

Not yet in production. The earlier entry's statement that the development gate
was “currently green” is no longer current: the four services were shut down by
exact recorded identity before further source/configuration changes. No prior
health result is being reused as evidence for the changed worktree.

### Work performed

- Replaced the npm-wrapper service tree with one supervised socket-holder
  process per service and exercised a real four-service v2 lifecycle before the
  next hardening edits.
- Added native macOS process-working-directory and TCP-listener inspection after
  sandboxed `lsof`/`netstat` observations proved too slow or incomplete under
  concurrent repository load. The listener helper reports wildcard and IPv6
  endpoints and now fails closed on truncated process/descriptor snapshots.
- Bound ready records and health to exact PID/start/cwd/group/session/command,
  exact socket holder/interface, run identity, source/config/lock digest, and
  built-manifest asset digest both before and after HTTP probes.
- Added the `DEV_LIFECYCLE_RESULT` versioned machine record and an exact
  `startInvocationId` to every v2 service record. Expected-invocation cleanup
  now requires all four still-valid records from that exact start lease before
  it signals anything.
- Added bounded forced supervisor exit for a bind or close that does not finish;
  stale records remain safely reconcilable rather than leaving a listener.
- Expanded the service integrity manifest to every TypeScript build config,
  the sanitized Vite environment boundary, and both native helper sources.
- Narrowed the release toolchain contract from an unverified Node 24–26 range
  to exact Node.js 24.19.0 and npm 11.17.0 across package and lock metadata,
  superseding assumptions A-0010/A-0012 through A-0014.

### Commands and observed evidence

```text
npm run dev:down
npm run dev:preflight
npm run dev:up
npm run dev:health
npm run test:e2e
npm run dev:down
npm run dev:preflight
.dev/cache/toolchains/node-v24.19.0-darwin-arm64/bin/node --test tests/tooling/dev-services.test.mjs
/usr/bin/clang -O2 -Wall -Wextra -Werror scripts/dev-socket-listeners.c -o .dev/tmp/dev-socket-listeners.manual
node --check scripts/dev-service-runtime.mjs
node --check scripts/dev-services.mjs
node --check scripts/dev-service-supervisor.mjs
git diff --check -- <lifecycle-owned-paths>
```

- The real v2 `dev:up` and `dev:health` pass proved four exact-owned services on
  4140–4143 after the native macOS listener helper was introduced.
- The first cross-browser E2E attempt exposed shared-load parallel-worker
  timeouts after Chromium passed; retries remained zero. The configuration was
  changed to one worker and a bounded global timeout, but that changed surface
  still requires a fresh real browser run.
- Exact `dev:down` then stopped all four v2 supervisors; the latest preflight
  reports assigned ports 4140–4143 and reserved ports 4144–4149 free.
- The focused lifecycle/static suite now passes 26/26 on the exact pinned Node
  runtime, including expected-invocation refusal, PID-reuse refusal, socket
  swaps/extras, wildcard/IPv6 endpoints, source/build integrity, and filesystem
  escape cases.
- Native C compilation, Node syntax checks, and focused whitespace checks exited
  zero. These are current-worktree observations, not clean-checkout evidence.

### Risks, migration, rollback, blockers

- Risks: the new process-tree runner, verifier, bootstrap, environment,
  boundary, and coverage changes are still under hostile review; no subsequent
  all-browser run or clean-checkout `verify-all` exists yet.
- Migration: v1 PID records were stopped through their validated legacy
  identity path; new records are schema version 2 and include one exact start
  invocation. No player-data schema exists.
- Rollback: `dev:down --expected-invocation <uuid>` is fail closed and acts only
  when all four records still belong to that invocation; ordinary `dev:down`
  remains the explicit operator reconciliation path.
- External blockers: none.

### Next selected item

`GOAL.md` section 10 selects the currently non-standing `dev:health` gate first.
Finish the in-flight Tier 0 safety edits, immediately rebuild/start/health-check
all four services, run the sequential browser matrix, and then execute the
clean-checkout verifier rather than treating the earlier health pass as current.
