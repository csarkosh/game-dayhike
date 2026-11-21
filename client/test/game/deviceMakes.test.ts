import { describe, expect, it } from "vitest";
import { createDeviceMakes, type MakesDevice } from "@csarkosh/engine/game/deviceMakes";

/** A device as the count meets one: its calls on a prototype, as a browser's are, each saying it ran. */
function fakeDevice(): { device: MakesDevice; ran: string[]; settle: (() => void)[] } {
  const ran: string[] = [];
  const settle: (() => void)[] = [];
  const later = (name: string) => (): Promise<unknown> => {
    ran.push(name);
    return new Promise((resolve) => settle.push(() => resolve(name)));
  };
  const proto = {
    createShaderModule(this: unknown, d: { code: string }) {
      ran.push(`module ${d.code}`);
      return { module: d.code, self: this };
    },
    createRenderPipeline: () => (ran.push("render"), { pipeline: "render" }),
    createRenderPipelineAsync: later("render async"),
    createComputePipeline: () => (ran.push("compute"), { pipeline: "compute" }),
    createComputePipelineAsync: later("compute async"),
  };
  return { device: Object.create(proto) as MakesDevice, ran, settle };
}
const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("what a device is asked to make", () => {
  it("counts each kind as it is asked, and hands the device's own answer back", () => {
    const { device, ran } = fakeDevice();
    const makes = createDeviceMakes();
    makes.count(device);
    const made = device.createShaderModule({ code: "a" } as never) as { module: string; self: unknown };
    device.createShaderModule({ code: "b" } as never);
    device.createRenderPipeline({} as never);
    device.createComputePipeline({} as never);
    expect(made.module).toBe("a");
    // The device's own call ran on the device.
    expect(made.self).toBe(device);
    expect(ran).toEqual(["module a", "module b", "render", "compute"]);
    expect(makes.total).toEqual({ modules: 2, pipelines: 2, pipelinesAsync: 0 });
  });

  it("tells its listeners at the end of a frame that asked for something, and of no other", () => {
    const { device } = fakeDevice();
    const makes = createDeviceMakes();
    makes.count(device);
    let told = 0;
    const off = makes.onMade(() => told++);
    expect(makes.frameEnd()).toBe(false);
    device.createShaderModule({ code: "a" } as never);
    device.createRenderPipeline({} as never);
    expect(told).toBe(0);
    expect(makes.frameEnd()).toBe(true);
    expect(told).toBe(1);
    expect(makes.frameEnd()).toBe(false);
    expect(told).toBe(1);
    off();
    device.createRenderPipeline({} as never);
    makes.frameEnd();
    expect(told).toBe(1);
  });

  it("keeps a pipeline asked for off the page's thread pending until it lands, and tells of the frame it landed before", async () => {
    const { device, settle } = fakeDevice();
    const makes = createDeviceMakes();
    makes.count(device);
    let told = 0;
    makes.onMade(() => told++);
    void device.createRenderPipelineAsync({} as never);
    void device.createComputePipelineAsync({} as never);
    expect(makes.pending).toBe(2);
    expect(makes.total.pipelinesAsync).toBe(2);
    makes.frameEnd();
    expect(told).toBe(1);
    makes.frameEnd();
    expect(told).toBe(1);
    for (const land of settle) land();
    await turn();
    expect(makes.pending).toBe(0);
    makes.frameEnd();
    expect(told).toBe(2);
  });

  it("takes its functions off the device when it stops, and off one device when it counts another", () => {
    const a = fakeDevice();
    const b = fakeDevice();
    const makes = createDeviceMakes();
    makes.count(a.device);
    expect(Object.keys(a.device).sort()).toEqual(["createComputePipeline", "createComputePipelineAsync", "createRenderPipeline", "createRenderPipelineAsync", "createShaderModule"]);
    makes.count(b.device);
    expect(Object.keys(a.device)).toEqual([]);
    a.device.createShaderModule({ code: "x" } as never);
    expect(makes.total.modules).toBe(0);
    let told = 0;
    makes.onMade(() => told++);
    makes.stop();
    expect(Object.keys(b.device)).toEqual([]);
    b.device.createShaderModule({ code: "y" } as never);
    expect(makes.frameEnd()).toBe(false);
    expect(told).toBe(0);
    // And the devices still answer by their own calls.
    expect(b.ran).toEqual(["module y"]);
  });
});
