/**
 * The inner voice's clips (docs/gameplay/2026-10-07-the-inner-voice.md §6):
 * each line of innerLines.ts is a clip, `audio/voice.<scenario>.<n>.mp3`,
 * n from 1 in the pool's order, fetched the first time its line is said and
 * kept decoded; played on the ambient's voice bus, on the master, so the
 * stare's muffle and the world's level never touch the ranger's own head.
 * A clip that is not there (not yet made, or a line with no recording) is
 * silent and not asked for again: the subtitle stands on its own.
 */
import type { AmbientAudio } from "./ambientAudio.js";
import { audioUrl } from "./assetUrls.js";
import type { VoiceLine } from "./innerVoice.js";

/** The clips' level on the voice bus. */
export const VOICE_CLIP_LEVEL = 0.9;

/** The clip's id for a line: the scenario and its 1-based index in the pool. */
export function voiceClipId(line: { scenario: string; index: number }): string {
  return `voice.${line.scenario}.${line.index + 1}`;
}

export type VoiceClips = {
  /** Says the line: fetches its clip once, and plays it when it has it. */
  speak(line: VoiceLine): void;
  /** The line cut, playing or still on its way: a scene has the frame. */
  cut(): void;
  /** How many clips were asked for, and how many came: for tests. */
  readonly asked: number;
  readonly had: number;
  dispose(): void;
};

/** `fetchBytes` fetches a clip's bytes by its id, or null when there is no such clip; the default fetches `audio/<id>.mp3`. */
export function createVoiceClips(ambient: AmbientAudio, fetchBytes?: (id: string) => Promise<ArrayBuffer | null>): VoiceClips {
  const fetchClip = fetchBytes ?? (async (id: string): Promise<ArrayBuffer | null> => {
    const response = await fetch(audioUrl(`audio/${id}.mp3`));
    return response.ok ? response.arrayBuffer() : null;
  });
  const clips = new Map<string, Promise<AudioBuffer | null>>();
  let asked = 0, had = 0, disposed = false;
  /** Bumped by a cut: a clip that arrives from before it is not spoken. */
  let generation = 0;
  return {
    speak(line) {
      const id = voiceClipId(line);
      let pending = clips.get(id);
      if (pending === undefined) {
        asked++;
        pending = fetchClip(id)
          .then((bytes) => (bytes === null ? null : ambient.decode(bytes)))
          .then((buffer) => { if (buffer !== null) had++; return buffer; })
          .catch(() => null);
        clips.set(id, pending);
      }
      const spokenIn = generation;
      void pending.then((buffer) => {
        if (buffer !== null && !disposed && spokenIn === generation) ambient.speak(buffer, VOICE_CLIP_LEVEL);
      });
    },
    cut() {
      generation++;
      ambient.cutSpeech();
    },
    get asked() { return asked; },
    get had() { return had; },
    dispose() {
      disposed = true;
      clips.clear();
    },
  };
}
