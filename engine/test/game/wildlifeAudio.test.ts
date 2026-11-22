import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

describe("app.ts wiring", () => {
  // `app.ts` builds a WebRTC session and a WebGPU renderer, so nothing here can
  // run it — this reads the source for the wiring, the `lite/renderer.test.ts`
  // precedent, because the wiring exists nowhere else. The failure it guards is
  // the silent one: a shell that is constructed and never fed plays nothing,
  // and the game looks exactly as it does with it fed.
  const src = sourceText("app.ts");

  it("feeds the shell after renderer.sync, in the one frame the host and a follower run", () => {
    // The host and a follower run one frame (`frame`, appFrame.test.ts), so each step is written once.
    const calls = [...src.matchAll(/renderer\.sync\([^)]*\);\n\s*playWildlifeAudio\(\);/g)];
    expect(calls).toHaveLength(1);
    expect(src.match(/playWildlifeAudio\(\);/g)).toHaveLength(1);
  });

  it("takes the listener and the events from the renderer, and the gain from the weather: the engine's half", () => {
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
