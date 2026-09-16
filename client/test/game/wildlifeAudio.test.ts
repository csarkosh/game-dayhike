import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createWildlifeAudio, listenerToAudio, CALL_CLIP, CALL_RANGE,
} from "../../src/game/wildlifeAudio.js";
import {
  CALL_COUNT, CALL_GULL_CRY, CALL_SQUIRREL_CHATTER, CALL_ELK_BUGLE, wildlifePresenceUnder,
  type WildlifeEvent,
} from "../../src/game/wildlifeBehaviour.js";
import { SPECIES_ELK, SPECIES_GULL, SPECIES_SQUIRREL } from "../../src/game/wildlifeField.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";

/**
 * `unlocked: false` models the real startup order: the shell is built at
 * `startGame` and the AudioContext does not exist until the first pointerdown,
 * so `decode` can only answer null until `unlock()` is called here.
 */
function fakeAmbient({ unlocked = true }: { unlocked?: boolean } = {}) {
  const emitted: { id: string; x: number; z: number; gain: number; ref: number; max: number }[] = [];
  const listened: number[][] = [];
  const buffers = new Map<string, AudioBuffer>();
  let ready = unlocked;
  const unlockListeners: (() => void)[] = [];
  return {
    emitted,
    listened,
    unlock() {
      ready = true;
      for (const fn of unlockListeners.splice(0)) fn();
    },
    ambient: {
      emitter: (
        buffer: AudioBuffer, x: number, _y: number, z: number, gain: number, ref: number, max: number,
      ) => {
        emitted.push({ id: (buffer as unknown as { id: string }).id, x, z, gain, ref, max });
        return { move() {}, stop() {} };
      },
      decode: async (bytes: ArrayBuffer) =>
        ready ? ({ id: new TextDecoder().decode(bytes) } as unknown as AudioBuffer) : null,
      setListener(...args: number[]) { listened.push(args); },
      onUnlock(fn: () => void) {
        if (ready) fn();
        else unlockListeners.push(fn);
      },
    },
    buffers,
  };
}

/** Lets every pending microtask chain settle — the decode batch is promise work. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const clipBytes = async (id: string) => new TextEncoder().encode(id).buffer;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wildlifeAudio", () => {
  it("maps every call kind to a clip id and a range", () => {
    expect(CALL_CLIP.length).toBe(CALL_COUNT);
    expect(CALL_RANGE.length).toBe(CALL_COUNT);
    expect(CALL_RANGE[CALL_SQUIRREL_CHATTER]).toEqual([6, 60]);
    expect(CALL_RANGE[CALL_ELK_BUGLE]).toEqual([10, 300]);
  });

  it("plays a loaded clip at the event position with the species' presence gain, and skips a species at gain 0", async () => {
    const { ambient, emitted } = fakeAmbient();
    const audio = createWildlifeAudio(ambient as never, 1, {
      fetchClip: clipBytes,
    });
    await audio.ready;
    const events = [
      { kind: "call" as const, call: CALL_ELK_BUGLE, x: 10, y: 0, z: 0, species: SPECIES_ELK },
      { kind: "call" as const, call: CALL_SQUIRREL_CHATTER, x: 20, y: 0, z: 0, species: SPECIES_SQUIRREL },
    ];
    audio.play(events, wildlifePresenceUnder(WEATHER_PRESETS.clear));
    expect(emitted.map((e) => e.id)).toEqual(["call.elk_bugle", "call.squirrel_chatter"]);
    expect(emitted[0]!.ref).toBe(10);
    expect(emitted[1]!.ref).toBe(6);
    expect(emitted[1]!.max).toBe(60);
    emitted.length = 0;
    audio.play(events, wildlifePresenceUnder(WEATHER_PRESETS.eerie));
    expect(emitted).toEqual([]);
    audio.dispose();
  });

  it("a missing clip is silent, never a throw", async () => {
    const { ambient, emitted } = fakeAmbient();
    const audio = createWildlifeAudio(ambient as never, 1, {
      fetchClip: async () => { throw new Error("404"); },
    });
    await audio.ready;
    audio.play(
      [{ kind: "call", call: CALL_ELK_BUGLE, x: 0, y: 0, z: 0, species: SPECIES_ELK }],
      wildlifePresenceUnder(WEATHER_PRESETS.clear),
    );
    expect(emitted).toEqual([]);
    audio.dispose();
  });

  it("ignores lift and flee events — only a call is audible", async () => {
    const { ambient, emitted } = fakeAmbient();
    const audio = createWildlifeAudio(ambient as never, 1, {
      fetchClip: clipBytes,
    });
    await audio.ready;
    // The flee carries a stray `call` index no real flee event has. Without it
    // this case passes for the wrong reason — a flee's missing `call` misses the
    // clip map anyway — and would go on passing with the `kind` check deleted.
    // With it, only the check itself keeps the shell quiet.
    audio.play(
      [
        { kind: "flee", x: 1, z: 2, species: SPECIES_ELK, call: CALL_ELK_BUGLE } as unknown as WildlifeEvent,
        { kind: "lift", unit: {} as never },
      ],
      wildlifePresenceUnder(WEATHER_PRESETS.clear),
    );
    expect(emitted).toEqual([]);
    audio.dispose();
  });

  it("negates z for both the emitter and the listener — Babylon is left-handed, Web Audio is not", async () => {
    const { ambient, emitted, listened } = fakeAmbient();
    const audio = createWildlifeAudio(ambient as never, 1, {
      fetchClip: clipBytes,
    });
    await audio.ready;
    // An animal 30 m in front of a world-space origin listener facing +Z.
    audio.play(
      [{ kind: "call", call: CALL_ELK_BUGLE, x: 5, y: 1, z: 30, species: SPECIES_ELK }],
      wildlifePresenceUnder(WEATHER_PRESETS.clear),
    );
    expect(emitted[0]!.x).toBe(5);
    expect(emitted[0]!.z).toBe(-30);

    audio.setListener({ x: 0, y: 2, z: 7, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0 });
    expect(listened[0]!.slice(0, 6)).toEqual([0, 2, -7, 0, 0, -1]);
    // The mirror applies to every vector, up included. Proven with a tilted up
    // rather than the (0, 1, 0) the renderer always sends, where a negated zero
    // would be indistinguishable from an unnegated one.
    audio.setListener({ x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 0.8, uz: 0.6 });
    expect(listened[1]!.slice(6)).toEqual([0, 0.8, -0.6]);
    audio.dispose();
  });

  it("listenerToAudio mirrors z, fz and uz, and nothing else", () => {
    // The one place the handedness flip is written. `app.ts` places the
    // listener every frame through it too — a world with no wildlife would
    // otherwise never place one at all, and the wind bed would sample its
    // gust at the world origin for the whole match.
    const pose = { x: 1, y: 2, z: 3, fx: 0.4, fy: 0.5, fz: 0.6, ux: 0.7, uy: 0.8, uz: 0.9 };
    expect([...listenerToAudio(pose)]).toEqual([1, 2, -3, 0.4, 0.5, -0.6, 0.7, 0.8, -0.9]);
    // The mirror is its own inverse: a pose that already points the other way
    // comes back positive, and the eight unmirrored components are untouched.
    const flipped = listenerToAudio({
      x: -1, y: -2, z: -3, fx: -0.4, fy: -0.5, fz: -0.6, ux: -0.7, uy: -0.8, uz: -0.9,
    });
    expect([...flipped]).toEqual([-1, -2, 3, -0.4, -0.5, 0.6, -0.7, -0.8, 0.9]);
  });

  // The collect disc is 400 m and the call schedule is per
  // UNIT, so the meadow produced 77 calls a minute with two-thirds of them past
  // their own maxDistance. The `inverse` model already floors those to
  // inaudible; what it does not do is stop them costing a source, a panner and
  // a gain node each. Same shape as the gain-0 skip: do not build the graph.
  it("drops a call from beyond its own maxDistance and keeps the one just inside it", async () => {
    const { ambient, emitted } = fakeAmbient();
    const audio = createWildlifeAudio(ambient as never, 1, { fetchClip: clipBytes });
    await audio.ready;
    audio.setListener({ x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0 });
    const bugleAt = (x: number, y = 0, z = 0): WildlifeEvent =>
      ({ kind: "call", call: CALL_ELK_BUGLE, x, y, z, species: SPECIES_ELK });
    audio.play([bugleAt(299), bugleAt(301)], wildlifePresenceUnder(WEATHER_PRESETS.clear));
    expect(emitted.map((e) => e.x)).toEqual([299]);
    // Measured in three dimensions, not on the ground plane: an eagle circles up
    // to 250 m overhead, and a call 40 m away horizontally but 400 m up is not
    // audible. A gate that only looked at x/z would emit this one.
    emitted.length = 0;
    audio.play([bugleAt(40, 400)], wildlifePresenceUnder(WEATHER_PRESETS.clear));
    expect(emitted).toEqual([]);
    // The squirrel carries its own, much shorter range — the gate reads the call
    // kind's max, not one shared constant. 100 m is well inside a bugle's 300 and
    // well outside chatter's 60.
    emitted.length = 0;
    audio.play(
      [
        { kind: "call", call: CALL_SQUIRREL_CHATTER, x: 100, y: 0, z: 0, species: SPECIES_SQUIRREL },
        bugleAt(100),
      ],
      wildlifePresenceUnder(WEATHER_PRESETS.clear),
    );
    expect(emitted.map((e) => e.id)).toEqual(["call.elk_bugle"]);
    audio.dispose();
  });

  it("emits everything until a listener has been placed", async () => {
    // The shell sets the listener every frame before it plays (see the app.ts
    // wiring test below), but a `play` that somehow ran first must not silence
    // the world by measuring against a listener at the origin that is not there.
    const { ambient, emitted } = fakeAmbient();
    const audio = createWildlifeAudio(ambient as never, 1, { fetchClip: clipBytes });
    await audio.ready;
    audio.play(
      [{ kind: "call", call: CALL_ELK_BUGLE, x: 5000, y: 0, z: 0, species: SPECIES_ELK }],
      wildlifePresenceUnder(WEATHER_PRESETS.clear),
    );
    expect(emitted.length).toBe(1);
    audio.dispose();
  });

  it("follows the listener — the same call is dropped, then heard once the player walks to it", async () => {
    // Pins that the gate reads the LATEST listener rather than the first one:
    // the position is remembered per `setListener` call, and a stale one would
    // leave a player who has walked 400 m hearing the wrong half of the valley.
    const { ambient, emitted } = fakeAmbient();
    const audio = createWildlifeAudio(ambient as never, 1, { fetchClip: clipBytes });
    await audio.ready;
    const call: WildlifeEvent = { kind: "call", call: CALL_ELK_BUGLE, x: 500, y: 0, z: 0, species: SPECIES_ELK };
    const pose = (x: number) => ({ x, y: 0, z: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0 });
    audio.setListener(pose(0));
    audio.play([call], wildlifePresenceUnder(WEATHER_PRESETS.clear));
    expect(emitted).toEqual([]);
    audio.setListener(pose(400));
    audio.play([call], wildlifePresenceUnder(WEATHER_PRESETS.clear));
    expect(emitted.length).toBe(1);
    audio.dispose();
  });
});

describe("the unlock ordering", () => {
  it("keeps a clip fetched before unlock and decodes it when the context arrives", async () => {
    // The real order: `createWildlifeAudio` runs at startGame, `unlock()` on the
    // first pointerdown seconds later. Decoding once at construction hands every
    // clip to a context that does not exist, gets null, and leaves the game
    // silent for the whole session with a green test suite.
    const ambient = fakeAmbient({ unlocked: false });
    const audio = createWildlifeAudio(ambient.ambient as never, 1, { fetchClip: clipBytes });
    await audio.ready;
    const events = [
      { kind: "call" as const, call: CALL_ELK_BUGLE, x: 0, y: 0, z: 0, species: SPECIES_ELK },
    ];
    const presence = wildlifePresenceUnder(WEATHER_PRESETS.clear);

    audio.play(events, presence);
    expect(ambient.emitted).toEqual([]); // nothing decodable yet — and nothing dropped

    ambient.unlock();
    await flush();
    audio.play(events, presence);
    expect(ambient.emitted.map((e) => e.id)).toEqual(["call.elk_bugle"]);
    audio.dispose();
  });

  it("decodes at once when the context is already up before the fetch lands", async () => {
    // The other ordering: unlock happens first, so the callback fires immediately
    // and the fetch completion is what has to trigger the decode.
    const ambient = fakeAmbient({ unlocked: true });
    const audio = createWildlifeAudio(ambient.ambient as never, 1, { fetchClip: clipBytes });
    await audio.ready;
    audio.play(
      [{ kind: "call", call: CALL_ELK_BUGLE, x: 0, y: 0, z: 0, species: SPECIES_ELK }],
      wildlifePresenceUnder(WEATHER_PRESETS.clear),
    );
    expect(ambient.emitted.map((e) => e.id)).toEqual(["call.elk_bugle"]);
    audio.dispose();
  });

  it("decodes clip bytes that land while an unlock-triggered batch is still in flight", async () => {
    // The third ordering, and the one the two above miss: unlock lands DURING
    // the fetch spread. A player clicking to start while six mp3s are still
    // arriving on a cold cache starts a real `decodeAudioData` on what has
    // landed; the rest land during it, and `ready`'s trigger then finds a batch
    // already in flight. Handing back that batch and scheduling nothing leaves
    // those clips as bytes for the whole session — silent, permanent, green
    // suite. A decode gate is what makes the window wide
    // enough to test: a fake that resolves in a microtask cannot reproduce it.
    const ambient = fakeAmbient({ unlocked: false });
    const plainDecode = ambient.ambient.decode;
    let releaseDecode = (): void => {};
    const decodeGate = new Promise<void>((resolve) => { releaseDecode = resolve; });
    ambient.ambient.decode = async (raw: ArrayBuffer) => { await decodeGate; return plainDecode(raw); };
    let releaseLate = (): void => {};
    const lateGate = new Promise<void>((resolve) => { releaseLate = resolve; });
    const LATE = CALL_CLIP[CALL_GULL_CRY]!;

    const audio = createWildlifeAudio(ambient.ambient as never, 1, {
      fetchClip: async (id) => { if (id === LATE) await lateGate; return clipBytes(id); },
    });
    await flush();     // every clip but the gull has landed
    ambient.unlock();  // batch #1 starts on those five, and holds on the gate
    releaseLate();
    await flush();     // the gull's bytes land, and `ready` fires its trigger
    releaseDecode();
    await audio.ready;
    await flush();

    audio.play(
      [{ kind: "call", call: CALL_GULL_CRY, x: 0, y: 0, z: 0, species: SPECIES_GULL }],
      wildlifePresenceUnder(WEATHER_PRESETS.clear),
    );
    expect(ambient.emitted.map((e) => e.id)).toEqual([LATE]);
    audio.dispose();
  });

  it("does not decode into a shell disposed mid-flight", async () => {
    // Disposing BETWEEN the unlock that starts the batch and the decodes
    // settling — the one ordering that can put six buffers back into a map the
    // teardown just cleared, and the only one the inner guard covers.
    const ambient = fakeAmbient({ unlocked: false });
    const audio = createWildlifeAudio(ambient.ambient as never, 1, { fetchClip: clipBytes });
    await audio.ready;
    ambient.unlock();
    audio.dispose();
    await flush();
    audio.play(
      [{ kind: "call", call: CALL_ELK_BUGLE, x: 0, y: 0, z: 0, species: SPECIES_ELK }],
      wildlifePresenceUnder(WEATHER_PRESETS.clear),
    );
    expect(ambient.emitted).toEqual([]);
  });
});

describe("the breadcrumb", () => {
  it("warns once per clip that cannot be fetched, naming the id and the reason", async () => {
    // Silence is also the CORRECT behaviour today, so without this a clip that
    // fails to load is indistinguishable from one that has not shipped yet.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ambient = fakeAmbient();
    const audio = createWildlifeAudio(ambient.ambient as never, 1, {
      fetchClip: async () => { throw new Error("HTTP 404"); },
    });
    await audio.ready;
    expect(warn).toHaveBeenCalledTimes(CALL_CLIP.length);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("call.elk_bugle") && m.includes("HTTP 404"))).toBe(true);
    // Once per clip, not once per play: the frame loop calls `play` every frame.
    audio.play([], wildlifePresenceUnder(WEATHER_PRESETS.clear));
    audio.play([], wildlifePresenceUnder(WEATHER_PRESETS.clear));
    expect(warn).toHaveBeenCalledTimes(CALL_CLIP.length);
    audio.dispose();
  });

  it("warns for a clip the browser refuses, but only once the context exists", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ambient = fakeAmbient({ unlocked: false });
    // Fetches fine; `decode` answers null — which pre-unlock means "no context
    // yet" and must NOT be reported as a broken clip.
    const audio = createWildlifeAudio(ambient.ambient as never, 1, { fetchClip: clipBytes });
    await audio.ready;
    expect(warn).not.toHaveBeenCalled();

    ambient.ambient.decode = async () => null; // now the bytes really are bad
    ambient.unlock();
    await flush();
    expect(warn).toHaveBeenCalledTimes(CALL_CLIP.length);
    expect(String(warn.mock.calls[0]![0])).toMatch(/could not decode/);
    audio.dispose();
  });
});

describe("app.ts wiring", () => {
  // `app.ts` builds a WebRTC session and a WebGL renderer, so nothing here can
  // run it — this reads the source for the wiring, the renderer.test.ts
  // precedent, because the wiring exists nowhere else. The failure it guards is
  // the silent one: a shell that is constructed and never fed plays nothing,
  // and the game looks exactly as it does with it fed.
  const src = readFileSync(fileURLToPath(new URL("../../src/app.ts", import.meta.url)), "utf8");

  it("feeds the shell after renderer.sync on BOTH the host and the client loop", () => {
    // Counting over the whole file would pass with both calls in the host loop.
    const calls = [...src.matchAll(/renderer\.sync\([^)]*\);\n\s*playWildlifeAudio\(\);/g)];
    expect(calls).toHaveLength(2);
    expect(src.match(/playWildlifeAudio\(\);/g)).toHaveLength(2);
  });

  it("takes the listener and the events from the renderer, and the gain from the weather", () => {
    const body = src.slice(
      src.indexOf("function playWildlifeAudio()"),
      src.indexOf("Advances the free camera"),
    );
    expect(body).toContain("wildlifeAudio.setListener(renderer.listener());");
    expect(body).toContain("wildlifeAudio.play(renderer.wildlifeEvents(), wildlifePresence);");
    // The presence is the weather's, recomputed wherever the weather is set —
    // a presence pinned at construction would leave the calls at `clear` gain
    // forever, including under dread where everything but the ravens is silent.
    // Two call sites feed it now: the `weather` command's own base, and
    // `syncAtmosphere`'s eased weather on a forest world's escalation.
    expect(src).toContain("wildlifePresence = wildlifePresenceUnder(base.weather);");
    expect(src).toContain("wildlifePresence = wildlifePresenceUnder(a.weather);");
    expect(src).toContain("wildlifeAudio?.dispose();");
  });

  it("builds nothing at all for a level with no wildlife", () => {
    // A hand-authored level has no forest and so no animals: six clip fetches
    // and nine AudioParam writes a frame, for a world with nothing to voice.
    expect(src).toContain(
      "const wildlifeAudio = renderer.hasWildlife ? createWildlifeAudio(ambient, seed) : null;",
    );
    expect(src).toContain("if (wildlifeAudio === null) return;");
  });
});
