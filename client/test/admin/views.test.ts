import { describe, it, expect } from "vitest";
import { fpsVerdict, funnelLine, gpuName, loadVerdict, osName, placeName, playerVerdict, reachOf } from "../../src/admin/views.js";


describe("funnelLine", () => {
  it("says the sessions and the builds, and how many of those that landed were turned away", () => {
    expect(funnelLine({ build: "all", sessions: 191, landed: 181, turned_away: 6 }, 2)).toBe(
      "191 sessions on 2 builds, each stage's share of the one before; 6 of those that landed could not play here and were turned away",
    );
    expect(funnelLine({ build: "all", sessions: 1, landed: 1, turned_away: 0 }, 1)).toBe(
      "1 sessions on 1 build, each stage's share of the one before; 0 of those that landed could not play here and were turned away",
    );
    // BigQuery hands a count back as a string.
    expect(funnelLine({ build: "all", sessions: "40", landed: "38", turned_away: "3" }, 1)).toContain("; 3 of those that landed");
  });

  it("says nothing of the turned away where the query has no such column", () => {
    expect(funnelLine({ build: "all", sessions: 191, landed: 181 }, 2)).toBe("191 sessions on 2 builds, each stage's share of the one before");
  });
});

describe("a player's load and frame rate", () => {
  it("calls a load good to 15 s, slow to 30 s and bad past it", () => {
    expect([loadVerdict(9_000), loadVerdict(15_000), loadVerdict(15_001), loadVerdict(30_000), loadVerdict(30_001), loadVerdict(null)]).toEqual(["good", "good", "slow", "slow", "bad", null]);
  });

  it("calls a frame rate good from 50 fps, slow from 30 and bad under it", () => {
    expect([fpsVerdict(60), fpsVerdict(50), fpsVerdict(49.9), fpsVerdict(30), fpsVerdict(29.9), fpsVerdict(null)]).toEqual(["good", "good", "slow", "slow", "bad", null]);
  });

  it("gives a player the worse of the two, and none to a player who has neither", () => {
    expect(playerVerdict({ load_ms: 9_000, fps: 60 })).toBe("good");
    expect(playerVerdict({ load_ms: 9_000, fps: 24 })).toBe("bad");
    expect(playerVerdict({ load_ms: 22_000, fps: 60 })).toBe("slow");
    // BigQuery hands numbers back as strings, and a player who left before the world was in has nulls.
    expect(playerVerdict({ load_ms: "40000", fps: null })).toBe("bad");
    expect(playerVerdict({ load_ms: null, fps: null })).toBeNull();
  });

  it("names a GPU as people say it, without ANGLE's wrapping", () => {
    expect(gpuName("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("NVIDIA GeForce RTX 3060");
    expect(gpuName("ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("Intel(R) UHD Graphics 620");
    expect(gpuName("ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)")).toBe("Apple M3 Max");
    expect(gpuName("ANGLE (ARM, Mali-G52 MC2, OpenGL ES 3.2)")).toBe("Mali-G52 MC2");
    expect(gpuName("ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2, OpenGL 4.5.0)")).toBe("NVIDIA GeForce RTX 4060 Laptop GPU");
    expect(gpuName("Apple M2")).toBe("Apple M2");
    expect(gpuName("")).toBe("");
  });
});

describe("a player's row", () => {
  it("says how far they got: finished a hike, played one, or only looked", () => {
    expect(reachOf({ played: 4, finished: 2 })).toBe("finished");
    expect(reachOf({ played: "1", finished: "0" })).toBe("played");
    expect(reachOf({ played: 0, finished: 0 })).toBe("looked");
  });

  it("names the place as people say it, leaving out what the database did not know", () => {
    expect(placeName({ city: "Port Angeles", region: "Washington", country: "US" })).toBe("Port Angeles, Washington · US");
    expect(placeName({ city: "Berlin", region: "Berlin", country: "DE" })).toBe("Berlin · DE");
    expect(placeName({ city: null, region: null, country: "GB" })).toBe("United Kingdom");
    expect(placeName({ city: null, region: null, country: null })).toBe("");
  });

  it("names the operating system", () => {
    expect([osName("darwin-arm64"), osName("win32-x64"), osName("android-arm64"), osName("other"), osName("")]).toEqual(["macOS", "Windows", "Android", "Other", ""]);
  });
});
