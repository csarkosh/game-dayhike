/**
 * The smallest AudioContext fake that can carry the ambient graph and the
 * car's. Every node records its connections and whether it was disconnected;
 * every AudioParam records setTargetAtTime calls, the value-at and ramp-to
 * calls in order (the drips', the voices' and the car's envelopes, and the
 * fades), and the times its schedule was cancelled from.
 */
export type FakeParam = {
  value: number;
  targets: { value: number; time: number; tc: number }[];
  ramps: { kind: "set" | "linear" | "exponential"; value: number; time: number }[];
  cancels: number[];
};
export function param(value = 0): FakeParam {
  const p: FakeParam = { value, targets: [], ramps: [], cancels: [] };
  const methods = p as unknown as Record<string, unknown>;
  methods.setTargetAtTime = (v: number, time: number, tc: number) => p.targets.push({ value: v, time, tc });
  methods.setValueAtTime = (v: number, time: number) => p.ramps.push({ kind: "set", value: v, time });
  methods.linearRampToValueAtTime = (v: number, time: number) => p.ramps.push({ kind: "linear", value: v, time });
  methods.exponentialRampToValueAtTime = (v: number, time: number) =>
    p.ramps.push({ kind: "exponential", value: v, time });
  methods.cancelScheduledValues = (time: number) => p.cancels.push(time);
  return p;
}
export function fakeCtx() {
  const created = {
    gains: [] as ReturnType<typeof gainNode>[],
    panners: [] as ReturnType<typeof pannerNode>[],
    stereo: [] as { pan: FakeParam; connections: unknown[] }[],
    sources: [] as ReturnType<typeof sourceNode>[],
    filterNodes: [] as ReturnType<typeof filterNode>[],
    oscillatorNodes: [] as ReturnType<typeof oscillatorNode>[],
    constants: [] as ReturnType<typeof constantNode>[],
    compressors: [] as ReturnType<typeof compressorNode>[],
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
  /** Web Audio's own defaults, so a value left unset shows. */
  function compressorNode() {
    return { ...node(), threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) };
  }
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
  /** A constant source: its offset, Web Audio's default 1, and its start and stop. */
  function constantNode() {
    return {
      ...node(),
      offset: param(1), started: false, stopped: false,
      start() { this.started = true; },
      stop() { this.stopped = true; },
    };
  }
  /** One array a channel, kept: a reversed recording is written into it and read back. */
  function bufferOf(ch: number, len: number, rate: number) {
    const channels = Array.from({ length: ch }, () => new Float32Array(len));
    return { getChannelData: (c: number) => channels[c] as Float32Array, length: len, sampleRate: rate, numberOfChannels: ch, duration: len / rate };
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
    createConstantSource() { const c = constantNode(); created.constants.push(c); return c; },
    createBufferSource() { const s = sourceNode(); created.sources.push(s); return s; },
    createPanner() { const p = pannerNode(); created.panners.push(p); return p; },
    createStereoPanner() { const p = { ...node(), pan: param(0) }; created.stereo.push(p); return p; },
    createBiquadFilter() { created.filters++; const f = filterNode(); created.filterNodes.push(f); return f; },
    createDynamicsCompressor() { const c = compressorNode(); created.compressors.push(c); return c; },
    createBuffer(ch: number, len: number, rate: number) {
      const b = bufferOf(ch, len, rate);
      created.buffers.push(b);
      return b;
    },
    decodeAudioData(bytes: ArrayBuffer) { return Promise.resolve({ token: bytes } as unknown as AudioBuffer); },
    close() {},
  };
  return { ctx: ctx as unknown as AudioContext, created, listener, clock: ctx };
}
