import { describe, expect, it } from "vitest";
import { FPS, createSceneClock } from "../../../src/game/scene/sceneClock.js";

describe("the scene clock", () => {
  it("runs on the wall clock from zero, in seconds", () => {
    let ms = 1000;
    const c = createSceneClock(() => ms);
    expect(c.time()).toBe(0);
    ms = 3500;
    expect(c.time()).toBe(2.5);
  });

  it("holds while hidden and resumes at the same time", () => {
    let ms = 0;
    const c = createSceneClock(() => ms);
    ms = 2000;
    c.hidden(true);
    ms = 9000;
    expect(c.time()).toBe(2);
    expect(c.held()).toBe(true);
    c.hidden(false);
    ms = 10000;
    expect(c.time()).toBe(3);
  });

  it("seeks, and a seek is idempotent", () => {
    let ms = 0;
    const c = createSceneClock(() => ms);
    c.seek(12.5);
    c.seek(12.5);
    expect(c.time()).toBe(12.5);
    ms = 500;
    expect(c.time()).toBe(13);
  });

  it("steps to a frame and holds there, whatever the wall clock does", () => {
    let ms = 0;
    const c = createSceneClock(() => ms);
    c.step(48, FPS);
    ms = 5000;
    expect(c.time()).toBe(2);
    expect(c.held()).toBe(true);
    c.hidden(true);
    c.hidden(false);
    expect(c.time()).toBe(2);
    c.resume();
    ms = 5250;
    expect(c.time()).toBe(2.25);
    expect(FPS).toBe(24);
  });
});
