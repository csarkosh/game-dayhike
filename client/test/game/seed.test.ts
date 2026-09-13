import { describe, it, expect } from "vitest";
import { seedFromToken } from "../../src/game/seed.js";

describe("seedFromToken", () => {
  it("is stable for the same token", () => {
    expect(seedFromToken("epic-panda-fun")).toBe(seedFromToken("epic-panda-fun"));
  });

  it("separates different tokens", () => {
    expect(seedFromToken("epic-panda-fun")).not.toBe(seedFromToken("42asf134"));
  });

  it("returns a 32-bit integer", () => {
    const s = seedFromToken("epic-panda-fun");
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBe(s | 0);
  });

  it("reproduces the seed app.ts derived from room ids", () => {
    // Pinned against the previous inline implementation. If this changes, every
    // existing room generates a different world with no other symptom.
    let h = 0x811c9dc5;
    const roomId = "2390a0bf-b454-499e-8ca0-17f379e413be";
    for (let i = 0; i < roomId.length; i++) {
      h ^= roomId.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    expect(seedFromToken(roomId)).toBe(h | 0);
  });
});
