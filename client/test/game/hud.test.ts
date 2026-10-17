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

describe("the HUD's pause button", () => {
  it("shows the bars and the key that pauses, pauses when pressed, and goes on null", () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    doc.body.append(container);
    let paused = 0;
    const hud = createHud(asHtml(container), { onPause: () => paused++ });
    const pause = container.querySelector("button.pause") as StandInElement;
    expect(pause.getAttribute("aria-label")).toBe("Pause");
    expect(pause.classList.contains("shown")).toBe(false);
    expect(hud.pause()).toBeNull();
    hud.setPause({ key: "Esc" });
    expect(pause.classList.contains("shown")).toBe(true);
    expect(pause.querySelector("span.key")?.textContent).toBe("Esc");
    expect(pause.querySelector("svg")).not.toBeNull();
    expect(hud.pause()).toEqual({ key: "Esc" });
    pause.click();
    expect(paused).toBe(1);
    hud.setPause(null);
    expect(pause.classList.contains("shown")).toBe(false);
    expect(hud.pause()).toBeNull();
    hud.dispose();
  });

  it("is pressed without a hook to no effect", () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    doc.body.append(container);
    const hud = createHud(asHtml(container));
    hud.setPause({ key: "Esc" });
    expect(() => (container.querySelector("button.pause") as StandInElement).click()).not.toThrow();
    hud.dispose();
  });
});
