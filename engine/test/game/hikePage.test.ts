import { describe, expect, it } from "vitest";
import { sourceText } from "../helpers/source.js";

/**
 * The page's shell (`shell.ts`, the engine's: the routes, the lobby, the start of a session) calls Day Hike's own
 * of the page (`hikePage.ts`) at the page's own points, by names that say what the point is. The shell reads and
 * writes none of Day Hike's variables; Day Hike's own half is read by Day Hike's suite (`client/test/game/hikePage.test.ts`).
 */

const shell = sourceText("shell.ts");

describe("the page's shell and Day Hike's own of the page", () => {
  it("the shell names none of Day Hike's variables of the page: the engine's half", () => {
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
  });

  it("Play stops the title's loop and starts the film, to be carried into the game: the engine's half", () => {
    expect(shell).toMatch(/    telemetry\.event\("play", [^\n]+\n(?:    \/\/[^\n]*\n)*    side\.played\(\);\n    side\.repaint\(\);/);
  });

  it("the landing page is shown by Day Hike's own, with the shell's handlers: the engine's half", () => {
    expect(shell).toMatch(/    if \(isLandingRoute\(route\)\) \{\n      running = side\.showLanding\(container, route, \{/);
    // A page already up only changes its panel; a page left lets the landing go and ends the film playing.
    expect(shell).toContain("    if (isLandingRoute(route) && side.landingUp()) {\n      side.showPanel(route);");
    expect(shell).toMatch(/    paused = false;\n    side\.left\(\);\n    container\.replaceChildren\(\);/);
  });

  it("a game's route takes its opening from Day Hike's own: the film Play started, or a follower's, mounted: the engine's half", () => {
    expect(shell).toContain('    const opening = side.openingFor(container, lobby !== null && lobby.state.role === "client");');
    // The start waits on the opening twice, fails through it and launches under it.
    for (const call of ["opening.beforeEngine()", "opening.beforeBuild()", "opening?.failed()", "opening?.launched(handle)", "opening?.connectPanel()", "deferClipmap: opening !== null,"]) {
      expect(shell, call).toContain(call);
    }
  });

  it("a visitor turned away is told once and shown the engine's page by the shell; Day Hike's own lets go of what is its own: the engine's half", () => {
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
    expect(shell).toContain("    return turnedAwayModel({\n      title: page.identity.title,\n      reason: why.reason,\n      short: why.short,\n      desktop,\n");
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
    expect(shell).toContain("  let selfName = loadName(selfNameOf);");
    expect(shell).toContain("      selfName = saveName(selfNameOf, raw);\n      lobby?.setName(selfName);");
    expect(shell).toContain("        selfName,\n        inviteUrl:");
    expect(shell).toContain("        name: selfName,\n        route: hostRoute(currentRoutePath()),");
    expect(shell).toContain("joinLobby({ signaling, peerId: selfId, lobbyId, name: selfName });");
    expect(shell).not.toMatch(/side\.(name|rename)\b/);
    expect(shell).toContain("      mode: { choice: side.mode, save: side.saveMode },");
  });
});
