import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

/**
 * The page's shell (`shell.ts`, the engine's: the routes, the lobby, the start of a session) calls Day Hike's own
 * of the page (`hikePage.ts`: the intro's film, the title's loop, the landing page, the page for
 * those turned away, the name, the mode) at the page's own points, by names that say what the point
 * is. The shell reads and writes none of Day Hike's variables.
 */

const own = sourceText("hikePage.ts");

/** The body of a function of Day Hike's own of the page, from its opening brace to the brace that closes it. */
function bodyOf(name: string): string {
  const at = own.indexOf(`  function ${name}(`);
  if (at < 0) throw new Error(`hikePage.ts has no function ${name}`);
  const open = own.indexOf(" {\n", at);
  return own.slice(open, own.indexOf("\n  }\n", open));
}

describe("the page's shell and Day Hike's own of the page", () => {
  it("the shell names none of Day Hike's variables of the page", () => {
    // The player's name is no longer one of them: the engine keeps it (`playerName.ts`), and Day Hike's own of the page holds none.
    expect(own).not.toMatch(/playerName|selfName|loadName|saveName|\brename\b/);
    // Nor the page for those turned away, which is the engine's and shown by the shell: Day Hike's own draws none of it.
    expect(own).not.toMatch(/renderTurnedAway|turnedAwayModel|turnedAwayView|game\/turnedAway|creditsEntries|visitorDevice/);
  });

  it("Play stops the title's loop and starts the film, to be carried into the game", () => {
    const played = bodyOf("played");
    expect(played.indexOf("titleLoop?.stop();")).toBeGreaterThan(0);
    expect(played.indexOf("pendingIntro = startIntro(src, false);")).toBeGreaterThan(played.indexOf("titleLoop?.stop();"));
    expect(played).toContain("endIntro(pendingIntro);");
  });

  it("the landing page is shown by Day Hike's own, with the shell's handlers", () => {
    const show = bodyOf("showLanding");
    const order = ["endIntro(pendingIntro);", "titleLoop = createTitleLoop(", "warmFilmHead();", "landingNotice = takeNotice(", "renderLanding(", "landing = handle;", "void h.latestReady.then("];
    const places = order.map((line) => show.indexOf(line));
    expect(places.every((at) => at >= 0), order.filter((_, i) => (places[i] as number) < 0).join(" | ")).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    // A page already up only changes its panel; a page left lets the landing go and ends the film playing.
    expect(bodyOf("left")).toMatch(/landing = null;\n\s+endIntro\(activeIntro\);/);
  });

  it("a game's route takes its opening from Day Hike's own: the film Play started, or a follower's, mounted", () => {
    const take = bodyOf("openingFor");
    const order = ["let intro = pendingIntro;", "pendingIntro = null;", "intro = startIntro(src, true);", "activeIntro = intro;", "intro.overlay.mount(container);"];
    const places = order.map((line) => take.indexOf(line));
    expect(places.every((at) => at >= 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(own).toContain("waitForBuffer(run.overlay, INTRO_BUFFER_S, INTRO_BUFFER_MAX_MS)");
    expect(own).toContain("waitForBuffer(run.overlay, INTRO_BUILD_BUFFER_S, INTRO_BUILD_BUFFER_MAX_MS)");
  });

  it("a visitor turned away is told once and shown the engine's page by the shell; Day Hike's own lets go of what is its own", () => {
    // Day Hike's own lets go of what is Day Hike's: the landing page it held, a film playing or waiting.
    const let_go = bodyOf("turnedAway");
    const mine = ["landing = null;", "endIntro(activeIntro);", "endIntro(pendingIntro);"];
    const mineAt = mine.map((line) => let_go.indexOf(line));
    expect(mineAt.every((place) => place >= 0), JSON.stringify(mineAt)).toBe(true);
    expect(mineAt).toEqual([...mineAt].sort((a, b) => a - b));
    // And writes nothing of the shell's: the session, the pause, the render's token, the roster and the page shown
    // are not handed to a game at all.
    expect(own).not.toMatch(/\bh\.(renderToken|running|game|paused|roster|shownPage|signals)\b/);
  });
});
