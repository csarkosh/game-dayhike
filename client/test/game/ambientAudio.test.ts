import { describe, it, expect } from "vitest";
import {
  createAmbientAudio, DEFAULT_VOLUME, RAIN_LEVEL, WILDLIFE_LEVEL, WIND_LEVEL,
  WIND_CUTOFF_BASE, WIND_CUTOFF_GUST, WIND_GAIN_FLOOR, WIND_MIST_DEEPEN, WIND_MIST_QUIET,
  WIND_GAIN_DEPTH, WIND_GAIN_RAMP_S, windBedGain, BIRD_LEVEL, BIRD_PAN, BIRD_OVERLAP_S, BIRD_GAIN_RAMP_S,
  HOLLOW_CALL_LEVEL, HOLLOW_CALL_STANDOFF_M, HOLLOW_CALL_VOICES, HUSH_RAMP_S, type VoiceSource,
} from "../../src/game/ambientAudio.js";
import { frogCallVoice, humVoice, rustleVoice } from "../../src/game/insectVoices.js";
import { ambientGainsUnder, WEATHER_PRESETS } from "../../src/game/weather.js";
import { MUFFLE_OPEN_HZ, MUFFLE_SHUT_HZ, MUFFLE_GAIN, HEART_LEVEL, WHISPER_LEVEL, WHISPER_VOICES } from "../../src/game/stareAudio.js";
import { HEART_DUB_AT, STARE_LENS_REST } from "../../src/game/stareLens.js";
import { gustAt, windRecordUnder } from "../../src/game/windParams.js";

/** The smallest AudioContext fake that can carry the graph. Every node records
 * its connections and whether it was disconnected; every AudioParam records
 * setTargetAtTime calls and, for the drips' and the voices' envelopes, the
 * value-at and ramp-to calls in order. */
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
    stereo: [] as { pan: FakeParam; connections: unknown[] }[],
    sources: [] as ReturnType<typeof sourceNode>[],
    filterNodes: [] as ReturnType<typeof filterNode>[],
    oscillatorNodes: [] as ReturnType<typeof oscillatorNode>[],
    buffers: [] as ReturnType<typeof bufferOf>[],
    oscillators: 0,
    filters: 0,
  };
  /** Records `disconnect()` too: a loop emitter stopped but left wired into
   * the bus is the leak its `stop` exists to prevent. */
  function node() {
    return {
      connections: [] as unknown[],
      disconnected: false,
      connect(t: unknown) { this.connections.push(t); },
      disconnect() { this.disconnected = true; },
      start() {},
    };
  }
  function gainNode() { return { ...node(), gain: param(1) }; }
  function filterNode() { return { ...node(), frequency: param(350), Q: param(1), type: "lowpass" }; }
  /** Records `stop()` rather than ignoring it: a one-shot that is never stopped is
   * the emitter bug that leaks a source node per call. The scheduled times are
   * kept too, for the drips. */
  function sourceNode() {
    return {
      ...node(),
      buffer: null as unknown, loop: false, stopped: false, playbackRate: param(1),
      startedAt: undefined as number | undefined, offset: undefined as number | undefined,
      stoppedAt: undefined as number | undefined,
      start(when?: number, offset?: number) { this.startedAt = when; this.offset = offset; },
      stop(when?: number) { this.stopped = true; this.stoppedAt = when; },
    };
  }
  /** Records its start and its scheduled stop, as a buffer source does: a
   * voice that ends itself schedules its own stop when it is built. */
  function oscillatorNode() {
    return {
      ...node(),
      frequency: param(440), type: "sine", started: false, stopped: false,
      startedAt: undefined as number | undefined, stoppedAt: undefined as number | undefined,
      start(when?: number) { this.started = true; this.startedAt = when; },
      stop(when?: number) { this.stopped = true; this.stoppedAt = when; },
    };
  }
  function bufferOf(len: number, rate: number) {
    return { getChannelData: () => new Float32Array(len), length: len, sampleRate: rate };
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
    createOscillator() {
      created.oscillators++;
      const o = oscillatorNode();
      created.oscillatorNodes.push(o);
      return o;
    },
    createBufferSource() { const s = sourceNode(); created.sources.push(s); return s; },
    createPanner() { const p = pannerNode(); created.panners.push(p); return p; },
    createStereoPanner() { const p = { ...node(), pan: param(0) }; created.stereo.push(p); return p; },
    createBiquadFilter() { created.filters++; const f = filterNode(); created.filterNodes.push(f); return f; },
    createBuffer(_ch: number, len: number, rate: number) {
      const b = bufferOf(len, rate);
      created.buffers.push(b);
      return b;
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
    // 2 noise sources (rain, wind), no oscillators, 3 filters (rain, wind,
    // the world's), and gains: master + world + rain + wind + wildlife +
    // drip + birdsong + the stare's heart and whispers = 9. The drips' own sources,
    // filters and gains are made as they fire, not here, and the whispers'
    // voices on the first stare.
    expect(created.sources.length).toBe(2);
    expect(created.oscillators).toBe(0);
    expect(created.filters).toBe(3);
    expect(created.gains.length).toBe(9);
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

  it("wires the master gain to destination, every layer gain to the world's bus, and that through its low-pass to the master", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.unlock();

    const master = created.gains[0];
    expect(master?.connections).toContain(ctx.destination);

    // No gain feeds an AudioParam any more (the LFO depth gain is gone —
    // `setWind` drives the wind filter's frequency directly); every
    // layer gain (rain/wind/wildlife/drip/birdsong) reaches the world's bus, which
    // reaches the master through the low-pass the stare shuts; the stare's
    // own two buses reach the master directly, unmuffled.
    const isParam = (t: unknown): boolean =>
      Array.isArray((t as { targets?: unknown[] }).targets);
    const world = created.gains[1]!;
    const layerGains = created.gains.slice(2, 7);
    const stareGains = created.gains.slice(7);

    expect(created.gains.slice(1).some((g) => g.connections.some(isParam))).toBe(false);
    expect(layerGains.length).toBe(5);
    for (const g of layerGains) expect(g.connections).toEqual([world]);
    const muffle = created.filterNodes[2]!;
    expect(muffle.type).toBe("lowpass");
    expect(muffle.frequency.value).toBe(MUFFLE_OPEN_HZ);
    expect(world.connections).toEqual([muffle]);
    expect(muffle.connections).toEqual([master]);
    expect(stareGains.length).toBe(2);
    for (const g of stareGains) expect(g.connections).toEqual([master]);

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
    expect(wildlifeGain.connections).toContain(created.gains[1]);

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
    const dripGain = created.gains[5]!;
    expect(dripGain.gain.value).toBe(1);
    expect(master.connections).toContain(ctx.destination);
    expect(dripGain.connections).toContain(created.gains[1]);

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

/** A voice for the loop emitter's own tests: one looping buffer source, its
 * stops counted. */
function testVoice(stops: { n: number }) {
  return (c: BaseAudioContext): VoiceSource => {
    const src = c.createBufferSource();
    src.loop = true;
    src.start();
    return { output: src, stop() { stops.n++; src.stop(); } };
  };
}

describe("loopEmitter", () => {
  it("is null before unlock and after dispose, and builds nothing then", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    let builds = 0;
    const build = (c: BaseAudioContext): VoiceSource => { builds++; return testVoice({ n: 0 })(c); };
    expect(audio.loopEmitter(build, 1, 2, 3, 0.5, 0.5, 10)).toBeNull();
    expect(builds).toBe(0);
    expect(created.panners.length).toBe(0);
    audio.unlock();
    expect(audio.loopEmitter(build, 1, 2, 3, 0.5, 0.5, 10)).not.toBeNull();
    expect(builds).toBe(1);
    audio.dispose();
    expect(audio.loopEmitter(build, 1, 2, 3, 0.5, 0.5, 10)).toBeNull();
    expect(builds).toBe(1);
  });

  it("wires the voice to its panner, its own gain and the wildlife bus, equal-power and inverse, positioned", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.unlock();
    const beds = created.sources.length;
    audio.loopEmitter(testVoice({ n: 0 }), 1, 2, -3, 0.6, 0.5, 10);
    const voice = created.sources[beds]!;
    const panner = created.panners[0]!;
    expect(panner.panningModel).toBe("equalpower");
    expect(panner.distanceModel).toBe("inverse");
    expect(panner.refDistance).toBe(0.5);
    expect(panner.maxDistance).toBe(10);
    expect(panner.rolloffFactor).toBe(1);
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([1, 2, -3]);
    const loopGain = created.gains.at(-1)!;
    expect(voice.connections).toEqual([panner]);
    expect(panner.connections).toEqual([loopGain]);
    expect(loopGain.gain.value).toBe(0.6);
    // Into the same bus as the calls, so the master volume and the bus level trim it,
    // and with them through the world's bus, which a stare muffles and a hush cuts.
    const wildlifeGain = created.gains.find((g) => g.gain.value === WILDLIFE_LEVEL)!;
    expect(loopGain.connections).toEqual([wildlifeGain]);
    expect(wildlifeGain.connections).toEqual([created.gains[1]]);
    audio.dispose();
  });

  it("moves and changes gain in place: one build, one source, never restarted", () => {
    const { ctx, created, clock } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.unlock();
    const stops = { n: 0 };
    let builds = 0;
    const loop = audio.loopEmitter((c) => { builds++; return testVoice(stops)(c); }, 0, 0, 0, 0.6, 0.5, 10)!;
    const sources = created.sources.length;
    const panner = created.panners[0]!;
    const loopGain = created.gains.at(-1)!;
    clock.currentTime = 2;
    loop.move(4, 5, -6);
    loop.setGain(0.3);
    clock.currentTime = 2.5;
    loop.move(7, 8, -9);
    loop.setGain(0.9);
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([7, 8, -9]);
    // Ramped, never set: a jump in a looping voice's gain clicks.
    expect(loopGain.gain.value).toBe(0.6);
    expect(loopGain.gain.targets.map((t) => [t.value, t.time])).toEqual([[0.3, 2], [0.9, 2.5]]);
    expect(loopGain.gain.targets[0]!.tc).toBeCloseTo(0.033333, 6);
    expect(builds).toBe(1);
    expect(created.sources.length).toBe(sources);
    expect(created.panners.length).toBe(1);
    expect(stops.n).toBe(0);
    expect(created.sources.at(-1)!.stopped).toBe(false);
    audio.dispose();
  });

  it("stop ends the voice and disconnects it, its panner and its gain; a stopped loop ignores every call", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.unlock();
    const stops = { n: 0 };
    const loop = audio.loopEmitter(testVoice(stops), 0, 0, 0, 0.6, 0.5, 10)!;
    const source = created.sources.at(-1)!;
    const panner = created.panners[0]!;
    const loopGain = created.gains.at(-1)!;
    loop.stop();
    expect(stops.n).toBe(1);
    expect(source.stopped).toBe(true);
    expect(source.disconnected).toBe(true);
    expect(panner.disconnected).toBe(true);
    expect(loopGain.disconnected).toBe(true);
    loop.stop();
    loop.setGain(0.1);
    loop.move(9, 9, 9);
    expect(stops.n).toBe(1);
    expect(loopGain.gain.targets.length).toBe(0);
    expect(panner.positionX.value).toBe(0);
    audio.dispose();
    expect(stops.n).toBe(1);
  });

  it("a hum on a loop emitter, stopped, leaves no oscillator running and nothing connected", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.unlock();
    const loop = audio.loopEmitter((c) => humVoice(c, 230, () => 0.5), 0, 0, 0, 1, 0.5, 10)!;
    expect(created.oscillatorNodes.length).toBe(12);
    loop.stop();
    expect(created.oscillatorNodes.every((o) => o.stopped && o.disconnected)).toBe(true);
    expect(created.filterNodes.at(-1)!.disconnected).toBe(true);
    expect(created.panners[0]!.disconnected).toBe(true);
    audio.dispose();
  });

  it("dispose stops every loop still playing, once each", () => {
    const { ctx } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.unlock();
    const stops = [{ n: 0 }, { n: 0 }, { n: 0 }];
    const loops = stops.map((s) => audio.loopEmitter(testVoice(s), 0, 0, 0, 1, 0.5, 10)!);
    loops[1]!.stop();
    audio.dispose();
    expect(stops.map((s) => s.n)).toEqual([1, 1, 1]);
  });
});

describe("the insects' voices", () => {
  it("humVoice: six detuned sawtooths, each drifting on its own slow sine, through one band-pass at the pitch", () => {
    const { ctx, created } = fakeCtx();
    const voice = humVoice(ctx, 230, () => 0.5);
    const saws = created.oscillatorNodes.filter((o) => o.type === "sawtooth");
    const drifts = created.oscillatorNodes.filter((o) => o.type === "sine");
    expect(saws.length).toBe(6);
    expect(drifts.length).toBe(6);
    expect(saws.map((o) => o.frequency.value.toFixed(3)))
      .toEqual(["211.600", "218.960", "226.320", "233.680", "241.040", "248.400"]);
    expect(drifts.map((o) => o.frequency.value.toFixed(3)))
      .toEqual(["0.150", "0.150", "0.150", "0.150", "0.150", "0.150"]);
    expect(created.oscillatorNodes.every((o) => o.started && !o.stopped)).toBe(true);
    const band = created.filterNodes[0]!;
    expect(created.filterNodes.length).toBe(1);
    expect(band.type).toBe("bandpass");
    expect(band.frequency.value).toBe(230);
    expect(band.Q.value).toBe(4);
    expect(voice.output).toBe(band);
    for (let k = 0; k < 6; k++) {
      // Each saw through a level of its own into the band, and each drift
      // through a depth into that level's gain: an LFO on an AudioParam, no timer.
      const level = created.gains.find((g) => saws[k]!.connections.includes(g))!;
      expect(level.gain.value).toBe(0.15);
      expect(level.connections).toEqual([band]);
      const depth = created.gains.find((g) => drifts[k]!.connections.includes(g))!;
      expect(depth.gain.value).toBe(0.1);
      expect(depth.connections).toEqual([level.gain]);
    }
  });

  it("humVoice.setPitch glides every oscillator and the band; stop ends all twelve sources and disconnects", () => {
    const { ctx, created, clock } = fakeCtx();
    const voice = humVoice(ctx, 230, () => 0.5);
    clock.currentTime = 3;
    voice.setPitch(250);
    const saws = created.oscillatorNodes.filter((o) => o.type === "sawtooth");
    expect(saws.map((o) => o.frequency.targets.at(-1)!.value.toFixed(3)))
      .toEqual(["230.000", "238.000", "246.000", "254.000", "262.000", "270.000"]);
    expect(saws.every((o) => o.frequency.targets.at(-1)!.time === 3 && o.frequency.targets.at(-1)!.tc === 0.5))
      .toBe(true);
    expect(created.filterNodes[0]!.frequency.targets.at(-1)).toEqual({ value: 250, time: 3, tc: 0.5 });
    // The drifts keep their own rates.
    expect(created.oscillatorNodes.filter((o) => o.type === "sine").every((o) => o.frequency.targets.length === 0))
      .toBe(true);
    // A loop: nothing is scheduled to stop until `stop`.
    expect(created.oscillatorNodes.some((o) => o.stopped)).toBe(false);
    voice.stop();
    expect(created.oscillatorNodes.every((o) => o.stopped && o.stoppedAt === undefined && o.disconnected)).toBe(true);
    expect(created.gains.every((g) => g.disconnected)).toBe(true);
    expect(created.filterNodes[0]!.disconnected).toBe(true);
  });

  it("rustleVoice: band-passed noise pulsed at the wingbeat for 0.25 s, ending itself; the noise made once a context", () => {
    const { ctx, created, clock } = fakeCtx();
    clock.currentTime = 1;
    const voice = rustleVoice(ctx, 36, false, () => 0.5);
    expect(created.buffers.length).toBe(1);
    const noise = created.buffers[0]!;
    expect(noise.length).toBe(48000);
    const src = created.sources[0]!;
    expect(src.buffer).toBe(noise);
    expect(src.loop).toBe(false);
    expect(src.startedAt).toBe(1);
    expect(src.offset).toBe(0.375);
    expect(src.stoppedAt).toBe(1.25);
    const band = created.filterNodes[0]!;
    expect(src.connections).toEqual([band]);
    expect(band.type).toBe("bandpass");
    expect(band.frequency.value).toBe(1500);
    expect(band.Q.value).toBe(1.2);
    const pulse = created.gains.find((g) => band.connections.includes(g))!;
    expect(pulse.gain.value).toBe(0.5);
    const wing = created.oscillatorNodes[0]!;
    expect(wing.frequency.value).toBe(36);
    expect(wing.startedAt).toBe(1);
    expect(wing.stoppedAt).toBe(1.25);
    const depth = created.gains.find((g) => wing.connections.includes(g))!;
    expect(depth.gain.value).toBe(0.5);
    expect(depth.connections).toEqual([pulse.gain]);
    const envelope = created.gains.find((g) => pulse.connections.includes(g))!;
    expect(voice.output).toBe(envelope);
    expect(envelope.gain.ramps.map((r) => [r.kind, r.value])).toEqual([["set", 0], ["linear", 0.5], ["linear", 0]]);
    expect(envelope.gain.ramps.map((r) => r.time.toFixed(6))).toEqual(["1.000000", "1.020000", "1.250000"]);

    // A chase's clatter on the same context: louder, longer, and the same noise.
    const loud = rustleVoice(ctx, 36, true, () => 0.5);
    expect(created.buffers.length).toBe(1);
    const loudSrc = created.sources[1]!;
    expect(loudSrc.buffer).toBe(noise);
    expect(loudSrc.offset).toBeCloseTo(0.3, 10);
    expect(loudSrc.stoppedAt).toBeCloseTo(1.4, 10);
    const loudEnvelope = loud.output as unknown as (typeof created.gains)[number];
    expect(loudEnvelope.gain.ramps.map((r) => r.value)).toEqual([0, 1, 0]);

    // Another context makes its own.
    const other = fakeCtx();
    rustleVoice(other.ctx, 30, false, () => 0.5);
    expect(other.created.buffers.length).toBe(1);
    expect(created.buffers.length).toBe(1);

    voice.stop();
    expect(src.stopped && src.disconnected && wing.disconnected && envelope.disconnected).toBe(true);
  });

  it("frogCallVoice: two pulsed notes, the second higher, 0.35 s in all, ending itself", () => {
    const { ctx, created, clock } = fakeCtx();
    clock.currentTime = 2;
    const voice = frogCallVoice(ctx, 2200, () => 0.5);
    const notes = created.oscillatorNodes.filter((o) => o.frequency.value > 1000);
    const pulse = created.oscillatorNodes.find((o) => o.frequency.value < 1000)!;
    expect(created.oscillatorNodes.length).toBe(3);
    expect(notes.map((o) => o.frequency.value.toFixed(3))).toEqual(["2200.000", "2420.000"]);
    expect(notes.map((o) => [o.startedAt!.toFixed(6), o.stoppedAt!.toFixed(6)]))
      .toEqual([["2.000000", "2.110000"], ["2.190000", "2.350000"]]);
    expect(pulse.frequency.value).toBe(100);
    expect(pulse.startedAt).toBe(2);
    expect(pulse.stoppedAt).toBeCloseTo(2.35, 10);
    const pulsed = voice.output as unknown as (typeof created.gains)[number];
    expect(pulsed.gain.value).toBe(0.5);
    const depth = created.gains.find((g) => pulse.connections.includes(g))!;
    expect(depth.gain.value).toBe(0.5);
    expect(depth.connections).toEqual([pulsed.gain]);
    for (const note of notes) {
      const envelope = created.gains.find((g) => note.connections.includes(g))!;
      expect(envelope.connections).toEqual([pulsed]);
      expect(envelope.gain.ramps.map((r) => [r.kind, r.value]))
        .toEqual([["set", 0], ["linear", 1], ["exponential", 0.001]]);
    }
    const second = created.gains.find((g) => notes[1]!.connections.includes(g))!;
    expect(second.gain.ramps.map((r) => r.time.toFixed(6))).toEqual(["2.190000", "2.200000", "2.350000"]);
    voice.stop();
    expect(created.oscillatorNodes.every((o) => o.stopped && o.disconnected)).toBe(true);
  });
});

describe("the stare", () => {
  const lens = (level: number, beats: number) => ({ ...STARE_LENS_REST, level, beats, period: 0.8 });

  it("is inert before unlock, and at rest leaves the world open and builds no voice", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx, () => 0.5);
    audio.setStare(lens(1, 3)); // pre-unlock: inert, not a throw
    audio.unlock();
    const sources = created.sources.length;
    audio.setStare(STARE_LENS_REST);
    const muffle = created.filterNodes[2]!;
    expect(muffle.frequency.targets.at(-1)!.value).toBe(MUFFLE_OPEN_HZ);
    expect(created.gains[1]!.gain.targets.at(-1)!.value).toBe(1);
    expect(created.sources.length).toBe(sources);
    expect(created.oscillators).toBe(0);
    expect(created.panners.length).toBe(0);
    audio.dispose();
  });

  it("muffles and quiets the world under a full stare, and the stare's own buses are left alone", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx, () => 0.5);
    audio.unlock();
    audio.setStare(lens(1, 0));
    expect(created.filterNodes[2]!.frequency.targets.at(-1)!.value).toBeCloseTo(MUFFLE_SHUT_HZ, 6);
    expect(created.gains[1]!.gain.targets.at(-1)!.value).toBeCloseTo(MUFFLE_GAIN, 12);
    expect(created.gains[8]!.gain.targets.at(-1)!.value).toBeCloseTo(WHISPER_LEVEL, 12);
    audio.dispose();
  });

  it("plays a beat's two sounds each time the lens begins one, and none for the beats before it first heard", () => {
    const { ctx, created, clock } = fakeCtx();
    const audio = createAmbientAudio(() => ctx, () => 0.5);
    audio.unlock();
    clock.currentTime = 4;
    audio.setStare(lens(1, 7));
    expect(created.oscillators).toBe(0);
    audio.setStare(lens(1, 7));
    expect(created.oscillators).toBe(0);
    audio.setStare(lens(1, 8));
    // Two sounds, each a tone and its octave.
    expect(created.oscillators).toBe(4);
    expect(created.oscillatorNodes.map((o) => o.startedAt)).toEqual([4, 4, 4 + HEART_DUB_AT * 0.8, 4 + HEART_DUB_AT * 0.8]);
    for (const o of created.oscillatorNodes) expect(o.stoppedAt).toBeGreaterThan(o.startedAt!);
    // The first sound swells to the heart's level, and every one ends near silence.
    const sounds = created.gains.filter((g) => g.connections.includes(created.gains[7]));
    expect(sounds.length).toBe(4);
    const first = sounds[0]!;
    expect(first.gain.ramps.map((r) => r.kind)).toEqual(["set", "linear", "exponential"]);
    expect(first.gain.ramps[1]!.value).toBeCloseTo(HEART_LEVEL, 12);
    expect(first.connections).toEqual([created.gains[7]]);
    // A beat at rest is not heard.
    audio.setStare(lens(0, 9));
    expect(created.oscillators).toBe(4);
    audio.dispose();
  });

  it("builds the whispers' voices on the first stare deep enough, circles them round the listener, and schedules syllables within the look-ahead", () => {
    const { ctx, created, clock } = fakeCtx();
    const audio = createAmbientAudio(() => ctx, () => 0.5);
    audio.unlock();
    audio.setListener(10, 2, -30, 0, 0, -1, 0, 1, 0);
    const sources = created.sources.length;
    audio.setStare(lens(0.05, 0));
    expect(created.panners.length).toBe(0);
    clock.currentTime = 2;
    audio.setStare(lens(0.9, 0));
    expect(created.sources.length).toBe(sources + WHISPER_VOICES);
    expect(created.panners.length).toBe(WHISPER_VOICES);
    for (const p of created.panners) {
      expect(p.panningModel).toBe("HRTF");
      expect(p.rolloffFactor).toBe(0);
      const d = Math.hypot(p.positionX.value - 10, p.positionZ.value + 30);
      expect(d).toBeGreaterThan(0.4);
      expect(d).toBeLessThan(0.95);
      expect(Math.abs(p.positionY.value - 2)).toBeLessThan(0.3);
      expect(p.connections).toEqual([created.gains[8]]);
    }
    // A minute of frames: every syllable's envelope opens from nothing and
    // shuts to nothing, in time order, never further ahead than the look-ahead.
    for (let f = 0; f < 3600; f++) {
      clock.currentTime = 2 + f / 60;
      audio.setStare(lens(0.9, 0));
    }
    const voiceGains = created.gains.slice(9).filter((g) => g.gain.ramps.length > 0);
    expect(voiceGains.length).toBeGreaterThanOrEqual(WHISPER_VOICES);
    let syllables = 0;
    for (const g of voiceGains) {
      let last = -Infinity;
      for (const r of g.gain.ramps) {
        expect(r.time).toBeGreaterThanOrEqual(last);
        expect(r.time).toBeLessThanOrEqual(62 + 1);
        last = r.time;
        if (r.kind === "set") { expect(r.value).toBe(0); syllables++; }
      }
      expect(g.gain.ramps.at(-1)!.value).toBe(0);
    }
    expect(syllables).toBeGreaterThan(100);
    // The stare lets go: a second on, nothing more is scheduled.
    const ramps = () => voiceGains.reduce((n, g) => n + g.gain.ramps.length, 0);
    for (let f = 0; f < 120; f++) {
      clock.currentTime = 62 + f / 60;
      audio.setStare(STARE_LENS_REST);
    }
    const settled = ramps();
    for (let f = 0; f < 300; f++) {
      clock.currentTime = 64 + f / 60;
      audio.setStare(STARE_LENS_REST);
    }
    expect(ramps()).toBe(settled);
    expect(created.gains[8]!.gain.targets.at(-1)!.value).toBe(0);
    audio.dispose();
  });
});

describe("the hush", () => {
  it("cuts the world's bus within a breath, on top of what a stare takes, and leaves the stare's own buses alone", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx, () => 0.5);
    audio.setHush(1); // pre-unlock: inert, not a throw
    audio.unlock();
    const world = created.gains[1]!;
    audio.setHush(1);
    expect(world.gain.targets.at(-1)).toEqual({ value: 0, time: 0, tc: HUSH_RAMP_S });
    audio.setHush(0);
    expect(world.gain.targets.at(-1)!.value).toBe(1);
    audio.setStare({ ...STARE_LENS_REST, level: 1 });
    audio.setHush(0.5);
    expect(world.gain.targets.at(-1)!.value).toBeCloseTo(MUFFLE_GAIN * 0.5, 12);
    // The heart's bus and the whispers' are not the world's.
    expect(created.gains[7]!.connections).toEqual([created.gains[0]]);
    expect(created.gains[8]!.connections).toEqual([created.gains[0]]);
    audio.dispose();
  });
});

describe("the birdsong bed", () => {
  const BED = { duration: 46 } as unknown as AudioBuffer;

  it("is silent and unscheduled until the bed is in, then loops two passes half a bed apart, one to each ear", () => {
    const { ctx, created, clock } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.setBirdBed(BED); // pre-unlock: inert, not a throw
    audio.unlock();
    const birds = created.gains[6]!;
    expect(birds.gain.value).toBe(0);
    const beds = created.sources.length;
    audio.setBirds(1);
    expect(created.sources.length).toBe(beds);
    expect(birds.gain.targets.at(-1)).toEqual({ value: BIRD_LEVEL, time: 0, tc: BIRD_GAIN_RAMP_S });

    clock.currentTime = 10;
    audio.setBirdBed(BED);
    audio.setBirdBed(BED); // a second hand-over changes nothing
    const first = created.sources.slice(beds);
    expect(first.length).toBe(2);
    expect(first.map((s) => [s.startedAt, s.offset])).toEqual([[10, 0], [10, 23]]);
    expect(created.stereo.map((p) => p.pan.value)).toEqual([-BIRD_PAN, BIRD_PAN]);
    for (const [i, s] of first.entries()) {
      expect(s.loop).toBe(false);
      expect(s.connections).toEqual([created.stereo[i]]);
      expect(created.stereo[i]!.connections).toEqual([birds]);
    }

    // Two minutes of frames: each ear's next pass starts BIRD_OVERLAP_S before
    // the one before it ends, scheduled no more than the look-ahead early.
    for (let f = 0; f <= 120 * 60; f++) {
      clock.currentTime = 10 + f / 60;
      audio.setBirds(1);
    }
    const starts = (ear: number) => created.sources.slice(beds).filter((s) => s.connections[0] === created.stereo[ear]).map((s) => s.startedAt);
    const pass = 46 - BIRD_OVERLAP_S;
    expect(starts(0)).toEqual([10, 10 + pass, 10 + 2 * pass]);
    expect(starts(1)).toEqual([10, 10 + 23 - BIRD_OVERLAP_S, 10 + 23 - BIRD_OVERLAP_S + pass, 10 + 23 - BIRD_OVERLAP_S + 2 * pass]);
    audio.dispose();
  });

  it("follows the level it is handed, clamped, and a hush is a gain of none", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.unlock();
    const birds = created.gains[6]!;
    audio.setBirds(0.5);
    expect(birds.gain.targets.at(-1)!.value).toBe(BIRD_LEVEL * 0.5);
    audio.setBirds(0);
    expect(birds.gain.targets.at(-1)!.value).toBe(0);
    audio.setBirds(7);
    expect(birds.gain.targets.at(-1)!.value).toBe(BIRD_LEVEL);
    audio.dispose();
  });
});

describe("the Hollow's call", () => {
  it("plays the recording an octave down and a fourth under that, from a direction, through a low-pass, into the world's bus", () => {
    const { ctx, created, clock } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    const clip = { duration: 1.9 } as unknown as AudioBuffer;
    audio.hollowCall(clip, 1, 0, 0, 1, 2000); // pre-unlock: inert, not a throw
    audio.unlock();
    audio.setListener(5, 2, -7, 0, 0, -1, 0, 1, 0);
    clock.currentTime = 3;
    const sources = created.sources.length;
    const gains = created.gains.length;
    audio.hollowCall(clip, 0, 30, -40, 0.5, 2000);
    const voices = created.sources.slice(sources);
    expect(voices.map((s) => s.playbackRate.value)).toEqual(HOLLOW_CALL_VOICES.map((v) => v.rate));
    expect(voices.map((s) => s.startedAt)).toEqual(HOLLOW_CALL_VOICES.map((v) => 3 + v.after));
    const voiceGains = created.gains.slice(gains);
    expect(voiceGains.map((g) => g.gain.value)).toEqual(HOLLOW_CALL_VOICES.map((v) => HOLLOW_CALL_LEVEL * 0.5 * v.share));
    const filter = created.filterNodes.at(-1)!;
    expect(filter.type).toBe("lowpass");
    expect(filter.frequency.value).toBe(2000);
    for (const g of voiceGains) expect(g.connections).toEqual([filter]);
    // Placed by direction alone, HOLLOW_CALL_STANDOFF_M from the ear: (0, 3, -4) / 5.
    const panner = created.panners.at(-1)!;
    expect(filter.connections).toEqual([panner]);
    expect(panner.rolloffFactor).toBe(0);
    expect(panner.positionX.value).toBeCloseTo(5, 12);
    expect(panner.positionY.value).toBeCloseTo(2 + 0.6 * HOLLOW_CALL_STANDOFF_M, 12);
    expect(panner.positionZ.value).toBeCloseTo(-7 - 0.8 * HOLLOW_CALL_STANDOFF_M, 12);
    expect(panner.connections).toEqual([created.gains[1]]);
    // No direction, or no level: nothing is made.
    audio.hollowCall(clip, 0, 0, 0, 1, 2000);
    audio.hollowCall(clip, 1, 0, 0, 0, 2000);
    expect(created.sources.length).toBe(sources + HOLLOW_CALL_VOICES.length);
    audio.dispose();
  });
});
