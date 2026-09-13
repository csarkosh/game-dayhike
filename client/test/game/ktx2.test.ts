import { describe, expect, it } from "vitest";

import { KTX2_DECODER_BASE_URL } from "../../src/game/ktx2.js";
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2.js";

describe("ktx2 transcoder config", () => {
  it("points every configured URL at the vendored local directory", () => {
    expect(KTX2_DECODER_BASE_URL).toBe("/libs/ktx2");
    const config = KhronosTextureContainer2.URLConfig;
    // Pin the field count so the loop below can't pass vacuously if URLConfig
    // ends up empty or a field gets dropped — 9 wasm transcoders/decoders plus
    // jsDecoderModule (see the field-by-field mapping comment in ktx2.ts).
    expect(Object.keys(config)).toHaveLength(10);
    // Every field must be an explicit local URL — none may be left null,
    // since a null field silently falls back to Babylon's CDN default at
    // decode time (see ktx2.ts for the field-by-field rationale).
    for (const [key, value] of Object.entries(config)) {
      expect(value, key).toContain("/libs/ktx2/");
    }
    expect(config.jsDecoderModule).toContain("/libs/ktx2/");
  });
});
