import { describe, it, expect } from "vitest";
import { cellText, machineLines } from "../../src/admin/machines.js";
import type { Row } from "../../src/admin/source.js";

const row = (o: Row): Row => ({ gpu: "Apple M2", mobile: false, tier: "high", players: 3, sessions: 4, fps: 58.4, good: 4, slow: 0, bad: 0, no_frames: 0, load_ms: 6100, auto_sessions: 1, cores: 8, mem: 8, oses: "darwin-arm64", ...o });

describe("machineLines", () => {
  it("makes one line of a chip's tiers, the unplayed one null, players the most of any tier", () => {
    const lines = machineLines([row({ tier: "high", players: 5 }), row({ tier: "medium", players: 2, sessions: 12, good: 9, slow: 2, bad: 1, fps: "41" })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.players).toBe(5);
    expect(lines[0]!.cells.low).toBeNull();
    expect(lines[0]!.cells.medium?.verdict).toBe("slow");
    expect(lines[0]!.cells.medium?.title).toBe("12 sessions: 9 smooth, 2 choppy, 1 poor; median load 6.1 s; 1 put here by auto");
  });

  it("words a cell", () => {
    expect(cellText(null)).toBe("not played");
    expect(cellText({ tier: "high", sessions: 2, fps: null, verdict: null, title: "" })).toBe("no frames measured");
    const [line] = machineLines([row({ fps: "58.4" })]);
    expect(cellText(line!.cells.high)).toBe("smooth, 58 fps");
  });

  it("names a masked phone, and a phone apart from a desktop of the same chip", () => {
    const lines = machineLines([row({ gpu: "", mobile: true }), row({ gpu: "", mobile: "false", players: "1" }), row({ gpu: "Apple M2", mobile: "true" })]);
    expect(lines.map((l) => l.name).sort()).toEqual(["Apple M2 (phone)", "Not shared by the browser", "Not shared by the browser (phone)"]);
  });

  it("merges ANGLE strings that differ by the device id, taking the cell with more sessions", () => {
    const lines = machineLines([
      row({ gpu: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060", sessions: 3, good: 3 }),
      row({ gpu: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti", sessions: 1 }),
      row({ gpu: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060", sessions: 5, good: 5, players: 2 }),
    ]);
    expect(lines.map((l) => l.name).sort()).toEqual(["NVIDIA GeForce RTX 3060", "NVIDIA GeForce RTX 3060 Ti"]);
    const merged = lines.find((l) => l.name === "NVIDIA GeForce RTX 3060")!;
    expect(merged.cells.high?.sessions).toBe(8);
    expect(merged.cells.high?.title.startsWith("8 sessions:")).toBe(true);
  });

  it("orders by players, most first, and says cores, memory and systems in the title", () => {
    const lines = machineLines([row({ gpu: "A", players: 1, mem: 4 }), row({ gpu: "B", players: 9, cores: 0, mem: 0, oses: "" })]);
    expect(lines.map((l) => l.name)).toEqual(["B", "A"]);
    expect(lines[1]!.title).toBe("8 cores, 4 GB; macOS");
    expect(lines[0]!.title).toBe("not shared by the browser cores, not shared by the browser memory");
  });
});
