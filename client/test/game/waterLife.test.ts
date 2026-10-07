import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { lakeOf } from "../sim/helpers/lakes.js";
import { marshWeightAt } from "../../src/sim/features.js";
import { elevationAt } from "../../src/sim/terrain.js";
import { WEATHER_PRESETS, type WeatherParams } from "../../src/game/weather.js";
import { windRecordUnder } from "../../src/game/windParams.js";
import { skyStateFor } from "../../src/game/skyState.js";
import { MIDGE_NAME } from "../../src/game/midgeSwarms.js";
import { HUM_RANGE } from "../../src/game/waterLifeAudio.js";
import type { WaterLifeLayout } from "../../src/game/waterLifeField.js";
import type { Dragonflies } from "../../src/game/dragonflyBehaviour.js";
import { createWaterLife, type WaterLife, type WaterLifeFrame } from "../../src/game/waterLife.js";
import { skyFixture } from "./helpers/skyFixture.js";
import { timeLimit } from "../helpers/timeLimit.js";

// What the water life hands its parts, recorded on the way through to the
// real ones: the layout, the midges' blocks and table, the dragonflies' units
// and how often the units and the frogs are stepped.
const seen = vi.hoisted(() => ({
  layout: null as WaterLifeLayout | null,
  blocks: [] as number[],
  table: null as Float32Array | null,
  /** The sun's light and the sky's glow the last midge frame carried. */
  sunLight: null as number[] | null,
  skyGlow: null as number[] | null,
  midgeUpdates: 0,
  dragonflies: null as Dragonflies | null,
  dragonflySteps: 0,
  frogSteps: 0,
  /** The players the last steps of the dragonflies and of the frogs were handed. */
  dragonflyPlayers: null as readonly unknown[] | null,
  frogPlayers: null as readonly unknown[] | null,
}));
vi.mock("../../src/game/waterLifeField.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/waterLifeField.js")>();
  return {
    ...mod,
    waterLifeLayout: (...args: Parameters<typeof mod.waterLifeLayout>) => {
      seen.layout = mod.waterLifeLayout(...args);
      return seen.layout;
    },
  };
});
vi.mock("../../src/game/midgeSwarms.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/midgeSwarms.js")>();
  return {
    ...mod,
    createMidgeSwarms: (...args: Parameters<typeof mod.createMidgeSwarms>) => {
      seen.blocks = [...args[1]];
      const swarms = mod.createMidgeSwarms(...args);
      const update = swarms.update.bind(swarms);
      swarms.update = (f) => {
        seen.midgeUpdates += 1;
        seen.table = f.table;
        seen.sunLight = [f.sunR, f.sunG, f.sunB];
        seen.skyGlow = [f.glowR, f.glowG, f.glowB];
        update(f);
      };
      return swarms;
    },
  };
});
vi.mock("../../src/game/dragonflyBehaviour.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/dragonflyBehaviour.js")>();
  return {
    ...mod,
    createDragonflyBehaviour: (...args: Parameters<typeof mod.createDragonflyBehaviour>) => {
      const d = mod.createDragonflyBehaviour(...args);
      const step = d.step.bind(d);
      d.step = (...at) => {
        seen.dragonflySteps += 1;
        seen.dragonflyPlayers = [...at[5]];
        step(...at);
      };
      seen.dragonflies = d;
      return d;
    },
  };
});
vi.mock("../../src/game/frogChorus.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/frogChorus.js")>();
  return {
    ...mod,
    createFrogChorus: (...args: Parameters<typeof mod.createFrogChorus>) => {
      const chorus = mod.createFrogChorus(...args);
      const step = chorus.step.bind(chorus);
      chorus.step = (...at) => {
        seen.frogSteps += 1;
        seen.frogPlayers = [...at[2]];
        step(...at);
      };
      return chorus;
    },
  };
});

/** The suite's world: its lake is clear, its rim 31 m from its centre, eight frogs about it and no marsh. */
const SEED = 388817;
/** A world whose murky lake has a marsh. */
const MARSH_SEED = -1065037390;
/** A row's count and presence in the swarms' table (three vec4 a row). */
const COUNT = 5;
const PRESENCE = 6;
const ROW = 12;

/** The first marker's row's count in the table, as last packed. */
function table0Count(): number {
  return seen.table![COUNT]!;
}

let engine: NullEngine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
  seen.layout = null;
  seen.blocks = [];
  seen.table = null;
  seen.sunLight = null;
  seen.skyGlow = null;
  seen.midgeUpdates = 0;
  seen.dragonflies = null;
  seen.dragonflySteps = 0;
  seen.frogSteps = 0;
  seen.dragonflyPlayers = null;
  seen.frogPlayers = null;
});

function scene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

/** The camera at (x, y, z) at `hour` under `weather`, no player, no Hollow. */
function frameAt(x: number, y: number, z: number, hour: number, weather: WeatherParams = WEATHER_PRESETS.clear): WaterLifeFrame {
  return {
    camX: x, camY: y, camZ: z,
    tick: 0, dt: 1 / 60, time: 0,
    players: [],
    weather, hour, wind: windRecordUnder(weather, 0),
    sky: skyStateFor(skyFixture(), hour, weather), skyLuma: 0.25, pixelAt1m: 0.001,
    hollowDistance: Infinity,
  };
}

/** How many of this frame's hums can be heard from the camera: a swarm
 * present, with midges, within the hum's range. */
function audible(life: WaterLife, f: WaterLifeFrame): number {
  const s = life.sound();
  let n = 0;
  for (let i = 0; i < s.hums_n; i++) {
    const h = s.hums[i]!;
    if (h.presence > 0 && h.midges > 0 && Math.hypot(h.x - f.camX, h.y - f.camY, h.z - f.camZ) <= HUM_RANGE) n++;
  }
  return n;
}

/** `seconds` of frames `dt` apart on the shared clock, `each` after every one. */
function run(life: WaterLife, f: WaterLifeFrame, seconds: number, dt = 1 / 20, each: () => void = () => undefined): void {
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) {
    f.dt = dt;
    f.time += dt;
    f.tick = Math.round(f.time * 60);
    life.update(f);
    each();
  }
}

/** A point on the shore `out` metres beyond the rim at `angle`, and its ground. */
function shore(angle: number, out = 2): { x: number; z: number; ground: number } {
  const lake = lakeOf(SEED);
  const x = lake.x + Math.cos(angle) * (lake.radius + out);
  const z = lake.z + Math.sin(angle) * (lake.radius + out);
  return { x, z, ground: elevationAt(SEED, x, z) };
}

describe("the lake's life", { timeout: timeLimit(60_000) }, () => {
  it("makes one midge draw and the three kinds' cards, with a block of instances for every marker and every head", () => {
    const life = createWaterLife(scene(), SEED, lakeOf(SEED), "high", "post");
    expect(life.meshes).toHaveLength(4);
    expect(life.meshes[0]!.material?.name).toBe(MIDGE_NAME);
    expect(seen.layout!.markers).toHaveLength(19);
    expect(seen.blocks).toHaveLength(32);
    // A marker's swarm at its fullest, mist's 30 % more (the first marker's 81
    // midges are a block of 106); the unused marker rows hold none.
    expect(seen.blocks.slice(0, 25)).toEqual([
      106, 302, 85, 78, 491, 78, 259, 440, 206, 205, 394, 207, 489, 266, 385, 98, 240, 505, 143,
      0, 0, 0, 0, 0, 0,
    ]);
    // One head row a player, each the largest head swarm; the last two rows unused.
    expect(seen.blocks.slice(25)).toEqual([150, 150, 150, 150, 150, 0, 0]);
    // Nothing drawn before the first frame.
    expect(life.meshes[0]!.isEnabled()).toBe(false);
    // Their bounds sit at the origin: they sort by their index alone, last.
    for (const mesh of life.meshes) expect(mesh.alphaIndex).toBe(Number.POSITIVE_INFINITY);
    life.dispose();
  });

  it("tones its midges for the frame's colour path, as the sky dome is toned", () => {
    for (const [colourPath, toneMap] of [["post", 0], ["material", 1]] as const) {
      const life = createWaterLife(scene(), SEED, lakeOf(SEED), "low", colourPath);
      const floats = (life.meshes[0]!.material as unknown as { _floats: Record<string, number> })._floats;
      expect(floats["midgeToneMap"], colourPath).toBe(toneMap);
      life.dispose();
      engine?.dispose();
      engine = null;
    }
  });

  it("at dusk by a marker, fills its row at full presence and hums it at the summer's pitch", () => {
    const life = createWaterLife(scene(), SEED, lakeOf(SEED), "high", "post");
    const m = seen.layout!.markers[0]!;
    const f = frameAt(m.x, m.y, m.z + 1, 18.5);
    life.update(f);
    const table = seen.table!;
    expect(table[COUNT]).toBeGreaterThan(0);
    expect(table[PRESENCE]).toBe(1);
    // No player, so no head swarm.
    for (let h = 25; h < 30; h++) expect(table[h * ROW + COUNT]).toBe(0);
    expect(life.meshes[0]!.isEnabled()).toBe(true);
    const sound = life.sound();
    expect(audible(life, f)).toBeGreaterThan(0);
    // A hum for every row, each the swarm of its own row: the first marker's
    // is the first, at its swarm, and the heads' rows have none.
    expect(sound.hums_n).toBe(30);
    expect(Math.hypot(sound.hums[0]!.x - m.x, sound.hums[0]!.z - m.z)).toBeLessThan(2 * m.radius);
    expect(sound.hums[0]!.presence).toBe(1);
    // Its marker's midges: no mist, no fuller.
    expect(sound.hums[0]!.midges).toBeCloseTo(81, 3);
    for (let h = 25; h < 30; h++) expect(sound.hums[h]!.presence).toBe(0);
    // 19.04 °C at 18:30 under a clear sky: 230 Hz at 15 °C and 10 Hz a degree.
    expect(sound.pitch).toBeCloseTo(270.43807145043604, 9);
    expect(sound.frogCalls).toHaveLength(0);
    life.dispose();
  });

  it("lights the midges with the sun and with the dome's horizon toward it, and with neither before the sky's first slices", () => {
    const life = createWaterLife(scene(), SEED, lakeOf(SEED), "high", "post");
    const m = seen.layout!.markers[0]!;
    // A quarter hour after sunset: the sun is down and gives no light, the
    // horizon toward it still glows (the sky state's horizonToward, in the
    // scene's units as the dome draws it).
    const f = frameAt(m.x, m.y, m.z + 1, 18.25);
    life.update(f);
    expect(seen.sunLight).toEqual([0, 0, 0]);
    expect(seen.skyGlow![0]).toBeCloseTo(1.8279791202740467, 9);
    expect(seen.skyGlow![1]).toBeCloseTo(0.46724543707121463, 9);
    expect(seen.skyGlow![2]).toBeCloseTo(0.5186590210160579, 9);
    f.sky = null;
    run(life, f, 0.05);
    expect(seen.sunLight).toEqual([0, 0, 0]);
    expect(seen.skyGlow).toEqual([0, 0, 0]);
    life.dispose();
  });

  it("lights the sky's glint with the horizon toward the sun as the dome draws it, the mist's blend in it", () => {
    const life = createWaterLife(scene(), SEED, lakeOf(SEED), "high", "post");
    const m = seen.layout!.markers[0]!;
    // Sunset in mist: the dome's horizon is wholly the mist's air (its weight
    // 1), not the red glow the clear sky's ring holds under it.
    const f = frameAt(m.x, m.y, m.z + 1, 18, WEATHER_PRESETS.mist);
    life.update(f);
    expect(seen.skyGlow![0]).toBeCloseTo(0.13512684221165877, 9);
    expect(seen.skyGlow![1]).toBeCloseTo(0.13365015103716507, 9);
    expect(seen.skyGlow![2]).toBeCloseTo(0.13812700476024908, 9);
    life.dispose();
  });

  it("keeps a swarm's hum at its row, and zeroes its presence when the swarm is out of sight", () => {
    const lake = lakeOf(SEED);
    const life = createWaterLife(scene(), SEED, lake, "high", "post");
    const m = seen.layout!.markers[0]!;
    const f = frameAt(m.x, m.y, m.z + 1, 18.5);
    life.update(f);
    const first = life.sound().hums[0]!;
    expect(first.presence).toBe(1);
    // 100 m out from the far shore: the first swarm is past 80 m, out of sight.
    const away = Math.atan2(m.z - lake.z, m.x - lake.x) + Math.PI;
    f.camX = lake.x + Math.cos(away) * (lake.radius + 100);
    f.camZ = lake.z + Math.sin(away) * (lake.radius + 100);
    run(life, f, 0.1);
    const sound = life.sound();
    expect(sound.hums_n).toBe(30);
    expect(sound.hums[0]).toBe(first);
    expect(first.presence).toBe(0);
    expect(table0Count()).toBe(0);
    life.dispose();
  });

  it("at noon on the shore, flies the dragonflies and neither draws nor hums a midge", () => {
    const life = createWaterLife(scene(), SEED, lakeOf(SEED), "high", "post");
    const at = shore(0);
    const f = frameAt(at.x, at.ground + 1.6, at.z, 12);
    let hums = 0;
    run(life, f, 1, 1 / 20, () => {
      hums += audible(life, f);
    });
    const d = seen.dragonflies!;
    expect(d.count[0] + d.count[1] + d.count[2]).toBeGreaterThan(0);
    expect(seen.dragonflySteps).toBe(20);
    expect(seen.midgeUpdates).toBe(0);
    expect(life.meshes[0]!.isEnabled()).toBe(false);
    expect(hums).toBe(0);
    life.dispose();
  });

  it("at night on the shore, the frogs call and nothing hums", () => {
    const life = createWaterLife(scene(), SEED, lakeOf(SEED), "high", "post");
    const at = shore(0);
    const f = frameAt(at.x, at.ground + 1.6, at.z, 22);
    let calls = 0;
    let hums = 0;
    run(life, f, 120, 1 / 20, () => {
      calls += life.sound().frogCalls.length;
      hums += audible(life, f);
    });
    expect(calls).toBeGreaterThan(0);
    expect(hums).toBe(0);
    expect(seen.midgeUpdates).toBe(0);
    expect(life.meshes[0]!.isEnabled()).toBe(false);
    life.dispose();
  });

  it("far from the lake, steps, draws and voices nothing, even with a player at the water, until the camera comes back", () => {
    const lake = lakeOf(SEED);
    const life = createWaterLife(scene(), SEED, lake, "high", "post");
    const m = seen.layout!.markers[0]!;
    const at = shore(0);
    const f = frameAt(lake.x + 1000, at.ground + 100, lake.z, 18.5);
    f.players = [{ x: at.x, y: at.ground + 0.9, z: at.z }];
    let heard = 0;
    run(life, f, 2, 1 / 20, () => {
      const s = life.sound();
      heard += s.hums_n + s.rustles.length + s.frogCalls.length;
    });
    expect([seen.dragonflySteps, seen.frogSteps, seen.midgeUpdates]).toEqual([0, 0, 0]);
    expect(heard).toBe(0);
    expect(life.meshes[0]!.isEnabled()).toBe(false);
    f.camX = m.x;
    f.camY = m.y;
    f.camZ = m.z + 1;
    run(life, f, 0.1);
    expect([seen.dragonflySteps, seen.frogSteps, seen.midgeUpdates]).toEqual([2, 2, 2]);
    expect(audible(life, f)).toBeGreaterThan(0);
    life.dispose();
  });

  it("eases the midges out over 3 s when the hour jumps from dusk to noon", () => {
    const life = createWaterLife(scene(), SEED, lakeOf(SEED), "high", "post");
    const m = seen.layout!.markers[0]!;
    const f = frameAt(m.x, m.y, m.z + 1, 18.5);
    life.update(f);
    expect(seen.table![PRESENCE]).toBe(1);
    f.hour = 12;
    f.sky = skyStateFor(skyFixture(), 12, WEATHER_PRESETS.clear);
    run(life, f, 1.5);
    expect(seen.table![PRESENCE]).toBeCloseTo(0.5, 6);
    expect(life.sound().hums[0]!.presence).toBeCloseTo(0.5, 6);
    run(life, f, 1.5);
    expect(life.meshes[0]!.isEnabled()).toBe(false);
    expect(life.sound().hums[0]!.presence).toBe(0);
    expect(audible(life, f)).toBe(0);
    life.dispose();
  });

  it("holds no NaN through jumps of the hour and the weather, with a swarm over a player's head", () => {
    const life = createWaterLife(scene(), SEED, lakeOf(SEED), "high", "post");
    const m = seen.layout!.markers[0]!;
    const at = shore(0);
    const f = frameAt(m.x, m.y, m.z + 1, 18.5);
    f.players = [{ x: at.x, y: at.ground + 0.9, z: at.z }];
    run(life, f, 12);
    // Ten seconds standing in the band at dusk: a swarm over the head.
    expect(seen.table![25 * ROW + COUNT]).toBeGreaterThan(0);
    const jumps: [number, WeatherParams, number][] = [
      [22, WEATHER_PRESETS.clear, 1 / 60],
      [6.25, WEATHER_PRESETS.mist, 5],
      [12, WEATHER_PRESETS.rain, 0],
      [18.5, WEATHER_PRESETS.eerie, 1 / 60],
      [3, WEATHER_PRESETS.clear, 0.25],
      [18.5, WEATHER_PRESETS.clear, 1 / 60],
    ];
    const d = seen.dragonflies!;
    const finite = (): void => {
      expect(seen.table!.every(Number.isFinite)).toBe(true);
      const s = life.sound();
      expect(Number.isFinite(s.pitch)).toBe(true);
      for (let i = 0; i < s.hums_n; i++) {
        const h = s.hums[i]!;
        expect([h.x, h.y, h.z, h.midges, h.presence].every(Number.isFinite)).toBe(true);
      }
      for (let k = 0; k < 3; k++) {
        for (let i = 0; i < d.count[k]!; i++) {
          const p = d.poses[k]![i]!;
          expect([p.x, p.y, p.z, p.yaw, p.pitch].every(Number.isFinite)).toBe(true);
        }
      }
    };
    for (const [hour, weather, dt] of jumps) {
      f.hour = hour;
      f.weather = weather;
      f.wind = windRecordUnder(weather, f.time);
      f.sky = skyStateFor(skyFixture(), hour, weather);
      f.dt = dt;
      f.time += dt;
      f.tick = Math.round(f.time * 60);
      life.update(f);
      finite();
      // And the second the presence eases through after the jump.
      run(life, f, 1, 1 / 20, finite);
    }
    life.dispose();
  });

  it("gathers a swarm over each of five players standing at dusk, within the rows and the low tier's 800 midges", () => {
    const life = createWaterLife(scene(), SEED, lakeOf(SEED), "low", "material");
    const players = [0, 0.3, 0.6, 0.9, 1.2].map((angle) => {
      const at = shore(angle);
      return { x: at.x, y: at.ground + 0.9, z: at.z };
    });
    const first = players[0]!;
    const f = frameAt(first.x, first.y + 0.7, first.z, 18.5);
    f.players = players;
    // Ten seconds still, then three as the swarms gather.
    run(life, f, 14);
    const table = seen.table!;
    let drawn = 0;
    for (let r = 0; r < 32; r++) drawn += table[r * ROW + COUNT]!;
    expect(drawn).toBeLessThanOrEqual(800);
    for (let h = 0; h < 5; h++) {
      const row = (25 + h) * ROW;
      expect(table[row + COUNT]).toBeGreaterThan(0);
      // Over the head, the body's centre and 0.9 m above it: half a metre to
      // a metre higher, as the wind leaves it.
      expect(table[row + 1]).toBeGreaterThan(players[h]!.y + 0.9);
      expect(table[row + 1]).toBeLessThan(players[h]!.y + 0.9 + 1.5);
    }
    expect([table[30 * ROW + COUNT], table[31 * ROW + COUNT]]).toEqual([0, 0]);
    // Each head's hum is its row's, over its own player.
    for (let h = 0; h < 5; h++) {
      const hum = life.sound().hums[25 + h]!;
      expect(hum.presence).toBe(1);
      expect(Math.hypot(hum.x - players[h]!.x, hum.z - players[h]!.z)).toBeLessThan(1);
    }
    life.dispose();
  });

  it("gathers a swarm over a head over 3 s once it forms, and thins it out over 3 s where the head last was once it lets go", () => {
    const life = createWaterLife(scene(), SEED, lakeOf(SEED), "high", "post");
    const at = shore(0);
    const player = { x: at.x, y: at.ground + 0.9, z: at.z };
    const f = frameAt(at.x, at.ground + 1.6, at.z, 18.5);
    f.players = [player];
    const row = 25 * ROW;
    /** The head's row's presence as drawn and as heard. */
    const shown = (): number[] => [seen.table![row + PRESENCE]!, life.sound().hums[25]!.presence];
    // Ten seconds standing still in the band at dusk: the swarm forms, its
    // midges laid out at once, their presence a first step of the ease.
    run(life, f, 9.95);
    expect(seen.table![row + COUNT]).toBe(0);
    run(life, f, 0.05);
    expect(seen.table![row + COUNT]).toBeGreaterThan(0);
    shown().forEach((p) => expect(p).toBeCloseTo(0.016667, 6));
    // Half gathered a second and a half on, whole at three seconds.
    run(life, f, 1.5);
    shown().forEach((p) => expect(p).toBeCloseTo(0.516667, 6));
    run(life, f, 1.5);
    expect(shown()).toEqual([1, 1]);
    // The player leaves: the swarm thins out over three seconds, still over
    // the place their head last was, then is gone.
    f.players = [];
    run(life, f, 0.05);
    shown().forEach((p) => expect(p).toBeCloseTo(0.983333, 6));
    run(life, f, 1.5);
    shown().forEach((p) => expect(p).toBeCloseTo(0.483333, 6));
    expect(seen.table![row + COUNT]).toBeGreaterThan(0);
    const hum = life.sound().hums[25]!;
    expect(Math.hypot(hum.x - player.x, hum.z - player.z)).toBeLessThan(1);
    run(life, f, 1.45);
    expect(shown()).toEqual([0, 0]);
    expect(seen.table![row + COUNT]).toBe(0);
    life.dispose();
  });

  it("keeps each swarm over its own player's head when a slot between them empties", () => {
    const life = createWaterLife(scene(), SEED, lakeOf(SEED), "low", "material");
    const players = [0, 0.6, 1.2].map((angle) => {
      const at = shore(angle);
      return { x: at.x, y: at.ground + 0.9, z: at.z };
    });
    const first = players[0]!;
    const f = frameAt(first.x, first.y + 0.7, first.z, 18.5);
    f.players = players;
    run(life, f, 14);
    for (let h = 0; h < 3; h++) expect(life.sound().hums[25 + h]!.presence).toBe(1);
    // The second player's slot empties: their swarm thins out over three
    // seconds and is gone; the third keeps the third.
    f.players = [players[0], undefined, players[2]];
    run(life, f, 3);
    const hums = life.sound().hums;
    expect(hums[26]!.presence).toBe(0);
    expect(seen.table![26 * ROW + COUNT]).toBe(0);
    for (const h of [0, 2]) {
      expect(hums[25 + h]!.presence).toBe(1);
      expect(Math.hypot(hums[25 + h]!.x - players[h]!.x, hums[25 + h]!.z - players[h]!.z)).toBeLessThan(1);
    }
    // The dragonflies and the frogs are handed the players there are.
    expect(seen.dragonflyPlayers).toEqual([players[0], players[2]]);
    expect(seen.frogPlayers).toEqual([players[0], players[2]]);
    life.dispose();
  });

  it("lets every head swarm go while the camera is out of reach, so none passes to a player who takes a slot meanwhile", () => {
    const lake = lakeOf(SEED);
    const life = createWaterLife(scene(), SEED, lake, "high", "post");
    const a = shore(0);
    const b = shore(2);
    const f = frameAt(a.x, a.ground + 1.6, a.z, 18.5);
    f.players = [{ x: a.x, y: a.ground + 0.9, z: a.z }];
    run(life, f, 14);
    expect(life.sound().hums[25]!.presence).toBe(1);
    // The camera goes beyond the reach; the first player leaves and another,
    // elsewhere on the shore, takes the slot.
    f.camX = lake.x + 1000;
    run(life, f, 0.1);
    f.players = [{ x: b.x, y: b.ground + 0.9, z: b.z }];
    run(life, f, 0.1);
    // Back by the newcomer: no swarm over them until they have stood long enough.
    f.camX = b.x;
    f.camY = b.ground + 1.6;
    f.camZ = b.z;
    run(life, f, 0.1);
    expect(life.sound().hums[25]!.presence).toBe(0);
    expect(seen.table![25 * ROW + COUNT]).toBe(0);
    life.dispose();
  });

  it("lays the far chorus over the marsh's middle and on the rim across the lake from it, 0.3 m above the water", () => {
    const lake = lakeOf(MARSH_SEED);
    const lobe = lake.lobe!;
    const life = createWaterLife(scene(), MARSH_SEED, lake, "low", "material");
    const [marsh, across] = life.sound().bed.points;
    const from = (p: { x: number; z: number }) => Math.hypot(p.x - lake.x, p.z - lake.z);
    const along = (p: { x: number; z: number }) => ((p.x - lake.x) * lobe.dirX + (p.z - lake.z) * lobe.dirZ) / from(p);
    // The marsh's middle: 5 m in from the rim along the marsh's own direction, its core.
    expect(from(marsh) - lake.radius).toBeCloseTo(-5, 9);
    expect(along(marsh)).toBeCloseTo(1, 9);
    expect(marshWeightAt(lake, marsh.x, marsh.z)).toBe(1);
    // Straight across, on the rim.
    expect(from(across) - lake.radius).toBeCloseTo(0, 9);
    expect(along(across)).toBeCloseTo(-1, 9);
    expect([marsh.y - lake.level, across.y - lake.level].map((h) => h.toFixed(9))).toEqual(["0.300000000", "0.300000000"]);
    life.dispose();
  });

  it("without a marsh, lays the far chorus on the rim across the lake from its first frog, and on the rim by that frog", () => {
    const lake = lakeOf(SEED);
    expect(lake.lobe).toBeNull();
    const life = createWaterLife(scene(), SEED, lake, "low", "material");
    const v = seen.layout!.voices[0]!;
    const [far, by] = life.sound().bed.points;
    const from = (p: { x: number; z: number }) => Math.hypot(p.x - lake.x, p.z - lake.z);
    const toward = (p: { x: number; z: number }) => ((p.x - lake.x) * (v.x - lake.x) + (p.z - lake.z) * (v.z - lake.z)) / (from(p) * from(v));
    expect([from(far) - lake.radius, from(by) - lake.radius].map((d) => d.toFixed(9))).toEqual(["0.000000000", "0.000000000"]);
    expect(toward(far)).toBeCloseTo(-1, 9);
    expect(toward(by)).toBeCloseTo(1, 9);
    expect([far.y - lake.level, by.y - lake.level].map((h) => h.toFixed(9))).toEqual(["0.300000000", "0.300000000"]);
    life.dispose();
  });

  it("quiets each chorus loop around the player nearest its place, as the voices fall silent there, never below 0.35", () => {
    const lake = lakeOf(SEED);
    const life = createWaterLife(scene(), SEED, lake, "low", "material");
    const at = shore(0);
    const f = frameAt(at.x, at.ground + 1.6, at.z, 22);
    const [p0, p1] = life.sound().bed.points;
    /** A player `d` metres out from a loop's place, away from the lake's middle:
     * the other place, across the lake, stays more than 52 m off. */
    const outFrom = (p: { x: number; z: number }, d: number) => {
      const r = Math.hypot(p.x - lake.x, p.z - lake.z);
      return { x: p.x + ((p.x - lake.x) / r) * d, y: lake.level + 1, z: p.z + ((p.z - lake.z) / r) * d };
    };
    const duck = () => [...life.sound().bed.duck];
    // No player: both whole.
    life.update(f);
    expect(duck()).toEqual([1, 1]);
    // At the place, and at the voices' quiet radius: the floor. Then linearly
    // from 12 m to 30 m: half at 21 m, whole from 30 m.
    for (const [d, want] of [[0, 0.35], [12, 0.35], [15, 0.35], [21, 0.5], [27, 0.833333333], [30, 1], [45, 1]] as const) {
      f.players = [outFrom(p0!, d)];
      run(life, f, 0.05);
      expect(duck()[0], `${d} m`).toBeCloseTo(want, 9);
      expect(duck()[1], `${d} m`).toBe(1);
    }
    // Several players: the nearest to each place decides its loop.
    f.players = [outFrom(p0!, 40), outFrom(p0!, 21), outFrom(p1!, 24)];
    run(life, f, 0.05);
    expect(duck()[0]).toBeCloseTo(0.5, 9);
    expect(duck()[1]).toBeCloseTo(0.666666667, 9);
    life.dispose();
  });

  it("sounds the far chorus at night, thinner with a player among the frogs, and not by day, under dread, with the Hollow near, out of reach or once disposed", () => {
    const lake = lakeOf(SEED);
    const life = createWaterLife(scene(), SEED, lake, "low", "material");
    const at = shore(0);
    const f = frameAt(at.x, at.ground + 1.6, at.z, 22);
    const level = () => life.sound().bed.level;
    life.update(f);
    expect(level()).toBe(1);
    // A player by the first of the eight frogs stops it: the chorus at 0.35 + 0.65 · 7/8.
    const v = seen.layout!.voices[0]!;
    f.players = [{ x: v.x, y: v.y + 0.9, z: v.z }];
    run(life, f, 0.1);
    expect(level()).toBeCloseTo(0.91875, 9);
    f.players = [];
    // The Hollow within 60 m: none at once, and back beyond 80 m (the stopped frog still waiting).
    f.hollowDistance = 50;
    run(life, f, 0.1);
    expect(level()).toBe(0);
    f.hollowDistance = 100;
    run(life, f, 0.1);
    expect(level()).toBeCloseTo(0.91875, 9);
    // Noon: the frogs' presence eases out over 3 s.
    f.hour = 12;
    run(life, f, 1.5);
    expect(level()).toBeGreaterThan(0);
    run(life, f, 1.5);
    expect(level()).toBe(0);
    // Back at night under dread: none.
    f.hour = 22;
    f.weather = WEATHER_PRESETS.eerie;
    f.wind = windRecordUnder(WEATHER_PRESETS.eerie, f.time);
    run(life, f, 3);
    expect(level()).toBe(0);
    // A clear night again, then the camera out of reach: none.
    f.weather = WEATHER_PRESETS.clear;
    f.wind = windRecordUnder(WEATHER_PRESETS.clear, f.time);
    run(life, f, 3);
    expect(level()).toBeGreaterThan(0);
    f.camX = lake.x + 1000;
    run(life, f, 0.1);
    expect(level()).toBe(0);
    f.camX = at.x;
    run(life, f, 0.1);
    expect(level()).toBeGreaterThan(0);
    life.dispose();
    expect(level()).toBe(0);
  });

  it("steps, draws and voices nothing once disposed, and disposes once", () => {
    const life = createWaterLife(scene(), SEED, lakeOf(SEED), "high", "post");
    const m = seen.layout!.markers[0]!;
    life.update(frameAt(m.x, m.y, m.z + 1, 18.5));
    expect(life.sound().hums_n).toBe(30);
    life.dispose();
    const steps = [seen.dragonflySteps, seen.frogSteps, seen.midgeUpdates];
    // At night on the shore, where the frogs call: nothing.
    const at = shore(0);
    const f = frameAt(at.x, at.ground + 1.6, at.z, 22);
    let calls = 0;
    run(life, f, 30, 1 / 20, () => {
      calls += life.sound().frogCalls.length;
    });
    expect(life.sound().hums_n).toBe(0);
    expect(calls).toBe(0);
    expect([seen.dragonflySteps, seen.frogSteps, seen.midgeUpdates]).toEqual(steps);
    expect(() => life.dispose()).not.toThrow();
  });

  it("takes every mesh and material it made out of the scene on dispose, and falls silent", () => {
    const s = scene();
    const before = { meshes: s.meshes.length, materials: s.materials.length };
    const life = createWaterLife(s, SEED, lakeOf(SEED), "high", "post");
    const m = seen.layout!.markers[0]!;
    const f = frameAt(m.x, m.y, m.z + 1, 18.5);
    life.update(f);
    expect(audible(life, f)).toBeGreaterThan(0);
    life.dispose();
    expect(life.meshes.every((mesh) => mesh.isDisposed())).toBe(true);
    expect({ meshes: s.meshes.length, materials: s.materials.length }).toEqual(before);
    expect(life.sound().hums_n).toBe(0);
  });
});
