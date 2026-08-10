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

## 2026-08-10 08:29 PDT — Repository-wide application progress audit and next-agent handoff

### Production state and user outcome

Not yet in production and not playable. The only browser outcome currently
implemented is an intentionally truthful, accessible foundation-status page that
says the rooms are unavailable. No player can commit a game command, use native
Back/Forward to change a world state, create a branch or ghost, complete a room,
or persist progress. This is still Tier 0 foundation work, not a partial game.

This entry audits commit `a1ae0d6a92f73d07bf0155024677d944c79886b2` on
`main`. Results below are current-worktree or remote-CI observations unless an
artifact is explicitly named; they are not release claims.

### What exists now

| Area | Implemented truth | Important boundary |
| --- | --- | --- |
| Product shell | A small semantic status page, visible skip link, responsive CSS, reduced-motion CSS, and an explicit `playable: false` build status | It is not a game screen and contains no gameplay state |
| Toolchain | Exact Node.js 24.19.0 and npm 11.17.0 contract, exact-pinned dependencies, lockfile, strict TypeScript project references, ESLint, Prettier, Vitest, fast-check, Playwright, and Vite | The ambient workstation Node.js 26.5.1 is outside the supported repository contract |
| Ownership enforcement | AST-based domain import/nondeterminism checks, isolated TypeScript ambient types, local-state containment checks, coverage policy, and install-script policy | Only one pure source file currently exercises the domain boundary; gameplay packages do not exist |
| Local services | Fail-closed ownership and health lifecycle for game `4140`, preview `4141`, E2E `4142`, and static bundle `4143`; reserved ports `4144`-`4149` are checked | Service health proves the status shell is served, not that gameplay works |
| Verification | Unit, tooling, build, dependency-audit, three-browser shell E2E, automatic shell accessibility checks, and a preserving `verify-all` evidence runner | The canonical verifier is red, so Tier 0 has not exited |
| CI | A SHA-pinned GitHub Actions workflow for Node 24, bootstrap, `verify-all`, and always-uploaded diagnostics | The only current `main` run fails during bootstrap before verification |
| Architecture/docs | Product contract, goal ladder, two ADRs, dependency register, boundary policy, Tier 0 threat model, support matrix, assumption/blocker journals, and evidence protocol | These documents intentionally describe planned gameplay that has not been implemented |

### End-goal gap by ownership area

| End-goal area | Current state | Next proof required |
| --- | --- | --- |
| `src/engine` | Missing: no `WorldState`, command union/schema, reducer, canonical serialization, seeded randomness, fixed-step rule, or state hash | Encode the invariants in types and pure code; add generated legal-sequence determinism and malformed-command tests |
| `src/history` | Missing: no History API adapter, opaque/versioned history entry, active branch graph, snapshots, `popstate`, reload, BFCache, or leave-site behavior | Real-browser Back/Forward, rapid navigation, refresh, BFCache, and initial-state exit tests |
| `src/ghosts` | Missing: no discarded-suffix capture, replay preconditions, causality ordering, or visible desynchronization | Property/unit tests for exact command replay and integration tests for collision/precondition order |
| `src/levels` | Missing: zero of eight authored rooms exist | Data-driven room contracts, solver/completability evidence, and per-input completion tests |
| `src/render` | Missing: PixiJS is installed but unused; there is no game renderer, interpolation, timeline, transitions, particles, or quality scaling | Prove rendering is never authoritative and measure frame/input budgets on target devices |
| `src/audio` | Missing: no Web Audio lifecycle, forward/reverse cue, mute control, or visual cue equivalent | Interaction-gated audio, mute persistence, suspension/resume, blocked-audio, and equivalence tests |
| `src/input-accessibility` | Missing as a gameplay subsystem: no keyboard, pointer, touch, in-game Back/Forward equivalent, semantic help, canvas alternative, or focus model | Complete every released room in every supported mode; manual and automated accessibility matrix |
| Persistence/recovery | Missing: `idb` and Zod are installed but unused; no schema, migration, branch/snapshot store, quota behavior, multi-tab policy, corruption recovery, or offline save | Versioned ingestion schema plus real IndexedDB failure, restart, migration, quota, corruption, and concurrency tests |
| Deployment/operations | Missing: no public deployment, release manifest/SBOM, telemetry destination, SLO/dashboard, rollback drill, incident drill, soak, or real-user evidence | Reproducible tagged deployment and the Tier 10-12 evidence defined in `GOAL.md` |
| Submission | Draft exists externally, but no approved product name, playable URL, screenshots, public video, or evidence-backed submission copy exists | Produce submission artifacts from the tested release and submit before the deadline in `HACKATHON.md` |

### Tier and release-gate status

- **Tier 0 — incomplete.** Most repository foundation mechanisms exist, but the
  canonical local verifier and remote CI are red. Tier 0 cannot be promoted on
  partial command success.
- **Tiers 1-13 — not started as application outcomes.** Some Tier 7/10-style
  tooling and documentation exists early, but that does not skip the lower
  tiers or satisfy later evidence requirements.
- **Release gate G1:** not met; zero playable/polished rooms.
- **Release gate G2:** not met; there is no reducer or deterministic hash suite.
- **Release gate G3:** not met; current browser tests cover only the static
  foundation shell, not history lifecycle behavior.
- **Release gate G4:** not met; no ghost exists to discover.
- **Release gate G5:** not met; there is no gameplay input/frame performance
  surface or mobile-device evidence.
- **Release gate G6:** not met; the shell has a narrow automated accessibility
  pass, but audio, save recovery, gameplay accessibility, and leaving-site
  behavior are absent.

### Commands and observed evidence

All local commands in this audit that exercised repository tooling used the
pinned Node.js 24.19.0 runtime by prepending
`.dev/cache/toolchains/node-v24.19.0-darwin-arm64/bin` to `PATH`.

```text
npm run dev:down
npm run dev:preflight
npm run dev:up
npm run dev:health
npm run verify-all
npm run test:e2e
npm run test:e2e:preview
npm run test:e2e:static
gh run list --repo rishabhcli/btt-web-game-jam-summer-2026 --branch main
gh run view 31402716548 --repo rishabhcli/btt-web-game-jam-summer-2026 --log-failed
```

Observed results:

- A fresh exact-runtime lifecycle start and health probe passed for all four
  exact-owned loopback HTTP services; ports `4144`-`4149` were free.
- `npm run verify-all` **failed**. The preserved local run summary is
  `evidence/runs/20260810T152632.603Z-2b1f1df77a07/summary.md`; it is local
  diagnostic evidence until deliberately reviewed and committed. `check` failed
  at `vite.config.ts:61:5` on
  `@typescript-eslint/no-unnecessary-boolean-literal-compare`.
- Within that failed verifier, the current narrow foundation unit suite passed
  2/2 tests; the production-tooling suite passed 91/91; build passed; and the
  local high-severity npm audit probe reported zero findings. The reported 100%
  coverage is only five statements, two functions, and two branches across
  `src/build-status.ts` and `src/foundation-view.ts`, with `src/main.ts`
  explicitly excluded. It is not meaningful gameplay coverage.
- The built shell contained a 1.47 kB JavaScript asset (0.83 kB gzip) and a
  1.53 kB CSS asset (0.77 kB gzip). These are shell build observations, not game
  bundle budgets.
- Direct E2E runs passed 6/6 on Chromium, Firefox, and WebKit for each of the E2E
  dev target, production preview, and static bundle target (18 checks total).
  They prove only status copy, service identity, and absence of automatically
  detected Axe violations on the foundation shell.
- GitHub Actions run
  <https://github.com/rishabhcli/btt-web-game-jam-summer-2026/actions/runs/31402716548>
  for the audited commit **failed before `verify-all`**. `npm run bootstrap`
  rejected the GitHub Actions-provided `npm_config_userconfig` with stable code
  `BOOTSTRAP_NPM_POLICY_OVERRIDE`. No green CI run exists for `main`.

### What became true

- The current application gap is mapped to every repository ownership area
  without treating installed dependencies, scaffolding, or shell tests as
  gameplay progress.
- Both immediate Tier 0 failures have exact reproduction locations instead of a
  vague instruction to “finish setup.”
- The next agent can distinguish the passing local shell surfaces from the red
  canonical gate and from entirely missing application behavior.

### Next-agent work queue

Follow `GOAL.md` section 10 in this order; do not begin rooms, rendering polish,
or content while Tier 0 is red.

1. **Keep the development gate valid.** Use Node.js 24.19.0 and npm 11.17.0,
   run `npm run dev:health`, and reconcile only exact repository-owned service
   records. Running lifecycle commands under the ambient Node.js 26 binary can
   make pinned-runtime supervisor records appear invalid; switch back to the
   pinned runtime rather than deleting records or signalling broad process
   sets.
2. **Repair the local canonical gate.** Remove the unnecessary boolean-literal
   comparison at `vite.config.ts:61:5`, add or adjust a focused regression test
   if behavior could change, and make `npm run check` green without weakening
   the lint rule.
3. **Repair clean GitHub bootstrap.** Reconcile the fail-closed bootstrap policy
   with the trusted `npm_config_userconfig` created by `actions/setup-node`.
   Preserve protection against caller-controlled install-policy overrides; add
   a tooling/CI-policy regression test for the exact trusted Actions shape
   rather than allowlisting arbitrary user configuration.
4. **Re-prove Tier 0 from the changed commit.** Restart/re-health services after
   integrity-affecting edits, run the canonical `npm run verify-all` from a clean
   checkout, review its redaction/digests, push, and require a green GitHub
   Actions run. Append the committed run URL/artifact and exact outcomes here.
5. **Then enter Tier 1.** Create the real `src/engine` ownership area with a
   versioned serializable command schema, canonical `WorldState`, pure reducer,
   deterministic serialization/hash contract, and seeded randomness. Add
   property generators and rejection behavior before adding a playable room.
   Continue until all seven invariants in `GOAL.md` Tier 1 have code paths and
   named tests; do not claim Tier 1 from I1/I2 alone.

The first two defects may be locally independent, but both are one Tier 0
release-gate slice: no clean-checkout or CI result should be called green until
both are fixed and the final commit is reverified.

### Risks, migration, rollback, blockers

- Risks: the verifier has never completed its browser/build matrix from a clean
  checkout; CI has never reached verification; the exact toolchain differs from
  the workstation default; current browser passes cover only non-game status
  content; no application invariant exists in code.
- Migration: none. No player persistence schema or saved player data exists.
- Rollback: revert this documentation entry; it changes no runtime behavior,
  schema, dependency, or service allocation.
- External blockers: none. The two red Tier 0 gates are repository work, not
  user or third-party blockers.

## 2026-08-10 13:20 PDT — First green clean-checkout `verify-all`

### Production state and user outcome

Not yet in production and still not playable. This entry repairs the
verification machinery only; no gameplay, engine, history bridge, ghost, room,
renderer, audio, persistence, or deployment exists. The browser outcome is still
the truthful non-playable foundation status page.

What changed is that the canonical gate can now run to completion and be
believed. Before this work `npm run verify-all` could not pass on any machine,
and `npm run bootstrap` could not pass under `npm run` at all.

### Work performed

Three independent fail-closed defects were found and repaired, each with a named
regression test. All three were invisible to the existing suite because the
existing tests injected synthetic results at exactly the boundary that was
broken.

1. **`vite.config.ts:61` typed-lint failure.** The resolved-service boundary
   compared `config.server.fs.strict` to `true`, which
   `@typescript-eslint/no-unnecessary-boolean-literal-compare` rejected. Rather
   than dropping the comparison, the check now goes through an explicit
   `isExactlyTrue` boundary predicate that treats the runtime-resolved value as
   untrusted and refuses a truthy substitute (`1`, `"false"`, `{}`) as firmly as
   `false`. The same predicate now guards `strictPort`.
   `assertResolvedServiceConfig` is exported so the boundary is attacked
   directly instead of only through a Vite plugin hook.

2. **`npm run bootstrap` could never succeed.** npm exports its own resolved
   `npm_config_userconfig` into every run-script environment, and the install
   policy check rejected that variable by name. The check now refuses a
   *redirect* — any path that is neither this repository's committed `.npmrc`
   nor the invoking account's default `~/.npmrc` — which is the protection that
   was actually intended. A key carrying `undefined`/`null` is now treated as an
   absent variable rather than the string `"undefined"`.

3. **`verify-all`'s browser-integrity probe emitted unparseable output.** Inside
   a `String.raw` template the probe ended with `"\\n"`, so it wrote a literal
   backslash-n. `parseBrowserEvidence` therefore always returned `null`, and
   every run failed with `PLAYWRIGHT_BROWSER_VERSIONS_UNAVAILABLE` and
   `BROWSER_INTEGRITY_CHANGED_DURING_RUN`. A PASS outcome was unreachable by
   construction.

4. **`verify-all` killed the services it had just started.** The owned process
   runner treats any descendant alive after the leader exits as a leak, but
   `dev:up` exists to leave four supervised services running. The runner now
   accepts a `declareSurvivingDescendants` callback evaluated after leader exit
   and before the leak decision; `verify-all` supplies it for `dev_up` only,
   deriving permitted PIDs from that command's own `DEV_LIFECYCLE_RESULT`
   ownership proof. Survivors must be exactly the declared identities plus their
   live descendants. An absent, malformed, empty, throwing, or non-covering
   declaration fails closed. Because a survivor outlives the launcher's per-run
   scratch, declaring survivors now requires a caller-owned home directory
   (`.dev/tmp/lifecycle-home`), and the runner removes its scratch when
   environment setup fails.

### Commands and observed evidence

All commands ran on the pinned Node.js 24.19.0 / npm 11.17.0 toolchain by
prepending `.dev/cache/toolchains/node-v24.19.0-darwin-arm64/bin` to `PATH`.

```text
npm run dev:preflight
npm run dev:health
npm run dev:down
npm run bootstrap
npm run check
npm test
node --test tests/tooling/bootstrap.test.mjs
node --test tests/tooling/config-environment.test.mjs
node --test tests/tooling/verify-all.test.mjs
node --test tests/tooling/owned-process-runner.test.mjs
npm run verify-all
```

Observed results:

- `npm run bootstrap` exits **0** for the first time, installing 173 packages
  under the locked install-script policy and reporting zero vulnerabilities.
- `npm run check` is green: Prettier, typed ESLint, all TypeScript project
  references, and the AST ownership-boundary policy.
- `npm test` passes **102/102** tooling tests and **2/2** unit tests. The unit
  coverage remains five statements across two foundation files; it is not
  gameplay coverage.
- `npm run verify-all` **PASSED from a clean checkout** at commit
  `613b8e4937fe174957918838357c89b954eabb7b`. All 25 recorded steps passed with
  an empty `failureCodes` array. Preserved artifact:
  `evidence/runs/20260810T201403.217Z-db08bdbf876e/` (`summary.md`,
  `manifest.json`, `events.jsonl`, `SHA256SUMS`), 194025 ms, clean at start
  `yes`.
- Within that run: three-browser E2E on the owned 4142 service, Chromium E2E
  against the production preview on 4141 and the static bundle on 4143, a real
  four-service `dev:up`/`dev:health`/`dev:down` lifecycle, and stable
  start/end digests for source, discovered inputs, tooling, browsers, and the
  served build.
- Two preserved FAIL runs are committed alongside it as the raw observations for
  defects 1 and 3: `evidence/runs/20260810T152632.603Z-2b1f1df77a07/` and
  `evidence/runs/20260810T192538.286Z-0f315ef731c5/`.

### What became true

- The canonical Tier 0 verifier has passed end to end from a clean checkout for
  the first time in this repository's history, and the exact artifact that
  proves it is committed rather than described.
- Three defects that made the gate unreachable are fixed with tests that fail if
  they return, rather than with looser gates.
- The repository's own leak policy now distinguishes a declared, proven service
  handover from an undeclared leak, instead of forbidding both.

### Risks, migration, rollback, blockers

- Risks: no green GitHub Actions run exists yet, so the clean-checkout proof is
  still workstation-only. Whether a detached supervisor is *tracked* before its
  launcher exits is timing-dependent (recorded as A-0016), so this run took the
  "no live tracked descendant" path and did not exercise the declaration in
  production; the declaration path is proven by a real-process tooling test
  instead. No application invariant exists in code yet.
- Migration: none. No player persistence schema or saved player data exists.
- Rollback: revert `613b8e4` and `34c11f6`; both are verification-machinery
  changes with no runtime game behavior, no schema, and no port reallocation.
- External blockers: none.

### Next selected item

`GOAL.md` section 10.1 item 2 — the remaining failing release gate is CI, which
has never reached verification. Push these commits and require a green GitHub
Actions run for `main`, then begin Tier 1: create `src/engine` with a versioned
serializable command schema, canonical `WorldState`, pure reducer, deterministic
serialization/hash contract, and seeded randomness, with named property tests
per invariant.
