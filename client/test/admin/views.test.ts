import { describe, it, expect } from "vitest";
import type { Row } from "../../src/admin/source.js";
import { fpsVerdict, funnelLine, funnelSentence, gpuName, loadVerdict, osName, placeName, placesSentence, playerVerdict, reachOf } from "../../src/admin/views.js";


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

describe("funnelSentence", () => {
  const all = { build: "all", landed: 120, pressed_play: 80, started: 52, finished: 20, turned_away: 6 };
  it("walks the stages with each share of the one before", () => {
    expect(funnelSentence(all)).toBe("120 landed → 80 pressed Play (67%) → 52 started a hike (65%) → 20 reached an end (38%) · 6 turned away");
  });
  it("ends after the last stage where the query has no turned_away", () => {
    expect(funnelSentence({ build: "all", landed: 120, pressed_play: 80, started: 52, finished: 20 })).toBe("120 landed → 80 pressed Play (67%) → 52 started a hike (65%) → 20 reached an end (38%)");
  });
  it("says so when nobody landed, and parses string counts", () => {
    expect(funnelSentence({ build: "all", landed: 0 })).toBe("No sessions in this range.");
    expect(funnelSentence({ build: "all", landed: "120", pressed_play: "80", started: "52", finished: "20" })).toContain("80 pressed Play (67%)");
  });
});

describe("placesSentence", () => {
  const city = (name: string, visits: number | string, country: string): Row => ({ city: name, country, visits });
  it("names the top four of the placed cities and how many more", () => {
    const cities = ["US", "GB", "CA", "DE", "FR", "JP"];
    const rows = [city("New York", 30, "US"), city("London", 12, "GB"), city("Toronto", 8, "CA"), city("Berlin", 5, "DE")];
    for (let i = 0; i < 10; i += 1) rows.push(city(`Town ${i}`, 1, cities[i % 6]!));
    expect(placesSentence(rows)).toBe("From 14 places in 6 countries: New York 30, London 12, Toronto 8, Berlin 5, and 10 more");
  });
  it("says one country, and no 'more' when all are named", () => {
    expect(placesSentence([city("Austin", "4", "US")])).toBe("From 1 place in 1 country: Austin 4");
  });
  it("says so with no rows", () => {
    expect(placesSentence([])).toBe("No visits in this range.");
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
    // The machines query trims a device id and the driver text, leaving the ANGLE string unterminated.
    expect(gpuName("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060")).toBe("NVIDIA GeForce RTX 3060");
    expect(gpuName("ANGLE (Intel, Intel(R) UHD Graphics 620")).toBe("Intel(R) UHD Graphics 620");
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
