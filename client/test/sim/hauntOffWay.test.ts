import { beforeAll, describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "@csarkosh/engine/sim/forest";
import { createForestWorld, spawnPlayer, tickWorld, type World } from "../../src/sim/world.js";
import { seedFromToken } from "@csarkosh/engine/game/seed";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "@csarkosh/engine/sim/terrain";
import { AiState, Button, DeathCause, Phase, type PlayerState } from "../../src/sim/types.js";
import { TICK_DT } from "@csarkosh/engine/sim/constants";
import { SUMMIT_REVEAL_S } from "../../src/sim/hollow.js";
import { SHADE_TRAIL_OFF_M } from "../../src/sim/haunt.js";
import { stemAhead } from "@csarkosh/engine/sim/trailRoute";
import { chaseLineDistance, chaseLinePoint } from "../../src/sim/chaseLine.js";
import { wayDirection, wayProject, type WayDown } from "../../src/sim/wayDown.js";
import { wayOf } from "../../src/sim/wayDraw.js";
import { timeLimit } from "@csarkosh/engine/testing/timeLimit";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

/** A world in the chase, its one player a few strides down the way, the haunt on as in a match. */
function chase(token: string): { w: World; p: PlayerState; way: WayDown } {
  const w = createForestWorld(createForest(seedFromToken(token)));
  const way = wayOf(w) as WayDown;
  const g = w.trail!, crest = g.nodes[g.summit]!;
  const p = spawnPlayer(w);
  for (const down of [10, 8, 6, 4]) {
    const at = stemAhead(g, crest.x, crest.z, -down) ?? crest;
    p.pos = { x: at.x, y: w.ground!.heightAt(at.x, at.z) + 0.9, z: at.z };
    tickWorld(w, new Map());
    if (w.state.phase !== Phase.Climb) break;
  }
  const ahead = chaseLinePoint(w, p.pos.x, p.pos.z, 8, { x: 0, z: 0 })!;
  const yaw = Math.atan2(ahead.x - p.pos.x, ahead.z - p.pos.z);
  const sceneTicks = Math.round(SUMMIT_REVEAL_S / TICK_DT) + 1;
  for (let i = 0; i < sceneTicks; i++) tickWorld(w, i >= sceneTicks - 110 ? new Map([[p.id, { seq: i, moveX: 0, moveZ: 1, yaw, pitch: 0, buttons: Button.Sprint }]]) : new Map());
  return { w, p, way };
}

describe("the chase answers a player who leaves the way", { timeout: timeLimit(240_000) }, () => {
  let run: { seconds: number; off: number; lunges: number; standing: number; nearestToLine: number; cause: DeathCause; firstAt: number };

  beforeAll(() => {
    const { w, p, way } = chase("atmo");
    expect(w.state.phase).toBe(Phase.Chase);
    // Down the way for eight seconds, then square off it and on, sprinting, never looking back.
    const seen = new Set<number>();
    let lunges = 0, standing = 0, nearestToLine = Infinity, off = 0, firstAt = -1, t = 0;
    for (; t < 90 / TICK_DT && p.health > 0; t++) {
      const dir = wayDirection(way, wayProject(way, p.pos.x, p.pos.z).s, { x: 0, z: 0 });
      const yaw = t * TICK_DT < 8 ? Math.atan2(dir.x, dir.z) : Math.atan2(-dir.z, dir.x);
      tickWorld(w, new Map([[p.id, { seq: t, moveX: 0, moveZ: 1, yaw, pitch: 0, buttons: Button.Sprint }]]));
      off = Math.max(off, chaseLineDistance(w, p.pos.x, p.pos.z));
      for (const e of w.state.enemies.values()) {
        // The way's own lunges wait beside the path for whoever runs it (waylay.test.ts): what answers leaving it is the rest.
        if (seen.has(e.id) || e.waylay !== 0 || (e.ai !== AiState.Shade && e.ai !== AiState.Lunge)) continue;
        seen.add(e.id);
        if (e.ai === AiState.Shade) standing++;
        if (t * TICK_DT < 8) continue;
        if (firstAt < 0) firstAt = t * TICK_DT;
        if (e.ai === AiState.Lunge) lunges++;
        nearestToLine = Math.min(nearestToLine, chaseLineDistance(w, e.pos.x, e.pos.z));
      }
    }
    run = { seconds: t * TICK_DT, off, lunges, standing, nearestToLine, cause: p.cause, firstAt };
  }, timeLimit(240_000));

  it("something comes for them within seconds of leaving it, wherever they run: the way is the only one, not a trail with another beside it", () => {
    // Until 2026-11-14 a shade could stand only 15 to 20 m off the line, so a player past that, looking away from it, met nothing for a minute and a half.
    expect(run.off).toBeGreaterThan(30);
    expect(run.firstAt).toBeGreaterThanOrEqual(8);
    expect(run.firstAt).toBeLessThan(8 + 12);
    expect(run.lunges).toBeGreaterThan(0);
  });

  it("and takes them: they do not get far, and the death is the off-trail one", () => {
    expect(run.seconds).toBeLessThan(45);
    expect(run.cause).toBe(DeathCause.OffTrail);
  });

  it("what comes is a lunge, never a shade that only stands: the crowd is the standing shades in the chase", () => {
    expect(run.standing).toBe(0);
  });

  it("nothing of it stands in the channel: every shade is as far off the line as a shade ever stands", () => {
    expect(run.nearestToLine).toBeGreaterThanOrEqual(SHADE_TRAIL_OFF_M[0]);
  });
});
