import { describe, it, expect } from "vitest";
import {
  createAmbientAudio, HUSH_RAMP_S, noGameSound, WORLD_OPEN_HZ, type SoundGame, type SoundHost,
} from "@csarkosh/engine/game/ambientAudio";
import { fakeCtx } from "./helpers/fakeAudio.js";
import { sourceText } from "../helpers/source.js";

/**
 * The sound's bus and a game's side of it: the bus is the world's beds, its buses and its levels,
 * and a game adds its own voices where the bus hands it the graph. These hold the seam; what Day
 * Hike's side plays is held by `ambientAudio.test.ts`, on the whole bus as the hike makes it.
 */

/** A game that records what it was handed and when. */
function recording(log: string[]) {
  let host: SoundHost | null = null;
  const game: SoundGame<{ ping(): string; host(): SoundHost | null }> = () => ({
    side: {
      unlocked(h) {
        host = h;
        log.push("unlocked");
      },
      disposed() {
        host = null;
        log.push("disposed");
      },
    },
    api: { ping: () => "pong", host: () => host },
  });
  return game;
}

describe("the sound's bus without a game", () => {
  it("makes the world's graph alone: eight gains, three filters, two noise sources, nothing else", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(noGameSound, () => ctx);
    audio.unlock();
    // master, world, rain, wind, wildlife, drip, birdsong and the scene's.
    expect(created.gains.length).toBe(8);
    expect(created.filterNodes.length).toBe(3);
    expect(created.sources.length).toBe(2);
    expect(created.oscillators).toBe(0);
    expect(created.panners.length).toBe(0);
    expect(created.filterNodes[2]!.frequency.value).toBe(WORLD_OPEN_HZ);
    audio.dispose();
  });
});

describe("a game's side of the sound", () => {
  it("is handed the graph once the world's stands, before a listener of the unlock hears of it, and once", () => {
    const { ctx, created } = fakeCtx();
    const log: string[] = [];
    const audio = createAmbientAudio(recording(log), () => ctx);
    audio.onUnlock(() => log.push(`listener after ${created.gains.length} gains`));
    expect(audio.host()).toBeNull();
    audio.unlock();
    audio.unlock();
    expect(log).toEqual(["unlocked", "listener after 8 gains"]);
    const host = audio.host()!;
    expect(host.ctx).toBe(ctx);
    // The world's bus, the scene's gain beside it and the master: the second, eighth and first gains made.
    expect(host.world).toBe(created.gains[1]);
    expect(host.scene).toBe(created.gains[7]);
    expect(host.master).toBe(created.gains[0]);
    expect(host.noise).toBe(created.sources[0]!.buffer);
    audio.dispose();
  });

  it("is worn by the bus: the game's own methods beside the bus's", () => {
    const { ctx } = fakeCtx();
    const audio = createAmbientAudio(recording([]), () => ctx);
    expect(audio.ping()).toBe("pong");
    expect(typeof audio.setWeather).toBe("function");
  });

  it("muffles the world through the bus: the low-pass to the cutoff, the level to the share a hush leaves of it", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(recording([]), () => ctx);
    audio.unlock();
    const world = created.gains[1]!;
    const lowpass = created.filterNodes[2]!;
    audio.host()!.muffle(650, 0.5);
    expect(lowpass.frequency.targets.at(-1)).toEqual({ value: 650, time: 0, tc: 0.15 });
    expect(world.gain.targets.at(-1)).toEqual({ value: 0.5, time: 0, tc: HUSH_RAMP_S });
    // A hush is taken from what the muffle leaves, and the muffle from what a hush leaves.
    audio.setHush(0.5);
    expect(world.gain.targets.at(-1)!.value).toBe(0.25);
    audio.host()!.muffle(WORLD_OPEN_HZ, 1);
    expect(world.gain.targets.at(-1)!.value).toBe(0.5);
    audio.dispose();
  });

  it("hears the listener where the bus placed it", () => {
    const { ctx } = fakeCtx();
    const audio = createAmbientAudio(recording([]), () => ctx);
    audio.unlock();
    audio.setListener(1, 2, 3, 0, 0, -1, 0, 1, 0);
    expect(audio.host()!.ear).toEqual({ x: 1, y: 2, z: 3, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 });
    audio.dispose();
  });

  it("is told of the disposal, and handed a new graph by an unlock after it", () => {
    const { ctx } = fakeCtx();
    const log: string[] = [];
    const audio = createAmbientAudio(recording(log), () => ctx);
    audio.unlock();
    audio.dispose();
    expect(log).toEqual(["unlocked", "disposed"]);
    expect(audio.host()).toBeNull();
    audio.unlock();
    expect(log).toEqual(["unlocked", "disposed", "unlocked"]);
    audio.dispose();
  });
});

describe("whose voices are whose", () => {
  it("the bus names none of a game's voices and hands its side the graph after the world's is wired", () => {
    const text = sourceText("game/ambientAudio.ts");
    expect(text).not.toMatch(/stareAudio|chaseAudio|oddSounds|carAudio|hikeAudio|woodsVoice/);
    const wired = text.indexOf("limiter.connect(scene);");
    const handed = text.indexOf("side.unlocked({ ctx, noise, world, scene, master, ear, random, muffle });");
    const applied = text.indexOf("applyGains(pending);", handed);
    expect(wired).toBeGreaterThan(0);
    expect(handed).toBeGreaterThan(wired);
    expect(applied).toBeGreaterThan(handed);
  });

  it("the hike's bus is the bus made with the hike's side, and the hike makes that one", () => {
    expect(sourceText("game/hikeAudio.ts")).toContain("  return createAmbientAudio(hikeSound, createCtx, random);");
    // The page makes the bus of the game it is handed, which for Day Hike is the hike's (`hikeGame.ts`).
    expect(sourceText("app.ts")).toContain("const ambient = game.audio();");
    expect(sourceText("hikeGame.ts")).toContain("  audio: createHikeAudio,");
  });
});
