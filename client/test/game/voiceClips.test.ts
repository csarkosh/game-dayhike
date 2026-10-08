import { describe, it, expect } from "vitest";
import { createVoiceClips, voiceClipId, VOICE_CLIP_LEVEL } from "../../src/game/voiceClips.js";
import type { AmbientAudio } from "../../src/game/ambientAudio.js";

function fakeAmbient() {
  const spoken: { buffer: AudioBuffer; level: number }[] = [];
  const decoded: ArrayBuffer[] = [];
  const ambient = {
    decode: async (bytes: ArrayBuffer) => { decoded.push(bytes); return { length: bytes.byteLength } as unknown as AudioBuffer; },
    speak: (buffer: AudioBuffer, level: number) => { spoken.push({ buffer, level }); },
  } as unknown as AmbientAudio;
  return { ambient, spoken, decoded };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the inner voice's clips", () => {
  it("names a clip by its scenario and 1-based index", () => {
    expect(voiceClipId({ scenario: "cryFirst", index: 0 })).toBe("voice.cryFirst.1");
    expect(voiceClipId({ scenario: "safe", index: 2 })).toBe("voice.safe.3");
  });

  it("fetches a line's clip once, plays it on the voice bus at its level each time the line is said, and a missing clip is silent and not asked for again", async () => {
    const { ambient, spoken, decoded } = fakeAmbient();
    const fetched: string[] = [];
    const clips = createVoiceClips(ambient, async (id) => { fetched.push(id); return id === "voice.safe.3" ? null : new ArrayBuffer(8); });
    const line = { text: "What was that?!", scenario: "cryFirst" as const, index: 0 };
    clips.speak(line);
    clips.speak(line);
    await tick(); await tick();
    expect(fetched).toEqual(["voice.cryFirst.1"]);
    expect(decoded).toHaveLength(1);
    expect(spoken).toHaveLength(2);
    expect(spoken[0]!.level).toBe(VOICE_CLIP_LEVEL);
    expect(clips.asked).toBe(1);
    expect(clips.had).toBe(1);
    const missing = { text: "In. Lock it. Go.", scenario: "safe" as const, index: 2 };
    clips.speak(missing);
    clips.speak(missing);
    await tick(); await tick();
    expect(fetched).toEqual(["voice.cryFirst.1", "voice.safe.3"]);
    expect(spoken).toHaveLength(2);
    expect(clips.asked).toBe(2);
    expect(clips.had).toBe(1);
    clips.dispose();
  });
});
