# BTT Web Game Jam - Summer 2026: Winning Idea Dossier

> **Status:** One idea selected; no product name assigned; no implementation started.
> **Deadline:** August 21, 2026 at 9:00 AM PT.
> **Ground truth:** [`HACKATHON.md`](./HACKATHON.md) remains authoritative for rules, links, and submission fields.

## Final decision

Build a short, polished browser-native puzzle game in which the browser's actual **Back** and **Forward** controls are the time machine. Every meaningful move becomes a history entry. Back rewinds the world, Forward replays it, and acting after a rewind turns the abandoned future into a ghost that repeats its old actions. The player solves rooms by collaborating with timelines they deliberately discard.

No product name is proposed here. “Browser-history time puzzle” is only a mechanic description.

## Why this is the winner

The event has only three criteria: **Creativity**, **Fun Factor**, and **Technical Execution**. This concept makes one memorable promise that scores all three at once:

> The control judges already use to leave a web page becomes the game's central mechanic.

It is not a platformer with generated art, a generic roguelike, a quiz, a chatbot, or a tech demo that needs a paragraph before it becomes a game. A judge understands the surprise the first time the developer clicks the browser Back button and the character, switches, particles, and music all rewind in place.

The mechanic is technically meaningful rather than cosmetic. It depends on the History API, deterministic state capture, branch preservation, replayable command logs, and careful behavior across refreshes and mobile back gestures. Yet the implementation serves an immediately playable loop instead of becoming infrastructure nobody feels.

### Ideas deliberately rejected

- **Generic platformer or endless runner:** easy to finish, almost impossible to distinguish.
- **LLM-generated levels or dialogue:** an API call would be mistaken for the idea, and nondeterminism would undermine puzzle design.
- **Multiplayer party game:** networking and lobby reliability would consume the twelve-day window while improving none of the three criteria enough.
- **Procedural puzzle generation:** produces quantity, not authored delight; difficult to guarantee solvable, teachable rooms.
- **Audio- or webcam-controlled game:** visually novel but fragile in judging environments and inaccessible by default.
- **Multiple-window or multiple-tab game:** browser popup restrictions create a setup tax before the fun begins.
- **A normal rewind mechanic with an on-screen button:** already familiar. The native browser navigation contract is the part judges will remember.

## Experience in one sentence

Solve eight compact rooms by making a plan, rewinding it with the browser's real Back button, and branching so a ghost of the future you abandoned can perform one half of the solution while you perform the other.

## Core player fantasy

The player is not “controlling time” through a themed button. They are editing the page's history as if it were a physical place. Browser navigation, normally outside the game world, becomes diegetic.

The emotional rhythm is:

1. **Observe:** see a room whose switches cannot be held by one body.
2. **Attempt:** execute a short sequence and reach a dead end.
3. **Rewind:** use native Back one or more times; the entire scene reverses cleanly.
4. **Branch:** take a different action. The discarded forward sequence becomes a translucent ghost.
5. **Coordinate:** time the live character against the ghost's replay.
6. **Resolve:** both timelines satisfy the room at once; the exit opens.

Failure is cheap and often funny. There are no lives, loading screens, inventory menus, or restart confirmations.

## Scope boundary

### Build exactly this

- One deterministic, top-down or shallow-isometric puzzle game.
- Eight handcrafted rooms, each lasting roughly 60 seconds to four minutes.
- Native Back/Forward navigation plus visible, accessible in-game equivalents.
- One abandoned branch replaying as a ghost at a time for the first six rooms; up to two ghosts in the final rooms.
- A compact timeline visualization showing the live branch and discarded branches.
- Keyboard, pointer, touch, and reduced-motion support.
- A complete beginning, escalation, climax, and ending in roughly 20 minutes.

### Do not build

1. **No accounts, cloud saves, leaderboard, or backend.** Local persistence is enough.
2. **No procedural rooms.** Every room must teach one idea and have an authored reveal.
3. **No combat system.** The mechanic is coordination, not reflex shooting.
4. **No narrative dialogue tree.** Story is environmental and limited to a few lines.
5. **No level editor.** It is a second product and a classic jam trap.
6. **No more than eight rooms.** A polished six-room cut is better than twelve uneven rooms.
7. **No product name until the game loop survives playtesting.**

## Rules of time

The rules must be simple enough to learn without a tutorial paragraph:

- A move, push, switch activation, pickup, or wait is one **action**.
- Completing an action appends a state to browser history.
- Back moves to the preceding state and animates the transition in reverse.
- Forward replays the next stored state if the player has not branched.
- Taking a new action after rewinding discards the browser's forward stack. The game preserves that discarded command suffix as a **ghost track**.
- A ghost replays only commands that remain physically valid. If blocked by a changed world, it stops and visibly “desynchronizes” rather than teleporting or improvising.
- The live player can erase the newest ghost, but doing so restores the room to the branch point. This prevents unsalvageable states.
- Certain late-game objects are **anchors**: their state belongs to the branch graph rather than the rewound world. Anchors are rare and introduced only after ghost replay is understood.

The game should never pretend a failed replay is correct. Desynchronization is a legible game state, not a hidden correction.

## Room progression

### Room 1: Back means rewind

A straight corridor ends in a floor collapse. The only instruction is a subtle browser-back glyph in the environment. Back restores the tile and character. No ghost yet.

### Room 2: Forward means replay

The player rewinds past a switch press, sees the door close, then uses Forward to replay the press. This establishes that browser history is not just undo.

### Room 3: The first branch

One pressure plate opens a distant door. The player records walking onto the plate, rewinds, then branches. The abandoned future becomes a ghost that walks onto the plate while the live player goes through the door.

### Room 4: Timing

A moving hazard forces the player to insert explicit Wait actions so the ghost and player arrive together. This turns the system from a static clone gimmick into choreography.

### Room 5: Changed geometry

The live branch moves a crate into the ghost's old route. The ghost desynchronizes at the exact collision. The solution requires preserving its corridor. This teaches that branches share the resulting world but not arbitrary corrections.

### Room 6: One anchor

A single object can remain changed through a rewind. The room asks the player to carry information from a discarded future into its past without text exposition.

### Room 7: Two ghosts

Two short discarded suffixes operate separate mechanisms. The timeline view expands but keeps a strict color hierarchy.

### Room 8: Browser history as level

A compact finale uses Back, Forward, one branch, two ghosts, and one anchor. It should take fewer than twenty actions when solved and look impossible before the player recognizes the choreography.

## Architecture

```text
Input adapters
  keyboard / pointer / touch / browser popstate
                    |
                    v
Deterministic command reducer
  WorldState × Command -> WorldState + Events
                    |
          +---------+----------+
          |                    |
          v                    v
History bridge          Branch graph
pushState/popstate      commands, snapshots,
state id only           ghost suffixes, hashes
          |                    |
          +---------+----------+
                    v
Fixed-step simulation and tween renderer
                    |
          +---------+----------+
          |                    |
          v                    v
Canvas/WebGL scene       Audio timeline
sprites, particles       forward/reverse stems
                    |
                    v
IndexedDB persistence + deterministic replay tests
```

### Recommended stack

- TypeScript and Vite.
- PixiJS or Phaser for rendering, but a custom command/state layer rather than framework scene state.
- Web Audio API for synchronized music and reverse cues.
- IndexedDB for snapshots, command branches, settings, and local progress.
- Playwright for browser navigation, refresh, and input regression tests.
- Vitest/property tests for reducer determinism and serialization round trips.
- GitHub Pages, Netlify, or Vercel for the playable URL.

## Hard technical core

### 1. Deterministic command model

The game cannot save arbitrary mutable engine objects. Every player action becomes a serializable command such as:

```text
Move(entityId, dx, dy)
Push(actorId, objectId, dx, dy)
Wait(ticks)
Toggle(actorId, switchId)
Anchor(objectId)
```

A pure reducer applies a command to a canonical `WorldState`. Visual movement is an interpolation between two committed states, never the authority. Randomness uses a seeded generator whose state is serialized. Entity iteration order is stable. Fixed-point or integer grid coordinates avoid floating-point drift.

A state hash is recorded after every action. Replaying a branch from its nearest snapshot must produce the same hash at every step. Any mismatch fails development tests immediately.

### 2. Browser History API bridge

`history.pushState` stores only a small opaque state ID, not the full world. Full snapshots and command metadata live in IndexedDB to avoid browser-specific state-size limits.

`popstate` does four things:

1. freezes new game input;
2. looks up the target node;
3. computes whether navigation is backward or forward relative to the active branch;
4. animates the state transition and re-enables input only after the canonical state is installed.

The app seeds a safe initial entry but must not trap users. At the first game state, Back should show a clear “Back again leaves the game” message and then allow normal navigation. Accessibility and trust matter more than a clever history hack.

### 3. Branch capture

Browsers discard the native forward stack after a new `pushState`, and do not expose that stack. The game therefore maintains its own branch graph:

```text
node = {
  id,
  parentId,
  commandFromParent,
  stateHash,
  snapshotId?,
  children[],
  activeChildId?
}
```

Before appending a new action from a rewound node, the game identifies the formerly active child and walks its suffix into a ghost command track. The browser forgets it; the game does not.

### 4. Ghost replay and causality

Ghosts replay commands at action boundaries against the current world. Each command has declared preconditions. If a precondition fails, replay transitions to `desynchronized` and shows the collision point. The engine never silently retargets or pathfinds for a ghost because that would destroy the player's mental model.

Simultaneous actions resolve in a published order: environment, oldest ghost, newer ghost, live player. Puzzles are authored around this order, and a small inspector shows it during development.

### 5. Snapshot strategy

Store a full snapshot at room start, each branch point, and every 12 actions. Other nodes store commands only. Rewind loads the nearest ancestor snapshot and replays forward, bounded to eleven commands. This keeps Back responsive without duplicating every state.

### 6. Browser lifecycle correctness

Test all of the following explicitly:

- refresh on a non-root history entry;
- BFCache restore after leaving and returning;
- page suspension on mobile;
- touch back gesture firing before an animation completes;
- double-clicking Back/Forward rapidly;
- a deep-linked room without prior local state;
- blocked or unavailable IndexedDB;
- audio context suspended until user interaction.

## Visual and audio direction

The page should look authored rather than like a framework demo:

- A restrained dark field with warm live-world geometry.
- The active player rendered solid; ghosts use distinct cyan/magenta temporal trails rather than lower opacity alone.
- Rewind pulls particles, doors, and footsteps backward along their trajectories.
- The timeline is a thin branching line integrated into the floor or top border, not a developer graph.
- Typography is large, sparse, and limited to controls or one-sentence prompts.
- Music is built from reversible stems. Back briefly reverses percussion and room ambience; branching adds a harmonic layer for each ghost.
- Reduced-motion mode replaces spatial rewind with a high-contrast state dissolve and preserves all information.

## Fun safeguards

Technical novelty will not save a puzzle that feels laborious. Enforce these constraints:

- No solution longer than 25 committed actions.
- Rewind animation under 250 ms per action, with hold-to-scrub for multiple actions.
- Restart from room beginning in one input.
- Undo never consumes a resource.
- The first ghost appears within 90 seconds of starting.
- Every room introduces at most one new rule.
- Playtest without narration; if a tester needs the developer to explain a room, rewrite the room.
- The final room recombines learned rules instead of adding a ninth mechanic.

## Validation and testing

### Engine tests

- Reducer purity: same state + command yields byte-identical next state.
- Replay determinism across 10,000 generated legal command sequences.
- Serialize/deserialize round-trip preserves state hash.
- Snapshot plus suffix equals uninterrupted simulation.
- Ghost precondition failures are deterministic and visible.
- Rapid `popstate` events coalesce without losing the final requested target.

### Playtest metrics

For at least six external playtest sessions, record:

- seconds until the player independently tries browser Back;
- room completion time;
- number of restarts;
- point of first confusion;
- whether the player can explain ghost creation in one sentence;
- whether they voluntarily replay a room for a cleaner solution.

Success threshold: five of six testers understand the central mechanic without spoken explanation by the end of Room 3, and median full-game completion remains below 25 minutes.

## First 48-hour kill test

The riskiest assumption is not rendering. It is whether browser navigation can feel immediate and trustworthy rather than like the page is malfunctioning.

Build only this vertical slice:

1. one room, one character, one pressure plate, one door;
2. four atomic commands persisted by ID;
3. native Back and Forward transitions through them;
4. branch after rewind;
5. old suffix replayed by one ghost;
6. refresh and resume at the current state.

Put it in front of three people without explaining the mechanic. Kill or radically simplify the concept if any of these remain true after iteration:

- Back leaves or reloads the site unexpectedly;
- state transitions take more than 300 ms;
- a tester cannot tell live player from ghost;
- branching produces a state the developer cannot explain;
- mobile back behavior cannot be made reliable;
- the pressure-plate room is clever but not enjoyable on a second attempt.

## Build order

### August 9-10: engine proof

Command reducer, state hash, History API bridge, branch capture, one ugly pressure-plate room. No art.

### August 11: replay reliability

Ghost preconditions, snapshots, IndexedDB, refresh/BFCache recovery, rapid Back/Forward tests.

### August 12: first three rooms

Teach Back, Forward, and branching. Add keyboard, pointer, and touch input.

### August 13: timing and desynchronization

Rooms 4-5, wait command, visible replay failure, first audio pass.

### August 14: anchor mechanic

Room 6 and only the minimum persistent-state rule needed for it.

### August 15: finale systems

Second ghost support and development inspector. Draft Rooms 7-8.

### August 16: feature freeze

All rooms playable end to end. Cut any room that is not fun. No new mechanics after this date.

### August 17-18: art, audio, responsiveness

Lighting, particles, typography, reversible sound cues, touch targets, reduced motion, color-blind-safe ghost differentiation.

### August 19: blind playtests

Six sessions, capture metrics, fix the two largest comprehension failures only.

### August 20: submission production

Record a clean 2-3 minute demo, take 3:2 screenshots, write README and Devpost copy, deploy final build.

### August 21 before 7:00 AM PT

Final smoke test on a clean browser profile and phone. Submit at least two hours before the 9:00 AM deadline.

## Demo video storyboard, 2:20

- **0:00-0:08:** Cold open on a character falling into a trap. No logo or explanation.
- **0:08-0:22:** Cursor clicks the browser's real Back button. The world runs backward and restores the character. This is the first hook.
- **0:22-0:38:** The player walks onto a switch, rewinds, and chooses a different direction.
- **0:38-0:52, winning moment:** The discarded future peels off as a ghost, walks onto the switch, and holds the door while the live player exits. Let the action sit for a beat.
- **0:52-1:15:** Fast montage of timing, a desynchronized ghost hitting a moved crate, and an anchored object surviving rewind.
- **1:15-1:34:** Show the branch timeline and one deterministic state-hash/replay test, proving the mechanic is an engine rather than a video trick.
- **1:34-1:52:** Touch and keyboard play, reduced-motion setting, instant restart.
- **1:52-2:12:** Finale choreography with two ghosts. Do not reveal the full solution.
- **2:12-2:20:** End on the browser Forward button replaying the solved room. One sentence: “The browser already had a time machine.”

The video must show the browser chrome. Cropping it out would erase the entire differentiator.

## Rubric map

### Creativity

- Browser navigation is not a wrapper around the game; it is the game rule.
- Branch deletion becomes a playable object through ghost capture.
- The idea is understandable from one action and difficult to confuse with another entry.

### Fun Factor

- Rewind removes punishment and encourages experimentation.
- Ghost collaboration produces short “I made that happen” reveals.
- Eight authored rooms create a complete difficulty curve instead of an endless prototype.
- Fast actions, clean restarts, and no resource cost keep the loop playful.

### Technical Execution

- Deterministic reducer and state hashing.
- Browser-history synchronization and safe native navigation behavior.
- Branch graph independent of the browser's inaccessible forward stack.
- Snapshot/replay architecture, IndexedDB recovery, BFCache and mobile testing.
- Responsive rendering, audio synchronization, accessibility, and a polished deployed link.

## Submission plan

- Public GitHub repository already exists; keep it public.
- Playable deployment is mandatory in practice even though the page calls it optional.
- README must include controls, supported browsers, architecture diagram, local setup, accessibility settings, known limitations, and AI-assistance disclosure.
- Demo video: 2-3 minutes, public on YouTube or Vimeo.
- Thumbnail: 3:2 frame containing browser chrome, live player, and one ghost.
- Gallery: at least six images covering branch creation, timeline, two-ghost finale, touch controls, reduced motion, and architecture.
- Built-with tags: TypeScript, Vite, PixiJS/Phaser, Web Audio API, History API, IndexedDB, Playwright, Vitest, GitHub Pages/Vercel.
- About section follows Inspiration / What it does / How built / Challenges / Accomplishments / Learned / Next, but leads with the native Back-button moment rather than setup.

## Repository plan

```text
/
├── README.md
├── LICENSE
├── package.json
├── src/
│   ├── engine/
│   │   ├── commands.ts
│   │   ├── reducer.ts
│   │   ├── state.ts
│   │   ├── hash.ts
│   │   ├── replay.ts
│   │   └── snapshots.ts
│   ├── history/
│   │   ├── bridge.ts
│   │   ├── branch-graph.ts
│   │   └── persistence.ts
│   ├── game/
│   │   ├── levels/
│   │   ├── ghosts.ts
│   │   ├── interactions.ts
│   │   └── progression.ts
│   ├── render/
│   ├── audio/
│   ├── input/
│   ├── accessibility/
│   └── main.ts
├── tests/
│   ├── determinism/
│   ├── history/
│   └── e2e/
├── public/
└── docs/
    ├── architecture.svg
    ├── playtest-notes.md
    └── submission-checklist.md
```

## What would make this lose anyway

1. **It feels like a clever API demo instead of a game.** The cure is authored rooms and blind playtests, not more engine features.
2. **Back navigation behaves differently in the judge's browser.** Test Chrome, Safari, Firefox, desktop, and mobile; provide in-game controls without hiding the native mechanic.
3. **The player cannot predict ghost behavior.** Never allow silent correction or dynamic pathfinding.
4. **The first reveal arrives too late.** A ghost must exist within 90 seconds.
5. **Visual polish is deferred until the final night.** Feature-freeze by August 16.
6. **Too many rooms dilute quality.** Cut aggressively.
7. **A judge has seen time-clone games before.** The answer is not claiming the entire genre is new; it is executing the browser-history contract so completely that this could only be a web game.

The winning version is a finished twenty-minute game whose technology disappears after teaching one unforgettable rule.