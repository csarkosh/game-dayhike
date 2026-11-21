import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import "../../../src/sim/passes/index.js";
import environmentBrdf from "../../../../engine/src/game/lite/environmentBrdf.png?inline";
import { SKY_CAPTURE_BYTES, SKY_CAPTURE_WGSL, faceValues, skyCaptureValues } from "@csarkosh/engine/game/lite/skyCapture";
import { SKY_RADIANCE_WGSL } from "@csarkosh/engine/game/lite/skyDome";
import { SKY_DOME_SIZE } from "@csarkosh/engine/game/skyDomeParams";
import { SKY_PROBE_FACES, SKY_PROBE_SIZE } from "@csarkosh/engine/game/skyProbeParams";
import { skyStateFor } from "@csarkosh/engine/game/skyState";
import { WEATHER_PRESETS } from "@csarkosh/engine/game/weather";
import { skyFixture } from "../helpers/skyFixture.js";

const tight = (text: string): string => text.replace(/\s+/g, "");

describe("the sky's capture on Babylon Lite", () => {
  it("hands the pass the sky of a state, the scene's share and the eye, a vector each with a scalar in its fourth place", () => {
    const s = skyStateFor(skyFixture(), 18, WEATHER_PRESETS.mist);
    const values = skyCaptureValues(s, 0.5, { x: 250, y: 220, z: -500 });
    expect(values.byteLength).toBe(SKY_CAPTURE_BYTES);
    const f = (x: number): number => Math.fround(x);
    expect([...values]).toEqual([
      s.sunDir.x, s.sunDir.y, s.sunDir.z, 1,
      s.deckZenith.r, s.deckZenith.g, s.deckZenith.b, s.cloud,
      s.nightFloor.r, s.nightFloor.g, s.nightFloor.b, s.mistWeight,
      s.mistAir.r, s.mistAir.g, s.mistAir.b, 0.5,
      s.discColour.r, s.discColour.g, s.discColour.b, 0,
      250, 220, -500, 0,
    ].map(f));
  });

  it("draws each face along the probe's axes for it", () => {
    for (let face = 0; face < 6; face++) {
      const { normal, across, down } = SKY_PROBE_FACES[face]!;
      expect([...faceValues(face)]).toEqual([normal.x, normal.y, normal.z, 0, across.x, across.y, across.z, 0, down.x, down.y, down.z, 0]);
    }
    expect(() => faceValues(6)).toThrow(/six faces/);
  });

  it("draws the dome's radiance with the disc capped, as the probe sees it from the origin, times the scene's share", () => {
    const wgsl = tight(SKY_CAPTURE_WGSL);
    expect(wgsl).toContain(tight(SKY_RADIANCE_WGSL));
    // A texel's centre across the face, as `probeTexelDirection` takes it.
    expect(wgsl).toContain(`leta=2.0*at.x/${SKY_PROBE_SIZE}.0-1.0;letb=2.0*at.y/${SKY_PROBE_SIZE}.0-1.0;`);
    expect(wgsl).toContain("letd=skyProbeDome(normalize(face.normal.xyz+face.across.xyz*a+face.down.xyz*b),sky.eye.xyz);");
    // `probeDomeDirection`: the nearest face of the box round the eye ahead along each axis the ray moves on.
    expect(wgsl).toContain(`constSKY_DOME_HALF:f32=${SKY_DOME_SIZE / 2}.0;`);
    expect(wgsl).toContain("letalong=select(vec3<f32>(3.0e38),(eye+sign(ray)*SKY_DOME_HALF)/ray,abs(ray)>vec3<f32>(1.0e-8));");
    expect(wgsl).toContain("lett=min(along.x,min(along.y,along.z));returnnormalize(ray*t-eye);");
    expect(wgsl).toContain(
      "letradiance=skyRadiance(d,sky.sunDir.xyz,sky.sunDir.w,sky.deckZenith.w,sky.deckZenith.xyz,sky.night.xyz,sky.disc.xyz,sky.mistAir.xyz,sky.night.w,1.0);",
    );
    expect(wgsl).toContain("returnvec4<f32>(radiance*sky.mistAir.w,1.0);");
  });

  it("weighs the reflection by the table the game keeps: a PNG of 256 by 256, held to its size and its bytes", () => {
    const png = readFileSync(new URL("../../../../engine/src/game/lite/environmentBrdf.png", import.meta.url));
    // The PNG's signature, and its header's size.
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([256, 256]);
    expect(png.length).toBe(23_494);
    expect(createHash("sha256").update(png).digest("hex")).toBe("f10818901fccd58cd708fef7979daa3a37294b0bca53f450dc37e1589419813d");
    // The renderer is handed those bytes as a data URL, and nothing else.
    expect(environmentBrdf).toBe(`data:image/png;base64,${png.toString("base64")}`);
    const capture = readFileSync(new URL("../../../../engine/src/game/lite/skyCapture.ts", import.meta.url), "utf8");
    expect(capture).toContain('import environmentBrdf from "./environmentBrdf.png?inline";');
    expect(capture).toContain("brdfUrl: environmentBrdf,");
  });
});
