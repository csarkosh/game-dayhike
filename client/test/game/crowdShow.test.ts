import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CROWD_ADMIT_EVERY, CROWD_HEIGHTS_A_FRAME, CROWD_HEIGHT_STALE_M, crowdHeights, crowdOn, figureOf, newCrowd, stepCrowd, type CrowdFigure, type CrowdGround, type CrowdWorld,
} from "../../src/game/crowdField.js";
import { Outcome, Phase } from "../../src/sim/types.js";

/** A file of the client, wherever the suite is run from (the gate runs it from the repository's root). */
const clientFile = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const figure = (id: number, x: number, z: number): CrowdFigure => ({ id, x, z, born: 0, gone: -1, rise: 0, ...figureOf(id, 1) });

describe("when the crowd is up", () => {
  it("is from the summit scene's turn to the way, through the chase, while the match is undecided and the way's mist is shown", () => {
    expect(crowdOn(Phase.Chase, Outcome.Playing, 1)).toBe(true);
    expect(crowdOn(Phase.Scene, Outcome.Playing, 0.4)).toBe(true);
    expect(crowdOn(Phase.Scene, Outcome.Playing, 0)).toBe(false);
    expect(crowdOn(Phase.Climb, Outcome.Playing, 1)).toBe(false);
    for (const outcome of [Outcome.Won, Outcome.Lost] as Outcome[]) expect(crowdOn(Phase.Chase, outcome, 1)).toBe(false);
  });
});

describe("the ground under the crowd", () => {
  it("is asked for a few figures a frame and kept until a figure has moved a metre, never once a figure a frame", () => {
    expect([CROWD_HEIGHTS_A_FRAME, CROWD_HEIGHT_STALE_M]).toEqual([8, 1]);
    const ground: CrowdGround = new Map();
    let asked = 0;
    const heightAt = (x: number): number => { asked++; return 100 + x; };
    const figures = Array.from({ length: 20 }, (_, i) => figure(i + 1, i, 0));
    const first = crowdHeights(ground, figures, heightAt, 50, []);
    expect(asked).toBe(CROWD_HEIGHTS_A_FRAME);
    // The ones asked for stand on their ground. The rest stand at the fallback until their turn.
    expect(first.slice(0, 8)).toEqual([100, 101, 102, 103, 104, 105, 106, 107]);
    expect(first.slice(8)).toEqual(new Array(12).fill(50));
    crowdHeights(ground, figures, heightAt, 50, []);
    const third = crowdHeights(ground, figures, heightAt, 50, []);
    expect(asked).toBe(20);
    expect(third[19]).toBe(119);
    // Nothing has moved: nothing more is asked.
    crowdHeights(ground, figures, heightAt, 50, []);
    expect(asked).toBe(20);
    // One moves half a metre: its height is kept. A metre and a half: asked again.
    figures[3]!.x += 0.5;
    expect(crowdHeights(ground, figures, heightAt, 50, [])[3]).toBe(103);
    figures[3]!.x += 1;
    expect(crowdHeights(ground, figures, heightAt, 50, [])[3]).toBe(104.5);
    expect(asked).toBe(21);
    // A figure gone is forgotten.
    crowdHeights(ground, figures.slice(0, 5), heightAt, 50, []);
    expect(ground.size).toBe(5);
  });
});

describe("the crowd's cost in the ground's admissions", () => {
  it("asks whether a walking figure may step on for an eighth of them a step, not for all", () => {
    expect(CROWD_ADMIT_EVERY).toBe(8);
    let asked = 0;
    const world: CrowdWorld = {
      length: 400,
      project: (x, z) => { const s = Math.min(400, Math.max(0, x)); return { s, d: Math.hypot(x - s, z) }; },
      point: (s, out) => { out.x = s; out.z = 0; return out; },
      direction: (_s, out) => { out.x = 1; out.z = 0; return out; },
      admit: () => { asked++; return true; },
    };
    const crowd = newCrowd(9), eye = { x: 200, z: 0, yaw: Math.PI / 2 };
    for (let i = 0; i < 600; i++) stepCrowd(crowd, world, eye, 60, i / 60, 1 / 60);
    expect(crowd.figures.length).toBeGreaterThan(50);
    asked = 0;
    for (let i = 600; i < 720; i++) stepCrowd(crowd, world, eye, 60, i / 60, 1 / 60);
    // Sixty figures, an eighth of them a step, and at most four places tried: under thirteen a step.
    expect(asked / 120).toBeLessThan(13);
    expect(asked / 120).toBeGreaterThan(4);
  });

  it("a figure whose way on is refused stands until it is asked again and admitted", () => {
    let open = false;
    const world: CrowdWorld = {
      length: 400,
      project: (x, z) => { const s = Math.min(400, Math.max(0, x)); return { s, d: Math.hypot(x - s, z) }; },
      point: (s, out) => { out.x = s; out.z = 0; return out; },
      direction: (_s, out) => { out.x = 1; out.z = 0; return out; },
      admit: () => open,
    };
    const crowd = newCrowd(1), eye = { x: 200, z: 0, yaw: Math.PI / 2 };
    crowd.figures.push({ id: 8, x: 260, z: 20, born: 0, gone: -1, rise: 0, ...figureOf(8, 1) });
    for (let i = 0; i < 40; i++) stepCrowd(crowd, world, eye, 1, i / 60, 1 / 60);
    // (A most of one: the one figure alone, and none added.) Refused, it has not crept on between askings.
    const stood = crowd.figures.find((f) => f.id === 8)!;
    expect(Math.hypot(stood.x - 260, stood.z - 20)).toBeLessThan(0.2);
    open = true;
    for (let i = 40; i < 100; i++) stepCrowd(crowd, world, eye, 1, i / 60, 1 / 60);
    const walked = crowd.figures.find((f) => f.id === 8)!;
    expect(Math.hypot(walked.x - 260, walked.z - 20)).toBeGreaterThan(0.4);
  });
});

describe("the renderer and the app", () => {
  // The renderer, and Day Hike's side of it (`lite/hikeParts.ts`), where what is this game's own in a frame is written.
  const renderer = readFileSync(clientFile("../engine/src/game/lite/renderer.ts"), "utf8") + readFileSync(clientFile("src/game/lite/hikeParts.ts"), "utf8");
  const app = readFileSync(clientFile("src/app.ts"), "utf8");
  const commands = readFileSync(clientFile("src/game/commands.ts"), "utf8");

  it("the app steps this screen's crowd every frame on the host and on a client, before the renderer's own sync", () => {
    expect(app).toContain("      syncCrowd(host.world, state, host.localEntityId, dt);\n      syncWayDraw(host.world, state);");
    expect(app).toContain("      syncCrowd(client.world, state, client.localEntityId, dt);\n      syncWayDraw(client.world, state);");
    // And says whether the crowd is up: while it is, the chase's killers are drawn among it, as shadows.
    expect(app).toContain("renderer.setCrowd(crowd.figures, seconds, up);");
    // Whether a figure may have this player now: alive, in the chase, the match undecided, off the road.
    // Nor while a scene has their legs, nor in the hold after a return (the host would refuse it, and a touch then would land as the hold ended).
    expect(app).toContain("const prey = up && me !== undefined && me.health > 0 && state.phase === Phase.Chase && state.outcome === Outcome.Playing && !me.safe && !sceneOn() && seconds >= crowdQuietUntil;");
    // A living player who cannot be had is let go of at once: no stale word is left to send.
    expect(app).toContain("if (!prey && me !== undefined && me.health > 0) crowdLetGo(crowd, seconds);");
    // And a return scatters the crowd: what gathered round the body, or stands down the way, is not run back through.
    expect(app).toContain("crowdScatter(crowd, now);\n      crowdQuietUntil = now + RETURN_HOLD_S;");
    expect(app).toContain("{ x: me.pos.x, z: me.pos.z, yaw: me.yaw, prey }");
    // A player their crowd has says so to the host in every command until their death is seen, on the host and on a client alike.
    expect(app).toContain("crowd !== null && crowd.has !== 0 && !crowdTook ? { ...cmd, buttons: cmd.buttons | Button.Taken } : cmd");
    expect(app).toContain("cmd = taken(ranToCar(stilled(input.sample(++seq), me, host.world), me));");
    expect(app).toContain("cmd = taken(ranToCar(stilled(input.sample(++seq), me, client.world), me));");
    // And what is at the centre of their view, for the chase's dark: the crowd's figures and the state's enemies; null where the chase does not have them.
    expect(app).toContain("renderer.setChaseThreat(threat);");
    expect(app).toContain("threat = Math.max(threat, threatOf(eyeAt, f.x, f.z, presenceOf(f, seconds)));");
    expect(app).toContain("for (const e of state.enemies.values()) threat = Math.max(threat, threatOf(eyeAt, e.pos.x, e.pos.z));");
    expect(renderer).toContain("stareLens = stepStareLens(stareLens, stare, towards, dt, chaseThreat);");
    expect(app).toContain("crowdHeld !== null ? crowdHeld > 0 : crowdOn(state.phase, state.outcome, wayShown)");
    // Each screen's own: its stream is seeded from the world's seed and whose screen it is, never the sim's.
    expect(app).toContain("newCrowd((seed ^ Math.imul(localId + 1, 0x9e3779b1)) >>> 0)");
  });

  it("the renderer draws the crowd as cards, in the frame and in the shade mask, and as eyes, where there is a mask, and disposes both", () => {
    expect(renderer).toContain("crowdCards = made === null ? null : createLiteCrowdCards(engine, scene, CROWD_MOST_ANY, uploads);");
    expect(renderer).toContain("crowdEyes = made === null ? null : createLiteCrowdEyes(engine, scene, CROWD_MOST_ANY, uploads);");
    expect(renderer).toContain("if (made !== null && crowdCards !== null) made.addCards(crowdCards.mesh, crowdCards.maskMaterial);");
    for (const part of ["crowdCards", "crowdEyes"]) expect(renderer).toContain(`${part}?.dispose();`);
    expect(renderer).toContain("const cards = crowdCards.sync(shown, heights, pose, seconds, CROWD_NONE_HELD, 0, CROWD_CARDS_TO_M, tint);\n      mask?.cards(cards > 0);");
    expect(renderer).toContain("crowdEyes.sync(shown, heights, pose, seconds, CROWD_NONE_HELD);");
    // A figure's rim is lit by the way's mist, toned for the tier's path as the mist is.
    expect(renderer).toContain("const tint = wayTint(wayPath, cloudColourUnder(host.nearColour()), 1 / wayDimAt(wayLevel), look.cast, CHASE_TINT);");
  });

  it("the renderer draws the chase's killers among the crowd while it is up, and not as the model: first in what is shown, from where their bodies stand each frame", () => {
    const meshes = readFileSync(clientFile("src/game/lite/entityMeshes.ts"), "utf8");
    expect(renderer).toContain("poses.shadows = shadows;");
    expect(renderer).toContain("killers.step(bodies === null ? NO_BODIES : bodies.hollows, crowdSeconds);");
    expect(renderer).toContain("const shown = killers.shown(figures);");
    // Room for them beside the crowd's most.
    expect(renderer).toContain("const CROWD_MOST_ANY = Math.max(CROWD_MOST.low, CROWD_MOST.medium, CROWD_MOST.high) + KILLERS_MOST;");
    // The model is not drawn for one that is a shadow.
    expect(meshes).toContain("for (const pose of frame.hollows) if (pose.modelled && !pose.shadow) figure(");
  });

  it("the console holds the crowd on, off or at a count, as it holds the way's mist", () => {
    expect(commands).toContain('name: "crowd",');
    expect(app).toContain('} else if (name === "crowd") {');
  });
});
