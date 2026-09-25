import { describe, it, expect } from "vitest";
import {
  STALE_PAGE_MESSAGE,
  connectFailure,
  connectFailureMessage,
  runRetry,
  sessionEndOutcome,
} from "../../src/game/connectPanel.js";

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

describe("connectFailure", () => {
  it("retries a failed handshake by running it again", () => {
    expect(connectFailure(new Error("ice_failed"))).toEqual({
      message: "Could not connect. You or the host may be on a restrictive network.",
      retry: "reconnect",
    });
  });
});

describe("sessionEndOutcome", () => {
  it("sends a version skew to the panel, whose Retry reloads the page", () => {
    // Joining again from the same page runs the same stale bundle and is
    // refused the same way; only a reload fetches the current one.
    const outcome = sessionEndOutcome({
      kind: "version_skew",
      message: "Level mismatch: the host is running a, this client has b. Reload the page to update.",
    });
    expect(outcome).toEqual({ panel: { message: STALE_PAGE_MESSAGE, retry: "reload" } });
  });

  it("keeps a host that moved to another world on the status line", () => {
    const message = "World mismatch: the host is running forest/5/olympic/222/-17/9, this client has forest/5/olympic/111/-16/9.";
    expect(sessionEndOutcome({ kind: "world_changed", message })).toEqual({ status: message });
  });

  it("keeps the host's own ending on the status line, reason verbatim", () => {
    expect(sessionEndOutcome({ kind: "host_ended", message: "Closing up." })).toEqual({
      status: "Closing up.",
    });
  });

  it("fills in a host ending that gave no reason", () => {
    expect(sessionEndOutcome({ kind: "host_ended", message: "" })).toEqual({
      status: "The host ended this session.",
    });
  });
});

describe("runRetry", () => {
  function hooks() {
    const calls: string[] = [];
    return {
      calls,
      reconnect: () => calls.push("reconnect"),
      reload: () => calls.push("reload"),
    };
  }

  it("reloads the page for a version skew and never re-runs the handshake", () => {
    const h = hooks();
    runRetry("reload", h);
    expect(h.calls).toEqual(["reload"]);
  });

  it("re-runs the handshake for a failed connection and never reloads", () => {
    const h = hooks();
    runRetry("reconnect", h);
    expect(h.calls).toEqual(["reconnect"]);
  });
});
