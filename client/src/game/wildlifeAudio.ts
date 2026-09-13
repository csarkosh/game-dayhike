/**
 * The wildlife calls, spatialized on the ambient AudioContext.
 *
 * This shell owns three things and nothing else: which recording each call kind
 * plays, how far that recording carries, and the mirror between Babylon's world
 * and Web Audio's. The schedule — WHEN an animal calls — is `wildlifeBehaviour`'s
 * (seeded, so every peer hears the same call on the same tick), and the mixing
 * graph is `ambientAudio`'s. What arrives here is a flat list of `call` events
 * that already happened.
 *
 * Fetch is eager, decode is LAZY, and the split is the whole point. This shell is
 * built when the game starts, but browsers do not give a page an AudioContext
 * until a user gesture, and the gesture here is the first pointerdown — seconds
 * later. Six small mp3s off an immutable URL land long before that, so decoding
 * them at construction would hand every one of them to a context that does not
 * exist yet, get null back, and leave the game permanently silent with nothing
 * to show for it. The bytes are therefore kept and decoded when `ambientAudio`
 * says the context is ready.
 *
 * Nothing here throws. A recording that has not shipped yet
 * never enters `buffers`, and its
 * species is silent — the game plays exactly as it does today, with the animals
 * visible and mute, and gains its voice one clip at a time. It does WARN, once
 * per clip: silence is also the correct behaviour today, so without a breadcrumb
 * a clip that fails to load is indistinguishable from one that has not shipped.
 */

import type { AmbientAudio, ListenerPose } from "./ambientAudio.js";
import { audioUrl } from "./assetUrls.js";
import type { Presence, WildlifeEvent } from "./wildlifeBehaviour.js";

/**
 * `CALL_*` (wildlifeBehaviour.ts) → the catalog's `audio` id that voices it.
 * Indexed by the call constant, so this array's ORDER matters, not its
 * contents; `wildlifeAudio.test.ts` pins its length to `CALL_COUNT` so a new
 * call kind cannot be added without a clip to play for it.
 */
export const CALL_CLIP: readonly string[] = [
  "call.raven_croak",
  "call.gull_cry",
  "call.elk_bugle",
  "call.elk_bark",
  "call.squirrel_chatter",
  "call.eagle_cry",
];

/**
 * `[refDistance, maxDistance]` per call, in metres. 10/300 is the
 * default — a bugle or a raven croak is a landscape-scale sound and should be
 * heard across the valley. The squirrel is the exception at 6/60: chatter is a
 * close, personal noise, and giving it the same 300 m reach would put a
 * squirrel you cannot see in every direction at once.
 */
export const CALL_RANGE: readonly (readonly [number, number])[] = [
  [10, 300], // raven croak
  [10, 300], // gull cry
  [10, 300], // elk bugle
  [10, 300], // elk alarm bark
  [6, 60],   // squirrel chatter
  [10, 300], // eagle cry
];

export type WildlifeAudio = {
  /**
   * Resolves once every clip has been fetched — and decoded, if the context was
   * already unlocked by then. A clip fetched before unlock stays as bytes and is
   * decoded when `ambient.onUnlock` fires, so `ready` is "the network is done",
   * not "the calls are audible".
   */
  readonly ready: Promise<void>;
  /** Plays this frame's calls, minus the ones the listener cannot hear —
   * silenced by weather, or further away than the call kind's `maxDistance`.
   * Events of any other kind are ignored. */
  play(events: readonly WildlifeEvent[], presence: Presence): void;
  setListener(l: ListenerPose): void;
  dispose(): void;
};

export type WildlifeAudioOptions = {
  /** Injected by the tests; production fetches the hashed URL Vite serves. */
  fetchClip?: (id: string) => Promise<ArrayBuffer>;
};

/** One line per clip that will never play, at most once each. */
function warnClip(id: string, reason: string): void {
  // Unconditional, not gated on a dev flag: nothing else in client/src logs, so
  // there is no convention to follow, and a call whose recording fails to load
  // in production is a content bug whoever notices it needs to be able to see.
  console.warn(`wildlife call "${id}" will not play: ${reason}`);
}

/**
 * `seed` is taken for the same reason every other wildlife shell takes it — the
 * per-clip variation the call table implies (pitch and gain jitter so a
 * repeated recording does not read as a loop) is seeded, not random, so peers
 * hear the same thing. Nothing varies yet; the parameter is here so adding that
 * does not change this signature or its two call sites.
 */
export function createWildlifeAudio(
  ambient: Pick<AmbientAudio, "decode" | "emitter" | "setListener" | "onUnlock">,
  seed: number,
  options: WildlifeAudioOptions = {},
): WildlifeAudio {
  void seed;
  /** Fetched but not yet decoded. Emptied into `buffers` as decoding succeeds. */
  const bytes = new Map<string, ArrayBuffer>();
  const buffers = new Map<string, AudioBuffer>();
  let decoding: Promise<void> | null = null;
  let disposed = false;
  /** Whether the context exists, which is what tells a null decode apart from a
   * bad one: see `decodePending`. */
  let unlocked = false;
  /** The last listener position, in Babylon's frame, or null until the shell has
   * placed one. What the distance gate in `play` measures against. */
  let listenerX = 0, listenerY = 0, listenerZ = 0, listenerSet = false;

  const fetchClip = options.fetchClip ?? (async (id: string) => {
    const response = await fetch(audioUrl(`audio/${id}.mp3`));
    // Without this the body of a 404 — an HTML error page, on most hosts — goes
    // to `decodeAudioData`, which rejects with a message about the audio data
    // rather than about the missing file.
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  });

  /**
   * Decodes everything still held as bytes, at most one batch at a time.
   * Returns the batch so `ready` and the tests can wait on it.
   *
   * A null decode means two different things and is treated as two: before
   * unlock it means "no context yet", so the clip keeps its bytes and is retried
   * — dropping it for that is the failure this whole split exists to avoid —
   * and after unlock it means the browser refused the recording, so the clip is
   * dropped and warned about once. The two triggers together cover both
   * orderings: the fetch finishing after unlock, and unlock after the fetch.
   *
   * And a batch DRAINS: on settling it starts another pass if any clip is still
   * holding bytes. Without that, bytes that land while a batch is in flight are
   * stranded forever — the first pointerdown starts a real
   * `decodeAudioData` on the one clip that has landed, the other five land
   * milliseconds later, `ready`'s trigger finds `decoding !== null` and returns
   * that batch, and nothing ever calls this again. A cold cache on a slow
   * connection is exactly that ordering, and the failure is silent and
   * permanent for the session. The drain is bounded because every clip in a
   * post-unlock batch leaves `bytes` — decoded into `buffers`, or dropped and
   * warned — and the fetches that can add to it are the six fired at
   * construction.
   */
  function decodePending(): Promise<void> {
    if (decoding !== null) return decoding;
    if (bytes.size === 0 || disposed) return Promise.resolve();
    const batch = [...bytes].map(async ([id, raw]) => {
      const decoded = await ambient.decode(raw);
      // `dispose` may have run while this was in flight; without the check the
      // torn-down session keeps six decoded buffers alive until it settles.
      if (disposed) return;
      if (decoded === null) {
        if (unlocked) {
          bytes.delete(id);
          warnClip(id, "the browser could not decode it");
        }
        return;
      }
      buffers.set(id, decoded);
      bytes.delete(id);
    });
    decoding = Promise.all(batch).then((): void | Promise<void> => {
      decoding = null;
      // `unlocked` is what makes this terminate: before the context exists a
      // null decode KEEPS its bytes on purpose, so looping then would spin.
      if (unlocked && !disposed && bytes.size > 0) return decodePending();
    });
    return decoding;
  }

  // Every clip at once, at construction: six small mp3s, and a call that fires
  // before its buffer has arrived is one missed croak rather than a stall.
  // `audioUrl` throws for a clip that has not shipped yet, which is the normal
  // state until every recording lands — hence the catch around the fetch.
  const ready = Promise.all(
    CALL_CLIP.map(async (id) => {
      try {
        bytes.set(id, await fetchClip(id));
      } catch (e) {
        warnClip(id, e instanceof Error ? e.message : String(e));
      }
    }),
  ).then(() => decodePending());

  // The other trigger. Fires immediately when the context already exists, so a
  // shell built after unlock decodes at once rather than waiting for a gesture
  // that has already happened.
  ambient.onUnlock(() => {
    unlocked = true;
    void decodePending();
  });

  return {
    ready,
    play(events, presence) {
      for (const e of events) {
        if (e.kind !== "call") continue;
        // Weather, per species: under dread every species but the
        // ravens is at 0, and skipping here — rather than emitting at gain 0 —
        // is what keeps a silenced chorus from costing a node graph per call.
        const gain = presence.callGain[e.species] ?? 0;
        if (gain <= 0) continue;
        const buffer = buffers.get(CALL_CLIP[e.call]!);
        if (buffer === undefined) continue;
        const [ref, max] = CALL_RANGE[e.call]!;
        // Out of earshot, skipped for the same reason as gain 0 above: the
        // `inverse` distance model FLOORS at maxDistance rather than reaching
        // zero — refDistance/maxDistance = 10/300 is a gain of 0.033, about
        // −30 dB — so a call from a kilometre away plays at exactly the same
        // quiet-but-present level as one at 300 m, and costs a buffer source, a
        // panner and a gain node to do it. The collect disc is 400 m and the
        // schedule is PER UNIT, so the meadow measured 77 calls a minute in the
        // browser (26 at a roost), roughly two-thirds past their own max.
        // Measured in 3D: an eagle circles up to 250 m overhead, and its
        // horizontal distance says nothing about whether it can be heard.
        if (listenerSet && Math.hypot(e.x - listenerX, e.y - listenerY, e.z - listenerZ) > max) continue;
        // z negated: Babylon's world is left-handed, Web Audio's is right-handed
        // (see `ListenerPose`). Mirroring z on every position and every
        // direction vector — here and in `setListener` below, and nowhere else —
        // maps one to the other, so a call to the player's left pans left.
        // Emitted and forgotten: a call is a one-shot of at most three seconds
        // that ends on its own, and the animal that made it moves less than the
        // panner's resolution in that time.
        ambient.emitter(buffer, e.x, e.y, -e.z, gain, ref, max);
      }
    },
    setListener(l) {
      // Kept UNMIRRORED: the gate below compares against event positions, which
      // arrive in Babylon's frame. Only what crosses into Web Audio is mirrored.
      listenerX = l.x; listenerY = l.y; listenerZ = l.z; listenerSet = true;
      ambient.setListener(l.x, l.y, -l.z, l.fx, l.fy, -l.fz, l.ux, l.uy, -l.uz);
    },
    dispose() {
      disposed = true;
      buffers.clear();
      bytes.clear();
    },
  };
}
