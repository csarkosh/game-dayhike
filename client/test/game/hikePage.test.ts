import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

/**
 * The page's shell (`shell.ts`, the engine's: the routes, the lobby, the start of a session) calls Day Hike's own
 * of the page (`hikePage.ts`: the intro's film, the title's loop, the landing page, the page for
 * those turned away, the name, the mode) at the page's own points, by names that say what the point
 * is. The shell reads and writes none of Day Hike's variables.
 */

const shell = sourceText("shell.ts");
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
    for (const inner of [
      "pendingIntro", "activeIntro", "titleLoop", "landingNotice", "turnedAwayView", "hikePage.selfName",
      "introSource", "startIntro", "endIntro", "cutIntro", "waitForBuffer", "INTRO_BUFFER", "INTRO_BUILD_BUFFER",
      "warmFilmHead", "landingInput", "repaintLanding", "panelFor", "currentMode",
    ]) {
      expect(shell, inner).not.toMatch(new RegExp(`\\b${inner}`));
    }
    // Nor the modules those are made with.
    for (const module of ["game/landing.js", "game/landingModel.js", "game/titleLoop.js", "game/introOverlay.js", "game/playerName.js", "game/filmHead.js", "game/turnedAway"]) {
      expect(shell, module).not.toContain(module);
    }
  });

  it("Play stops the title's loop and starts the film, to be carried into the game", () => {
    expect(shell).toMatch(/    telemetry\.event\("play", [^\n]+\n(?:    \/\/[^\n]*\n)*    hikePage\.played\(\);\n    hikePage\.repaint\(\);/);
    const played = bodyOf("played");
    expect(played.indexOf("titleLoop?.stop();")).toBeGreaterThan(0);
    expect(played.indexOf("pendingIntro = startIntro(src, false);")).toBeGreaterThan(played.indexOf("titleLoop?.stop();"));
    expect(played).toContain("endIntro(pendingIntro);");
  });

  it("the landing page is shown by Day Hike's own, with the shell's handlers", () => {
    expect(shell).toMatch(/    if \(isLandingRoute\(route\)\) \{\n      running = hikePage\.showLanding\(container, route, \{/);
    const show = bodyOf("showLanding");
    const order = ["endIntro(pendingIntro);", "titleLoop = createTitleLoop(", "warmFilmHead();", "landingNotice = takeNotice(", "renderLanding(", "landing = handle;", "void h.latestReady.then("];
    const places = order.map((line) => show.indexOf(line));
    expect(places.every((at) => at >= 0), order.filter((_, i) => (places[i] as number) < 0).join(" | ")).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    // A page already up only changes its panel; a page left lets the landing go and ends the film playing.
    expect(shell).toContain("    if (isLandingRoute(route) && hikePage.landingUp()) {\n      hikePage.showPanel(route);");
    expect(bodyOf("left")).toMatch(/landing = null;\n\s+endIntro\(activeIntro\);/);
    expect(shell).toMatch(/    paused = false;\n    hikePage\.left\(\);\n    container\.replaceChildren\(\);/);
  });

  it("a game's route takes its opening from Day Hike's own: the film Play started, or a follower's, mounted", () => {
    expect(shell).toContain('    const opening = hikePage.openingFor(container, lobby !== null && lobby.state.role === "client");');
    const take = bodyOf("openingFor");
    const order = ["let intro = pendingIntro;", "pendingIntro = null;", "intro = startIntro(src, true);", "activeIntro = intro;", "intro.overlay.mount(container);"];
    const places = order.map((line) => take.indexOf(line));
    expect(places.every((at) => at >= 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    // The start waits on the opening twice, fails through it and launches under it.
    for (const call of ["opening.beforeEngine()", "opening.beforeBuild()", "opening?.failed()", "opening?.launched(handle)", "opening?.connectPanel()", "deferClipmap: opening !== null,"]) {
      expect(shell, call).toContain(call);
    }
    expect(own).toContain("waitForBuffer(run.overlay, INTRO_BUFFER_S, INTRO_BUFFER_MAX_MS)");
    expect(own).toContain("waitForBuffer(run.overlay, INTRO_BUILD_BUFFER_S, INTRO_BUILD_BUFFER_MAX_MS)");
  });

  it("a visitor turned away is told once and shown the page, by Day Hike's own", () => {
    expect(shell).toContain("    if (!hikePage.turnedAwayNow(next)) render(app);");
    const now = bodyOf("turnedAwayNow");
    expect(now).toContain("turnedAway.setView(turnedAwayView(next));");
    expect(shell).toContain("    if (hikePage.awayShown()) return;");
    // The row is the shell's, sent once.
    expect(shell.split('telemetry.event("turned_away"').length - 1).toBe(1);
  });

  it("the name and the mode are asked of Day Hike's own", () => {
    expect(shell).toContain("      lobby?.setName(hikePage.rename(raw));");
    expect(shell).toContain("        selfName: hikePage.name(),");
    expect(shell).toContain("      mode: { choice: hikePage.mode, save: hikePage.saveMode },");
  });
});
