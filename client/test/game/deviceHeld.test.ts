import { describe, expect, it } from "vitest";
import { createDeviceHeld, texelBytes, textureBytes, type HeldDevice } from "@csarkosh/engine/game/deviceHeld";

/** A device as the count meets one: its calls on a prototype, as a browser's are, and what it makes with a `destroy` on a prototype of its own. */
function fakeDevice(): { device: HeldDevice & { createBuffer(d: { size: number }): { size: number; destroy(): void } ; createTexture(d: object): { destroy(): void } }; destroyed: unknown[] } {
  const destroyed: unknown[] = [];
  const made = {
    destroy(this: unknown) {
      destroyed.push(this);
    },
  };
  const proto = {
    createBuffer(this: unknown, d: { size: number }) {
      return Object.assign(Object.create(made) as object, { size: d.size, device: this });
    },
    createTexture(this: unknown, d: { size: number[]; format: string; mipLevelCount?: number; sampleCount?: number; dimension?: string }) {
      return Object.assign(Object.create(made) as object, {
        width: d.size[0], height: d.size[1] ?? 1, depthOrArrayLayers: d.size[2] ?? 1, format: d.format, mipLevelCount: d.mipLevelCount ?? 1, sampleCount: d.sampleCount ?? 1,
        dimension: d.dimension ?? "2d", device: this,
      });
    },
  };
  return { device: Object.create(proto) as never, destroyed };
}

describe("the bytes a texture was asked for", () => {
  it("is its texels by its format's size", () => {
    expect(texelBytes("rgba8unorm")).toBe(4);
    expect(texelBytes("bgra8unorm-srgb")).toBe(4);
    expect(texelBytes("rgba16float")).toBe(8);
    expect(texelBytes("rgba32float")).toBe(16);
    expect(texelBytes("r16float")).toBe(2);
    expect(texelBytes("rg8unorm")).toBe(2);
    expect(texelBytes("r8unorm")).toBe(1);
    expect(texelBytes("depth24plus-stencil8")).toBe(4);
    expect(texelBytes("depth16unorm")).toBe(2);
    expect(texelBytes("astc-4x4-unorm-srgb")).toBe(1);
    expect(texelBytes("astc-8x8-unorm")).toBe(0.25);
    expect(texelBytes("bc1-rgba-unorm")).toBe(0.5);
    expect(texelBytes("bc7-rgba-unorm")).toBe(1);
    // One it does not know is taken as four bytes a texel.
    expect(texelBytes("something-new")).toBe(4);
  });

  it("counts every mip, layer and sample", () => {
    expect(textureBytes({ width: 1470, height: 956, format: "rgba16float", sampleCount: 4 })).toBe(1470 * 956 * 8 * 4);
    expect(textureBytes({ width: 4, height: 4, format: "rgba8unorm", mipLevelCount: 3 })).toBe((16 + 4 + 1) * 4);
    expect(textureBytes({ width: 256, height: 256, depthOrArrayLayers: 6, format: "rgba8unorm" })).toBe(256 * 256 * 6 * 4);
    // A volume's depth halves with its mips; an array's layers do not.
    expect(textureBytes({ width: 4, height: 4, depthOrArrayLayers: 4, mipLevelCount: 2, format: "r8unorm", dimension: "3d" })).toBe(64 + 8);
    expect(textureBytes({ width: 4, height: 4, depthOrArrayLayers: 4, mipLevelCount: 2, format: "r8unorm" })).toBe(64 + 16);
    expect(textureBytes({ width: 512, format: "r32float" })).toBe(512 * 4);
  });
});

describe("what a device holds", () => {
  it("counts each buffer and texture as it is made, and hands the device's own answer back", () => {
    const { device } = fakeDevice();
    const held = createDeviceHeld();
    expect(held.counts).toEqual({ buffers: 0, bufferBytes: 0, textures: 0, textureBytes: 0 });
    held.count(device);
    const buffer = device.createBuffer({ size: 4096 }) as unknown as { size: number; device: unknown };
    device.createBuffer({ size: 100 });
    const texture = device.createTexture({ size: [64, 32], format: "rgba8unorm" }) as unknown as { width: number; device: unknown };
    // The device's own call ran on the device.
    expect(buffer.device).toBe(device);
    expect(texture.device).toBe(device);
    expect(buffer.size).toBe(4096);
    expect(held.counts).toEqual({ buffers: 2, bufferBytes: 4196, textures: 1, textureBytes: 64 * 32 * 4 });
  });

  it("takes each off the count when it is destroyed, once, and its own destroy runs each time", () => {
    const { device, destroyed } = fakeDevice();
    const held = createDeviceHeld();
    held.count(device);
    const a = device.createBuffer({ size: 10 });
    const b = device.createBuffer({ size: 20 });
    const t = device.createTexture({ size: [8, 8], format: "r8unorm" });
    a.destroy();
    expect(held.counts).toEqual({ buffers: 1, bufferBytes: 20, textures: 1, textureBytes: 64 });
    expect(destroyed).toEqual([a]);
    // A second destroy is the buffer's own alone: nothing is taken off twice.
    a.destroy();
    expect(held.counts.buffers).toBe(1);
    expect(destroyed).toEqual([a, a]);
    t.destroy();
    b.destroy();
    expect(held.counts).toEqual({ buffers: 0, bufferBytes: 0, textures: 0, textureBytes: 0 });
    expect(Object.hasOwn(a, "destroy")).toBe(false);
  });

  it("stops counting what the device makes once told, and leaves the device its own calls", () => {
    const { device } = fakeDevice();
    const held = createDeviceHeld();
    held.count(device);
    const kept = device.createBuffer({ size: 8 });
    held.stop();
    expect(Object.hasOwn(device, "createBuffer")).toBe(false);
    expect(Object.hasOwn(device, "createTexture")).toBe(false);
    device.createBuffer({ size: 1000 });
    expect(held.counts).toEqual({ buffers: 1, bufferBytes: 8, textures: 0, textureBytes: 0 });
    // What was made while it counted still lets go cleanly.
    expect(() => kept.destroy()).not.toThrow();
    // A second stop, or a stop before any count, does nothing.
    held.stop();
    createDeviceHeld().stop();
  });

  it("counts a new device in place of the last", () => {
    const first = fakeDevice();
    const second = fakeDevice();
    const held = createDeviceHeld();
    held.count(first.device);
    held.count(second.device);
    expect(Object.hasOwn(first.device, "createBuffer")).toBe(false);
    first.device.createBuffer({ size: 5 });
    second.device.createBuffer({ size: 7 });
    expect(held.counts.bufferBytes).toBe(7);
  });
});
