import { describe, it, expect } from "vitest";
import { connectFailureMessage } from "../../src/game/connectPanel.js";

describe("connectFailureMessage", () => {
  it("blames the network when ICE failed", () => {
    expect(connectFailureMessage(new Error("ice_failed"))).toBe(
      "Could not connect. You or the host may be on a restrictive network.",
    );
  });

  it("says the host could not be reached for anything else", () => {
    expect(connectFailureMessage(new Error("timeout"))).toBe("Could not reach the host.");
    expect(connectFailureMessage("boom")).toBe("Could not reach the host.");
  });
});
