import { describe, expect, it, vi } from "vitest";
import "../../../src/sim/passes/index.js";
import { SETTLE_FRAMES, SETTLE_STRETCH, startLiteSceneRoute, type LiteSceneRouteDeps } from "../../../src/game/lite/sceneRoute.js";
import type { LiteActor, LiteCar, SceneryHost } from "../../../src/game/lite/sceneryMeshes.js";
import type { FreecamView, Renderer } from "../../../src/game/renderer.js";
import { JUMP_M, WARM_FRAMES } from "../../../src/game/scene/cameraJump.js";
import { INTRO_HOUR, INTRO_SHOTS, INTRO_WEATHER } from "../../../src/game/scene/intro.js";
import { FILM_PATCH_DARKNESS } from "../../../src/game/scene/routeWorld.js";
import { TITLE_HOUR } from "../../../src/game/scene/title.js";
import { SYNC_LATE_FRAMES_MAX } from "../../../src/game/syncJobs.js";
import { skyFixture } from "../helpers/skyFixture.js";
import { asHtml, installStandInDom } from "../helpers/standInDom.js";
import { timeLimit } from "../../helpers/timeLimit.js";

/** A renderer that draws nothing and says what it was asked: the hike's own, as the route holds it. */
function fakeRenderer() {
  const log: string[] = [];
  const asked = { posts: 0, sites: [] as unknown[], film: [] as ({ darkness: number } | undefined)[], actors: [] as string[], poses: 0, staged: 0, disposed: [] as string[] };
  let skyIn: () => void = () => undefined;
  const sky = new Promise<void>((resolve) => { skyIn = resolve; });
  let waiting = 0;
  /** Frames the scenery will still say the world streamed in. */
  let streaming = 0;
  let view: FreecamView | null = null;
  const car: LiteCar = { stage: () => void (asked.staged += 1), leave: () => undefined, tailLamps: () => undefined };
  const scenery: SceneryHost = {
    streaming: () => streaming-- > 0,
    signs(posts) {
      asked.posts = posts.length;
      return { dispose: () => void asked.disposed.push("signs") };
    },
    trailhead(sites) {
      asked.sites.push(sites);
      return {
        filmCar: (_signal, alone) => {
          asked.film.push(alone);
          return Promise.resolve();
        },
        filmCarIn: () => asked.film.length > 0, car: () => (asked.film.length > 0 ? car : null), warm: () => false,
        dispose: () => void asked.disposed.push("trailhead"),
      };
    },
    body: () => ({ dispose: () => undefined }),
    actor(url): LiteActor {
      asked.actors.push(url);
      return { settled: Promise.resolve(), stage: () => void (asked.poses += 1), joint: (_name, out) => out, dispose: () => void asked.disposed.push("actor") };
    },
  };
  const renderer = {
    scenery,
    hasWildlife: false,
    setWeather: (w: unknown) => void log.push(`weather ${w === INTRO_WEATHER ? "intro" : "other"}`),
    setHour: (h: number) => void log.push(`hour ${h}`),
    setFreecam: (v: FreecamView | null) => { view = v; },
    setDepthOfField: () => undefined,
    skyReady: () => sky,
    whenReady: (maxMs: number) => { log.push(`whenReady ${maxMs}`); return Promise.resolve(); },
    waitingItems: () => waiting,
    sync: (_state: unknown, localId: number, alpha: number) => void log.push(`sync ${localId} ${alpha}`),
    drawFrame: () => void log.push("draw"),
    resize: () => void log.push("resize"),
    dispose: () => void asked.disposed.push("renderer"),
  };
  return { renderer: renderer as unknown as Renderer, log, asked, skyIn, view: () => view, setWaiting: (n: number) => { waiting = n; }, setStreaming: (n: number) => { streaming = n; } };
}

type Api = { seek(t: number): void; frame(): Promise<void>; time(): number; ready: Promise<void>; engine(): string };
const api = (): Api | undefined => (globalThis as { dayhikeScene?: Api }).dayhikeScene;

function route(name: "intro" | "title", search: { t: number | null; step: number | null }, over: Partial<LiteSceneRouteDeps> = {}) {
  const doc = installStandInDom();
  const container = doc.createElement("div");
  const fake = fakeRenderer();
  const frames: ((ms: number) => void)[] = [];
  const clock = { ms: 0 };
  let options: unknown = null;
  const run = startLiteSceneRoute(
    {
      canvas: {} as HTMLCanvasElement, container: asHtml(container), tier: "high", skyTable: skyFixture(), now: () => clock.ms,
      raf: (fn) => { frames.push(fn); return frames.length; },
      renderer: (_canvas, _world, given) => { options = given; return fake.renderer; },
      ...over,
    },
    search,
    name,
  );
  const turn = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  /** Calls queued animation frames until `p` settles. */
  const drain = async (p: Promise<void>): Promise<void> => {
    let done = false;
    void p.then(() => { done = true; });
    while (!done) {
      for (const fn of frames.splice(0)) fn(0);
      await turn();
    }
  };
  return { run, container, fake, frames, clock, options: () => options as { tier: string; clock: () => number; wildlife: boolean }, turn, drain };
}

describe("the scene route on the hike's own renderer", () => {
  it("plays the intro on the fixed world: its hour and weather, the scene's clock, no wildlife, and at the trailhead the board, the posts, the scene's own car and its ranger", async () => {
    const { run, fake, options, clock } = route("intro", { t: 20, step: null });
    expect(fake.log.slice(0, 2)).toEqual(["weather intro", `hour ${INTRO_HOUR}`]);
    expect(options().tier).toBe("high");
    expect(options().wildlife).toBe(false);
    // The renderer's clock is the scene's, in milliseconds: it stands where the scene is.
    clock.ms = 500;
    expect(options().clock()).toBeCloseTo(20_500, 6);
    expect(fake.asked.posts).toBeGreaterThan(0);
    // The hike's parked car is not there: the scene's car moves in its place, alone, on the film's lighter patch.
    expect(fake.asked.sites).toHaveLength(1);
    expect((fake.asked.sites[0] as { car?: unknown }).car).toBeUndefined();
    expect(fake.asked.film).toEqual([{ darkness: FILM_PATCH_DARKNESS }]);
    expect(fake.asked.actors).toHaveLength(1);
    expect(fake.asked.actors[0]).toMatch(/intro\.ranger/);
    expect(run.hasWildlife).toBe(false);
    expect(api()?.engine()).toBe("webgpu");
    run.dispose();
    vi.unstubAllGlobals();
  }, timeLimit(60_000));

  it("asks for no frame before the sky's first slices are in, then draws one an animation frame: the world read as it stands, never stepped", async () => {
    const { run, fake, frames, turn } = route("intro", { t: 20, step: null });
    await turn();
    expect(frames).toHaveLength(0);
    expect(fake.log.filter((line) => line === "draw")).toHaveLength(0);
    const before = JSON.stringify(run.worldState());
    fake.skyIn();
    await turn();
    for (const fn of frames.splice(0)) fn(0);
    for (const fn of frames.splice(0)) fn(0);
    expect(fake.log.filter((line) => line === "draw")).toHaveLength(2);
    expect(fake.log.filter((line) => line.startsWith("sync"))).toEqual(["sync -1 0", "sync -1 0"]);
    // Each frame stands the ranger and the car before the renderer is synced.
    expect(fake.asked.poses).toBe(2);
    expect(fake.asked.staged).toBe(2);
    expect(JSON.stringify(run.worldState())).toBe(before);
    run.dispose();
    vi.unstubAllGlobals();
  }, timeLimit(60_000));

  it("seeks, steps and draws one frame on request, with the caption up, and is ready once the loads have settled", async () => {
    const { run, container, fake, drain, clock } = route("intro", { t: null, step: 240 });
    clock.ms = 90_000;
    expect(api()?.time()).toBe(10);
    api()?.seek(43);
    expect(api()?.time()).toBe(43);
    fake.skyIn();
    await api()!.ready;
    const drawn = fake.log.filter((line) => line === "draw").length;
    await drain(api()!.frame());
    expect(fake.log.filter((line) => line === "draw").length).toBe(drawn + 1);
    expect(container.querySelector("div.scene-caption")?.textContent).toBe("Four-one, be advised,\nradio won't carry past the road.");
    run.dispose();
    vi.unstubAllGlobals();
  }, timeLimit(60_000));

  it("draws the world in at a cut's new camera before the frame that counts: the cut's frames, then frames until a run of them has streamed nothing with no model still to land", async () => {
    const { run, fake, frames, drain, turn } = route("intro", { t: null, step: 0 });
    fake.skyIn();
    const from = INTRO_SHOTS[1]!.from;
    api()?.seek(from - 1 / 24);
    await drain(api()!.frame());
    const before = fake.view()!;
    let drawn = fake.log.filter((line) => line === "draw").length;
    // Within a shot: one frame.
    api()?.seek(from - 1 / 48);
    await drain(api()!.frame());
    expect(fake.log.filter((line) => line === "draw").length).toBe(drawn + 1);
    drawn += 1;
    // Across the cut the camera jumps the length of the road: the world is drawn in, waited for and settled.
    api()?.seek(from);
    fake.setWaiting(3);
    const frame = api()!.frame();
    await turn();
    const after = fake.view()!;
    expect(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)).toBeGreaterThan(JUMP_M);
    // While a model is still to land the page is given a turn after each frame drawn: one frame so far past the cut's own.
    expect(fake.log.filter((line) => line === "draw").length).toBe(drawn + 1 + WARM_FRAMES + 1);
    for (const fn of frames.splice(0)) fn(0);
    await turn();
    expect(fake.log.filter((line) => line === "draw").length).toBe(drawn + 1 + WARM_FRAMES + 2);
    // The models land, and the world streams in for five frames more: then a run of quiet frames, and the frame that counts.
    fake.setWaiting(0);
    fake.setStreaming(5);
    await drain(frame);
    expect(fake.log.filter((line) => line === "draw").length).toBe(drawn + 1 + WARM_FRAMES + 2 + 5 + SETTLE_FRAMES + 1);
    expect(SETTLE_FRAMES).toBe(SYNC_LATE_FRAMES_MAX + 2);
    expect(SETTLE_STRETCH).toBeGreaterThan(1);
    run.dispose();
    vi.unstubAllGlobals();
  }, timeLimit(60_000));

  it("builds the title's tour: no film models, the hike's parked car, and ready once the renderer's world is in", async () => {
    const { run, fake } = route("title", { t: 0, step: null });
    expect(fake.log).toContain(`hour ${TITLE_HOUR}`);
    expect(fake.asked.actors).toEqual([]);
    expect(fake.asked.film).toEqual([]);
    expect((fake.asked.sites[0] as { car?: unknown }).car).toBeDefined();
    expect(fake.log.some((line) => line.startsWith("whenReady "))).toBe(true);
    fake.skyIn();
    await api()!.ready;
    run.dispose();
    vi.unstubAllGlobals();
  }, timeLimit(60_000));

  it("leaves nothing behind", async () => {
    const { run, container, fake } = route("intro", { t: 5, step: null });
    expect(container.querySelector("div.scene-black")).not.toBeNull();
    run.dispose();
    run.dispose();
    expect(api()).toBeUndefined();
    expect(container.querySelector("div.scene-caption")).toBeNull();
    expect(container.querySelector("div.scene-black")).toBeNull();
    expect(fake.asked.disposed).toEqual(["signs", "actor", "trailhead", "renderer"]);
    vi.unstubAllGlobals();
  }, timeLimit(60_000));
});
