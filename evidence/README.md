# Evidence protocol and index

> **Classification:** source-controlled protocol documentation, not a generated
> product-evidence artifact.
>
> **Random seed:** not applicable to this policy document.
>
> **Current evidence inventory:** none. The repository is not yet in production.

`evidence/` holds regenerable artifacts that support narrowly named claims. It
is not a place for manually curated success summaries, screenshots without
source, or copied CI badges. This README defines the protocol; its presence is
not evidence that any gate passed.

## Required artifact header

Every artifact added beside this README must state, in machine-readable metadata
or an adjacent manifest:

- stable claim or gate identifier;
- exact committed producer command;
- source commit and release tag, when applicable;
- whether the command ran from a clean checkout;
- immutable input manifest and hashes;
- random seed and case count, or `not-applicable` with a reason;
- UTC start/end timestamps and duration;
- operating system, architecture, runtime, browser, and device versions relevant
  to the claim;
- allocated repository port(s), if a server was used;
- exit status and terminal outcome;
- artifact SHA-256 digest; and
- redaction classification and reviewer for sensitive output.

If a claim cannot name a committed regeneration command, withdraw the claim. Do
not add a hand-authored artifact to make the evidence directory look populated.

## Artifact rules

1. **Generate, do not edit.** Derived artifacts are replaced only by rerunning
   their producer. Raw observations are immutable.
2. **Preserve failures.** A failed kill test, browser row, or chaos scenario is
   evidence and must not be overwritten by a later pass. Link the superseding
   run.
3. **Separate raw and derived.** A human-readable report must link the raw
   events, inputs, and calculation command that produced each number.
4. **Record seeds.** Property, fuzz, simulation, and randomized evaluation
   output records the seed and configured cases even when the run passes.
5. **Bind claims to artifacts.** Include source commit, build digest,
   configuration hash, and browser/device identity so evidence cannot drift to
   another release.
6. **Use real boundaries.** A mock, emulated viewport, or TCP-open check must be
   labeled as such and cannot prove a real browser/device/readiness claim.
7. **Protect privacy and secrets.** Never store credentials, tokens, full save
   contents, raw user input, private locations, or identifiable playtest media
   without an approved encrypted retention policy. Prefer aggregate/redacted
   data.
8. **No fabricated provenance.** Do not invent CI URLs, dashboard links, run
   IDs, timings, case counts, accessibility results, playtesters, or
   zero-finding security results.
9. **Regenerate from scratch.** The eventual evidence regeneration command
   removes derived output in its own scoped directory, rebuilds from immutable
   inputs, and diff-checks the result. It may not sweep sibling repositories or
   shared caches.
10. **Keep protocol and evidence distinct.** This README is the sole policy-file
    exception in this directory; every other file must be produced by a
    committed command or be an immutable raw capture with a committed capture
    procedure.

## `verify-all` producer contract

`npm run verify-all` creates exactly one new directory at
`evidence/runs/<run-id>/`. Run IDs contain a UTC timestamp plus random collision
resistance in production. Directory creation is exclusive: neither a passing
run nor a later retry can overwrite an earlier failed run. The repository root,
every `evidence/runs` parent, and every `.dev/tmp` or cache parent must be real
directories contained by the repository; a symlink, path escape, or non-directory
component fails before artifact allocation.

The producer proves the Git commit, `HEAD^{tree}`, index equality with `HEAD`,
and porcelain status **before** creating its own evidence directory. A dirty
start is recorded as `DIRTY_START`, a staged mismatch is recorded as
`INDEX_DOES_NOT_MATCH_HEAD`, and neither can pass. In the same pre-allocation
snapshot, `git ls-files` discovers every tracked and non-ignored untracked
repository input. The producer hashes regular files across source, tests,
documentation, scripts, workflows, and configuration instead of relying on a
hand-maintained path list. Generated `.git`, `.dev`, dependency, build, test,
coverage, and prior-run directories are excluded. Symlinks, path escapes,
duplicates, missing files, and files that change during hashing fail closed.
Commit, tree, index, the discovered path set, and every input digest are proven
again after cleanup; any drift makes the terminal result fail.

The producer requires Node v24.19.0 and npm 11.17.0 exactly. Caller `PATH` is
never trusted for Git or npm: Git comes from a fixed system path, npm is invoked
through the npm CLI derived from the running Node executable, and children see
only the trusted Node directory plus fixed system directories. Evidence hashes
the Node, npm, and Git executables, the npm installation tree, each direct local
tool entry point, and an aggregate of the installed `node_modules` tree. The
only declared exclusions from that aggregate are top-level generated Vite/cache
directories; they are rebuildable outputs, not executable installation inputs.
Playwright records the
version, byte length, and SHA-256 of each effective Chromium, Firefox, and WebKit
binary. Installed-tool and browser integrity are checked again at the end; a
probe failure or changed digest cannot coexist with `PASS`.

The producer runs static checks, tests, build, dependency audit, and the
development-service preflight/start/health sequence. A machine-readable
`btt.dev-lifecycle/v1` result binds the `dev:up` invocation to all four service
names, service IDs, ports, run IDs, start-invocation IDs, PIDs, and ownership.
`dev:health` must prove the same four identities with `exactOwned: true` before
any browser command may reuse them. It runs Chromium, Firefox, and WebKit
against 4142, then Chromium integration and accessibility coverage against the
built preview on 4141 and static bundle on 4143. Because `dev:up` may rebuild,
the canonical served `dist/` digest is taken after the validated up result, not
from the preliminary pre-up build.

Every child command owns a new POSIX process group (or an exact Windows process
tree). A bounded descendant supervisor also records and terminates children
that deliberately create a separate process group. Timeout, output-limit, and
parent-signal cancellation therefore target the owned process tree rather than
only the npm leader. Individual command limits are at most eight minutes and a
48-minute total deadline leaves CI time to perform cleanup, end-state proofs,
and artifact upload within its 60-minute job limit.

Cleanup is lease-scoped. If this verifier observes an up `STARTING` invocation
that may have created services, its `finally` block runs exactly
`dev:down -- --expected-invocation <uuid>` and validates the corresponding
machine result. Services proven as reused are deliberately left running, and a
verifier that never obtained an up invocation never performs a repository-wide
down. A first SIGINT or SIGTERM is handled long enough to preserve partial
failure artifacts and lease-scoped cleanup evidence; no path performs a broad
process kill.

Each run contains:

```text
evidence/runs/<run-id>/
├── events.jsonl   # sequenced stdout/stderr observations in occurrence order
├── manifest.json  # inputs, platform, tool/browser versions, ports, and exits
├── summary.md     # human-readable outcome bound to the manifest
└── SHA256SUMS     # SHA-256 for the three artifacts above
```

Output is buffered as one occurrence-ordered stdout/stderr tape per command so a
credential split across either stream can be masked before anything is written
or echoed. The tape is then divided back at the original chunk boundaries. The
child environment is an allowlist; environment values are never serialized,
and exact environment values plus credential-shaped output are
length-preservingly masked. The manifest records only environment variable
**names**, the redaction class, and whether a human publication review occurred.
A run is internal evidence until that review field names a reviewer.

Production run IDs use six bytes from `node:crypto.randomBytes`; the source and
entropy width are declared in the manifest. Randomized child suites remain
responsible for emitting their own seeds and case counts. The exported injected
runner exists only at the explicit isolated test entrypoint under
`.dev/test-tmp`; its manifests are marked `injected-test-noncanonical` and are
never eligible to support the canonical Tier 0 claim. The production entrypoint
rejects runner, clock, run-ID, runtime-version, tool-integrity, environment, and
repository-root injection.

`SHA256SUMS` is the adjacent digest envelope and therefore does not recursively
hash itself. Verify it from inside the run directory with
`shasum -a 256 -c SHA256SUMS` before review or publication.

## Evidence layout

```text
evidence/
├── README.md
├── runs/
│   └── <verify-all-run-id>/
├── manifests/
├── tier-0/
│   ├── clean-checkout/
│   ├── dependency-audit/
│   └── verify-all/
├── invariants/
├── browser-matrix/
├── accessibility/
├── performance/
├── security/
├── operations/
└── playtests/
```

Directories are created when a real producer owns them, not as empty
scaffolding.

## Minimum review before publishing a number

1. Re-run the producer from the stated clean checkout and immutable inputs.
2. Confirm the command exits successfully and the artifact digest matches.
3. Independently recompute or spot-check the calculation.
4. Verify sample size, case count, exclusions, environment, and uncertainty are
   visible next to the number.
5. Verify the number appears nowhere with broader wording than its evidence can
   support.
6. Link the exact artifact from README, UI, support matrix, or submission copy.

## Initial index

| Claim/gate                                  | Artifact | Status                                                 |
| ------------------------------------------- | -------- | ------------------------------------------------------ |
| Tier 0 clean-checkout `verify-all`          | None     | Not run                                                |
| Dependency licence/advisory/SBOM review     | None     | Not run                                                |
| Development service readiness               | None     | No indexed committed run                               |
| Determinism and domain invariants           | None     | Not implemented or run                                 |
| Browser/history lifecycle support           | None     | Not implemented or run                                 |
| Accessibility support                       | None     | Not implemented or run                                 |
| Performance or bundle budgets               | None     | Not declared or measured                               |
| Public deployment and production conditions | None     | Not achieved                                           |

An empty initial index is truthful. It becomes populated only by committed,
re-runnable producers.
