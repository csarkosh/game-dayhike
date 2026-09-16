# The Register and the Hollow — story and gameplay design

**Date:** 2026-09-08
**Status:** Design agreed. Sub-projects A, G1 and T are built; the rest are not (§17).
Implementation planning happens separately; this document deliberately contains no
tasks, phases, or file-level plan.

## 0. What this document is

Day Hike has a world and no game. It has terrain, an endless forest, weather, wildlife,
a highway, lobbies, netcode and a hitscan rifle — and no objective, no antagonist, and
no reason to be afraid. This is the design for the game that goes in it: a story arc and
a gameplay loop that together produce **dread and the sense of being stalked**, and an
**objective that can be beaten**.

Where a decision has been made, it is recorded in §1 and stated as settled in the body.
Where the shape is a proposal that has not been decided, it is flagged inline and collected
in §13.

## 1. Decisions (the frame)

Taken in the order they were made.

1. **Siege, not journey or loop.** A bounded site, a task under escalating pressure, and
   an exit — over a road-trip structure and over a repeating-day structure.
2. **The site is the Trailhead Register**, and the antagonist is **the Hollow**: one
   entity, persistent, unkillable.
3. **First person, and no weapons of any kind.** "I want the characters to survive the
   monster — not fight it." The existing rifle leaves the game entirely.
4. **The dread channels are shader distortion, lighting, and whispers**, scaling with
   proximity to the Hollow.
5. **A cutscene plays on Play**, masking world generation, establishing the story, *and*
   teaching the rules of the world.
6. **Four names** in the register at the start. *Superseded 2026-09-15 by sub-project B
   (`docs/gameplay/2026-09-15-register-and-count.md` §1.1): the count is however many sites
   the world builds, 2 to 4.*
7. **The Hollow is visible from Act 1**, but always far enough away to be hard to notice.
8. **The world starts bright and gets darker, mistier and eerier** as the game progresses.
9. **Total loss is a black screen with Edgar Allan Poe-style prose** about the characters'
   fate.
10. **The highway is outside the forest, where the forest ends.** It is visible or audible
    and **not the exit**. *Amended 2026-09-09:* the cliffs are gone; nothing physical keeps the
    player off the road. An invisible wall at the road edge with a spoken line ("I need to
    find those missing hikers first") does, built as its own later piece. A trail leads up
    from the trailhead at the side of the highway over open hillside.
11. **The trail forks** — on the way up, and again inside the forest — and four forks lead
    to the four landmarks. The register records which landmark each hiker was last seen
    near.
12. **Flagging tape is the only wayfinding aid**, it is **retroreflective**, and going too
    far off-trail escalates the dread until the Hollow arrives.
13. **The leash and the stalker are one system.** No invisible walls and no "turn back"
    message: the edge of the world is the monster.
14. **Joining players spawn near the host**, off-trail, so they appear to emerge from the
    forest. Their cutscene plays while their own world builds, whether or not the others
    are already playing.
15. **Contact kills.** An earlier proposal in which contact "took" a player, added their
    name to the book, and allowed a rescue, was rejected.
16. **Carry-and-light**: a player may hold the headlamp while carrying. The stricter
    carry-*or*-light rule is held in reserve as a difficulty lever.
17. **Escalation tracks progress, not the clock** — retrieval ratchets it up, and straying
    off-trail spikes it until the player returns. *Amended 2026-09-15 (B §1.14): the ratchet
    fires on the first pick-up of each hiker's item, not on each sign-out.*
18. **The car is the exit.**
19. **The stalker asset is a placeholder** until the real one exists.

## 2. Premise and win condition

Day hikers park at a trailhead below a forested ridge. In the trailhead register — the
wooden box on a post where hikers sign in and out — are names that signed in and never
signed out. *(Amended 2026-09-15, B §1.3: the last entry is NOT the player's own name. The
register lists the missing and nobody else.)*

The Hollow is what keeps the book. It has been counting for a long time and it considers
the players overdue. *(The identity of the Hollow as the book's keeper is a proposal —
§13.)*

To win: **find what is left of the missing hikers, sign each of them out, and get every
living player to the car.** The final walk happens in full dark. *(Amended 2026-09-15, B
§1.1 and §1.11: the count is the world's site count, and there is no self sign-out.)*

## 3. Geography

The world is a bowl with one entrance.

- The **highway** runs outside the forest on open hillside (the cliffs were removed on
  2026-09-09, see `docs/trail/2026-09-09-open-hillside-trail.md` §8). It can be seen and heard.
  An invisible wall with a spoken line keeps the player off it; it is not the exit.
- The **trailhead** sits at the side of the highway: parking, the **car**, the **register**
  on its post. This is the only lit, known, safe-ish point in the game.
- The **trail** climbs from the trailhead into the forest. It is the only way up.
- Everything else is forest, rock terraces, and altitude.

The bowl is what makes the boundaries honest. The player is not fenced in by design; they
are fenced in by terrain, and by what lives past the tape.

**Altitude is an escalation axis.** The existing montane terrain gives elevation for free:
higher means colder, thinner trees toward the treeline, fewer animals and more mist. The
furthest fork should also be the highest, so climbing *feels* worse independently of
progress. *(Proposal — §13.)*

## 4. The trail network

> **Superseded 2026-09-11 for the graph's shape** by the trail system
> (`docs/trail/2026-09-11-trail-system.md` §3.1): a stem to a made peak, the only dead end, and
> seeded loops round meadows and ponds. The overlook became the peak and the clearing the meadow;
> the stand and the talus are scenery off the trail, not graph nodes. Where the four sites of §5
> live on that graph is open (sub-project B).

- One **main trail ascending** from the trailhead, which carries the player into the
  forest.
- **Forks on the way up**, and **further forks once inside the forest**.
- Four of those forks terminate at the **four landmarks** — the four sites.
- **Old wooden fork signs** carry the landmark names, so the register's "last seen near the
  old stand" is a thing the player can actually follow. *(Proposal — §13.)*

**Landmark types must be things this terrain genuinely produces.** An earlier list included
*the road bend* and *the beach*; both are void under §3, because the road and the shore are
outside the bowl. Probing five seeds (sub-project A's design, §1) then removed two more and
merged two: **the creek and the tarn are not producible** — `water` in `sim/` is sea level
only — and the treeline is absent in two of five seeds, so it folds into the overlook. The
set is now **four fixed types, one per fork, every run:**

| Landmark | Derived from | Found in every seed? |
| --- | --- | --- |
| the old stand | high forest density | yes |
| the clearing / the burn | low forest density | yes |
| the talus field | boulder clutter | yes |
| the overlook | the highest point of the fork's fan — above the treeline where the plateau reaches it | no — carved when absent |

Each is **found where the seed provides it and carved where it does not** (A §4), so the
register's "last seen near…" is always true.

**Fork order is the player's decision**, and it is the only strategic layer in a game with
no combat: take the long fork early while there is light, or leave it for the dark. It
costs nothing to support and it is the one place the player gets to be clever.

**The trips invert.** The player climbs to a site and descends carrying, in worsening
light, being followed. Descending in a hurry is harder to control than climbing, which
puts the pressure in the right half of each trip.

## 5. The register and the count

- **One name per site** at the start, each with the site where that hiker was last seen —
  2 to 4 of them, per B §2. *(Was "four names".)*
- At each landmark, what is left of that hiker. Retrieve it, carry it back, sign them out.
- **The sign-out is a ritual that cannot be rushed** — several seconds at the box, hands
  busy, lamp on, while it comes. It should be the scariest recurring moment in the game and
  the place the dread stack peaks. *(Proposal — §13.)*
- **The first pick-up of each hiker's item ratchets the escalation up one permanent step**
  (amended 2026-09-15, B §1.14 — it was each sign-out). Each step is one share of the
  world's own count, so the last hiker always brings full dark, and a party retrieving
  several at once darkens the world faster than one player making the trips in turn.
- Tension also rises *within* a trip, because carrying is what draws the Hollow (§6), and
  resets at the sign-out. The curve is a sawtooth on a rising floor, not a staircase.
- **The book does not grow.** A joining player is not added, and neither is a player who
  dies (amended 2026-09-15, B §1.3 and §1.5). The register is the missing.

With four sites, four steps — a world with fewer takes correspondingly larger ones:

| Retrieved | The world |
| --- | --- |
| 0 | grey dawn, thin mist, long sight lines |
| 1 | overcast, mist thickening |
| 2 | dusk, the treeline closing |
| 3 | last light, heavy mist |
| 4 → the walk to the car | full dark |

The climax falls out of the structure rather than being scripted.

## 6. The Hollow

1. **One entity.** Alive from tick 0 at a real position, far away. It never despawns and it
   never ring-spawns. This is the opposite of today's `director.ts`, which maintains a
   *population* scaled to player count and spawns it 25 m out; that model is for an action
   shooter and it is not what this game is.
2. **Unkillable.** It cannot be damaged, blocked, or fought. There is no mechanic anywhere
   in the game that removes it.
3. **It navigates toward progress, not position** — the item being carried, the site last
   disturbed, the register. *Doing the objective is what draws it.* Standing still is safe
   and achieves nothing. This is the single most important rule in the design: it makes
   dread a consequence of playing rather than of a timer.
4. **It only walks** — slower than a player's sprint, faster than a player's walk. The
   player can always outrun it and can never rest.
5. **Visible from Act 1**, always at a distance, hard to notice. It must be **findable in
   hindsight**: someone reviewing a recording should be able to point at an early frame and
   say *it was there the whole time*. That is what separates dread from a jump scare — and
   because it walks toward progress from tick 0, the early distance is a consequence of the
   mechanic rather than a scripted tease. The tone comes out of the simulation for free.
6. **It can be delayed, never stopped.** It slows while held in the player's camera frame,
   at the cost of a degrading screen and not being able to see where you are running.
   **With contact killing, this is the only defensive verb in the game** and it carries far
   more weight than it did when a rescue loop existed. It deserves real attention when it is
   tuned. *(Proposal — §13.)*
7. **Contact kills.**
8. **The asset is a placeholder** until the real one exists. Nothing in the design should
   block on it.

## 7. The dread stack

All four channels run off **one scalar** — proximity, as a function of distance and line of
sight — so that the stack reads as a **range-finder**. Players should learn to judge how
close it is by ear and by the edges of the screen. Dread that carries no information is
noise.

| Band | Channel | Notes |
| --- | --- | --- |
| first stir | **the wildlife falls silent** | Gate the existing presence system on proximity. Eleven animals and six calls already exist; this is the cheapest and earliest tell in the game, and it teaches players to listen. |
| rising | **whispers** | A synthesized layer on `ambientAudio`'s gain graph, plus positioned one-shots through `playAt` that are deliberately **not** at its true position, to mislead. |
| high | **screen warp** | Edge distortion and chromatic separation. `stylize.ts` already composes `DefaultRenderingPipeline` with a custom `PostProcess` (the etched outline), so the pattern exists. |
| near max | **lighting collapse** | The lamp cone narrows and desaturates, the sky term drops, the outline thickens. It stops looking like a forest. |
| contact | death | §12. |

**Escalation has two inputs and no clock:**

- **Sign-outs** ratchet the floor up permanently.
- **Going off-trail** spikes it, and the spike **decays on returning to the trail**.

There is no wall-clock component, so exploring carefully is never punished for taking time.

One of the open dials would add a third input: if a death is made to cost an escalation
tick (§13.1), the floor also ratchets as the group thins. That is a deliberate extension of
this rule, not an exception to it — it is still progress-shaped, not time-shaped.

> **Shader warning, from this repo's own history:** a GLSL comment containing `#ifdef` is
> parsed as a real preprocessor directive and silently deletes code. This codebase has been
> bitten by it twice.

## 8. Wayfinding and the leash

- **Flagging tape is the only aid.** No minimap, no compass, no waypoint markers.
- It is **retroreflective**: it lights up only when the headlamp crosses it. This is how
  real flagging tape behaves, it is more unsettling than a glow, and it makes the lamp a
  navigation instrument rather than only a light.
- It guides the player **back to the nearest trail**.
- **The leash is the stalker.** Straying does not raise a warning or stop the player at a
  wall; it raises the same proximity scalar, with the same whispers and the same warp, and
  if the player keeps going the Hollow arrives and kills them.
- The player-facing rule this produces, learnable in a single run:
  **if you can see tape, you are being warned; if there is no tape, it is not warning you.**

Because carry-and-light is in effect (§9), the tape is always readable. Under the reserve
carry-*or*-light rule the tape would be invisible while carrying, which is why that rule is
kept on the shelf rather than discarded — it couples three systems at once.

## 9. Player verbs

No combat. Six verbs, each with an existing engine feature to hang on:

| Verb | Notes |
| --- | --- |
| **walk / sprint** | Sprint is the only escape and it is loud. Stamina replaces ammo as the rationed resource. |
| **crouch** *(new)* | Quiet, and breaks line of sight in the fern layer. The dense vegetation currently has no gameplay role; this gives it one. |
| **look** | Holding the Hollow in frame slows it, at the cost of a degrading screen and a blind path. The camera is the tension. |
| **carry** | An item occupies the hands. Carrying is what draws the Hollow. |
| **light** | One headlamp, on a battery. **Carry-and-light is permitted** (§1.16). |
| **listen** | Wildlife silence and whispers are the range-finder. |

The rifle is removed. Its wiring is not deeply entangled — `resolveHitscan` in
`sim/combat.ts`, a `fireCooldown` on player state, and a fire bit in the input command —
and **the input bit becomes Interact**: same wire, new verb, nothing to rip out.

## 10. Multiplayer

1–5 players, as today.

- A joining player spawns **near the host** — not on the host, not at a fixed start point —
  so late joiners are immediately in the game rather than walking up from the trailhead.
  `sim/spawn.ts` already has `groundSpawn` and `ringSample`, which is exactly the
  "valid position on a ring around a point" primitive this needs.
- They spawn **off-trail**, so they appear to **emerge from the forest**. Nobody sees them
  arrive. On this game's theme that is a scene, not a concession to netcode.
- **Their name is added to the register** on arrival. The book grows when a person
  materialises in the woods. It does not change the win condition (§5).
- **The spawn band needs deliberate definition**, not just a ring sample: visibly off-trail,
  but inside the tape's guidance range and short of where the leash starts to bite (§8).
  Emerging from the trees, finding tape with the lamp, and following it to the trail is a
  self-teaching first thirty seconds that reinforces the wayfinding rules — but only if the
  band is chosen for that.
- **Cutscenes are per-player and asynchronous.** A joiner's cutscene plays while their own
  world builds, regardless of whether the others are mid-game. The host never waits on
  anyone.

**Death and rejoining is the one hole this design has not closed.** Contact kills and there
is no rescue, so one death early means spectating the rest of the run — the most common way
a co-op horror game stops being played. The mechanism to fix it is already approved for
another reason: a dead player **rejoins as a new hiker emerging from the forest**, which is
the join path above, reused. It is diegetically correct rather than a concession. What a
death should *cost* is open (§13).

The machinery is smaller than it sounds: `PlayerState` already carries `health`,
`respawnTimer` and a last-death position, and `world.ts` already respawns a dead player on
a ring 15–25 m from where they fell. Contact-kills is the enemy attack dealing lethal
damage, and emergence is that respawn with its placement rule changed from *near where you
died* to *off-trail near the host*.

Solo resolves on its own: one player, contact kills, nobody to rejoin near — so it is the
ending in §12.

## 11. The cutscene

Three jobs, in this order of importance:

1. **Mask world generation.** Terrain, forest, clutter, wildlife and character assets all
   build on Play.
2. **Teach the rules of the world.** Follow the flagging tape back when lost; use the
   headlamp in the dark; the register is where you sign people out; you cannot fight.
   Taught by having the hands in the cutscene *do* these things — clip on the lamp, tear
   and tie a strip of tape, open the box — rather than by captions.
3. **Establish the story.**

**In-engine, not prerendered video.** A prerendered clip is easier to author and certain to
look right, but it is a large binary through Git LFS and the CDN, and its length is
*fixed* — which is exactly wrong for masking a variable load. An in-engine camera move
through a small authored set stretches naturally, holds a beat when the build is slow, and
reuses `createLandingScene`'s machinery.

**Skip.** While the world is still building there is no skip. Once it is ready, an
instruction appears and the player may hold a button or click **Skip**. The prompt doubles
as the "your world is ready" signal.

**Two variants:**

- **Full**, for a player starting at the trailhead: car pulls in at dawn → doors → the sign
  → the register box → a hand opens it → the page, names all signed in, none signed out →
  the last name is yours → look up at the trail. Cuts to gameplay **already looking at the
  register**, so the game opens on the object it is about.
- **Trimmed**, for a joining player, who materialises off-trail in the forest rather than at
  the register. It ends walking into the trees instead of at the box.

## 12. Endings

- **Win:** all four signed out, the players signed out, and the car reached in full dark.
  The win deserves the same treatment as the loss — a counterpart passage, the register's
  last line. *(Proposal — §13.)*
- **Total loss** — every player dead — is a **black screen with Edgar Allan Poe-style
  prose**, an ominous message about the characters' fate.

## 13. Open dials

Nothing below blocks the shape of the design; each changes what gets built.

1. ~~What a death costs (§10).~~ **Decided 2026-09-15 (B §1.4): death is permanent.** The
   dead do not rejoin and are not added to the book; they watch the living from a preview
   mode, its own sub-project. What they carried stays where they fell.
2. ~~The Hollow's identity — that it is the keeper of the book, and the players are
   overdue (§2).~~ **Decided 2026-09-15: the Hollow is a wendigo.** That is what the real
   asset depicts when it exists; the keeper-of-the-book reading stands beside it.
3. ~~The player's own name as the last entry (§2).~~ **Decided 2026-09-15 (B §1.3): no.**
4. **Altitude as a second escalation axis, furthest fork highest** (§3).
5. ~~Fork signs carrying the landmark names (§4).~~ **Decided 2026-09-15 (B §1.6): yes,
   wooden sign posts at every junction.**
6. ~~The sign-out as a multi-second, uninterruptible ritual (§5).~~ **Decided 2026-09-15
   (B §1.7): a five-second hold that breaks on release, on leaving reach, and on death.**
7. ~~"Looking slows it" as the sole defensive verb, and its tuning (§6.6).~~ **Decided
   2026-09-15 (C §1.8): yes, and looking costs the stare — the screen darkens while a Hollow is
   in view and a full stare kills.** The tuning stays with J.
8. **A counterpart Poe passage for the win** (§12).
9. **Carry-or-light** is held in reserve as the primary difficulty lever if the game plays
   too easy (§1.16, §8).

## 14. Engineering risk

Three pieces are genuinely new. Everything else leans on systems that already exist.

- **The bowl itself.** `cliffs.ts` produces scattered cliff *bands*, actively suppressed
  near the road — not a wall between the highway and the forest, and nothing produces a
  trailhead flat. The escarpment east of the road is natural but leaky (7–20 of 61 columns
  climbable per seed), so §3's geography is a terrain stage that closes gaps, plus a
  flattening disc and a relocated spawn. Designed in
  `docs/trail/2026-09-08-trailhead-and-trail-graph.md` together with the trail graph; the two
  are one sub-project.
- **The trail graph.** A deterministic, seeded trail *network* — a main ascent, forks on the
  way up, forks inside the forest, four terminating at landmarks — is a different shape from
  anything in `sim/` today, which is pointwise-deterministic field evaluation. It is
  **bounded** (a region around the trailhead) rather than endless, which makes it far easier
  than the highway was, but it is still the largest new system here. The landmark
  predicates must be satisfiable by terrain the world actually generates (§4).
- **The Hollow's navigation.** Pursuing *progress* rather than a position, over real terrain,
  deterministically enough that every peer agrees. Today's `sim/ai.ts` is a four-state
  machine (Idle / Chase / Attack / Dead) built for short-range chases; this is a different
  problem.

## 15. What already exists to build on

Recorded so the plan does not rebuild any of it.

| Need | What is already there |
| --- | --- |
| The wildlife-silence tell | Eleven animals, six calls, seeded schedule, presence gated on weather (`wildlifeBehaviour.ts`, `wildlifeAudio.ts`) |
| Whispers | `ambientAudio.ts` — synthesized layers on gain nodes, positioned one-shots via `playAt`, a listener pose |
| Screen warp and lighting collapse | `stylize.ts` composes `DefaultRenderingPipeline` with a custom `PostProcess`; `shaders/` holds the existing `.fx` files |
| Atmosphere curve | Weather presets, `lighting.ts`, `sky.ts`, `mistField.ts` |
| The Hollow visible at distance | The far-field impostor LODs in `clutterField.ts`, and `distanceFadePlugin.ts` |
| Join-near-host placement | `sim/spawn.ts` — `groundSpawn`, `ringSample` |
| Crouching into cover | The existing dense vegetation and fern layer |
| Terrain for the landmarks | Montane terrain, forest-density field, water, cliffs, boulder clutter |
| Determinism across peers | Fixed 60 Hz sim, seeded RNG, no wall-clock reads, `sim/` free of Babylon |
| The Interact verb | The existing fire bit and `fireCooldown` |

## 16. What is explicitly out

- Weapons, combat, damage to the Hollow, and any mechanic that removes it.
- A minimap, compass, waypoint marker, or objective arrow.
- Invisible walls, boundary warnings, or "return to the play area" messaging — *except at the
  road's edge, from 2026-09-15 (B §1.12): one wall there, with a line that names the objective.
  Everywhere else the leash still does the work.*
- A wall-clock difficulty timer.
- Reaching the highway on foot.
- Multiple monsters, or a population of them.

## 17. Sub-projects and build order

Agreed on 2026-09-09 and recorded here on 2026-09-10 so the order lives
with the design. Letters are the ones the sub-project specs use.

| # | Sub-project | Depends on | Risk | Status |
| --- | --- | --- | --- | --- |
| **A** | Trailhead & trail graph — bowl geography, trailhead flat, car and register post, ascent, forks, four landmark endpoints | — | highest | **Complete.** Shipped 2026-09-09 (`docs/trail/2026-09-08-trailhead-and-trail-graph.md`); revised 2026-09-09 (`docs/trail/2026-09-09-open-hillside-trail.md`: wall removed, bench cut) and 2026-09-10 (`docs/trail/2026-09-09-apron-and-ground-trail.md`: the trail is the ground) |
| **G1** | Rifle out, Interact in — the fire bit becomes Interact, `combat.ts` dormant, a headlamp | — | low | shipped 2026-09-11 |
| **T** | The trail system — a stem to a made peak (the only dead end), seeded loops around made features (meadow flats, wadeable ponds), the pad a car's worth from the road, every chunk prop drawn (`docs/trail/2026-09-11-trail-system.md`) | A, G1 | high | shipped 2026-09-11 |
| **B** | Register & the count — replicated book state, items at the sites, carry, the sign-out ritual, the win at the car, containment (§5; `docs/gameplay/2026-09-15-register-and-count.md`) | A, G1, T | medium | built 2026-09-15 |
| **C** | The Hollow — one Hollow per hunted player (floor one) replacing the director population, a crawl down the stem from tick 0, the hunt on pick-up, contact kills for good, the stare, placeholder asset, visible far (§6; `docs/gameplay/2026-09-15-the-hollow.md`) | A, B | medium | built 2026-09-16 |
| **D** | Escalation & atmosphere — one scalar from the retrieval floor, the Hollow's crawl and off-trail, plus its nearness for the lens; the sun, weather and dread curve; wildlife silence (§7; `docs/gameplay/2026-09-16-escalation-and-atmosphere.md`) | A, B, C | low | built 2026-09-16 |
| **F** | Tape & leash — retroreflective tape along the trails, distance-to-trail feeding the scalar (§8) | A, D | medium | |
| **E** | Dread stack — whispers and misleading one-shots, screen warp, lighting collapse (§7) | C, D | medium (GLSL) | |
| **H** | Join as emergence — the spawn band for a joining player. *Amended 2026-09-15: death is permanent (B §1.4), so no respawn path and no name added to the register.* | A, B, C, F | low | |
| **P** | Preview mode — a dead player watches the living from their views; permanent death ships here (B §6) | A, B | medium | added 2026-09-15 |
| **I** | Cutscene — an incremental world build first (`startGame` builds synchronously today), full and trimmed variants, the skip prompt (§11) | A–D settled | medium | |
| **J** | Endings & verb polish — the Poe passages, crouch, stamina, "looking slows it" tuning (§12, §9) | everything | low | |

**Order:** A → G1 → T → B → C is the vertical slice (T added 2026-09-11 — B places the register on T's graph) — the game with placeholders, and the earliest
point at which the loop can be judged. Then D, F, E, P, H, I, J (P added 2026-09-15: it pairs with
permanent death, so it follows C, which is what kills anybody). Nothing gates a sub-project any
more: §13.1 was decided on 2026-09-15.

Two facts agreed at the same time that later sub-projects should not rediscover: the trail graph
**is** the Hollow's navigation graph (its targets sit on or beside the network, so pursuit is a
graph walk plus a short approach, and §14's second risk mostly folds into the first); and the
world build is synchronous, so the cutscene needs an incremental build before it can mask one.

**Containment belongs to B** (claimed 2026-09-15, B §1.12 and §3.5): an invisible wall at the
pavement's edge, with the car on the shoulder still reachable, and a line on the HUD. §16's
"invisible walls, boundary warnings" exclusion is amended accordingly — the wall at the road is in,
everywhere else the leash (F) still does the work.

