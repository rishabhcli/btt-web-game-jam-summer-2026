# ADR-0002: Fail-closed development port allocation

- **Status:** Accepted for the Tier 0 development contract
- **Decision date:** 2026-08-09
- **Scope:** `GOAL.md` section 0A port ownership and relocation conflict
- **Production status:** Not yet in production

## Context

`GOAL.md` assigns the four current services to `127.0.0.1:4140` through
`127.0.0.1:4143` and reserves `4144` through `4149` for services discovered
later. Its two foreign-listener rules cannot both be satisfied as written:

1. section 0A.2 rule 5 says to relocate an assigned service to a free reserved
   port when its assigned port is held by a foreign process; and
2. section 0A.4 requires `dev:preflight` to fail when **any** port in the whole
   `4140` through `4149` block is held by a foreign process.

After a relocation, the original foreign listener would still be inside the
block, so the required preflight would still have to fail. Silently choosing one
interpretation would violate the repository conflict rule in `AGENTS.md`.

This decision concerns only local development-service allocation. It does not
grant authority to stop, inspect beyond ownership evidence, or modify a foreign
process.

## Decision

The development contract fails closed on a foreign listener anywhere in the
exclusive block. The four assignments remain exactly:

| Service                         | Address          |
| ------------------------------- | ---------------- |
| Game Vite server                | `127.0.0.1:4140` |
| Production preview              | `127.0.0.1:4141` |
| Browser-history E2E Vite server | `127.0.0.1:4142` |
| Static-bundle server            | `127.0.0.1:4143` |

Ports `4144` through `4149` remain unallocated. Discovering a future service
requires a reviewed update to `ports.env`, the launcher contract, health
identity, tests, and this ADR or a superseding ADR before anything binds there.

When any address in the block is occupied by a process that the repository
cannot prove it started and still owns, lifecycle commands:

- report the exact affected port and observable holder identity;
- perform no signal, deletion, build, bind, or relocation;
- return non-zero; and
- remain retryable after the foreign process disappears through action outside
  this repository.

The launcher may reconcile and stop only a stale process whose recorded PID,
start identity, actual working directory, process-group ancestry, command,
socket ownership, service identity, and run record all revalidate. A matching
command string or HTTP marker alone is never ownership evidence.

This interpretation supersedes only the relocation instruction in section 0A.2
rule 5. It retains and strengthens that rule's core protections: no bind outside
the exclusive block, no framework default, and no signal to a process the
repository did not start. It also implements the later, concrete Tier 0
preflight requirement without an exception that would make the whole-block check
false.

## Alternatives considered

### Dynamically relocate to `4144` through `4149`

Rejected for Tier 0. It cannot make the required whole-block preflight green
while the original foreign listener remains. It would also make Playwright,
static-server validation, PID evidence, health URLs, and concurrent callers
depend on mutable allocation state, increasing the chance that one component
uses a stale port.

### Ignore the foreign original after recording a relocation

Rejected. This weakens the explicit exclusive-block check and permits two
repositories to treat the same reserved namespace as valid simultaneously.

### Stop the foreign holder

Prohibited. Command similarity, username, or a familiar path does not prove that
this repository owns the process, and broad or guessed shutdown risks destroying
another agent's work.

## Consequences

### Positive

- Every service URL remains deterministic across the launcher, Playwright, logs,
  evidence, and support instructions.
- A foreign listener can never be hidden by opportunistic relocation.
- Failure is visible and non-destructive on the shared workstation.
- Reserved ports stay genuinely available for reviewed future services.

### Negative

- Development cannot proceed while a foreign process occupies any address in the
  block, even if another reserved port is free.
- Resolving the collision may require waiting for work outside this repository
  to finish; this repository still cannot stop or alter that work.

That availability cost is accepted because it is safer and satisfies the
explicit Tier 0 whole-block gate. A prolonged collision is recorded in
`BLOCKED.md` only when it meets the narrow external-blocker definition in
`GOAL.md`; it does not justify bypassing preflight.

## Verification

The committed launcher tests must demonstrate all of the following:

1. exact loopback assignments `4140` through `4143` are accepted;
2. no service binds or accepts an override outside its assignment;
3. a foreign listener on an assigned or reserved port fails preflight without
   receiving a signal;
4. wildcard and IPv6 listeners on a block port also fail;
5. an exact repository-owned ready service is recognized without duplication;
6. stale/reused/forged identity records fail closed; and
7. shutdown signals only the identities recorded for the exact run and leaves
   every foreign process alive.

The decision is not verified merely because this ADR exists. Tier 0 still
requires focused hostile tests, a real `dev:preflight`/`dev:up`/`dev:health`/
`dev:down` lifecycle, and clean-checkout `verify-all` evidence.

## Reversal

A future relocation design requires a superseding ADR that resolves the
whole-block preflight semantics, uses one atomic typed allocation as the only
source for every server and test runner, migrates active PID/evidence records,
and proves concurrency and foreign-listener safety. Until that is implemented
and reviewed, fail-closed fixed allocation is authoritative.
