import { describe, it, expect } from "vitest";
import {
  AIR_LEVEL, createAmbientAudio, DEFAULT_VOLUME, RAIN_LEVEL, WILDLIFE_LEVEL, WIND_LEVEL,
} from "../../src/game/ambientAudio.js";
import { ambientGainsUnder, WEATHER_PRESETS } from "../../src/game/weather.js";

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
    oscillators: 0,
    filters: 0,
  };
  function node() {
    return { connections: [] as unknown[], connect(t: unknown) { this.connections.push(t); }, start() {} };
  }
  function gainNode() { return { ...node(), gain: param(1) }; }
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
    createBiquadFilter() { created.filters++; return { ...node(), frequency: param(350), Q: param(1), type: "lowpass" }; },
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
    // 2 noise sources (rain, wind), 3 oscillators (LFO + two detuned sines),
    // 3 filters, and gains: master + rain + wind + air + LFO depth + wildlife = 6.
    expect(created.sources.length).toBe(2);
    expect(created.oscillators).toBe(3);
    expect(created.filters).toBe(3);
    expect(created.gains.length).toBe(6);
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
    expect(targets).toContain(gains.wind * WIND_LEVEL);
    expect(targets).toContain(gains.air * AIR_LEVEL);
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

  it("defaults: pending weather is the mist preset, volume 0.5", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.unlock();
    expect(created.gains[0]?.gain.value).toBe(DEFAULT_VOLUME);
    const gains = ambientGainsUnder(WEATHER_PRESETS.mist);
    const targets = created.gains.flatMap((g) => g.gain.targets.map((t) => t.value));
    expect(targets).toContain(gains.wind * WIND_LEVEL);
    audio.dispose();
  });

  it("wires the master gain to destination and every layer gain to the master", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.unlock();

    const master = created.gains[0];
    expect(master?.connections).toContain(ctx.destination);

    // The LFO depth gain feeds an AudioParam (recognizable because params,
    // unlike nodes, carry a `targets` array) rather than another node; every
    // other non-master gain is a layer gain (rain/wind/air/wildlife) and must
    // reach the master gain directly.
    const isParam = (t: unknown): boolean =>
      Array.isArray((t as { targets?: unknown[] }).targets);
    const others = created.gains.slice(1);
    const depthGain = others.find((g) => g.connections.some(isParam));
    const layerGains = others.filter((g) => g !== depthGain);

    expect(depthGain).toBeDefined();
    expect(layerGains.length).toBe(4);
    for (const g of layerGains) {
      expect(g.connections).toContain(master);
    }

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
