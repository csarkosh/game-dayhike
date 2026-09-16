# Escalation and Atmosphere Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The world answering the game: a shared world number (hikers retrieved, the Hollow's crawl) that takes the sun from noon to night and the weather toward the eerie preset, and a personal lens number (off the trail, the Hollow's nearness) that pales the view and silences the animals — computed on every client from replicated state, nothing on the wire.

**Architecture:** One pure, Babylon-free model, `client/src/game/escalation.ts` (targets from state, a stepped state with the ratchet, the spike integrator and two time lags, and the atmosphere curve), fed by a new `stemProgress` in `client/src/sim/trailRoute.ts`. `app.ts` keeps one escalation state and one base (the console's preset and hour) per match and, on forest worlds with a register, drives the renderer, the ambient audio and the wildlife presence from the model every frame.

**Tech Stack:** TypeScript strict, Vitest 4 (node), the existing weather/lighting/wildlife modules.

**Spec:** `docs/gameplay/2026-09-16-escalation-and-atmosphere.md` (parent: `docs/gameplay/2026-09-08-register-and-hollow.md` §7).

## Global Constraints

- `client/src/sim/` imports nothing outside itself and adds no `Math.sin/cos/tan/atan2/pow/exp/log/hypot` call and no `**` (the architecture test allow-lists every site; `stemProgress` uses products and `Math.sqrt` only). `client/src/game/` may import `sim/`; `escalation.ts` is Babylon-free and joins `BABYLON_FREE_FILES` in `client/test/architecture.test.ts`.
- Constants, verbatim from the spec: `OFF_TRAIL_START` 10, `OFF_TRAIL_FULL` 60, `SPIKE_RISE_S` 20, `SPIKE_DECAY_S` 8, `NEAR_FULL` 10, `NEAR_START` 80, `NEAR_BLIND` 0.5, `NIGHT_HOUR` 22, `WORLD_EASE_S` 20, `LENS_EASE_S` 1.5. The far preset is `WEATHER_PRESETS.eerie`; the sun is up 6–18 in `sky.ts`.
- Nothing on the wire: no change to `protocol.ts`, `hostSession.ts`, `clientSession.ts` or any sim rule. `PROTOCOL_VERSION` stays 4.
- The world number never falls (a ratchet in the state); the lens is per player; a dead local player's spike and lens hold. `world = max(floor, creep)`; `lens = max(spike, near)`; the shown `dread = max(blend.dread, lens)`.
- The console's `weather` and `time` write the base the escalation departs from; a bare `/weather` reports the base's preset; `/unsettle` is untouched. Worlds without a register keep the console's weather and hour untouched.
- Run from the repository root of the worktree: `npx vitest run --root client <path>`, `npx tsc -p client --noEmit`, `npx eslint .`.
- Commit messages follow `.agents/skills/github-push/SKILL.md` (What/How), never naming anything private about how the work was done.

## File structure

| File | Responsibility |
| --- | --- |
| `client/src/sim/trailRoute.ts` | `stemProgress(graph, x, z)`: progress along the stem chain, crest 0 → pad 1 |
| `client/src/game/escalation.ts` | The constants, `EscalationTargets`, `EscalationState`, `ESCALATION_REST`, `escalationTargets`, `stepEscalation`, `atmosphereUnder` |
| `client/src/app.ts` | The base, the per-match state, `syncAtmosphere` in both loops, the `weather`/`time` handlers writing the base |
| `client/test/sim/trailRoute.test.ts`, `client/test/game/escalation.test.ts`, `client/test/architecture.test.ts` | Tests and the Babylon-free list |

---

### Task 1: Progress along the stem

**Files:**
- Modify: `client/src/sim/trailRoute.ts`
- Test: `client/test/sim/trailRoute.test.ts`

**Interfaces:**
- Consumes: `stemNodes(graph)` (same file), `TrailGraph`/`TrailNode` (`trail.ts`).
- Produces: `stemProgress(graph: TrailGraph, x: number, z: number): number` — the nearest point on the stem chain, as progress from the crest (0) to the pad (1) by arc length; clamped at both ends; 1 for a degenerate stem.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/trailRoute.test.ts` (add `stemProgress` to the import from `trailRoute.js`):

```ts
describe("stemProgress", () => {
  // The hand graph's stem is a straight 200 m along +x: pad (0,0), middle (100,0), crest (200,0).
  it("is 0 at the crest, 1 at the pad and 0.5 at the middle node", () => {
    const g = graph(1);
    expect(stemProgress(g, 200, 0)).toBeCloseTo(0, 9);
    expect(stemProgress(g, 0, 0)).toBeCloseTo(1, 9);
    expect(stemProgress(g, 100, 0)).toBeCloseTo(0.5, 9);
  });

  it("projects a point beside the stem onto it", () => {
    // Loop node 3 at (120, 50) is nearest the stem at (120, 0): 120 m from the pad of 200.
    expect(stemProgress(graph(1), 120, 50)).toBeCloseTo(0.4, 9);
  });

  it("clamps past either end", () => {
    expect(stemProgress(graph(1), 300, 0)).toBeCloseTo(0, 9);
    expect(stemProgress(graph(1), -50, 10)).toBeCloseTo(1, 9);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root client test/sim/trailRoute.test.ts`
Expected: FAIL — `stemProgress` is not exported.

- [ ] **Step 3: Write the function**

Append to `client/src/sim/trailRoute.ts`:

```ts
/**
 * Where (x, z) stands along the stem: the nearest point on the chain, as
 * progress from the crest (0) to the pad (1) by arc length. A point past
 * either end clamps to that end. The escalation reads this for the Hollow's
 * crawl (`game/escalation.ts`).
 */
export function stemProgress(graph: TrailGraph, x: number, z: number): number {
  const chain = stemNodes(graph);
  let arc = 0;
  let bestSq = Infinity;
  let bestArc = 0;
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = graph.nodes[chain[i] as number] as TrailNode;
    const b = graph.nodes[chain[i + 1] as number] as TrailNode;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    let t = 0;
    if (len > 0) {
      t = ((x - a.x) * dx + (z - a.z) * dz) / (len * len);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const sq = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (sq < bestSq) {
      bestSq = sq;
      bestArc = arc + len * t;
    }
    arc += len;
  }
  return arc > 0 ? 1 - bestArc / arc : 1;
}
```

- [ ] **Step 4: Run the tests, types and lint**

Run: `npx tsc -p client --noEmit && npx eslint . && npx vitest run --root client test/sim/trailRoute.test.ts test/architecture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/sim/trailRoute.ts client/test/sim/trailRoute.test.ts
git commit -m "feat: progress along the stem"
```

(Full What/How body per the github-push skill.)

---

### Task 2: The escalation model

**Files:**
- Create: `client/src/game/escalation.ts`
- Modify: `client/test/architecture.test.ts` (`BABYLON_FREE_FILES`)
- Test: `client/test/game/escalation.test.ts`

**Interfaces:**
- Consumes: `retrievedCount`, `Register` (`sim/register.ts`); `isHollowState` (`sim/hollow.ts`); `trailDistance`, `TrailGraph` (`sim/trail.ts`); `stemProgress` (Task 1); `hasLineOfSight` (`sim/ai.ts`); `PLAYER_EYE_OFFSET`; `WEATHER_PRESETS`, `lerpWeather`, `WeatherParams` (`game/weather.ts`); `clamp01` (`game/colour.ts`).
- Produces: the constants; `EscalationTargets`, `EscalationState`, `ESCALATION_REST`, `AtmosphereBase`; `escalationTargets(state, localId, register, graph, boxes, ground)`, `stepEscalation(prev, targets, dt)`, `atmosphereUnder(base, state)`.

- [ ] **Step 1: Write the failing tests**

`client/test/game/escalation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createWorld, spawnPlayer } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { AiState } from "../../src/sim/types.js";
import { ENEMY_HALF } from "../../src/sim/constants.js";
import { installRegister, type Register } from "../../src/sim/register.js";
import { spawnHollow } from "../../src/sim/hollow.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { wildlifePresenceUnder } from "../../src/game/wildlifeBehaviour.js";
import {
  ESCALATION_REST, LENS_EASE_S, NEAR_BLIND, NEAR_FULL, NEAR_START, NIGHT_HOUR, OFF_TRAIL_FULL, OFF_TRAIL_START,
  SPIKE_DECAY_S, SPIKE_RISE_S, WORLD_EASE_S, atmosphereUnder, escalationTargets, stepEscalation,
  type EscalationTargets,
} from "../../src/game/escalation.js";
import { graph } from "../sim/helpers/registerGraph.js";

type Brush = { min: [number, number, number]; max: [number, number, number]; material: string };
const FLOOR: Brush = { min: [-300, -1, -300], max: [300, 0, 300], material: "concrete" };
const level = (...walls: Brush[]) =>
  parseLevel({ id: "flat", brushes: [FLOOR, ...walls], playerSpawns: [[0, 0.9, 0]], enemySpawns: [] });

/** Two hikers, the box and the car off the stem's pad; the one-loop hand graph as the trail. */
function register(): Register {
  const site = (name: string, x: number, z: number) => ({ kind: "meadow" as const, name, x, y: 0, z, progress: 1 });
  return {
    hikers: [{ id: 0, name: "Owen Marsh", site: site("the meadow", 150, 60) }, { id: 1, name: "Dana Whitcombe", site: site("the summit", 200, 0) }],
    box: { x: 0, y: 1, z: -20 },
    car: { x: 30, y: 0.8, z: -20 },
  };
}

function world(...walls: Brush[]) {
  const w = createWorld(level(...walls), 1);
  w.trail = graph(1);
  installRegister(w, register());
  const p = spawnPlayer(w);
  p.pos = { x: 100, y: 0.9, z: 0 }; // on the stem's middle node
  return { w, p };
}

const targetsOf = (w: ReturnType<typeof world>["w"], id: number) =>
  escalationTargets(w.state, id, w.register!, w.trail!, w.boxes, w.ground);

describe("escalationTargets", () => {
  it("floors on hikers picked up at least once, and not on a second pick-up or a put-down", () => {
    const { w, p } = world();
    expect(targetsOf(w, p.id).world).toBe(0);
    w.state.items[0]!.pickedUp = true;
    expect(targetsOf(w, p.id).world).toBeCloseTo(0.5, 9);
    w.state.items[0]!.carrier = 0; // put down: still picked up once
    expect(targetsOf(w, p.id).world).toBeCloseTo(0.5, 9);
    w.state.items[1]!.pickedUp = true;
    expect(targetsOf(w, p.id).world).toBe(1);
  });

  it("creeps with the furthest Hollow down the stem, a hunting one at its nearest stem point", () => {
    const { w, p } = world();
    spawnHollow(w, { x: 160, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    expect(targetsOf(w, p.id).world).toBeCloseTo(0.2, 9);
    spawnHollow(w, { x: 120, y: ENEMY_HALF.y, z: 50 }, AiState.Hunt, p.id); // beside the stem at x = 120
    expect(targetsOf(w, p.id).world).toBeCloseTo(0.4, 9);
  });

  it("takes the greater of the floor and the creep", () => {
    const { w, p } = world();
    w.state.items[0]!.pickedUp = true; // 0.5
    spawnHollow(w, { x: 160, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl); // 0.2
    expect(targetsOf(w, p.id).world).toBeCloseTo(0.5, 9);
  });

  it("measures off-trail from the corridor's edge to OFF_TRAIL_FULL", () => {
    const { w, p } = world();
    expect(targetsOf(w, p.id).offTrail).toBe(0);
    p.pos = { x: 100, y: 0.9, z: -OFF_TRAIL_START };
    expect(targetsOf(w, p.id).offTrail).toBe(0);
    p.pos = { x: 100, y: 0.9, z: -(OFF_TRAIL_START + OFF_TRAIL_FULL) / 2 };
    expect(targetsOf(w, p.id).offTrail).toBeCloseTo(0.5, 9);
    p.pos = { x: 100, y: 0.9, z: -OFF_TRAIL_FULL - 40 };
    expect(targetsOf(w, p.id).offTrail).toBe(1);
  });

  it("nears with the closest Hollow, halved without line of sight, 0 with none", () => {
    const { w, p } = world();
    expect(targetsOf(w, p.id).near).toBe(0);
    const h = spawnHollow(w, { x: 100, y: ENEMY_HALF.y, z: NEAR_START + 10 }, AiState.Crawl);
    expect(targetsOf(w, p.id).near).toBe(0);
    h.pos.z = (NEAR_START + NEAR_FULL) / 2;
    expect(targetsOf(w, p.id).near).toBeCloseTo(0.5, 9);
    h.pos.z = NEAR_FULL - 2;
    expect(targetsOf(w, p.id).near).toBe(1);

    const walled = world({ min: [90, 0, 20], max: [110, 4, 21], material: "concrete" });
    const q = walled.p;
    spawnHollow(walled.w, { x: 100, y: ENEMY_HALF.y, z: (NEAR_START + NEAR_FULL) / 2 }, AiState.Crawl);
    expect(targetsOf(walled.w, q.id).near).toBeCloseTo(0.5 * NEAR_BLIND, 9);
  });

  it("marks a dead local player", () => {
    const { w, p } = world();
    expect(targetsOf(w, p.id).dead).toBe(false);
    p.health = 0;
    expect(targetsOf(w, p.id).dead).toBe(true);
  });
});

const T = (over: Partial<EscalationTargets> = {}): EscalationTargets => ({ world: 0, offTrail: 0, near: 0, dead: false, ...over });
const stepFor = (seconds: number, t: EscalationTargets, from = ESCALATION_REST, dt = 1 / 60) => {
  let s = from;
  for (let i = 0; i < Math.round(seconds / dt); i++) s = stepEscalation(s, t, dt);
  return s;
};

describe("stepEscalation", () => {
  it("ratchets the world target: a Hollow climbing back never lowers it", () => {
    let s = stepEscalation(ESCALATION_REST, T({ world: 0.6 }), 1 / 60);
    expect(s.creepMax).toBeCloseTo(0.6, 9);
    s = stepEscalation(s, T({ world: 0.2 }), 1 / 60);
    expect(s.creepMax).toBeCloseTo(0.6, 9);
  });

  it("fills the spike in SPIKE_RISE_S at full rate, twice as long at half, and empties it in SPIKE_DECAY_S", () => {
    expect(stepFor(SPIKE_RISE_S, T({ offTrail: 1 })).spike).toBeCloseTo(1, 3);
    expect(stepFor(SPIKE_RISE_S, T({ offTrail: 0.5 })).spike).toBeCloseTo(0.5, 3);
    const full = stepFor(SPIKE_RISE_S, T({ offTrail: 1 }));
    expect(stepFor(SPIKE_DECAY_S, T(), full).spike).toBeCloseTo(0, 3);
  });

  it("lags the world and the lens with their time constants", () => {
    const w = stepFor(WORLD_EASE_S, T({ world: 1 }));
    expect(w.world).toBeCloseTo(1 - Math.exp(-1), 2);
    const l = stepFor(LENS_EASE_S, T({ near: 1 }));
    expect(l.lens).toBeCloseTo(1 - Math.exp(-1), 2);
  });

  it("changes nothing on a zero dt, and holds a dead player's spike and lens", () => {
    const s = stepFor(5, T({ offTrail: 1, near: 0.5 }));
    expect(stepEscalation(s, T({ offTrail: 1 }), 0)).toEqual(s);
    const held = stepFor(5, T({ dead: true, near: 1, world: 1 }), s);
    expect(held.spike).toBe(s.spike);
    expect(held.lens).toBe(s.lens);
    expect(held.world).toBeGreaterThan(s.world);
  });
});

describe("atmosphereUnder", () => {
  const noon = { weather: WEATHER_PRESETS.clear, hour: 12 };

  it("returns the base untouched at rest", () => {
    expect(atmosphereUnder(noon, ESCALATION_REST)).toEqual(noon);
  });

  it("reaches night and the eerie preset at world 1, and a later base hour stays", () => {
    const s = { ...ESCALATION_REST, world: 1 };
    const a = atmosphereUnder(noon, s);
    expect(a.hour).toBe(NIGHT_HOUR);
    expect(a.weather).toEqual(WEATHER_PRESETS.eerie);
    expect(atmosphereUnder({ weather: WEATHER_PRESETS.clear, hour: 23 }, s).hour).toBe(23);
  });

  it("eases with smootherstep: half way is half way", () => {
    const a = atmosphereUnder(noon, { ...ESCALATION_REST, world: 0.5 });
    expect(a.hour).toBeCloseTo(12 + (NIGHT_HOUR - 12) * 0.5, 9);
    expect(a.weather.mist).toBeCloseTo(0.5, 9);
  });

  it("lifts dread to the lens and never lowers it", () => {
    expect(atmosphereUnder(noon, { ...ESCALATION_REST, lens: 0.7 }).weather.dread).toBeCloseTo(0.7, 9);
    const far = atmosphereUnder(noon, { ...ESCALATION_REST, world: 1, lens: 0.2 });
    expect(far.weather.dread).toBe(1);
  });

  it("silences the ground animals through the existing ramp at lens 0.5", () => {
    const a = atmosphereUnder(noon, { ...ESCALATION_REST, lens: 0.5 });
    expect(wildlifePresenceUnder(a.weather).ground).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root client test/game/escalation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

`client/src/game/escalation.ts`:

```ts
/**
 * Escalation and atmosphere (docs/gameplay/2026-09-16-escalation-and-atmosphere.md):
 * two numbers computed on every client from state every peer already has.
 * The world — shared, never falling — is hikers retrieved or the Hollow's
 * crawl down the stem, whichever is further, and it takes the sun from the
 * base hour to night and the weather toward the eerie preset. The lens —
 * yours — is being off the trail or the nearest Hollow's closeness, and it
 * lifts the dread the grade and the wildlife read. Nothing here is
 * authoritative; nothing crosses the wire.
 */
import type { WorldState, Vec3 } from "../sim/types.js";
import { isHollowState } from "../sim/hollow.js";
import { retrievedCount, type Register } from "../sim/register.js";
import { trailDistance, type TrailGraph } from "../sim/trail.js";
import { stemProgress } from "../sim/trailRoute.js";
import type { BoxProvider } from "../sim/boxSource.js";
import type { GroundField } from "../sim/ground.js";
import { hasLineOfSight } from "../sim/ai.js";
import { PLAYER_EYE_OFFSET } from "../sim/constants.js";
import { WEATHER_PRESETS, lerpWeather, type WeatherParams } from "./weather.js";
import { clamp01 } from "./colour.js";

/** Metres from the nearest trail edge at which "off the trail" begins: the corridor's 7 m plus 3. */
export const OFF_TRAIL_START = 10;
/** Metres out at which the spike rises at full rate. */
export const OFF_TRAIL_FULL = 60;
/** Seconds off the trail, at full rate, to fill the spike. */
export const SPIKE_RISE_S = 20;
/** Seconds on the trail to empty it. */
export const SPIKE_DECAY_S = 8;
/** Within this of the eye the Hollow's nearness is total. */
export const NEAR_FULL = 10;
/** Beyond this it is nothing. */
export const NEAR_START = 80;
/** The nearness's share without line of sight: still there, still felt. */
export const NEAR_BLIND = 0.5;
/** The hour the world reaches at full escalation: the sun is up 6–18. */
export const NIGHT_HOUR = 22;
/** Time constant of the world's easing, seconds: a pick-up is a minute of the light going. */
export const WORLD_EASE_S = 20;
/** Time constant of the lens's easing, seconds. */
export const LENS_EASE_S = 1.5;

export type EscalationTargets = {
  /** max(floor, creep) before the ratchet. */
  world: number;
  /** The local player's distance past the corridor, 0 on the trail to 1 at OFF_TRAIL_FULL. */
  offTrail: number;
  /** The nearest Hollow's closeness to the local eye, 0 to 1. */
  near: number;
  /** The local player is dead: their spike and lens hold. */
  dead: boolean;
};

export type EscalationState = {
  /** The highest world target seen: the sky never brightens. */
  creepMax: number;
  /** The off-trail spike, integrated. */
  spike: number;
  /** The eased world, 0 to 1. */
  world: number;
  /** The eased lens, 0 to 1. */
  lens: number;
};

export const ESCALATION_REST: EscalationState = Object.freeze({ creepMax: 0, spike: 0, world: 0, lens: 0 });

export type AtmosphereBase = { weather: WeatherParams; hour: number };

/** The raw inputs from state. Pure. */
export function escalationTargets(
  state: WorldState,
  localId: number,
  register: Register,
  graph: TrailGraph,
  boxes: BoxProvider,
  ground: GroundField | null,
): EscalationTargets {
  const floor = register.hikers.length > 0 ? retrievedCount(state) / register.hikers.length : 0;
  let creep = 0;
  const hollows: Vec3[] = [];
  for (const e of state.enemies.values()) {
    if (!isHollowState(e.ai)) continue;
    hollows.push(e.pos);
    const p = stemProgress(graph, e.pos.x, e.pos.z);
    if (p > creep) creep = p;
  }
  const world = Math.max(floor, creep);

  const me = state.players.get(localId);
  if (me === undefined) return { world, offTrail: 0, near: 0, dead: false };

  const d = trailDistance(graph, me.pos.x, me.pos.z);
  const offTrail = clamp01((d - OFF_TRAIL_START) / (OFF_TRAIL_FULL - OFF_TRAIL_START));

  const eye: Vec3 = { x: me.pos.x, y: me.pos.y + PLAYER_EYE_OFFSET, z: me.pos.z };
  let near = 0;
  for (const h of hollows) {
    const dx = h.x - eye.x;
    const dy = h.y - eye.y;
    const dz = h.z - eye.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let n = clamp01((NEAR_START - dist) / (NEAR_START - NEAR_FULL));
    if (n > 0 && !hasLineOfSight(eye, h, boxes, ground)) n *= NEAR_BLIND;
    if (n > near) near = n;
  }
  return { world, offTrail, near, dead: me.health <= 0 };
}

/** First-order lag toward `to` with time constant `tau`, seconds. */
function lag(from: number, to: number, dt: number, tau: number): number {
  if (dt <= 0) return from;
  return from + (to - from) * (1 - Math.exp(-dt / tau));
}

/**
 * One frame of the state: the ratchet, the spike's rise or decay, the two
 * lags. A dead player's spike and lens hold; the world keeps moving. Pure.
 */
export function stepEscalation(prev: EscalationState, t: EscalationTargets, dt: number): EscalationState {
  if (dt <= 0) return prev;
  const creepMax = Math.max(prev.creepMax, clamp01(t.world));
  const world = lag(prev.world, creepMax, dt, WORLD_EASE_S);
  if (t.dead) return { creepMax, spike: prev.spike, world, lens: prev.lens };
  const spike =
    t.offTrail > 0
      ? Math.min(1, prev.spike + (t.offTrail / SPIKE_RISE_S) * dt)
      : Math.max(0, prev.spike - dt / SPIKE_DECAY_S);
  const lens = lag(prev.lens, Math.max(spike, clamp01(t.near)), dt, LENS_EASE_S);
  return { creepMax, spike, world, lens };
}

function smootherstep(x: number): number {
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * The sky and the weather for an eased state: the sun from the base hour to
 * NIGHT_HOUR (a base already past it stays), the weather from the base preset
 * to eerie, both by smootherstep of the world; then dread lifted to the lens.
 */
export function atmosphereUnder(base: AtmosphereBase, s: EscalationState): AtmosphereBase {
  const e = smootherstep(clamp01(s.world));
  const hour = base.hour >= NIGHT_HOUR ? base.hour : base.hour + (NIGHT_HOUR - base.hour) * e;
  const weather = lerpWeather(base.weather, WEATHER_PRESETS.eerie, e);
  const lens = clamp01(s.lens);
  if (lens > weather.dread) weather.dread = lens;
  return { weather, hour };
}
```

Add `join(SRC, "game", "escalation.ts"),` to `BABYLON_FREE_FILES` in `client/test/architecture.test.ts`, after the `registerHud.ts` entry.

- [ ] **Step 4: Run the tests, types and lint**

Run: `npx tsc -p client --noEmit && npx eslint . && npx vitest run --root client test/game/escalation.test.ts test/architecture.test.ts`
Expected: PASS. If `lerpWeather` returns a frozen object at `t === 0` or `t === 1` (it spreads — `{ ...a }` — so it does not), the dread lift would throw; the atmosphere tests at rest and at world 1 cover both ends.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/escalation.ts client/test/game/escalation.test.ts client/test/architecture.test.ts
git commit -m "feat: the escalation model"
```

---

### Task 3: The world answers

**Files:**
- Modify: `client/src/app.ts`

**Interfaces:**
- Consumes: everything Task 2 exports; `renderer.setHour/setWeather`, `ambient.setWeather`, `wildlifePresenceUnder` (existing).
- Produces: `base: AtmosphereBase` written by the `weather` and `time` commands; `escalation: EscalationState` per match; `syncAtmosphere(world, state, localId, dt)` called in both loops before `renderer.sync`.

There is no unit test for `app.ts`; the covering checks are the typecheck, the lint, and Task 4's browser pass.

- [ ] **Step 1: The base and the state**

In `client/src/app.ts`, beside `let weatherName: WeatherPresetName = DEFAULT_WEATHER;` (line ~133):

```ts
  /**
   * The console's preset and hour: what the escalation departs from on a
   * forest world (escalation.ts), and simply what shows everywhere else.
   */
  let base: AtmosphereBase = { weather: WEATHER_PRESETS[DEFAULT_WEATHER], hour: DEFAULT_HOUR };
  /** The escalation's eased state, reset when a match starts. */
  let escalation: EscalationState = ESCALATION_REST;
```

with the imports `import { ESCALATION_REST, atmosphereUnder, escalationTargets, stepEscalation, type AtmosphereBase, type EscalationState } from "./game/escalation.js";`.

- [ ] **Step 2: The commands write the base**

In `applyView`, the `time` branch becomes:

```ts
    } else if (name === "time") {
      // Instant, like every other view command: the sun moves, the world is not
      // rebuilt. Validation has already bounded this to [0, 24), so the fallback
      // is unreachable and exists only to satisfy the union type. On a forest
      // world this is the base the escalation departs from, and syncAtmosphere
      // overrides the renderer next frame; elsewhere it is simply the hour.
      base = { ...base, hour: typeof value === "number" ? value : DEFAULT_HOUR };
      renderer.setHour(base.hour);
```

and the `weather` branch keeps its preset lookup and `weatherName = preset;`, then:

```ts
      base = { ...base, weather: WEATHER_PRESETS[preset] };
      renderer.setWeather(base.weather, options.instant ? 0 : undefined);
      ambient.setWeather(base.weather);
      wildlifePresence = wildlifePresenceUnder(base.weather);
```

(The three direct calls stay so a world without a register behaves exactly as today; on a forest world `syncAtmosphere` overrides them next frame.)

- [ ] **Step 3: `syncAtmosphere`**

Add beside `syncPrompt`:

```ts
  /**
   * The world answering the game (escalation.ts): on a forest world with a
   * register, the sun, the weather, the ambient gains and the wildlife's
   * presence follow the escalation every frame — the renderer's own weather
   * fade is bypassed (0 s) because the model carries the easing. Elsewhere the
   * console's base stands and this does nothing. Both loops, before
   * `renderer.sync`, which reads the weather this sets.
   */
  function syncAtmosphere(world: World, state: WorldState, localId: number, dt: number): void {
    if (world.register === null || world.trail === null) return;
    const targets = escalationTargets(state, localId, world.register, world.trail, world.boxes, world.ground);
    escalation = stepEscalation(escalation, targets, dt);
    const a = atmosphereUnder(base, escalation);
    renderer.setHour(a.hour);
    renderer.setWeather(a.weather, 0);
    ambient.setWeather(a.weather);
    wildlifePresence = wildlifePresenceUnder(a.weather);
  }
```

In `runAsHost` and `runAsClient`, at the top (where `session = host;` / `session = client;` are set): `escalation = ESCALATION_REST;`.

In the host loop, replace

```ts
      const state: WorldState = host.world.state;
      const self = state.players.get(host.localEntityId);
      renderer.sync(state, host.localEntityId, accumulator.alpha, { dt, sprinting: input.sprinting });
```

with

```ts
      const state: WorldState = host.world.state;
      const self = state.players.get(host.localEntityId);
      syncAtmosphere(host.world, state, host.localEntityId, dt);
      renderer.sync(state, host.localEntityId, accumulator.alpha, { dt, sprinting: input.sprinting });
```

and in the client loop likewise, `syncAtmosphere(client.world, state, client.localEntityId, dt);` before its `renderer.sync` (the client's predicted world carries `register`, `trail`, `boxes` and `ground`; `state` is `client.renderState(...)`, which carries the items, the enemies and the reconciled local player).

- [ ] **Step 4: Types and lint, then a cost check**

Run: `npx tsc -p client --noEmit && npx eslint .`
Expected: PASS.

Then read `ambient.setWeather` (`client/src/game/ambientAudio.ts`) and `renderer.setWeather` once: if either allocates or restarts anything per call beyond setting gains and a record, throttle `syncAtmosphere`'s three consumer calls to when `a.weather` moved by more than 0.005 in any field or `a.hour` by more than 0.01 since the last call (keep the last applied values in two locals). If both are cheap, leave the per-frame calls and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add client/src/app.ts
git commit -m "feat: the world answers the game"
```

---

### Task 4: The browser, then the record

**Files:**
- Modify: `docs/gameplay/2026-09-16-escalation-and-atmosphere.md` (Status), `docs/gameplay/2026-09-08-register-and-hollow.md` (§17 row)

- [ ] **Step 1: The full suite**

Run: `npm run typecheck && npm run lint && npm test` on a quiet machine. Under load the forest-building tests time out; re-run those files alone with `--maxWorkers=2` before reading anything into it.

- [ ] **Step 2: Play it**

With the dev stack on the default ports, a headed isolated `chrome-devtools` daemon and the register play rig's hooks (`__host`, `__tp` for any player, `__scene`), on seed `hollow` (two hikers), check and screenshot:

1. Noon at the pad on a fresh world; `/weather` reports `clear`.
2. Pick up the pond item: over the next minute the light dims and the mist begins (`renderer`'s hour reads toward 17; the weather's `mist` toward 0.5). Read `escalation` through a temporary hook if the numbers are wanted; the screen is the gate.
3. Teleport the host 40 m off the trail (`trailDistance` ≥ 40): within a few seconds the vignette closes and the image pales; the animals fall quiet (`wildlifePresence.ground` reads 0); back on the trail it lifts within ten seconds.
4. The Hollow approaching: the same pallor from ~80 m, total at 10 m — keep the look under four seconds (the stare).
5. Both hikers picked up: night (hour 22), the eerie palette, the headlamp the only light on the walk to the car.
6. A world with no register (`/terrain` a variant without a trail, if one exists; else the sandbox level) keeps `/weather` and `/time` exactly as typed.

- [ ] **Step 3: Record**

Spec Status: `**Status:** Built <date> (\`docs/gameplay/2026-09-16-escalation-and-atmosphere-plan.md\`). Numbers that moved in execution: …` — every constant or rule that changed and why, or "none". Parent §17 D row: "built <date>". Commit:

```bash
git add docs/gameplay/2026-09-16-escalation-and-atmosphere.md docs/gameplay/2026-09-08-register-and-hollow.md
git commit -m "docs: record escalation and atmosphere as built"
```

Then the leak scan, push, `npm run deploy:client`, `npm run deploy:verify` (client only: `server/` is untouched).

## Self-review notes

- **Spec coverage.** §2.1 floor/creep/ratchet → Task 2 (`escalationTargets`, `stepEscalation`); §2.2 spike/near/dead → Task 2; §2.3 lags → Task 2; §3 the curve and its consumers → Task 2 (`atmosphereUnder`) and Task 3 (`syncAtmosphere`); §4.1 → Task 1; §4.3 the base and the commands → Task 3; §4.4 nothing on the wire → no task touches `net/`; §5 → the browser list in Task 4; §6's tests → Tasks 1 and 2; the spec's `commands.test.ts` line is dropped — the base lives in `app.ts`, which has no harness; Task 4's step 6 checks it in the browser instead.
- **Type consistency.** `escalationTargets(state, localId, register, graph, boxes, ground)`, `stepEscalation(prev, t, dt)`, `atmosphereUnder(base, s)`, `EscalationTargets { world, offTrail, near, dead }`, `EscalationState { creepMax, spike, world, lens }` are used with those shapes in every task.
- **Placeholder scan:** none.
