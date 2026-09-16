# Escalation and atmosphere — sub-project D

**Date:** 2026-09-16
**Status:** Built 2026-09-16 (`docs/gameplay/2026-09-16-escalation-and-atmosphere-plan.md`). What moved
in execution: no constant; the renderer's `setHour`/`setWeather` re-render the reflection probe on every
call, so `syncAtmosphere` applies them (and the ambient gains) only when the hour has moved 0.01 or a
weather field 0.005 since the last application — slow drift still lands, because the gate compares
against the last applied value; `near` is the greatest closeness over all Hollows after the line-of-sight
halving (§2.2, reworded), so a visible far Hollow outranks a blind near one; the browser saw the whole
curve on seed `hollow` — at world 0.5 the pad reads as bright mist rather than dusk (the sun is still at
17), which is the hour curve's dial if dusk should come sooner.
**Parent:** `docs/gameplay/2026-09-08-register-and-hollow.md` §1.8, §1.17, §7, §8, §17. Amends the
parent: §7 (the escalation has a third input, the Hollow's crawl, and the proximity term joins the
same scalar), §13.4 stays open (altitude is not an axis here), and the §17 table.
**Depends on:** B (the register and the count — `retrievedCount`), C (the Hollow — its position on the
stem and its nearness; `docs/gameplay/2026-09-15-the-hollow.md`), T (the trail graph).

## 0. What this is

The world answering the game. B made it winnable and C made it losable; this makes it *feel* the
difference. Two numbers, computed on every screen from state every peer already has: the **world**,
shared, which takes the party from a bright noon into full dark as hikers are found and as the
Hollow comes down the stem; and the **lens**, yours alone, which pales and closes your view and
silences the animals around you when you leave the trail or when the Hollow is near. Nothing
crosses the wire; nothing waits on a clock.

## 1. Decisions

Taken 2026-09-16, in the order they were made.

1. **One scalar, three inputs:** a floor from hikers retrieved, a spike from being off the trail,
   and the Hollow's nearness (parent §7 names the first two; the third is §7's proximity stack,
   folded in so the sky and the mist do not ignore the thing hunting you until E ships).
2. **The scalar drives the sun, the weather and the dread together:** noon to night, clear toward
   the eerie preset, the dread lens on top. Full dark for the last walk means the headlamp is the
   only light. Wildlife silence falls out of the weather's dread axis, which already exists.
3. **The sky belongs to the party, the lens to you.** Sun, cloud and mist follow the shared floor
   and creep, so every player stands under the same sky; your own off-trail spike and the Hollow's
   nearness to you drive the dread lens and the silence around you.
4. **Retrievals set the floor; the Hollow's crawl adds a slow creep.** The world is the greater of
   the two, so doing nothing still brings dusk, slowly, and doing the objective brings it faster —
   the letter of C §1.1, standing still is slower, not safe.
5. **A pure client-side model in `game/`**, fed from replicated state, with no wire change: every
   input already reaches every peer, and the numbers are authoritative for nothing.
6. **The console's preset and hour are the base** the escalation departs from, never returns past:
   `/weather eerie` still shows the far end, `/time 20` still previews dusk.

## 2. The two numbers

Both are 0–1, computed every frame on each client.

### 2.1 The world — shared, never falling

`world = max(floor, creep)`.

- **floor** = hikers picked up at least once ÷ hikers in the book (`retrievedCount(state) /
  register.hikers.length`): 0, then steps of 1/n to 1. B's ratchet; a second pick-up of the same
  hiker and a put-down change nothing.
- **creep** = the furthest any Hollow has come down the stem: each Hollow's position projected onto
  the stem chain as progress from the crest (0) to the pad (1) by arc length; a hunting Hollow off
  the stem counts at its nearest stem point. The client keeps the highest value it has seen
  (`creepMax`), so the pendulum's climb back up never brightens the sky. A player who joins late
  starts from the current value, and a reload does the same — the sky may be a shade brighter for
  them than it was; accepted.

### 2.2 The lens — yours, every frame

`lens = max(spike, near)`.

- **spike**: off the trail means further than `OFF_TRAIL_START` (10 m — the corridor's 7 m plus 3)
  from the nearest trail edge (`trailDistance`). While off, the spike rises at a rate that scales
  with how far past that you are — `clamp((d − OFF_TRAIL_START) / (OFF_TRAIL_FULL − OFF_TRAIL_START))`
  with `OFF_TRAIL_FULL` 60 m — reaching 1 in `SPIKE_RISE_S` (20 s) at full rate; on the trail it
  decays to 0 in `SPIKE_DECAY_S` (8 s). Brushing the corridor's edge costs almost nothing; striking
  out into the trees costs everything.
- **near**: each Hollow's closeness to your eye — 1 at or within `NEAR_FULL` (10 m), 0 at or beyond
  `NEAR_START` (80 m), linear between, multiplied by `NEAR_BLIND` (0.5) when it has no line of sight
  to you (`hasLineOfSight` from `sim/ai.ts`, eye to the Hollow's centre, against the world's boxes
  and ground) — and `near` is the greatest of them, so a Hollow you can see at thirty metres counts
  for more than one behind a wall at twenty-five. It is still there, and you should still feel it.
- A dead player's lens freezes at its last value; the fade is their screen now.

### 2.3 Easing in time

Every target is reached through a first-order lag, so nothing steps: the eased world approaches its
target with time constant `WORLD_EASE_S` (20 s) — a pick-up becomes a minute of the light going —
and the eased lens with `LENS_EASE_S` (1.5 s), fast enough that stepping off the trail or rounding
a bend on the Hollow reads within a breath, slow enough not to flicker with line of sight. The
spike's own rise and decay are integrated before the lag.

## 3. The curve

**The base** is whatever the console set: the weather preset (default `clear`) and the hour
(default 12). The escalation only moves away from the base toward night and dread.

**The sun.** `hour = baseHour + (NIGHT_HOUR − baseHour) · ease(world)`, `NIGHT_HOUR` 22: the sky
model's sun is up from 6 to 18, so 22 is full dark. A base hour at or past 22 stays where it is.
`ease` is smootherstep, so the first retrieval dims the afternoon and the last drops the night.

**The weather.** `weather = lerpWeather(basePreset, eerie, ease(world))` — cloud, mist, rain,
wetness and dread move together toward the eerie preset, the one already tuned as the far end of the
look. Then `weather.dread = max(weather.dread, lens)`: the world's share plus yours.

**What consumes it**, every frame, before the renderer syncs: `renderer.setHour(hour)`;
`renderer.setWeather(weather, 0)` — instant, the lag is the model's now, not the renderer's 3 s
fade; `ambient.setWeather(weather)` (rain and wind gains); `wildlifePresenceUnder(weather)` — the
existing ramp silences the ground animals and the birds as dread passes 0.3–0.5 and makes the ravens
bolder; the grade's dread lens reads `weather.dread` as today, and the `/unsettle` dial keeps its
meaning as a multiplier on those channels.

**Where it does not apply.** Only a forest world with a register escalates. The sandbox, any world
without a trail, and the landing scene keep the console's weather and hour untouched.

## 4. Where it lives

### 4.1 `client/src/sim/trailRoute.ts`

`stemProgress(graph, x, z): number` — the nearest point on the stem chain to (x, z), as progress from
the crest (0) to the pad (1) by arc length along the chain; a point past either end clamps. Pure,
`Math.sqrt` only; sim-side because it is graph geometry.

### 4.2 `client/src/game/escalation.ts`, new, Babylon-free

```ts
export type EscalationTargets = { world: number; offTrail: number; near: number; dead: boolean };
export type EscalationState = { creepMax: number; spike: number; world: number; lens: number };
export const ESCALATION_REST: EscalationState;   // all zeros

/** The raw inputs from state: `world` is max(floor, creep) before the ratchet; `offTrail` is the
 *  local player's distance past the corridor, 0 on the trail and 1 at OFF_TRAIL_FULL; `near` is
 *  §2.2's proximity term; `dead` when the local player's health is 0. */
export function escalationTargets(
  state: WorldState, localId: number, register: Register, graph: TrailGraph,
  boxes: BoxProvider, ground: GroundField | null,
): EscalationTargets;

/** Ratchets creep, integrates the spike from `offTrail`, lags `world` and `lens` (the lens's
 *  target is max(spike, near)). Pure in (prev, targets, dt). When `t.dead`, `spike` and `lens`
 *  hold their last values; the world keeps moving. */
export function stepEscalation(prev: EscalationState, t: EscalationTargets, dt: number): EscalationState;

export type AtmosphereBase = { weather: WeatherParams; hour: number };
export function atmosphereUnder(base: AtmosphereBase, s: EscalationState): AtmosphereBase;
```

Constants, exported: `OFF_TRAIL_START` 10, `OFF_TRAIL_FULL` 60, `SPIKE_RISE_S` 20, `SPIKE_DECAY_S`
8, `NEAR_FULL` 10, `NEAR_START` 80, `NEAR_BLIND` 0.5, `NIGHT_HOUR` 22, `WORLD_EASE_S` 20,
`LENS_EASE_S` 1.5.

### 4.3 `client/src/app.ts`

One `EscalationState` per match and one `base: AtmosphereBase` — the `weather` and `time` commands
now write the base (and, on a world without a register, apply it directly as today). Both render
loops, after the tick and before `renderer.sync`: `escalationTargets` → `stepEscalation` →
`atmosphereUnder` → `setHour`, `setWeather(w, 0)`, `ambient.setWeather(w)`, `wildlifePresence =
wildlifePresenceUnder(w)`. The host reads `host.world`; the client reads `client.renderState()` for
items, enemies and the reconciled local player, and its predicted world's `trail`, `register`,
`boxes` and `ground`. A bare `/weather` restores the base to `clear`.

### 4.4 Nothing on the wire

`escalation.ts` reads sim state and writes only to the renderer and audio. No protocol change; no
sim rule reads it.

## 5. What the player sees and hears

At the pad on a fresh world: the console's noon, or whatever was set. As the first hiker is picked up
the afternoon dims over a minute and the mist begins; each further retrieval takes it toward dusk;
with every hiker found the sky is night and the eerie palette is full — the last walk to the car is
by headlamp. Independently of all that, the Hollow's descent brings the same dusk on its own, slowly.

Leave the corridor and, within a breath, the vignette closes and the image pales and grains; the
animals near you fall quiet, then the birds; the ravens grow bolder. Return to the trail and it
lifts over eight seconds. The same happens as the Hollow closes — from eighty metres it begins,
by ten it is total — and, because it is your lens, a teammate on the far side of the ridge sees
none of it under the same sky.

## 6. Tests

**`client/test/sim/trailRoute.test.ts`** — `stemProgress`: the crest is 0, the pad 1, the middle
node 0.5 on the hand graph's straight stem; a loop node reads its nearest stem point's progress; a
point past the crest clamps to 0 and past the pad to 1.

**`client/test/game/escalation.test.ts`** (Babylon-free; added to the architecture test's list):
- targets — floor 0 with nothing picked up, 1/n after one first pick-up, unchanged by a second
  pick-up or a put-down; creep is a Hollow's stem progress and a hunting Hollow off the stem counts
  at its nearest stem point; world is the greater; `offTrail` is 0 within 10 m of an edge, 1 at 60 m,
  linear between; `near` is 1 at 10 m, 0 at 80 m, linear between, halved behind a wall brush, 0
  with no Hollow; `dead` when the local player's health is 0.
- step — creep ratchets (a Hollow climbing back does not lower `creepMax`); the spike fills in 20 s
  at `offTrail` 1, in 40 s at 0.5, and empties in 8 s at 0; world reaches 63 % of a step after 20 s
  and lens after 1.5 s; `dt` 0 changes nothing; a dead player's spike and lens hold.
- atmosphere — the base is returned untouched at rest; at world 1 the hour is 22 and the weather
  equals `eerie`; a base hour of 23 stays 23; `dread` is lifted to the lens when greater and never
  lowered; smootherstep's midpoint is 0.5.
- silence — `wildlifePresenceUnder(atmosphereUnder(clearNoon, { lens: 0.5 }).weather).ground` is 0.

**`client/test/game/commands.test.ts`** — `weather` and `time` write the base.

**In the browser, before shipping:** noon at the pad on a fresh world; the sky and mist thickening
over the minute after a first pick-up; dusk deepening as the Hollow's crawl descends; the vignette
and pallor rising as you leave the corridor, the animals falling quiet, both fading back on the
trail; the same as the Hollow closes; full dark with the headlamp for the last walk.

## 7. Boundaries

- **E (dread stack)** adds whispers, warp and lighting collapse on the same `lens`; D leaves the
  grade's channels as they are.
- **F (tape and leash)** adds the tape and the rule that a far-off-trail player draws the Hollow;
  the spike is already here for it to read.
- **C** is untouched: the Hollow's speeds stay constants; its `seen`, `stare` and rules never read
  the escalation.
- **P, J** as before.
- **Out of D:** altitude as an axis (parent §13.4), any new shader, any sound beyond the existing
  rain and wind gains and the wildlife calls.
