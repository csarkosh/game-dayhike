import { describe, it, expect } from "vitest";
import {
  createAmbientAudio, DEFAULT_VOLUME, RAIN_LEVEL, WILDLIFE_LEVEL, WIND_LEVEL,
  WIND_CUTOFF_BASE, WIND_CUTOFF_GUST, WIND_GAIN_FLOOR, WIND_MIST_DEEPEN, WIND_MIST_QUIET,
  WIND_GAIN_DEPTH, WIND_GAIN_RAMP_S, windBedGain,
} from "../../src/game/ambientAudio.js";
import { ambientGainsUnder, WEATHER_PRESETS } from "../../src/game/weather.js";
import { gustAt, windRecordUnder } from "../../src/game/windParams.js";

/** The smallest AudioContext fake that can carry the graph. Every node records
 * its connections; every AudioParam records setTargetAtTime calls and, for
 * the drips' envelopes, the value-at and ramp-to calls in order. */
type FakeParam = {
  value: number;
  targets: { value: number; time: number; tc: number }[];
  ramps: { kind: "set" | "linear" | "exponential"; value: number; time: number }[];
};
function param(value = 0): FakeParam {
  const p: FakeParam = { value, targets: [], ramps: [] };
  const methods = p as unknown as Record<string, unknown>;
  methods.setTargetAtTime = (v: number, time: number, tc: number) => p.targets.push({ value: v, time, tc });
  methods.setValueAtTime = (v: number, time: number) => p.ramps.push({ kind: "set", value: v, time });
  methods.linearRampToValueAtTime = (v: number, time: number) => p.ramps.push({ kind: "linear", value: v, time });
  methods.exponentialRampToValueAtTime = (v: number, time: number) =>
    p.ramps.push({ kind: "exponential", value: v, time });
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
   * the emitter bug that leaks a source node per call. The scheduled times are
   * kept too, for the drips. */
  function sourceNode() {
    return {
      ...node(),
      buffer: null as unknown, loop: false, stopped: false,
      startedAt: undefined as number | undefined, offset: undefined as number | undefined,
      stoppedAt: undefined as number | undefined,
      start(when?: number, offset?: number) { this.startedAt = when; this.offset = offset; },
      stop(when?: number) { this.stopped = true; this.stoppedAt = when; },
    };
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
  return { ctx: ctx as unknown as AudioContext, created, listener, clock: ctx };
}

describe("createAmbientAudio", () => {
  it("is inert before unlock and builds the full graph on unlock", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.setWeather(WEATHER_PRESETS.rain); // must not throw pre-unlock
    expect(created.oscillators).toBe(0);
    audio.unlock();
    // 2 noise sources (rain, wind), no oscillators, 2 filters (rain, wind),
    // and gains: master + rain + wind + wildlife + drip = 5. The drips' own
    // sources, filters and gains are made as they fire, not here.
    expect(created.sources.length).toBe(2);
    expect(created.oscillators).toBe(0);
    expect(created.filters).toBe(2);
    expect(created.gains.length).toBe(5);
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
    // non-master gain is a bus gain (rain/wind/wildlife/drip) and must reach
    // the master gain directly.
    const isParam = (t: unknown): boolean =>
      Array.isArray((t as { targets?: unknown[] }).targets);
    const layerGains = created.gains.slice(1);

    expect(layerGains.some((g) => g.connections.some(isParam))).toBe(false);
    expect(layerGains.length).toBe(4);
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

  /** The rain bed's nodes: the band-pass and the gain it feeds. */
  function rainBed(created: ReturnType<typeof fakeCtx>["created"]) {
    const filter = created.filterNodes.find((f) => f.type === "bandpass")!;
    const gain = created.gains.find((g) => filter.connections.includes(g))!;
    return { filter, gain };
  }

  it("the hiss's band centre sits at 3 kHz with no rain and falls to 1.8 kHz under full rain, on the weather ramp", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.setWeather(WEATHER_PRESETS.clear);
    audio.unlock();
    const { filter } = rainBed(created);
    expect(filter.frequency.value).toBe(3000);
    expect(filter.frequency.targets.at(-1)).toEqual({ value: 3000, time: 0, tc: 2 });
    audio.setWeather(WEATHER_PRESETS.rain);
    expect(filter.frequency.targets.at(-1)).toEqual({ value: 1800, time: 0, tc: 2 });
    audio.setWeather({ ...WEATHER_PRESETS.rain, rain: 0.5 });
    expect(filter.frequency.targets.at(-1)!.value).toBe(2400);
    audio.dispose();
  });

  it("an unlock under rain rests the band centre at 1.8 kHz rather than sliding down from 3 kHz", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.setWeather(WEATHER_PRESETS.rain);
    audio.unlock();
    const { filter } = rainBed(created);
    expect(filter.frequency.value).toBe(1800);
    audio.setWeather({ ...WEATHER_PRESETS.rain, rain: 0.5 });
    expect(filter.frequency.value).toBe(1800); // the resting value is set once; ramps move it from here
    expect(filter.frequency.targets.at(-1)!.value).toBe(2400);
    audio.dispose();
  });

  it("the wind cuts the hiss by a third at full speed and not at all below 0.6", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.setWeather(WEATHER_PRESETS.rain);
    audio.unlock();
    const { gain } = rainBed(created);
    expect(gain.gain.targets.at(-1)!.value).toBe(0.5);
    const rec = windRecordUnder(WEATHER_PRESETS.rain, 5);
    audio.setWind({ ...rec, speed: 1 });
    expect(gain.gain.targets.at(-1)!.value).toBeCloseTo(0.335, 10);
    expect(gain.gain.targets.at(-1)!.tc).toBe(2);
    audio.setWind({ ...rec, speed: 0.8, time: 6 });
    expect(gain.gain.targets.at(-1)!.value).toBeCloseTo(0.4175, 10);
    audio.setWind({ ...rec, speed: 0.6, time: 7 });
    expect(gain.gain.targets.at(-1)!.value).toBe(0.5);
    // The cut is remembered: a weather change under the same wind keeps it.
    audio.setWind({ ...rec, speed: 1, time: 8 });
    audio.setWeather({ ...WEATHER_PRESETS.rain, rain: 0.5 });
    expect(gain.gain.targets.at(-1)!.value).toBeCloseTo(0.1675, 10);
    audio.dispose();
  });

  it("setDrip schedules a train of bursts under a wet canopy, each with its envelope, within the look-ahead", () => {
    // A fixed draw of 0.5: every interval is (0.3 + 0.6) / (0.5 + 1) = 0.6 s
    // at level 1, every centre 1.5 kHz, every noise offset 0.5 × 1.97 s.
    const { ctx, created, clock } = fakeCtx();
    const audio = createAmbientAudio(() => ctx, () => 0.5);
    audio.setDrip(1, 1); // pre-unlock: inert, not a throw
    audio.unlock();
    const beds = created.sources.length;
    const master = created.gains[0]!;
    const dripGain = created.gains[4]!;
    expect(dripGain.gain.value).toBe(1);
    expect(dripGain.connections).toContain(master);

    // The train starts one interval out, past the 0.2 s look-ahead: nothing yet.
    audio.setDrip(1, 1);
    expect(created.sources.length).toBe(beds);
    // Nothing fires until the look-ahead reaches 0.6 s.
    clock.currentTime = 0.3;
    audio.setDrip(1, 1);
    expect(created.sources.length).toBe(beds);
    clock.currentTime = 0.45;
    audio.setDrip(1, 1);
    expect(created.sources.length).toBe(beds + 1);
    // Calling again inside the same look-ahead schedules nothing twice.
    audio.setDrip(1, 1);
    expect(created.sources.length).toBe(beds + 1);

    const src = created.sources[beds]!;
    expect(src.startedAt).toBeCloseTo(0.6, 10);
    expect(src.offset).toBeCloseTo(0.985, 10);
    expect(src.stoppedAt).toBeCloseTo(0.63, 10);
    expect(src.loop).toBe(false);
    const filter = created.filterNodes.at(-1)!;
    expect(src.connections).toEqual([filter]);
    expect(filter.type).toBe("bandpass");
    expect(filter.frequency.value).toBe(1500);
    expect(filter.Q.value).toBe(6);
    const g = created.gains.at(-1)!;
    expect(filter.connections).toEqual([g]);
    expect(g.connections).toEqual([dripGain]);
    expect(g.gain.ramps.map((r) => r.kind)).toEqual(["set", "linear", "exponential"]);
    expect(g.gain.ramps.map((r) => r.value)).toEqual([0, 0.35, 0.001]);
    expect(g.gain.ramps[0]!.time).toBeCloseTo(0.6, 10);
    expect(g.gain.ramps[1]!.time).toBeCloseTo(0.603, 10);
    expect(g.gain.ramps[2]!.time).toBeCloseTo(0.625, 10);

    // The train continues at the interval as the frames come: by 2.5 s the
    // drips at 1.2, 1.8 and 2.4 s have been scheduled too (2.4 < 2.5 + 0.2;
    // 3.0 has not).
    for (let t = 0.5; t < 2.55; t += 0.1) {
      clock.currentTime = t;
      audio.setDrip(1, 1);
    }
    expect(created.sources.length).toBe(beds + 4);
    expect(created.sources.slice(beds).map((s) => s.startedAt!.toFixed(6)))
      .toEqual(["0.600000", "1.200000", "1.800000", "2.400000"]);
    audio.dispose();
  });

  it("a stall longer than the look-ahead restarts the train rather than catching up on the drips it missed", () => {
    const { ctx, created, clock } = fakeCtx();
    const audio = createAmbientAudio(() => ctx, () => 0.5);
    audio.unlock();
    const beds = created.sources.length;
    audio.setDrip(1, 1);
    clock.currentTime = 0.45;
    audio.setDrip(1, 1);
    expect(created.sources.length).toBe(beds + 1);
    expect(created.sources[beds]!.startedAt).toBeCloseTo(0.6, 10);
    // The tab slept until 5 s: the drips at 1.2 to 4.8 are not fired late;
    // the train starts again one interval out.
    clock.currentTime = 5;
    audio.setDrip(1, 1);
    expect(created.sources.length).toBe(beds + 1);
    clock.currentTime = 5.5;
    audio.setDrip(1, 1);
    expect(created.sources.length).toBe(beds + 2);
    expect(created.sources[beds + 1]!.startedAt).toBeCloseTo(5.6, 10);
    audio.dispose();
  });

  it("a drip's peak and pace follow the level: half water under half canopy is a quarter", () => {
    const { ctx, created, clock } = fakeCtx();
    const audio = createAmbientAudio(() => ctx, () => 0.5);
    audio.unlock();
    const beds = created.sources.length;
    // Level 0.25: the interval is 0.9 / 0.75 = 1.2 s; the first drip at 1.2 s.
    audio.setDrip(0.5, 0.5);
    clock.currentTime = 1.1;
    audio.setDrip(0.5, 0.5);
    expect(created.sources.length).toBe(beds + 1);
    expect(created.sources[beds]!.startedAt).toBeCloseTo(1.2, 10);
    expect(created.gains.at(-1)!.gain.ramps[1]!.value).toBeCloseTo(0.0875, 10);
    audio.dispose();
  });

  it("no canopy water, no drips; and a train that dries up stops and restarts one interval out", () => {
    const { ctx, created, clock } = fakeCtx();
    const audio = createAmbientAudio(() => ctx, () => 0.5);
    audio.unlock();
    const beds = created.sources.length;
    for (let t = 0; t < 10; t += 0.1) {
      clock.currentTime = t;
      audio.setDrip(0, 1);
      audio.setDrip(1, 0);
      audio.setDrip(0.1, 0.1); // 0.01: under the 0.02 floor
    }
    expect(created.sources.length).toBe(beds);
    // Wet now: the first drip is 0.6 s after the train starts, not at once.
    clock.currentTime = 10;
    audio.setDrip(1, 1);
    expect(created.sources.length).toBe(beds);
    clock.currentTime = 10.5;
    audio.setDrip(1, 1);
    expect(created.sources.length).toBe(beds + 1);
    expect(created.sources[beds]!.startedAt).toBeCloseTo(10.6, 10);
    // Dry again, then wet 20 s later: the stale train is not caught up on.
    clock.currentTime = 11;
    audio.setDrip(0, 1);
    clock.currentTime = 31;
    audio.setDrip(1, 1);
    expect(created.sources.length).toBe(beds + 1);
    clock.currentTime = 31.5;
    audio.setDrip(1, 1);
    expect(created.sources.length).toBe(beds + 2);
    expect(created.sources[beds + 1]!.startedAt).toBeCloseTo(31.6, 10);
    audio.dispose();
  });

  it("dispose drops the graph: setDrip and setWeather after it build and ramp nothing", () => {
    const { ctx, created, clock } = fakeCtx();
    const audio = createAmbientAudio(() => ctx, () => 0.5);
    audio.unlock();
    const { filter } = rainBed(created);
    const sources = created.sources.length;
    const gains = created.gains.length;
    const centres = filter.frequency.targets.length;
    audio.dispose();
    clock.currentTime = 5;
    audio.setDrip(1, 1);
    audio.setWeather(WEATHER_PRESETS.rain);
    audio.setWind(windRecordUnder(WEATHER_PRESETS.rain, 5));
    expect(created.sources.length).toBe(sources);
    expect(created.gains.length).toBe(gains);
    expect(filter.frequency.targets.length).toBe(centres);
  });
});
