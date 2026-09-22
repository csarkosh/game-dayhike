import { describe, it, expect } from "vitest";
import {
  createAmbientAudio, DEFAULT_VOLUME, RAIN_LEVEL, WILDLIFE_LEVEL, WIND_LEVEL,
  WIND_CUTOFF_BASE, WIND_CUTOFF_GUST, WIND_GAIN_FLOOR, WIND_MIST_DEEPEN, WIND_MIST_QUIET,
  WIND_GAIN_DEPTH, WIND_GAIN_RAMP_S, windBedGain,
} from "../../src/game/ambientAudio.js";
import { ambientGainsUnder, WEATHER_PRESETS } from "../../src/game/weather.js";
import { gustAt, windRecordUnder } from "../../src/game/windParams.js";

/** The smallest AudioContext fake that can carry the graph. Every node records
 * its connections; every AudioParam records setTargetAtTime calls. */
type FakeParam = { value: number; targets: { value: number; time: number; tc: number }[] };
function param(value = 0): FakeParam {
  const p: FakeParam = { value, targets: [] };
  (p as unknown as { setTargetAtTime: unknown }).setTargetAtTime = (
    v: number, time: number, tc: number,
  ) => p.targets.push({ value: v, time, tc });
  return p;
}
function fakeCtx() {
  const created = {
    gains: [] as ReturnType<typeof gainNode>[],
    panners: [] as ReturnType<typeof pannerNode>[],
    sources: [] as ReturnType<typeof sourceNode>[],
    filterNodes: [] as ReturnType<typeof filterNode>[],
    oscillators: 0,
    filters: 0,
  };
  function node() {
    return { connections: [] as unknown[], connect(t: unknown) { this.connections.push(t); }, start() {} };
  }
  function gainNode() { return { ...node(), gain: param(1) }; }
  function filterNode() { return { ...node(), frequency: param(350), Q: param(1), type: "lowpass" }; }
  /** Records `stop()` rather than ignoring it: a one-shot that is never stopped is
   * the emitter bug that leaks a source node per call. */
  function sourceNode() {
    return { ...node(), buffer: null as unknown, loop: false, stopped: false, stop() { this.stopped = true; } };
  }
  function pannerNode() {
    return {
      ...node(),
      panningModel: "", distanceModel: "", refDistance: 0, maxDistance: 0, rolloffFactor: 0,
      positionX: param(0), positionY: param(0), positionZ: param(0),
    };
  }
  const listener = {
    positionX: param(0), positionY: param(0), positionZ: param(0),
    forwardX: param(0), forwardY: param(0), forwardZ: param(0),
    upX: param(0), upY: param(0), upZ: param(0),
  };
  const ctx = {
    currentTime: 0,
    destination: node(),
    sampleRate: 48000,
    listener,
    createGain() { const g = gainNode(); created.gains.push(g); return g; },
    createOscillator() { created.oscillators++; return { ...node(), frequency: param(440), type: "sine" }; },
    createBufferSource() { const s = sourceNode(); created.sources.push(s); return s; },
    createPanner() { const p = pannerNode(); created.panners.push(p); return p; },
    createBiquadFilter() { created.filters++; const f = filterNode(); created.filterNodes.push(f); return f; },
    createBuffer(_ch: number, len: number, rate: number) {
      return { getChannelData: () => new Float32Array(len), length: len, sampleRate: rate };
    },
    decodeAudioData(bytes: ArrayBuffer) { return Promise.resolve({ token: bytes } as unknown as AudioBuffer); },
    close() {},
  };
  return { ctx: ctx as unknown as AudioContext, created, listener };
}

describe("createAmbientAudio", () => {
  it("is inert before unlock and builds the full graph on unlock", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.setWeather(WEATHER_PRESETS.rain); // must not throw pre-unlock
    expect(created.oscillators).toBe(0);
    audio.unlock();
    // 2 noise sources (rain, wind), no oscillators, 2 filters (rain, wind),
    // and gains: master + rain + wind + wildlife = 4.
    expect(created.sources.length).toBe(2);
    expect(created.oscillators).toBe(0);
    expect(created.filters).toBe(2);
    expect(created.gains.length).toBe(4);
    audio.dispose();
  });

  it("unlock applies the pending weather through the layer levels", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.setWeather(WEATHER_PRESETS.mist);
    audio.unlock();
    const gains = ambientGainsUnder(WEATHER_PRESETS.mist);
    const targets = created.gains.flatMap((g) => g.gain.targets.map((t) => t.value));
    expect(targets).toContain(gains.rain * RAIN_LEVEL);
    audio.dispose();
  });

  it("volume set before unlock lands on the master gain at unlock", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.setVolume(0.2);
    audio.unlock();
    const master = created.gains[0];
    expect(master?.gain.value).toBe(0.2);
    audio.dispose();
  });

  it("defaults: pending weather is the mist preset, volume 0.5, wind bed not silent", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.unlock();
    expect(created.gains[0]?.gain.value).toBe(DEFAULT_VOLUME);
    const gains = ambientGainsUnder(WEATHER_PRESETS.mist);
    const targets = created.gains.flatMap((g) => g.gain.targets.map((t) => t.value));
    expect(targets).toContain(gains.rain * RAIN_LEVEL);
    // The wind bed starts at its floor gain, not silence, before the first setWind.
    const windGain = created.gains.find((g) => g.gain.value === WIND_LEVEL * WIND_GAIN_FLOOR);
    expect(windGain).toBeDefined();
    audio.dispose();
  });

  it("wires the master gain to destination and every layer gain to the master", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.unlock();

    const master = created.gains[0];
    expect(master?.connections).toContain(ctx.destination);

    // No gain feeds an AudioParam any more (the LFO depth gain is gone —
    // `setWind` drives the wind filter's frequency directly); every
    // non-master gain is a bus gain (rain/wind/wildlife) and must reach the
    // master gain directly.
    const isParam = (t: unknown): boolean =>
      Array.isArray((t as { targets?: unknown[] }).targets);
    const layerGains = created.gains.slice(1);

    expect(layerGains.some((g) => g.connections.some(isParam))).toBe(false);
    expect(layerGains.length).toBe(3);
    for (const g of layerGains) {
      expect(g.connections).toContain(master);
    }

    audio.dispose();
  });

  it("setWind moves the wind cutoff with the gust and the gain with speed, no more than every 100 ms", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.setWeather(WEATHER_PRESETS.mist);
    audio.unlock();
    const windFilter = created.filterNodes.find((f) => f.type === "lowpass")!;
    const rec = windRecordUnder(WEATHER_PRESETS.mist, 5);
    audio.setWind(rec);
    const cutoff = WIND_CUTOFF_BASE * (1 - WIND_MIST_DEEPEN * 1) + WIND_CUTOFF_GUST * gustAt(rec, 0, 0);
    expect(windFilter.frequency.targets.at(-1)!.value).toBeCloseTo(cutoff, 6);
    // Identified by its resting floor value — setWind only ever pushes targets,
    // it never mutates this fake's `.value`.
    const windGain = created.gains.find((g) => g.gain.value === WIND_LEVEL * WIND_GAIN_FLOOR)!;
    const gain = windBedGain(rec.speed, 1, gustAt(rec, 0, 0));
    expect(windGain.gain.targets.at(-1)!.value).toBeCloseTo(gain, 6);
    // The swell must be audible: the gain ramps on its own fast constant, not
    // the 2 s weather fade.
    expect(windGain.gain.targets.at(-1)!.tc).toBe(WIND_GAIN_RAMP_S);
    const n = windFilter.frequency.targets.length;
    audio.setWind({ ...rec, time: 5.02 }); // 20 ms later on the fake clock: throttled
    expect(windFilter.frequency.targets.length).toBe(n);
    audio.setWind({ ...rec, time: 299.98 });
    const n2 = windFilter.frequency.targets.length;
    audio.setWind({ ...rec, time: 0.05 }); // wrapped past 300 s: must apply immediately
    expect(windFilter.frequency.targets.length).toBe(n2 + 1);
    audio.dispose();
  });

  it("the bed always plays and its intensity follows the gust: louder at a crest, quieter in a trough, never below the floor", () => {
    // The raw gust, not the speed-scaled one, so even a clear day breathes.
    const crest = windBedGain(0.25, 0, 1.5);
    const trough = windBedGain(0.25, 0, -1.5);
    const mid = windBedGain(0.25, 0, 0);
    expect(crest).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(trough);
    expect(crest / trough).toBeCloseTo((1 + WIND_GAIN_DEPTH) / (1 - WIND_GAIN_DEPTH), 6);
    // Never silent: the floor holds at speed 0 in the deepest trough under full mist.
    expect(windBedGain(0, 1, -1.5)).toBeGreaterThan(0);
    expect(windBedGain(0, 1, -1.5)).toBeCloseTo(
      WIND_LEVEL * WIND_GAIN_FLOOR * (1 - WIND_MIST_QUIET) * (1 - WIND_GAIN_DEPTH), 6,
    );
    // Louder with speed, quieter under mist, at the same gust.
    expect(windBedGain(0.9, 0, 0)).toBeGreaterThan(windBedGain(0.25, 0, 0));
    expect(windBedGain(0.25, 1, 0)).toBeLessThan(windBedGain(0.25, 0, 0));
  });

  it("clear has a quiet wind bed instead of silence", () => {
    const rec = windRecordUnder(WEATHER_PRESETS.clear, 0);
    expect(rec.speed).toBeCloseTo(0.25, 10);
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.unlock();
    const windGain = created.gains.find((g) => g.gain.value === WIND_LEVEL * WIND_GAIN_FLOOR)!;
    expect(windGain.gain.value).toBeGreaterThan(0); // before any setWind call
    audio.setWeather(WEATHER_PRESETS.clear);
    audio.setWind(rec);
    const gain = windBedGain(rec.speed, 0, gustAt(rec, 0, 0));
    expect(gain).toBeGreaterThan(0);
    expect(windGain.gain.targets.at(-1)!.value).toBeCloseTo(gain, 6);
    audio.dispose();
  });

  it("setVolume clamps out-of-range volume before it reaches the master gain", () => {
    const over = fakeCtx();
    const audioOver = createAmbientAudio(() => over.ctx);
    audioOver.setVolume(1.5);
    audioOver.unlock();
    expect(over.created.gains[0]?.gain.value).toBe(1);
    audioOver.dispose();

    const under = fakeCtx();
    const audioUnder = createAmbientAudio(() => under.ctx);
    audioUnder.setVolume(-1);
    audioUnder.unlock();
    expect(under.created.gains[0]?.gain.value).toBe(0);
    audioUnder.dispose();
  });

  it("emitter builds source → panner → wildlife gain → master, positioned, and stops", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    expect(audio.emitter({} as AudioBuffer, 1, 2, 3, 0.8, 10, 300)).toBeNull(); // pre-unlock
    audio.unlock();
    const e = audio.emitter({} as AudioBuffer, 1, 2, 3, 0.8, 10, 300)!;
    const panner = created.panners[0]!;
    expect(panner.panningModel).toBe("equalpower");
    expect(panner.distanceModel).toBe("inverse");
    expect(panner.refDistance).toBe(10);
    expect(panner.maxDistance).toBe(300);
    expect(panner.rolloffFactor).toBe(1);
    expect(panner.positionX.value).toBe(1);
    expect(panner.positionY.value).toBe(2);
    expect(panner.positionZ.value).toBe(3);

    // The graph, end to end: the source reaches the panner, the panner its own
    // per-call gain, and that gain the shared wildlife gain — which was already
    // wired to the master at unlock. A per-call gain wired straight to the
    // master would bypass the weather/volume trim the wildlife gain exists for.
    const source = created.sources[created.sources.length - 1]!;
    expect(source.connections).toContain(panner);
    const callGain = created.gains[created.gains.length - 1]!;
    expect(panner.connections).toContain(callGain);
    expect(callGain.gain.value).toBe(0.8);
    // Found by its level rather than its index, so reordering the layers in
    // `unlock` does not silently repoint this at the wrong node.
    const wildlifeGain = created.gains.find((g) => g.gain.value === WILDLIFE_LEVEL)!;
    expect(wildlifeGain).toBeDefined();
    expect(callGain.connections).toContain(wildlifeGain);
    expect(wildlifeGain.connections).toContain(created.gains[0]);

    e.move(4, 5, 6);
    expect(panner.positionX.value).toBe(4);
    expect(panner.positionZ.value).toBe(6);
    e.stop();
    expect(created.sources[created.sources.length - 1]!.stopped).toBe(true);
    audio.dispose();
  });

  it("setListener writes position and orientation", () => {
    const { ctx, listener } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.setListener(1, 2, 3, 0, 0, 1, 0, 1, 0); // pre-unlock: inert, not a throw
    expect(listener.positionX.value).toBe(0);
    audio.unlock();
    // These arrive already converted to Web Audio's right-handed frame — the
    // caller negates z, not this API (see wildlifeAudio.ts).
    audio.setListener(1, 2, -3, 0.5, -0.25, -0.75, 0, 1, 0);
    expect([listener.positionX.value, listener.positionY.value, listener.positionZ.value])
      .toEqual([1, 2, -3]);
    expect([listener.forwardX.value, listener.forwardY.value, listener.forwardZ.value])
      .toEqual([0.5, -0.25, -0.75]);
    expect([listener.upX.value, listener.upY.value, listener.upZ.value]).toEqual([0, 1, 0]);
    audio.dispose();
  });

  it("onUnlock fires at unlock, and immediately for a late registration", () => {
    // The signal `wildlifeAudio` decodes on: without it a caller that needs the
    // context either polls every frame or gives up on its clips forever.
    const { ctx } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    const order: string[] = [];
    audio.onUnlock(() => order.push("early"));
    expect(order).toEqual([]);
    audio.unlock();
    expect(order).toEqual(["early"]);
    audio.onUnlock(() => order.push("late"));
    expect(order).toEqual(["early", "late"]);
    audio.dispose();
  });

  it("decode resolves null before unlock and on undecodable bytes, never throws", async () => {
    const { ctx } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    expect(await audio.decode(new ArrayBuffer(8))).toBeNull();
    audio.unlock();
    expect(await audio.decode(new ArrayBuffer(8))).not.toBeNull();
    (ctx as unknown as { decodeAudioData: unknown }).decodeAudioData = () =>
      Promise.reject(new Error("not audio"));
    expect(await audio.decode(new ArrayBuffer(8))).toBeNull();
    audio.dispose();
  });
});
