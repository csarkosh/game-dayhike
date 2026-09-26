import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer } from "../../src/sim/world.js";
import type { World } from "../../src/sim/world.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { nextRandom } from "../../src/sim/types.js";
import type { PlayerState, Vec3 } from "../../src/sim/types.js";
import { ENEMY_HALF, PLAYER_EYE_OFFSET, TICK_DT } from "../../src/sim/constants.js";
import { trailDistance } from "../../src/sim/trail.js";
import type { TrailNode } from "../../src/sim/trail.js";
import { stemNodes } from "../../src/sim/trailRoute.js";
import { isOnCorridor } from "../../src/sim/containment.js";
import { groundSpawn } from "../../src/sim/spawn.js";
import { hasLineOfSight } from "../../src/sim/ai.js";
import { aimDirection } from "../../src/sim/view.js";
import { WATCH_SALT, climbOf, placeWatcher, reachOf, stepWatcher, topForkClimb } from "../../src/sim/watcher.js";
import type { WatcherRecord } from "../../src/sim/watcher.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

const horizontal = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

/** Why one placement was refused, in the order the rule checks. */
type Refusal = "clearance" | "ground" | "slope" | "corridor" | "flee" | "sightline";
const REFUSALS: Refusal[] = ["clearance", "ground", "slope", "corridor", "flee", "sightline"];

/**
 * The placement rule, re-derived here so a refusal can be named: the same
 * two draws as `placeWatcher` (the side, then the mix of the band's two
 * edges), the same rotation by constant cosines and sines, and the same
 * checks in the same order. The sweep asserts that this and the rule agree
 * on every try, landed or refused.
 */
function judge(w: World, lead: PlayerState, reach: number, rng: { rngSeed: number }): Vec3 | Refusal {
  const side = nextRandom(rng) < 0.5 ? -1 : 1;
  const mix = nextRandom(rng);
  const look = aimDirection(lead.yaw, 0);
  const minX = look.x * 0.866 - side * look.z * 0.5, minZ = side * look.x * 0.5 + look.z * 0.866;
  const maxX = look.x * 0.342 - side * look.z * 0.9397, maxZ = side * look.x * 0.9397 + look.z * 0.342;
  let bx = (1 - mix) * minX + mix * maxX, bz = (1 - mix) * minZ + mix * maxZ;
  const len = Math.sqrt(bx * bx + bz * bz);
  bx /= len;
  bz /= len;
  const range = 90 + (25 - 90) * reach;
  const x = lead.pos.x + bx * range, z = lead.pos.z + bz * range;
  if (trailDistance(w.trail!, x, z) < 6) return "clearance";
  const centre = groundSpawn(w.boxes, w.forest!.seed, x, z, ENEMY_HALF);
  if (centre === null) return "ground";
  const n = { x: 0, y: 0, z: 0 };
  w.ground!.normalAt(x, z, n);
  if (n.y < 0.74) return "slope";
  if (isOnCorridor(w, x, z)) return "corridor";
  for (const p of w.state.players.values()) if (p.health > 0 && horizontal(p.pos, centre) < 15) return "flee";
  const eye = { x: lead.pos.x, y: lead.pos.y + PLAYER_EYE_OFFSET, z: lead.pos.z };
  if (!hasLineOfSight(eye, centre, w.boxes, w.ground)) return "sightline";
  return centre;
}

/** Every constraint a shown watcher must obey, against the lead at `range`. */
function check(w: World, lead: PlayerState, at: Vec3, range: number, label: string) {
  expect(trailDistance(w.trail!, at.x, at.z), label).toBeGreaterThanOrEqual(6);
  expect(isOnCorridor(w, at.x, at.z), label).toBe(false);
  for (const p of w.state.players.values()) if (p.health > 0) expect(horizontal(p.pos, at), label).toBeGreaterThanOrEqual(15);
  const n = { x: 0, y: 0, z: 0 };
  w.ground!.normalAt(at.x, at.z, n);
  expect(n.y, label).toBeGreaterThanOrEqual(0.74);
  expect(groundSpawn(w.boxes, w.forest!.seed, at.x, at.z, ENEMY_HALF), label).toEqual(at);
  const eye = { x: lead.pos.x, y: lead.pos.y + PLAYER_EYE_OFFSET, z: lead.pos.z };
  expect(hasLineOfSight(eye, at, w.boxes, w.ground), label).toBe(true);
  const d = horizontal(lead.pos, at);
  expect(Math.abs(d - range), label).toBeLessThanOrEqual(0.5);
  const cos = ((at.x - lead.pos.x) * Math.sin(lead.yaw) + (at.z - lead.pos.z) * Math.cos(lead.yaw)) / d;
  expect(cos, label).toBeGreaterThanOrEqual(0.3419);
  expect(cos, label).toBeLessThanOrEqual(0.8661);
}

/** What one (seed, node, facing) case measured. */
type Case = {
  label: string;
  slot: string;
  /** The tick the watcher showed on, 1-based, or -1 within 120. */
  shownAt: number;
  /** Its range from the lead when it showed. */
  range: number;
  /** Of 200 placements tried from a fresh stream. */
  admitted: number;
  refused: Record<Refusal, number>;
};

const SLOTS = ["climb 0", "climb 0.25", "climb 0.5", "climb 0.75", "top fork"];
const FACINGS: Array<[string, number]> = [["up", 0], ["down", Math.PI], ["left", Math.PI / 2], ["right", -Math.PI / 2]];

/**
 * One seed: the lead alone, on the stem nodes nearest climb 0, 0.25, 0.5 and
 * 0.75 and on the top fork (the same node counted once when two coincide; a
 * seed with no fork has no fifth stand), facing up the stem, down it, and the
 * two perpendiculars. At each stand the record's rest is zero and the tick
 * runs until the watcher shows or 120 ticks (960 tries) have gone; a showing
 * is checked against every rule. Then 200 placements are tried from a fresh
 * stream, each judged here too, and the two verdicts must agree.
 */
function sweep(token: string): Case[] {
  const seed = seedFromToken(token);
  const w = createForestWorld(createForest(seed));
  const p = spawnPlayer(w);
  const g = w.trail!;
  const chain = stemNodes(g);
  const climbs = chain.map((n) => climbOf(g, g.nodes[n]!.x, g.nodes[n]!.z));
  const nearest = (c: number) => { let best = 0; for (let k = 0; k < chain.length; k++) if (Math.abs(climbs[k]! - c) < Math.abs(climbs[best]! - c)) best = k; return chain[best]!; };
  const stands = new Map<number, string>();
  const stand = (node: number, slot: string) => stands.set(node, stands.has(node) ? `${stands.get(node)}/${slot}` : slot);
  [0, 0.25, 0.5, 0.75].forEach((c, i) => stand(nearest(c), SLOTS[i]!));
  const top = topForkClimb(g);
  for (const f of g.forks) { const n = g.nodes[f] as TrailNode; if (climbOf(g, n.x, n.z) === top) { stand(f, SLOTS[4]!); break; } }
  const fresh = (): WatcherRecord => ({ id: -1, rest: 0, rng: { rngSeed: (seed ^ WATCH_SALT) | 0 } });

  const out: Case[] = [];
  for (const [node, slot] of stands) {
    const at = chain.indexOf(node);
    expect(at, `${token}: stand ${node} is not on the stem`).toBeGreaterThanOrEqual(0);
    const here = g.nodes[node]!, next = g.nodes[chain[at + 1]!]!;
    const up = Math.atan2(next.x - here.x, next.z - here.z);
    p.pos = { x: here.x, y: w.ground!.heightAt(here.x, here.z) + 0.9, z: here.z };
    p.pitch = 0;
    for (const [facing, turn] of FACINGS) {
      p.yaw = up + turn;
      const label = `${token}, node ${node} (${slot}), facing ${facing}`;
      const reach = reachOf(w, p);
      const range = 90 + (25 - 90) * reach;

      w.watcher = fresh();
      let shownAt = -1;
      let shownRange = NaN;
      for (let t = 1; t <= 120; t++) {
        stepWatcher(w, TICK_DT);
        if (w.watcher.id !== -1) {
          const h = w.state.enemies.get(w.watcher.id)!;
          check(w, p, h.pos, range, label);
          shownAt = t;
          shownRange = horizontal(p.pos, h.pos);
          break;
        }
      }
      w.state.enemies.clear();

      w.watcher = fresh();
      const refused: Record<Refusal, number> = { clearance: 0, ground: 0, slope: 0, corridor: 0, flee: 0, sightline: 0 };
      let admitted = 0;
      for (let i = 0; i < 200; i++) {
        const verdict = judge(w, p, reach, { rngSeed: w.watcher.rng.rngSeed });
        const placed = placeWatcher(w, p, reach);
        if (typeof verdict === "string") {
          expect(placed, `${label}, try ${i}: refused for ${verdict}`).toBeNull();
          refused[verdict]++;
        } else {
          expect(placed, `${label}, try ${i}`).toEqual(verdict);
          check(w, p, verdict, range, `${label}, try ${i}`);
          admitted++;
        }
      }
      out.push({ label, slot, shownAt, range: shownRange, admitted, refused });
    }
  }
  return out;
}

/**
 * The watcher on fifty seeds, with the timeout `hollowWalk.test.ts` carries
 * for the same fifty worlds. The floors are what the sweep measured on
 * 2026-09-26, pinned: of 936 stands the watcher showed on 881 within 120
 * ticks (94 %), and 79 264 of 187 200 placements were admitted (42 %); the
 * refusals were the sightline 59 506, the ground 24 179, the trail clearance
 * 17 378, the corridor 5 985, the slope 888 and the flee radius none. The
 * pad is the hard stand — 157 of 200, and 34 of the 55 stands that never
 * showed face down the stem from the pad, into the road — and the top fork
 * the easy one, 192 of 192. The range ran 25.00–90.00 m. The sightline is the
 * refusal to read when the 90 m range is next tuned.
 */
describe("the watcher on fifty seeds", () => {
  it("stands only where every rule holds, and shows within 120 ticks on 881 of 936 stands", () => {
    const cases: Case[] = [];
    for (let i = 0; i < 50; i++) cases.push(...sweep(`hollow${i}`));
    const shown = cases.filter((c) => c.shownAt !== -1);
    const tries = cases.length * 200;
    const admitted = cases.reduce((n, c) => n + c.admitted, 0);
    const refused: Record<Refusal, number> = { clearance: 0, ground: 0, slope: 0, corridor: 0, flee: 0, sightline: 0 };
    for (const c of cases) for (const r of REFUSALS) refused[r] += c.refused[r];
    const ranges = shown.map((c) => c.range).sort((a, b) => a - b);
    const bySlot = SLOTS.map((s) => {
      const of = cases.filter((c) => c.slot.split("/").includes(s));
      const on = of.filter((c) => c.shownAt !== -1).length;
      const adm = of.reduce((n, c) => n + c.admitted, 0);
      return { slot: s, stands: of.length, shown: on, admitted: adm };
    });
    const never = cases.filter((c) => c.shownAt === -1).map((c) => c.label);
    const summary = [
      `${shown.length} of ${cases.length} stands shown within 120 ticks`,
      `${admitted} of ${tries} tries admitted; refused ${REFUSALS.map((r) => `${r} ${refused[r]}`).join(", ")}`,
      `ranges ${ranges[0]?.toFixed(2)}–${ranges[ranges.length - 1]?.toFixed(2)} m`,
      ...bySlot.map((b) => `${b.slot}: shown ${b.shown}/${b.stands}, admitted ${b.admitted}/${b.stands * 200}`),
      `never shown: ${never.join("; ")}`,
    ].join("\n");
    expect(cases.length, summary).toBe(936);
    expect(shown.length, summary).toBeGreaterThanOrEqual(881);
    expect(admitted, summary).toBeGreaterThanOrEqual(79264);
    expect(refused.flee, summary).toBe(0);
    expect(Math.abs(ranges[0]! - 25), summary).toBeLessThanOrEqual(0.5);
    expect(Math.abs(ranges[ranges.length - 1]! - 90), summary).toBeLessThanOrEqual(0.5);
    expect(bySlot.map((b) => `${b.slot} ${b.stands}`), summary).toEqual(["climb 0 200", "climb 0.25 200", "climb 0.5 200", "climb 0.75 200", "top fork 192"]);
    const floors = [157, 196, 192, 200, 192];
    const admittedFloors = [6531, 12547, 17832, 25745, 24154];
    bySlot.forEach((b, i) => {
      expect(b.shown, summary).toBeGreaterThanOrEqual(floors[i]!);
      expect(b.admitted, summary).toBeGreaterThanOrEqual(admittedFloors[i]!);
    });
  }, 300_000);
});
