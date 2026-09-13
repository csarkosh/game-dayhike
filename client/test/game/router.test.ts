import { afterEach, describe, it, expect, vi } from "vitest";
import {
  parseRoute,
  stripBase,
  withBase,
  isValidLobbyId,
  isValidToken,
  navigateToPanel,
  navigateTo,
  pushedFromLanding,
  leavePanel,
} from "../../src/game/router.js";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const BASE = "/dayhike/";

describe("isValidLobbyId", () => {
  it("accepts a v4-shaped uuid, in either case", () => {
    expect(isValidLobbyId(UUID)).toBe(true);
    expect(isValidLobbyId(UUID.toUpperCase())).toBe(true);
  });
  it("rejects arbitrary strings", () => {
    expect(isValidLobbyId("lobby")).toBe(false);
    expect(isValidLobbyId("")).toBe(false);
    expect(isValidLobbyId("../../etc/passwd")).toBe(false);
    expect(isValidLobbyId("3f2504e0-4f89-41d3-9a0c-0305e82c33")).toBe(false);
  });
});

describe("isValidToken", () => {
  it("accepts a uuid and a memorable word", () => {
    expect(isValidToken(UUID)).toBe(true);
    expect(isValidToken("epic-panda-fun")).toBe(true);
  });
  it("rejects empty, too long, and path-like tokens", () => {
    expect(isValidToken("")).toBe(false);
    expect(isValidToken("a".repeat(37))).toBe(false);
    expect(isValidToken("a/b")).toBe(false);
    expect(isValidToken("a b")).toBe(false);
  });
});

describe("stripBase / withBase", () => {
  it("strips the prefix and keeps the leading slash", () => {
    expect(stripBase("/dayhike/credits", BASE)).toBe("/credits");
    expect(stripBase("/dayhike/", BASE)).toBe("/");
    expect(stripBase("/dayhike", BASE)).toBe("/");
  });
  it("is the identity under the root base", () => {
    expect(stripBase("/credits", "/")).toBe("/credits");
    expect(withBase("/credits", "/")).toBe("/credits");
  });
  it("sends a path outside the base to the landing page", () => {
    expect(stripBase("/other/credits", BASE)).toBe("/");
    expect(stripBase("/dayhikex", BASE)).toBe("/");
  });
  it("prefixes without doubling slashes", () => {
    expect(withBase("/credits", BASE)).toBe("/dayhike/credits");
    expect(withBase("/", BASE)).toBe("/dayhike/");
    expect(withBase(`/game/${UUID}?cmd=seed%20x`, BASE)).toBe(`/dayhike/game/${UUID}?cmd=seed%20x`);
  });
});

describe("parseRoute", () => {
  it("routes the root to the landing page", () => {
    expect(parseRoute("/", "/")).toEqual({ kind: "landing" });
    expect(parseRoute("/dayhike/", BASE)).toEqual({ kind: "landing" });
  });
  it("routes /game/<token> to a game, lower-cased", () => {
    expect(parseRoute(`/game/${UUID}`, "/")).toEqual({ kind: "game", token: UUID });
    expect(parseRoute(`/dayhike/game/${UUID.toUpperCase()}/`, BASE)).toEqual({ kind: "game", token: UUID });
    expect(parseRoute("/game/epic-panda-fun", "/")).toEqual({ kind: "game", token: "epic-panda-fun" });
  });
  it("routes /party/<uuid> to an invite and refuses a non-uuid", () => {
    expect(parseRoute(`/dayhike/party/${UUID}`, BASE)).toEqual({ kind: "party", lobbyId: UUID });
    expect(parseRoute("/party/not-a-uuid", "/")).toEqual({ kind: "landing" });
  });
  it("routes the two secondary panels", () => {
    expect(parseRoute("/downloads", "/")).toEqual({ kind: "downloads" });
    expect(parseRoute("/dayhike/credits/", BASE)).toEqual({ kind: "credits" });
    expect(parseRoute("/creditsx", "/")).toEqual({ kind: "landing" });
  });
  it("falls back to landing for a malformed token and unknown paths", () => {
    expect(parseRoute("/game/", "/")).toEqual({ kind: "landing" });
    expect(parseRoute("/game/a/b", "/")).toEqual({ kind: "landing" });
    expect(parseRoute("/whatever", "/")).toEqual({ kind: "landing" });
  });
});

describe("history entries", () => {
  function stubHistory(): { state: unknown; pushed: unknown[]; replaced: unknown[] } {
    const record = { state: null as unknown, pushed: [] as unknown[], replaced: [] as unknown[] };
    vi.stubGlobal("history", {
      get state() {
        return record.state;
      },
      pushState(state: unknown, _title: string, url: string) {
        record.state = state;
        record.pushed.push({ state, url });
      },
      replaceState(state: unknown, _title: string, url: string) {
        record.state = state;
        record.replaced.push({ state, url });
      },
    });
    vi.stubGlobal(
      "PopStateEvent",
      class {
        constructor(readonly type: string) {}
      },
    );
    vi.stubGlobal("window", { dispatchEvent: () => true });
    return record;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stamps a panel entry so Back knows it can pop", () => {
    const record = stubHistory();
    navigateToPanel("downloads");
    expect(record.pushed).toEqual([{ state: { fromLanding: true }, url: withBase("/downloads") }]);
    expect(pushedFromLanding()).toBe(true);
  });

  it("reports false for a directly loaded panel", () => {
    stubHistory();
    expect(pushedFromLanding()).toBe(false);
  });

  it("pushes an arbitrary relative path under the base", () => {
    const record = stubHistory();
    navigateTo(`/game/${UUID}?cmd=seed%20x`);
    expect(record.pushed).toEqual([{ state: {}, url: withBase(`/game/${UUID}?cmd=seed%20x`) }]);
  });
});

describe("leavePanel", () => {
  function record(pushed: boolean): string[] {
    const calls: string[] = [];
    leavePanel({
      pushedFromLanding: () => pushed,
      back: () => calls.push("back"),
      toLanding: () => calls.push("toLanding"),
    });
    return calls;
  }
  it("pops history when the entry is one we pushed", () => {
    expect(record(true)).toEqual(["back"]);
  });
  it("pushes the landing route when the panel was loaded directly", () => {
    expect(record(false)).toEqual(["toLanding"]);
  });
});
