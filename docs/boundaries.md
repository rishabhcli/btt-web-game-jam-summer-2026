# Source-boundary policy

The deterministic domain must remain executable without the renderer, browser
history, browser persistence, UI frameworks, or framework-owned mutable state.
This makes the canonical reducer and its hashes independently testable and
prevents an adapter from becoming gameplay authority.

## Pure packages and import matrix

The checker treats `src/domain/`, `src/engine/`, `src/ghosts/`, `src/levels/`,
and `src/history/domain/` as pure packages. The browser-facing remainder of
`src/history/` is an adapter and is deliberately outside the pure set. The
foundation-only `src/build-status.ts` module follows the `domain` rule until its
status contract moves behind a later application boundary.

| Importer         | Allowed pure targets                 |
| ---------------- | ------------------------------------ |
| `domain`         | `domain`                             |
| `engine`         | `domain`, `engine`                   |
| `ghosts`         | `domain`, `engine`, `ghosts`         |
| `levels`         | `domain`, `engine`, `levels`         |
| `history/domain` | `domain`, `engine`, `history/domain` |

Every other local `src/` target is denied. This is a fail-closed matrix rather
than a list of known-bad folders: a newly created local area or alias cannot
silently become a pure dependency. Relative imports outside `src/` and
configured aliases whose targets cannot be resolved are also denied.

External packages are denied by default; the current reviewed domain-neutral
allowlist contains only `zod`. Adding another entry requires a policy update and
a passing/violation test in the same change. Pure files may not import:

- any adapter, application, renderer, browser-history, audio, input, UI,
  persistence, telemetry, transport, or other unreviewed local area;
- rendering and UI SDKs such as PixiJS, Phaser, React, Vue, Svelte, or Three.js;
- browser persistence, browser telemetry, or cloud SDKs such as `idb`, Dexie,
  LocalForage, Firebase, Supabase, or Sentry's browser package;
- framework-state packages such as Redux, Zustand, MobX, XState, Jotai, Recoil,
  or Pinia.

`scripts/check-boundaries.mjs` parses candidate TypeScript and JavaScript with
the TypeScript compiler API, then rejects JavaScript, JSX, declaration files,
and other non-`.ts` modules from pure packages. It inspects static imports,
type-only imports, re-exports, TypeScript import-equals declarations, CommonJS
`require`, and dynamic `import`. Comments and ordinary strings are not treated
as imports. Non-literal dynamic module references in pure code fail closed
because their target cannot be verified statically. Triple-slash path/type/lib
authority and AMD/no-default-lib directives are also rejected.

The checker understands relative imports, the `@/` and `~/` source aliases,
`src/`-rooted paths, and aliases resolved through referenced TypeScript project
configs. It also rejects ambient runtime inputs that would make canonical state
host-dependent: unseeded randomness, wall-clock/timer APIs, browser state,
network APIs, host locale/timezone data, worker/shared-memory scheduling, and
garbage-collection timing. Locally shadowed names are resolved through the
TypeScript symbol table rather than rejected by spelling alone. The global
`Date` and `crypto` capabilities are prohibited in full. `Math` is limited to
the checked integer-oriented allowlist in the checker; computed access and
transcendental functions fail closed. Runtime code generation, native
locale-sensitive methods, and native `Error.stack` diagnostics are prohibited,
while same-named methods on local domain types are not spelling-based false
positives. Any symlink anywhere below `src/` also fails the gate so source
cannot escape or evade traversal.

`tsconfig.domain.json` independently compiles the pure folders against only the
ES2022 library, aligned with the Vite production target, with an empty `types`
list. Browser/Vite globals belong to `tsconfig.app.json`; Node and Vitest
globals belong to the Node and test configs. The pure and app projects emit
declarations only into the ignored `.dev/cache/typescript/` tree. App and test
projects reference those declarations and exclude pure source, so a domain file
is never silently recompiled with DOM, Node, or Vitest ambient types. The root
solution references every config, so `npm run typecheck` cannot skip the pure
check.

Run the structural gate with:

```sh
npm run check:boundaries
```

The gate emits stable error codes and exits non-zero for violations or parse
errors. New adapters or external SDKs must update the policy and its Node test
in the same change; an import is not allowed merely because its package is not
yet listed.
