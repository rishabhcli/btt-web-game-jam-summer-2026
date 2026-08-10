# Support matrix

> **Current truth:** no executable release has been verified. The repository is
> not yet in production, and no browser, device, input mode, persistence mode,
> or accessibility configuration is currently a supported release configuration.

## Status vocabulary

- **Supported:** the exact configuration has passed its named release evidence
  on the current release artifact.
- **Candidate:** intended for verification; not a support claim.
- **Refused:** deliberately detected and rejected with a tested user-visible
  explanation.
- **Unsupported/unverified:** not covered by evidence; behavior must not be
  represented as reliable.

Only an evidence link produced from the current release can promote a row to
Supported. “Works on a developer machine,” an emulated viewport, compilation, or
a framework support statement does not qualify.

## Browser and device candidates

| Surface                               | Candidate configuration                                                     | Current status                    | Evidence required before support                                                                                    | Behavior today               |
| ------------------------------------- | --------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Desktop Chromium family               | Exact stable Chromium/Chrome version on declared macOS and Windows hardware | Candidate; unsupported/unverified | Real-engine History API, reload, BFCache, IndexedDB, rapid navigation, input, accessibility, and performance matrix | No verified release artifact |
| Desktop Firefox                       | Exact stable Firefox version on declared desktop OS                         | Candidate; unsupported/unverified | Same lifecycle and outcome matrix on Firefox engine                                                                 | No verified release artifact |
| Desktop Safari                        | Exact stable Safari and macOS versions on declared hardware                 | Candidate; unsupported/unverified | Same lifecycle and outcome matrix, including leaving-site behavior                                                  | No verified release artifact |
| Mobile Safari                         | Exact iOS/iPadOS and Safari versions on physical devices                    | Candidate; unsupported/unverified | Physical-device touch, edge-swipe, suspension, resume, audio, storage, and performance evidence                     | No verified release artifact |
| Chrome for Android                    | Exact Chrome/Android versions on physical mid-range device                  | Candidate; unsupported/unverified | Physical-device touch/back, suspension, resume, storage, audio, and performance evidence                            | No verified release artifact |
| In-app browsers and embedded webviews | No candidate version yet                                                    | Unsupported/unverified            | Capability detection plus a tested refusal/fallback state per container                                             | No verified refusal behavior |
| Other browsers/versions               | Unspecified                                                                 | Unsupported/unverified            | Explicit addition to matrix and full relevant gate evidence                                                         | No support claim             |

Version floors and the meaning of “stable” must be frozen in release evidence.
They may not float silently after a browser update.

## Input and accessibility candidates

| Surface                          | Candidate outcome                                                                        | Current status                    | Evidence required before support                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| Keyboard                         | Every released room is completable; all controls have visible focus                      | Candidate; unsupported/unverified | Per-room E2E plus manual keyboard-only pass                                |
| Pointer                          | Every released room is completable without keyboard-only assumptions                     | Candidate; unsupported/unverified | Per-room pointer E2E on declared desktop browsers                          |
| Touch                            | Every released room is completable with declared target sizing and gesture handling      | Candidate; unsupported/unverified | Per-room touch E2E plus physical-device pass                               |
| Browser Back/Forward             | Native controls rewind/replay while initial-state Back still permits leaving             | Candidate; unsupported/unverified | Lifecycle E2E on every supported browser/device                            |
| In-game Back/Forward equivalents | Equivalent accessible commands without misrepresenting native browser behavior           | Candidate; unsupported/unverified | Keyboard, pointer, touch, semantic-label, and state-equivalence tests      |
| Reduced motion                   | All gameplay information remains available without spatial rewind motion                 | Candidate; unsupported/unverified | Automated preference test plus manual information-equivalence review       |
| Screen-reader-adjacent semantics | Structure, controls, status, errors, and non-canvas equivalents are announced coherently | Candidate; unsupported/unverified | Automated rules plus named screen reader/browser manual matrix             |
| 200% zoom/reflow                 | Controls, help, error states, and status remain usable                                   | Candidate; unsupported/unverified | Visual/manual matrix at 200% zoom on declared viewports                    |
| Color-vision differentiation     | Live player, each ghost, and desynchronization have non-color cues                       | Candidate; unsupported/unverified | Contrast checks and manual color-vision simulation                         |
| Audio muted/blocked              | Visual equivalents preserve every gameplay cue                                           | Candidate; unsupported/unverified | Blocked-audio, mute persistence, resume, and information-equivalence tests |

“Screen-reader-adjacent” does not imply that canvas play is currently
accessible. The exact supported assistive-technology outcome must be based on
observed user tasks and named configurations.

## Storage, lifecycle, and deployment candidates

| Surface                     | Intended contract                                                                            | Current status                    | Evidence required before support                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| IndexedDB durable save      | Versioned local branch graph, snapshots, progress, and settings                              | Candidate; unsupported/unverified | Real-browser integration, schema migration, quota, corruption, crash, and restore tests |
| Session-only degradation    | Visible honest notice when durable storage is unavailable and safe session play can continue | Candidate; unsupported/unverified | Designed-state test and screenshot/transcript                                           |
| Refresh/BFCache recovery    | Recovered state hash equals pre-navigation state hash                                        | Candidate; unsupported/unverified | Per-engine refresh and BFCache E2E                                                      |
| Multi-tab behavior          | Explicit ownership/conflict policy prevents silent corruption                                | Candidate; unsupported/unverified | Real two-context IndexedDB concurrency test                                             |
| Offline/static assets       | Released static artifact can load under the declared cache/network policy                    | Candidate; unsupported/unverified | Clean-browser install/load and offline transition evidence                              |
| Public hosted build         | Tagged CI artifact at a public URL                                                           | Unsupported/unverified            | Reproducible deployment and public smoke evidence                                       |
| itch.io or equivalent entry | Same tested release artifact distributed publicly                                            | Unsupported/unverified            | Public entry and artifact equivalence check                                             |
| Error/session dashboard     | Redacted real destination with release and correlation identifiers                           | Unsupported/unverified            | Live dashboard event, redaction test, privacy review, and incident drill                |

## Explicit product exclusions

The current product contract excludes procedural levels, multiplayer, accounts,
leaderboards, cloud saves, combat, inventory, dialogue trees, a level editor,
framework-authoritative game state, and silent ghost path correction. Exclusion
is not a runtime support claim; shipped UI must not expose dead controls or
imply that an excluded capability exists.

## Promotion procedure

To change any row to Supported:

1. name the exact release tag, artifact digest, environment, versions, and
   device;
2. run the committed clean-checkout gate and the row-specific test matrix;
3. archive regenerable output under `evidence/`;
4. test the outside-matrix refusal or limitation where applicable;
5. link the evidence in the row; and
6. publish the same limitation where the player acts on it.

No row currently meets this procedure.
