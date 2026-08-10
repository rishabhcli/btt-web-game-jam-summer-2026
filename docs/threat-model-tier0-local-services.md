# Tier 0 local-service threat analysis

- **Status:** implemented controls require clean-checkout verification
- **Recorded:** 2026-08-09
- **Scope:** development lifecycle, loopback HTTP services, build/static asset
  serving, Playwright reuse, PID records, logs, and repository-local caches
- **Production status:** not yet in production

## Security objective

The Tier 0 service contract must let this repository build and test real browser
surfaces without exposing a network listener, writing outside the checkout,
trusting a foreign process, signaling another agent's work, reusing a spoofed
HTTP server, or presenting a stale/broken artifact as ready.

The services do not process player saves, credentials, accounts, payment data,
or production traffic. They still form a security boundary because a malicious
local process, inherited environment, filesystem link, browser origin, or
corrupt build could cross repository ownership.

## Assets and invariants

1. Every listener is exactly on `127.0.0.1` and its assigned port; no wildcard,
   IPv6, framework-default, or outside-block listener is accepted.
2. Only a process created for the exact repository run may be recorded,
   health-checked, reused by Playwright, or signaled during cleanup.
3. `.dev/`, `dist/`, logs, PID records, temporary files, caches, and served
   files remain physically inside this checkout and cannot be redirected by a
   symlink.
4. Readiness binds one exact process/socket identity to one service identity and
   one source/config/lock/build digest. A TCP accept or copied HTTP header is
   insufficient.
5. Build and request work is bounded; cancellation and crash reconciliation do
   not leave an unowned listener.
6. Local service output and preserved evidence contain no inherited credential
   values.

## Trust boundaries and actors

| Boundary              | Untrusted input or actor                                                            | Required treatment                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Port block 4140-4149  | Any pre-existing local TCP4/TCP6 holder                                             | Inspect without signaling; fail closed on any foreign holder                                                              |
| Process table         | Reused PID, copied argv, forged `PATH`, changed cwd/session/group                   | Read identity from absolute OS tools; bind PID, start token, cwd, group/session, run token, command, ancestry, and socket |
| Repository filesystem | Symlinked `.dev` component or `dist`, traversal, encoded separators, oversized file | Reject before build/write/serve; require real paths inside the repository and regular bounded files                       |
| Child environment     | Debugger flags, proxy/credential variables, poisoned tool lookup                    | Pass an allowlist or sanitized environment; remove debugger-bearing Node options; use absolute identity tools             |
| HTTP request          | Malicious local client, alternate Host, unsupported method/range, slow request      | Exact Host/address, GET/HEAD only where applicable, bounded headers/body/timeouts, one bounded range, security headers    |
| HTTP readiness        | Foreign responder copying marker/body                                               | Prove exact live socket PID set and recorded identity before validating multiple real content paths                       |
| Build artifact        | Stale source, missing/corrupt manifest asset, symlinked output                      | Atomic build, complete referenced-asset digest, source/config/lock binding, preview/static browser execution              |
| Playwright reuse      | Stale record, foreign 4142/4141/4143, concurrent lifecycle mutation                 | Reuse only after locked exact ownership/readiness proof; otherwise start when free or fail foreign                        |

## Threats, controls, and verification

| Threat                                                   | Impact                                         | Structural control                                                                                                   | Required hostile test                                                                                            |
| -------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Foreign process holds an assigned or reserved port       | Collision, data leak, another agent disrupted  | ADR-0002 fixed allocation; whole-block preflight; no relocation or broad kill                                        | Assigned/reserved TCP4, wildcard, loopback IPv6, and wildcard IPv6 holders all fail without a signal             |
| PID is reused or a process copies the expected command   | Foreign process signaled or false-owned        | Atomic run record plus independently observed start/cwd/group/session/command/socket identity                        | Reused start token, same argv from foreign cwd, forged tool path, extra/missing holder all fail and remain alive |
| Launcher dies after spawn or bind                        | Orphan listener, future preflight deadlock     | Per-run supervised starting/ready/stopping state and exact process-group reconciliation                              | Kill launcher at every promotion boundary; next preflight/down reclaims only that run                            |
| HTTP service is alive but no longer owns the socket      | Spoofed health passes                          | Exact equality of recorded listener set and current OS socket-holder set before every probe/reuse                    | Keep recorded process alive, replace listener with marker-copying responder, and require health failure          |
| Source/config/lock changes after startup                 | Preview/static silently serves stale code      | Source and build manifest digests in readiness record; drift makes health fail until rebuild                         | Change source/lock/config after start and corrupt/delete a referenced asset                                      |
| `.dev` or `dist` is a symlink                            | External write/delete/serve                    | `lstat` each component, no-follow/exclusive record writes, realpath containment, reject symlink output root          | Point each writable/served path at an external fixture and assert no external mutation or response               |
| DNS rebinding or hostile browser origin reaches loopback | Local source/content exposed or request abused | Exact loopback bind and Host allowlist, Vite CORS disabled, static same-origin resource policy, no mutating endpoint | Alternate Host and cross-origin requests cannot read content; no service exposes a mutation route                |
| Oversized/slow/malformed HTTP request                    | Resource exhaustion or traversal               | Header, target, file, body, range, and request time limits; encoded separator/traversal rejection                    | Boundary-size, timeout, traversal, symlink escape, multi-range, and unsupported method cases                     |
| Inherited `NODE_OPTIONS=--inspect`                       | Forbidden listener opens outside block         | Strip debugger/runtime options from spawned children and record child environment names, never values                | Inject debugger flags and prove no child outside-block listener                                                  |
| Verification timeout kills only npm, not descendants     | Orphan build/test/server/browser process       | Exact per-command process group with bounded TERM/KILL and lifecycle `finally` cleanup                               | Timeout a child tree and prove every created descendant exits while foreign groups remain                        |
| Logs/evidence echo a credential split across chunks      | Secret disclosure in CI artifact               | Environment allowlist plus cross-chunk structural redaction before persistence/tee                                   | Split token across stdout chunks with stderr interleaving and assert raw value absent from every artifact        |

## HTTP posture

The static server is intentionally non-mutating. It accepts only bounded `GET`
and `HEAD` requests for the generated bundle and a readiness document. It has no
upload, command, proxy, file-write, authentication, cookie, or user-data route.
Vite development services expose repository source transformations only for
local testing; they are never a production hosting surface and contain no
secrets. Vite CORS is disabled and the Host allowlist is exactly `127.0.0.1`.

Loopback is an exposure reduction, not authentication. Process/socket identity
and filesystem containment remain mandatory even when the port is reachable only
from the workstation.

## Residual risks and non-claims

- A sufficiently privileged local attacker can inspect or alter any process on
  the workstation. The contract prevents accidental cross-agent ownership and
  common unprivileged spoofing; it is not a host sandbox.
- OS process and socket tools differ across macOS, Linux, and Windows. A
  platform without the exact identity evidence must fail unsupported rather than
  downgrade checks.
- Vite source serving is for development only. No local health pass establishes
  a public security boundary or production deployment.
- Automated accessibility and browser smoke tests do not establish gameplay,
  history correctness, or support for any browser row.
- Preserved CI artifacts are internal and require the evidence protocol's human
  redaction review before publication.

No production, support, zero-risk, or security-certification claim follows from
this document. Its controls become Tier 0 evidence only when the committed
hostile tests, real lifecycle, built-artifact browser rows, and clean-checkout
`verify-all` pass.
