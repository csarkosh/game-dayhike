import { describe, it, expect } from "vitest";
import { actionForSignalingError } from "../../src/net/signalingPolicy.js";

describe("actionForSignalingError", () => {
  it("ends the session when the host is gone before peers connect", () => {
    // Nothing was ever established, so there is no game to preserve.
    expect(actionForSignalingError("host_gone", false)).toBe("end-session");
  });

  it("ignores host_gone once peers are connected", () => {
    // The match runs over peer-to-peer data channels. Signaling losing track of
    // the host says nothing about whether the game is still running.
    expect(actionForSignalingError("host_gone", true)).toBe("ignore");
  });

  it("ends the session when the room is full before peers connect", () => {
    // Nobody in a full room yet, so the joiner's attempt just failed.
    expect(actionForSignalingError("room_full", false)).toBe("end-session");
  });

  it("ignores room_full once peers are connected", () => {
    // A running match's own player is not "trying to get in" — the code is
    // only ever a reply to somebody's join attempt (the original join, or a
    // reconnecting signaling socket's resend), and a healthy transport does
    // not care that the room looks full to a would-be newcomer.
    expect(actionForSignalingError("room_full", true)).toBe("ignore");
  });

  it("ignores host_away regardless of connection state: it is a transient join-time condition", () => {
    expect(actionForSignalingError("host_away", false)).toBe("ignore");
    expect(actionForSignalingError("host_away", true)).toBe("ignore");
  });

  it("ignores codes it does not recognise", () => {
    expect(actionForSignalingError("bad_message", false)).toBe("ignore");
    expect(actionForSignalingError("invalid_room", true)).toBe("ignore");
  });
});
