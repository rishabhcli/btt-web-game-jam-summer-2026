# Direct dependency register

> **Status:** Tier 0 direct dependencies are exact-pinned in `package.json` and
> resolved in `package-lock.json`. Release suitability, transitive licence
> review, SBOM output, and clean-checkout verification remain incomplete.
>
> **Production status:** Not yet in production.

## Provenance and limits

The direct graph was reconciled against the lockfile root and `npm ls --depth=0`
on 2026-08-10 UTC. Exact package metadata was queried with:

```sh
npm view <package>@<selected-version> version license time.modified dist.unpackedSize --json
```

Versions in the Selected column are exact and lockfile-pinned. The registry
timestamp is evidence only that package metadata changed; it does not establish
maintainer responsiveness or software quality. The registry-declared licence is
not legal review. Registry tarball unpacked size is not a browser bundle
measurement and is intentionally not presented as one.

## Runtime dependencies

| Package   | Role and boundary                                                             | Selected | Licence declared by registry | Maintenance observation                                            | Security-history status                                                  | Native/binary implications                                         | Bundle/runtime cost                                                                                        |
| --------- | ----------------------------------------------------------------------------- | -------- | ---------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `pixi.js` | Canvas/WebGL rendering adapter; no Pixi object may cross into canonical state | `8.19.0` | MIT                          | Metadata modified 2026-07-13; issue/release-process review pending | Current graph scan described below; historical/provenance review pending | Browser JavaScript/WebGL; transitive graph still needs SBOM review | Expected dominant runtime dependency; production chunk composition, parse, GPU, and load cost not measured |
| `idb`     | Thin IndexedDB adapter confined to persistence                                | `8.0.3`  | ISC                          | Metadata modified 2025-05-07; issue/release-process review pending | Current graph scan described below; historical/provenance review pending | Browser JavaScript wrapper over native IndexedDB                   | Expected small relative to renderer; actual parsed/gzip and execution cost not measured                    |
| `zod`     | Runtime schemas at external and persisted-data ingestion boundaries           | `4.4.3`  | MIT                          | Metadata modified 2026-08-09; compatibility/issue review pending   | Current graph scan described below; historical/provenance review pending | JavaScript only in intended use                                    | Schema code ships to browser; tree-shaken output and parse cost not measured                               |

## Development and verification dependencies

Development-only packages must not enter production browser chunks. That
separation must be verified from the built artifact rather than assumed.

| Package                | Role                                                                       | Selected  | Licence declared by registry | Maintenance observation                                                                                            | Security-history status                                                           | Native/binary implications                                                                             | Build/runtime cost                                                         |
| ---------------------- | -------------------------------------------------------------------------- | --------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `typescript`           | Strict compiler and AST API for boundary enforcement                       | `6.0.3`   | Apache-2.0                   | Metadata modified 2026-08-09; selected major is intentionally below registry latest observed during reconnaissance | Current graph scan described below; compiler provenance review pending            | Node-executed JavaScript                                                                               | Development/CI only; compiler time and memory not measured                 |
| `vite`                 | Static build, dev server, preview server, and E2E server                   | `8.2.1`   | MIT                          | Metadata modified 2026-08-06                                                                                       | Current graph scan described below; build-chain history pending                   | Transitive build graph may select platform-specific optional packages; lockfile/SBOM must capture them | Development/CI tool; emitted production chunks must be measured            |
| `vitest`               | Unit, deterministic module, and selected integration tests                 | `4.1.10`  | MIT                          | Metadata modified 2026-07-24                                                                                       | Current graph scan described below; transitive history pending                    | Inherits Vite/V8 development environment                                                               | Development/CI only; suite duration and worker limits not measured         |
| `@vitest/coverage-v8`  | Coverage provider for Vitest                                               | `4.1.10`  | MIT                          | Metadata modified 2026-07-24                                                                                       | Current graph scan described below; transitive history pending                    | Uses Node/V8 coverage and source-map tooling                                                           | Development/CI only; report time/storage not measured                      |
| `fast-check`           | Seeded property/state-machine tests and shrinking                          | `4.9.0`   | MIT                          | Metadata modified 2026-07-08                                                                                       | Current graph scan described below; package history pending                       | JavaScript only in intended use                                                                        | Development/CI only; case-count runtime must be measured and bounded       |
| `@playwright/test`     | Real-browser history, persistence, input, accessibility, and lifecycle E2E | `1.62.1`  | Apache-2.0                   | Metadata modified 2026-08-09                                                                                       | Current graph scan described below; package and browser provenance review pending | Playwright tooling manages sizeable browser binaries separately from the deployed artifact             | Development/CI only; cache, install time, and matrix duration not measured |
| `@axe-core/playwright` | Playwright integration and its nested axe-core 4.12.1 engine               | `4.12.1`  | MPL-2.0                      | Metadata modified 2026-08-06                                                                                       | Current graph scan described below; package history pending                       | Browser-injected JavaScript in tests; not intended for production chunks                               | Development/CI only; scan duration and rule coverage not measured          |
| `eslint`               | Lint engine                                                                | `10.8.1`  | MIT                          | Metadata modified 2026-08-07                                                                                       | Current graph scan described below; plugin-graph history pending                  | JavaScript on Node                                                                                     | Development/CI only; lint duration not measured                            |
| `@eslint/js`           | ESLint core rule definitions                                               | `10.0.1`  | MIT                          | Metadata modified 2026-07-10                                                                                       | Current graph scan described below; package history pending                       | JavaScript on Node                                                                                     | Development/CI only                                                        |
| `typescript-eslint`    | TypeScript parser and lint rules                                           | `8.66.0`  | MIT                          | Metadata modified 2026-08-07                                                                                       | Current graph scan described below; parser history pending                        | JavaScript on Node; TypeScript program construction can be memory intensive                            | Development/CI only; typed-lint duration not measured                      |
| `globals`              | Explicit browser and Node global-name datasets for lint configuration      | `17.9.0`  | MIT                          | Metadata modified 2026-08-02                                                                                       | Current graph scan described below; package history pending                       | Data/JavaScript on Node                                                                                | Development/CI only                                                        |
| `prettier`             | Deterministic formatting check                                             | `3.9.6`   | MIT                          | Metadata modified 2026-07-21                                                                                       | Current graph scan described below; package history pending                       | JavaScript on Node                                                                                     | Development/CI only                                                        |
| `@types/node`          | Node.js 24 compile-time API declarations                                   | `24.13.3` | MIT                          | Metadata modified 2026-08-07                                                                                       | Current graph scan described below; package history pending                       | Type declarations only; no runtime code                                                                | Development/CI only                                                        |

Any future direct addition, including mutation tooling, must be registered
before it is treated as accepted. Installing it does not silently approve it.

## Approved transitive install scripts

The package policy allows install scripts only for the two exact, optional,
macOS-only `fsevents` resolutions already integrity-pinned in the lockfile:

| Package          | Introduced by                                         | Script observed in installed package | Scope and decision                                                                                                 |
| ---------------- | ----------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `fsevents@2.3.2` | `@playwright/test@1.62.1` through `playwright@1.62.1` | native `node-gyp rebuild` build path | Allowed only at this exact version so Playwright can use the macOS filesystem event adapter; development/test only |
| `fsevents@2.3.3` | `vite@8.2.1`                                          | native `node-gyp rebuild` build path | Allowed only at this exact version so Vite can use the macOS filesystem event adapter; development/test only       |

This is a narrow executable-code approval, not a general approval for dependency
scripts and not a provenance or security attestation. The checked-in
`strict-allow-scripts=true` npm configuration turns an unreviewed install script
into a hard installation failure; the exact `allowScripts` entries are the only
reviewed exceptions. Both packages declare MIT in the locked metadata and are
optional on non-macOS platforms. Their lockfile integrity values, dependency
paths, and `hasInstallScript` markers were inspected locally with
`npm explain fsevents`, `npm ls fsevents --all`, and the lockfile package
records. Clean-checkout installation, native toolchain behavior, transitive
source/provenance review, and SBOM capture remain release gates. Any version or
integrity change requires a new review rather than inheriting this allowlist.
The behavior is grounded in the npm 11 documentation for
[`approve-scripts`](https://docs.npmjs.com/cli/v11/commands/npm-approve-scripts/)
and the
[`strict-allow-scripts` install setting](https://docs.npmjs.com/cli/v11/commands/npm-install#strict-allow-scripts),
then attacked by the repository's unreviewed-script fixture test rather than
trusted from documentation alone.

## Security-history and licence gate

One local `npm audit --json` and one local `npm audit --omit=dev --json` run on
2026-08-10 UTC exited successfully and named no current advisory in the resolved
graph. Their raw JSON was not archived under `evidence/`, so those observations
are **not release evidence**, do not establish historical safety, and must not
be converted into a “secure” or “zero vulnerabilities forever” claim.

Release review still requires:

1. verify lockfile integrity and exact direct/transitive versions from a clean
   checkout;
2. run current production-only and full dependency advisory scans through a
   committed producer;
3. generate an SBOM including transitive packages and managed browser/native
   assets;
4. review all transitive licences, including MPL-2.0 file-level obligations and
   required notices;
5. inspect provenance, maintainers, release history, and response history for
   high-impact build and runtime packages;
6. record accepted risk, upgrade owner, and removal path for every exception;
   and
7. archive raw outputs under `evidence/` with commit, environment, command, exit
   status, and seed metadata.

An advisory scanner reporting no current finding is one time-bounded input, not
proof that a package has no security history.

## Cost and removal boundaries

| Dependency                        | Removal or replacement path                                                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pixi.js`                         | Replace the render adapter while retaining immutable render projections and domain events                                         |
| `idb`                             | Replace with native IndexedDB behind the versioned persistence adapter                                                            |
| `zod`                             | Replace parsers behind ingestion functions while retaining domain types and stable errors                                         |
| Vite/TypeScript/lint/format tools | Preserve the documented command contract and static ESM artifact                                                                  |
| Vitest/fast-check/coverage        | Preserve named invariant tests, seeds, case counts, failure shrinking/replay, and coverage semantics                              |
| Playwright/axe                    | Preserve real-engine lifecycle coverage, automated accessibility rules, reserved-port server contract, and manual-test boundaries |

## Update procedure

On every direct dependency addition or upgrade:

1. record the reason and owning boundary before installation;
2. inspect the proposed exact direct and transitive change;
3. install with exact versions and commit the lockfile change;
4. rerun licence, advisory, SBOM, bundle, and clean-checkout verification;
5. update metadata observations only when they were actually queried;
6. attach regenerable raw artifacts rather than copying green summaries; and
7. remove the dependency if measured value does not justify its cost.

## Current evidence gaps

- The exact graph is locked, but clean-checkout `npm ci` evidence is not
  recorded.
- No transitive licence review, provenance review, integrity report, or SBOM is
  recorded.
- The one-time local advisory outputs are not archived release evidence.
- No production browser bundle has been measured.
- No CI run URL is recorded.
- No dependency is proven suitable for release by this register alone.
