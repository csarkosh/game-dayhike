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
      "pendingIntro", "activeIntro", "titleLoop", "landingNotice", "turnedAwayView", "side.selfName",
      "introSource", "startIntro", "endIntro", "cutIntro", "waitForBuffer", "INTRO_BUFFER", "INTRO_BUILD_BUFFER",
      "warmFilmHead", "landingInput", "repaintLanding", "panelFor", "currentMode",
    ]) {
      expect(shell, inner).not.toMatch(new RegExp(`\\b${inner}`));
    }
    // Nor the modules those are made with.
    for (const module of ["game/landing.js", "game/landingModel.js", "game/titleLoop.js", "game/introOverlay.js", "game/filmHead.js"]) {
      expect(shell, module).not.toContain(module);
    }
    // The player's name is no longer one of them: the engine keeps it (`playerName.ts`), and Day Hike's own of the page holds none.
    expect(own).not.toMatch(/playerName|selfName|loadName|saveName|\brename\b/);
    // Nor the page for those turned away, which is the engine's and shown by the shell: Day Hike's own draws none of it.
    expect(own).not.toMatch(/renderTurnedAway|turnedAwayModel|turnedAwayView|game\/turnedAway|creditsEntries|visitorDevice/);
  });

  it("Play stops the title's loop and starts the film, to be carried into the game", () => {
    expect(shell).toMatch(/    telemetry\.event\("play", [^\n]+\n(?:    \/\/[^\n]*\n)*    side\.played\(\);\n    side\.repaint\(\);/);
    const played = bodyOf("played");
    expect(played.indexOf("titleLoop?.stop();")).toBeGreaterThan(0);
    expect(played.indexOf("pendingIntro = startIntro(src, false);")).toBeGreaterThan(played.indexOf("titleLoop?.stop();"));
    expect(played).toContain("endIntro(pendingIntro);");
  });

  it("the landing page is shown by Day Hike's own, with the shell's handlers", () => {
    expect(shell).toMatch(/    if \(isLandingRoute\(route\)\) \{\n      running = side\.showLanding\(container, route, \{/);
    const show = bodyOf("showLanding");
    const order = ["endIntro(pendingIntro);", "titleLoop = createTitleLoop(", "warmFilmHead();", "landingNotice = takeNotice(", "renderLanding(", "landing = handle;", "void h.latestReady.then("];
    const places = order.map((line) => show.indexOf(line));
    expect(places.every((at) => at >= 0), order.filter((_, i) => (places[i] as number) < 0).join(" | ")).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    // A page already up only changes its panel; a page left lets the landing go and ends the film playing.
    expect(shell).toContain("    if (isLandingRoute(route) && side.landingUp()) {\n      side.showPanel(route);");
    expect(bodyOf("left")).toMatch(/landing = null;\n\s+endIntro\(activeIntro\);/);
    expect(shell).toMatch(/    paused = false;\n    side\.left\(\);\n    container\.replaceChildren\(\);/);
  });

  it("a game's route takes its opening from Day Hike's own: the film Play started, or a follower's, mounted", () => {
    expect(shell).toContain('    const opening = side.openingFor(container, lobby !== null && lobby.state.role === "client");');
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

  it("a visitor turned away is told once and shown the engine's page by the shell; Day Hike's own lets go of what is its own", () => {
    expect(shell).toContain("    if (away !== null) away.setView(awayView(next));\n    else render(app);");
    expect(shell).toContain("    // Gone with everything else of the game once a visitor is turned away.\n    if (away !== null) return;");
    // What goes before the page is the shell's, done once and in this order, for every game alike; the page is
    // up, by the shell's own account, only once it is drawn.
    const at = shell.indexOf("  function turnAway(container: HTMLDivElement, route: Route, why: TurnedAway): void {");
    expect(at).toBeGreaterThan(0);
    const turn = shell.slice(at, shell.indexOf("\n  }\n", at));
    const order = [
      "renderToken += 1;", 'telemetry.mark("turned-away");', "if (away !== null) return;", "running?.dispose();", "running = null;", "game = null;", "paused = false;",
      "container.replaceChildren();", "mute.dispose();", "roster.dispose();", "if (veil.down) veil.lift();", "if (shownPage === null) {",
      'telemetry.event("page", { kind: route.kind });', "window.visits?.page?.();", "side.turnedAway();",
      "const handle = renderTurnedAway(container, awayView(why), {", "still: page.away.still(),", "credits: page.away.credits(),",
      'onDownload: (platform) => telemetry.event("download", { platform }),', "away = handle;", "void latestReady.then(() => handle.setView(awayView(why)));",
    ];
    const places = order.map((line) => turn.indexOf(line));
    expect(places.every((place) => place >= 0), JSON.stringify(places)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(shell.split("away = ").length - 1).toBe(1);
    // The page says the game's own name, and what the shell knows of the visitor's browser and computer.
    expect(shell).toContain("    return turnedAwayModel({\n      title: page.title,\n      reason: why.reason,\n      short: why.short,\n      desktop,\n");
    // Day Hike's own lets go of what is Day Hike's: the landing page it held, a film playing or waiting.
    const let_go = bodyOf("turnedAway");
    const mine = ["landing = null;", "endIntro(activeIntro);", "endIntro(pendingIntro);"];
    const mineAt = mine.map((line) => let_go.indexOf(line));
    expect(mineAt.every((place) => place >= 0), JSON.stringify(mineAt)).toBe(true);
    expect(mineAt).toEqual([...mineAt].sort((a, b) => a - b));
    // And writes nothing of the shell's: the session, the pause, the render's token, the roster and the page shown
    // are not handed to a game at all.
    expect(own).not.toMatch(/\bh\.(renderToken|running|game|paused|roster|shownPage|signals)\b/);
    const host = sourceText("game/pageGame.ts");
    const fields = host.slice(host.indexOf("export type PageHost = {"), host.indexOf("\n};\n", host.indexOf("export type PageHost = {")));
    expect(fields).not.toMatch(/^ {2}(?!readonly )\w/m);
    expect(fields).not.toMatch(/\b(renderToken|running|game|paused|roster|shownPage|signals)\b/);
    expect(host).not.toContain("awayShown");
    expect(host).not.toMatch(/showTurnedAway|turnedAwayNow/);
    // The row is the shell's, sent once.
    expect(shell.split('telemetry.event("turned_away"').length - 1).toBe(1);
  });

  it("the name is the shell's, kept under the game's key; the mode is asked of Day Hike's own", () => {
    expect(shell).toContain("  let selfName = loadName(page.name);");
    expect(shell).toContain("      selfName = saveName(page.name, raw);\n      lobby?.setName(selfName);");
    expect(shell).toContain("        selfName,\n        inviteUrl:");
    expect(shell).toContain("        name: selfName,\n        route: hostRoute(currentRoutePath()),");
    expect(shell).toContain("joinLobby({ signaling, peerId: selfId, lobbyId, name: selfName });");
    expect(shell).not.toMatch(/side\.(name|rename)\b/);
    expect(shell).toContain("      mode: { choice: side.mode, save: side.saveMode },");
  });
});
