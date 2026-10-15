import { describe, expect, it } from "vitest";
import { stillScript, stillUrl, stripPng } from "../lib/still.mjs";

const config = { game: "0f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b", tier: "high" };
const tarn = { name: "tarn", seed: "atmo", x: 228, z: 72, yaw: 1.571 };

describe("stillScript", () => {
  it("puts the free camera at the place and holds the day at its start, with no hour or weather", () => {
    expect(stillScript(tarn)).toBe("seed atmo;freecam 228 72 1.571;escalation 0;unsettle 0");
  });
});

describe("stillUrl", () => {
  it("opens a staged scene's route held at a step, on the tier, telemetry off, for a still with a route", () => {
    expect(stillUrl("https://games.csarko.sh/dayhike", config, { name: "range", route: "scene/title", step: 760 })).toBe(
      "https://games.csarko.sh/dayhike/scene/title?step=760&tier=high&telemetry=off",
    );
  });
  it("opens the game on the base with the script and the tier, semicolons kept readable, telemetry off", () => {
    expect(stillUrl("http://localhost:5173/dayhike/", config, tarn)).toBe(
      "http://localhost:5173/dayhike/game/0f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b?cmd=seed%20atmo;freecam%20228%2072%201.571;escalation%200;unsettle%200&tier=high&telemetry=off",
    );
  });
});

function chunk(type, body = Buffer.alloc(0)) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, Buffer.from(type, "latin1"), body, Buffer.alloc(4)]);
}
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("stripPng", () => {
  it("keeps the image's chunks and drops every other", () => {
    const png = Buffer.concat([
      signature,
      chunk("IHDR", Buffer.alloc(13)),
      chunk("tEXt", Buffer.from("Software\0a camera")),
      chunk("eXIf", Buffer.alloc(20)),
      chunk("IDAT", Buffer.from([1, 2, 3])),
      chunk("tIME", Buffer.alloc(7)),
      chunk("IEND"),
    ]);
    const stripped = stripPng(png);
    expect(stripped).toEqual(Buffer.concat([signature, chunk("IHDR", Buffer.alloc(13)), chunk("IDAT", Buffer.from([1, 2, 3])), chunk("IEND")]));
  });
  it("refuses what is not a PNG", () => {
    expect(() => stripPng(Buffer.from("hello"))).toThrow("not a PNG");
  });
});
