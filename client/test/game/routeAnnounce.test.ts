import { describe, it, expect } from "vitest";
import { createRouteAnnouncer } from "../../src/game/routeAnnounce.js";

/** A paint scheduler the test fires by hand, standing in for `afterNextPaint`. */
function manualPaint() {
  const pending: (() => void)[] = [];
  return {
    schedule: (fn: () => void) => {
      pending.push(fn);
    },
    paint: () => {
      for (const fn of pending.splice(0)) fn();
    },
  };
}

describe("createRouteAnnouncer", () => {
  it("announces a landing route at once", () => {
    const paint = manualPaint();
    const announced: string[] = [];
    const route = "/";
    const announcer = createRouteAnnouncer(() => announced.push(route), paint.schedule);
    announcer.now();
    expect(announced).toEqual(["/"]);
  });

  it("announces the game route only once the paint that follows the build has happened", () => {
    // The world build blocks the host's page for a second or more; a follower
    // invited inside that block sends an offer nobody can answer in time.
    const paint = manualPaint();
    const announced: string[] = [];
    const route = "/game/abc";
    const announcer = createRouteAnnouncer(() => announced.push(route), paint.schedule);
    announcer.afterPaint();
    expect(announced).toEqual([]);
    paint.paint();
    expect(announced).toEqual(["/game/abc"]);
  });

  it("drops a deferred announcement when the route changed before the paint", () => {
    const paint = manualPaint();
    const announced: string[] = [];
    let route = "/game/abc";
    const announcer = createRouteAnnouncer(() => announced.push(route), paint.schedule);
    announcer.afterPaint();
    route = "/";
    announcer.now();
    paint.paint();
    expect(announced).toEqual(["/"]);
  });

  it("announces only the newer of two deferred game routes", () => {
    const paint = manualPaint();
    const announced: string[] = [];
    let route = "/game/abc";
    const announcer = createRouteAnnouncer(() => announced.push(route), paint.schedule);
    announcer.afterPaint();
    route = "/game/def";
    announcer.afterPaint();
    paint.paint();
    expect(announced).toEqual(["/game/def"]);
  });
});
