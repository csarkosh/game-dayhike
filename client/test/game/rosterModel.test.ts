import { describe, it, expect } from "vitest";
import {
  rosterModel,
  ROSTER_MAX,
  PENDING_AFTER_MS,
  OVERRUN_MS,
  type RosterAttempt,
} from "../../src/game/rosterModel.js";
import type { LobbyState } from "../../src/net/lobby.js";

const LOBBY = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const invite = (id: string) => `https://games.csarko.sh/dayhike/party/${id}`;

describe("rosterModel with no lobby", () => {
  it("shows just you and an Invite action", () => {
    const view = rosterModel({ lobby: null, selfId: "me", selfName: "Sam", inviteUrl: invite, inGame: false, paused: false, attempt: null });
    expect(view).toEqual({
      rows: [{ id: "me", name: "Sam", isHost: false, isSelf: true }],
      count: { members: 1, max: ROSTER_MAX },
      invite: { action: "create", busy: false },
      editable: true,
      interactive: true,
      presence: "full",
      joining: false,
    });
  });
});

describe("rosterModel in a lobby", () => {
  const host: LobbyState = {
    id: LOBBY,
    role: "host",
    hostId: "me",
    members: [{ id: "me", name: "Sam" }, { id: "c1", name: "Cass" }],
    route: "/",
  };
  it("lists members host first, marks host and self, and shows the invite link", () => {
    const view = rosterModel({ lobby: host, selfId: "me", selfName: "Sam", inviteUrl: invite, inGame: false, paused: false, attempt: null });
    expect(view.rows).toEqual([
      { id: "me", name: "Sam", isHost: true, isSelf: true },
      { id: "c1", name: "Cass", isHost: false, isSelf: false },
    ]);
    expect(view.count).toEqual({ members: 2, max: ROSTER_MAX });
    expect(view.invite).toEqual({ url: invite(LOBBY) });
    expect(view.joining).toBe(false);
  });
  it("puts the host first even if the list arrived in another order", () => {
    const follower: LobbyState = { ...host, role: "client", hostId: "h", members: [{ id: "me", name: "Sam" }, { id: "h", name: "Host" }] };
    const view = rosterModel({ lobby: follower, selfId: "me", selfName: "Sam", inviteUrl: invite, inGame: false, paused: false, attempt: null });
    expect(view.rows.map((r) => r.id)).toEqual(["h", "me"]);
    expect(view.rows[0]?.isHost).toBe(true);
  });
  it("is joining until the host's first state arrives", () => {
    const fresh: LobbyState = { ...host, role: "client", hostId: "h", members: [{ id: "me", name: "Sam" }], route: "" };
    expect(rosterModel({ lobby: fresh, selfId: "me", selfName: "Sam", inviteUrl: invite, inGame: false, paused: false, attempt: null }).joining).toBe(true);
  });
  it("is not editable in-game and carries the error line", () => {
    const view = rosterModel({ lobby: host, selfId: "me", selfName: "Sam", inviteUrl: invite, inGame: true, paused: false, attempt: null, error: "That lobby is full." });
    expect(view.editable).toBe(false);
    expect(view.error).toBe("That lobby is full.");
  });
});

describe("rosterModel presence", () => {
  const lobby: LobbyState = {
    id: LOBBY,
    role: "host",
    hostId: "me",
    members: [{ id: "me", name: "Sam" }],
    route: "/",
  };
  const base = { lobby, selfId: "me", selfName: "Sam", inviteUrl: invite };
  it("is full on the landing page", () => {
    expect(rosterModel({ ...base, inGame: false, paused: false, attempt: null }).presence).toBe("full");
  });
  it("is subdued while a match is being played", () => {
    expect(rosterModel({ ...base, inGame: true, paused: false, attempt: null }).presence).toBe("subdued");
  });
  it("is full again on the pause menu", () => {
    expect(rosterModel({ ...base, inGame: true, paused: true, attempt: null }).presence).toBe("full");
  });
  it("paused in-game is still not editable", () => {
    expect(rosterModel({ ...base, inGame: true, paused: true, attempt: null }).editable).toBe(false);
  });
  it("with no lobby, presence follows the same rule", () => {
    expect(rosterModel({ ...base, lobby: null, inGame: true, paused: false, attempt: null }).presence).toBe("subdued");
  });
});

describe("rosterModel interactivity", () => {
  const lobby: LobbyState = {
    id: LOBBY,
    role: "host",
    hostId: "me",
    members: [{ id: "me", name: "Sam" }],
    route: "/",
  };
  const base = { lobby, selfId: "me", selfName: "Sam", inviteUrl: invite };
  it("takes the pointer on the landing page", () => {
    expect(rosterModel({ ...base, inGame: false, paused: false, attempt: null }).interactive).toBe(true);
  });
  it("ignores the pointer while a match is being played", () => {
    expect(rosterModel({ ...base, inGame: true, paused: false, attempt: null }).interactive).toBe(false);
  });
  it("takes the pointer again on the pause menu, where Invite and Copy must work", () => {
    expect(rosterModel({ ...base, inGame: true, paused: true, attempt: null }).interactive).toBe(true);
  });
  it("is interactive but not editable when paused: the name field stays out of the way", () => {
    const view = rosterModel({ ...base, inGame: true, paused: true, attempt: null });
    expect(view.interactive).toBe(true);
    expect(view.editable).toBe(false);
  });
});

describe("rosterModel pending attempt", () => {
  const base = { lobby: null, selfId: "me", selfName: "Sam", inviteUrl: invite, inGame: false, paused: false, attempt: null };
  const at = (elapsedMs: number, over: Partial<RosterAttempt> = {}) =>
    rosterModel({ ...base, attempt: { kind: "invite", elapsedMs, connectedAtMs: null, ...over } });
  const progressAt = (elapsedMs: number, over: Partial<RosterAttempt> = {}) => {
    const view = at(elapsedMs, over);
    if (!("pending" in view.invite)) throw new Error("expected a pending view");
    return view.invite.pending.progress;
  };

  it("offers a plain Invite button when nothing is in flight", () => {
    expect(rosterModel({ ...base, attempt: null }).invite).toEqual({ action: "create", busy: false });
  });

  it("disables the button at once, before the bar is worth showing", () => {
    expect(at(0).invite).toEqual({ action: "create", busy: true });
    expect(at(PENDING_AFTER_MS - 1).invite).toEqual({ action: "create", busy: true });
  });

  it("shows the bar once the attempt is old enough to be worth reporting", () => {
    const view = at(PENDING_AFTER_MS);
    expect(view.invite).toEqual({
      pending: { label: "Connecting", progress: expect.any(Number), overrun: false },
    });
  });

  it("climbs while the socket is still opening", () => {
    const samples = [300, 500, 1000, 1500, 2200, 4000, 10_000].map((t) => progressAt(t));
    for (let i = 1; i < samples.length; i++) expect(samples[i]!).toBeGreaterThan(samples[i - 1]!);
  });

  it("approaches the socket-open milestone without ever reaching it", () => {
    // The event is what earns that 0.6, not the passage of time.
    expect(progressAt(2200)).toBeCloseTo(0.54, 2);
    expect(progressAt(60_000)).toBeLessThan(0.6);
    expect(progressAt(600_000)).toBeLessThan(0.6);
  });

  it("snaps to the milestone when the socket opens, then climbs again", () => {
    const opened = progressAt(1000, { connectedAtMs: 1000 });
    expect(opened).toBe(0.6);
    expect(progressAt(1050, { connectedAtMs: 1000 })).toBeGreaterThan(0.6);
  });

  it("approaches completion without ever claiming it", () => {
    expect(progressAt(60_000, { connectedAtMs: 1000 })).toBeLessThan(1);
  });

  it("names the stage the attempt is actually in", () => {
    const label = (over: Partial<RosterAttempt>) => {
      const view = at(1000, over);
      if (!("pending" in view.invite)) throw new Error("expected a pending view");
      return view.invite.pending.label;
    };
    expect(label({})).toBe("Connecting");
    expect(label({ connectedAtMs: 900 })).toBe("Creating");
    expect(label({ kind: "join" })).toBe("Connecting");
    expect(label({ kind: "join", connectedAtMs: 900 })).toBe("Joining");
  });

  it("calls it an overrun once the wait stops being explicable", () => {
    const before = at(OVERRUN_MS - 1).invite;
    const after = at(OVERRUN_MS).invite;
    if (!("pending" in before) || !("pending" in after)) throw new Error("expected pending views");
    expect(before.pending.overrun).toBe(false);
    expect(after.pending.overrun).toBe(true);
  });

  it("gives way to the link the moment the lobby exists", () => {
    const lobby: LobbyState = {
      id: LOBBY,
      role: "host",
      hostId: "me",
      members: [{ id: "me", name: "Sam" }],
      route: "/",
    };
    const view = rosterModel({ ...base, lobby, attempt: { kind: "invite", elapsedMs: 400, connectedAtMs: 300 } });
    expect(view.invite).toEqual({ url: invite(LOBBY) });
  });
});
