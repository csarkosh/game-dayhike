import { describe, it, expect } from "vitest";
import { createHud } from "../../src/game/hud.js";
import { StandInElement, asHtml, installStandInDom } from "./helpers/standInDom.js";

describe("the HUD's lamp hint", () => {
  it("shows the torch and the key that lights it, lit with the lamp, and goes on null", () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    doc.body.append(container);
    const hud = createHud(asHtml(container));
    const lamp = container.querySelector("div.lamp") as StandInElement;
    expect(lamp.classList.contains("shown")).toBe(false);
    expect(hud.lamp()).toBeNull();
    hud.setLamp({ key: "F", on: false });
    expect(lamp.classList.contains("shown")).toBe(true);
    expect(lamp.classList.contains("lit")).toBe(false);
    expect(lamp.querySelector("span.key")?.textContent).toBe("F");
    expect(lamp.querySelector("svg")).not.toBeNull();
    expect(hud.lamp()).toEqual({ key: "F", on: false });
    hud.setLamp({ key: "F", on: true });
    expect(lamp.classList.contains("lit")).toBe(true);
    expect(hud.lamp()).toEqual({ key: "F", on: true });
    hud.setLamp(null);
    expect(lamp.classList.contains("shown")).toBe(false);
    expect(hud.lamp()).toBeNull();
    hud.dispose();
    expect(container.querySelector("div.hud")).toBeNull();
  });
});
