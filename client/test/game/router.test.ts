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
  announcedPath,
  sameFollowPlace,
  navigateToGame,
  navigateToLanding,
  replaceWithLanding,
  stripOverrides,
  keepOverrides,
  sameRoute,
  followsTo,
  hostRoute,
} from "../../src/game/router.js";
import { parseTierOverride, resolveTier } from "../../src/game/tierChoice.js";

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
  it("routes /settings to the Settings panel", () => {
    expect(parseRoute("/settings", "/")).toEqual({ kind: "settings" });
    expect(parseRoute("/dayhike/settings/", BASE)).toEqual({ kind: "settings" });
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

describe("where a lobby host is, for its followers", () => {
  it("announces a landing panel as the landing page: the panels are each player's own", () => {
    expect(announcedPath("/settings")).toBe("/");
    expect(announcedPath("/credits")).toBe("/");
    expect(announcedPath("/downloads")).toBe("/");
    expect(announcedPath("/")).toBe("/");
    expect(announcedPath("/game/epic-panda-fun?cmd=seed%20x")).toBe("/game/epic-panda-fun?cmd=seed%20x");
  });

  it("announces a host's route without its ?tier= and ?probe=, which are its own machine's", () => {
    expect(hostRoute("/game/epic-panda-fun?tier=high")).toBe("/game/epic-panda-fun");
    expect(hostRoute("/game/epic-panda-fun?cmd=seed%20atmo&tier=high&probe=high")).toBe("/game/epic-panda-fun?cmd=seed+atmo");
    expect(hostRoute("/settings?tier=low")).toBe("/");
    expect(hostRoute("/?probe=medium")).toBe("/");
    // A route with no override comes back byte for byte, its encoding kept.
    expect(hostRoute("/game/epic-panda-fun?cmd=seed%20atmo")).toBe("/game/epic-panda-fun?cmd=seed%20atmo");
    expect(hostRoute("/game/epic-panda-fun")).toBe("/game/epic-panda-fun");
  });

  it("takes ?tier= and ?probe= off a route a follower is sent to, from a host that still announces them", () => {
    expect(stripOverrides("/game/epic-panda-fun?tier=high")).toBe("/game/epic-panda-fun");
    expect(stripOverrides("/game/epic-panda-fun?probe=high&cmd=x&tier=low")).toBe("/game/epic-panda-fun?cmd=x");
    expect(stripOverrides("/game/epic-panda-fun?cmd=seed%20atmo")).toBe("/game/epic-panda-fun?cmd=seed%20atmo");
    expect(stripOverrides("")).toBe("");
    // A follower on the host's game with its own override is where the host is.
    expect(sameFollowPlace(stripOverrides("/game/epic-panda-fun?tier=high"), stripOverrides("/game/epic-panda-fun?tier=low"))).toBe(true);
  });

  it("leaves a follower in its own panel while the host is on the landing, and moves it into a game", () => {
    expect(sameFollowPlace("/", "/settings")).toBe(true);
    expect(sameFollowPlace("/", "/credits")).toBe(true);
    expect(sameFollowPlace("/", "/")).toBe(true);
    expect(sameFollowPlace("/game/epic-panda-fun", "/settings")).toBe(false);
    expect(sameFollowPlace("/game/epic-panda-fun", "/game/epic-panda-fun")).toBe(true);
    expect(sameFollowPlace("/", "/game/epic-panda-fun")).toBe(false);
  });
});

describe("the overrides stay on this page", () => {
  it("are taken off the route a host announces, and nothing else is touched", () => {
    expect(stripOverrides("/game/abc?engine=webgpu&tier=high")).toBe("/game/abc");
    expect(stripOverrides("/game/abc?cmd=seed%20atmo&engine=webgl2")).toBe("/game/abc?cmd=seed+atmo");
    // No override: the route goes out byte for byte as before.
    expect(stripOverrides("/game/abc?cmd=seed%20atmo")).toBe("/game/abc?cmd=seed%20atmo");
    expect(stripOverrides("/game/abc")).toBe("/game/abc");
    expect(stripOverrides("")).toBe("");
    // The probe override is the third of the set.
    expect(stripOverrides("/game/abc?probe=high&cmd=x&tier=low")).toBe("/game/abc?cmd=x");
    // The WebGPU shader lookup's, the fourth: a measurement's, never a follower's.
    expect(stripOverrides("/game/abc?wgsl=record&cmd=x")).toBe("/game/abc?cmd=x");
    expect(sameRoute("/game/abc?cmd=x&wgsl=off", "/game/abc?cmd=x")).toBe(true);
  });

  it("are carried onto the route a follower is sent to, from its own URL", () => {
    expect(keepOverrides("/game/abc?cmd=x", "?engine=webgl2&tier=medium&cmd=y")).toBe("/game/abc?cmd=x&engine=webgl2&tier=medium");
    expect(keepOverrides("/game/abc", "?tier=high")).toBe("/game/abc?tier=high");
    expect(keepOverrides("/game/abc?cmd=x", "")).toBe("/game/abc?cmd=x");
    expect(keepOverrides("/game/abc", "?probe=medium&engine=webgpu")).toBe("/game/abc?engine=webgpu&probe=medium");
    expect(keepOverrides("/game/abc", "?wgsl=verify&engine=webgpu")).toBe("/game/abc?engine=webgpu&wgsl=verify");
  });
});

describe("sameRoute", () => {
  // A hand-typed ?cmd= reaches the host's URL as the browser encoded it
  // (%20 for a space, a bare ;); the follower's URL went through
  // URLSearchParams when its own override was carried onto it (+ and %3B).
  const host = "/game/abc?cmd=seed%20atmo;weather%20mist";
  const follower = keepOverrides(host, "?tier=high");

  it("sees the same route where only the encoding and the follower's own overrides differ", () => {
    expect(follower).toBe("/game/abc?cmd=seed+atmo%3Bweather+mist&tier=high");
    // The comparison it replaces: an unchanged route read as changed, so the
    // follower navigated and rebuilt its game on every lobby change.
    expect(stripOverrides(host) === stripOverrides(follower)).toBe(false);
    expect(sameRoute(host, follower)).toBe(true);
    expect(sameRoute(`${host}&engine=webgl2`, follower)).toBe(true);
    expect(sameRoute("/game/abc?b=2&a=1", "/game/abc?a=1&b=2")).toBe(true);
    expect(sameRoute("/game/abc", "/game/abc?tier=medium")).toBe(true);
    expect(sameRoute("/game/abc?probe=high", "/game/abc")).toBe(true);
  });

  it("keeps the order of a parameter's repeated values, which decides what the page reads", () => {
    // URLSearchParams.get takes the first value, so these build different worlds.
    expect(sameRoute("/game/abc?cmd=a&cmd=b", "/game/abc?cmd=b&cmd=a")).toBe(false);
    expect(sameRoute("/game/abc?cmd=a&x=1&cmd=b", "/game/abc?x=1&cmd=a&cmd=b")).toBe(true);
    expect(sameRoute("/game/abc?cmd=a&cmd=b&tier=high", "/game/abc?cmd=a&engine=webgl2&cmd=b")).toBe(true);
  });

  it("still sees a real change", () => {
    expect(sameRoute(host, "/game/abc?cmd=seed%20other;weather%20mist&tier=high")).toBe(false);
    expect(sameRoute(host, "/game/xyz?cmd=seed%20atmo;weather%20mist")).toBe(false);
    expect(sameRoute("/game/abc", "/game/abc?cmd=x")).toBe(false);
    expect(sameRoute("/", "/credits")).toBe(false);
  });
});

describe("the overrides across the page's own navigation", () => {
  function stubPage(search: string): { pushed: string[]; replaced: string[] } {
    const record = { pushed: [] as string[], replaced: [] as string[] };
    const at = { pathname: "/", search };
    vi.stubGlobal("location", at);
    vi.stubGlobal("history", {
      state: null,
      pushState(_state: unknown, _title: string, url: string) {
        record.pushed.push(url);
        at.search = new URL(url, "http://page").search;
      },
      replaceState(_state: unknown, _title: string, url: string) {
        record.replaced.push(url);
        at.search = new URL(url, "http://page").search;
      },
    });
    vi.stubGlobal("PopStateEvent", class { constructor(readonly type: string) {} });
    vi.stubGlobal("window", { dispatchEvent: () => true });
    return record;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries tier=, engine= and probe= onto every route the page moves to, and nothing else", () => {
    const record = stubPage("?tier=high&engine=webgl2&probe=medium&cmd=seed%20x");
    navigateToGame("epic-panda-fun");
    navigateToLanding();
    navigateToPanel("settings");
    replaceWithLanding();
    expect(record.pushed).toEqual([
      withBase("/game/epic-panda-fun?engine=webgl2&tier=high&probe=medium"),
      withBase("/?engine=webgl2&tier=high&probe=medium"),
      withBase("/settings?engine=webgl2&tier=high&probe=medium"),
    ]);
    expect(record.replaced).toEqual([withBase("/?engine=webgl2&tier=high&probe=medium")]);
  });

  it("moves a page with no override exactly as before", () => {
    const record = stubPage("");
    navigateToGame("epic-panda-fun");
    navigateTo(`/game/${UUID}?cmd=seed%20x`);
    expect(record.pushed).toEqual([withBase("/game/epic-panda-fun"), withBase(`/game/${UUID}?cmd=seed%20x`)]);
  });

  it("starts the hike Play opens from a title at ?tier=high at high, as its Settings line says", () => {
    // The title's Settings says "The address sets High (?tier=high), which
    // overrides this setting." Play moves to the game route, whose search is
    // what the start reads the tier from (`startupTier`, `resolveTier`).
    stubPage("?tier=high");
    navigateToGame("epic-panda-fun");
    expect(parseTierOverride(location.search)).toBe("high");
    expect(resolveTier({ override: parseTierOverride(location.search), choice: "low", auto: "medium" })).toEqual({
      tier: "high",
      source: "override",
    });
  });
});

describe("a follower and its host, with the overrides", () => {
  it("moves a follower unless it is in the same place or on the same route", () => {
    expect(followsTo("", "/")).toBe(false);
    // The same place: a follower in its own Settings while the host is home.
    expect(followsTo("/", "/settings?tier=low")).toBe(false);
    // The same route: only the encoding and the follower's own overrides differ.
    expect(followsTo("/game/abc?cmd=seed%20atmo", "/game/abc?cmd=seed+atmo&tier=high")).toBe(false);
    expect(followsTo("/game/abc", "/game/abc?probe=high")).toBe(false);
    expect(followsTo("/game/abc", "/")).toBe(true);
    expect(followsTo("/game/abc", "/game/xyz?tier=high")).toBe(true);
  });

  it("announces the host's route with its overrides stripped and a panel as the home route", () => {
    expect(hostRoute("/settings?tier=high")).toBe("/");
    expect(hostRoute("/game/abc?tier=high&engine=webgpu&probe=medium&cmd=x")).toBe("/game/abc?cmd=x");
    expect(hostRoute("/game/abc?cmd=seed%20x")).toBe("/game/abc?cmd=seed%20x");
  });
});
