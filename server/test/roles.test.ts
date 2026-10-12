import { describe, it, expect } from "vitest";
import type { AddressInfo } from "node:net";
import { FakeStore } from "./fakeStore.js";
import { SharedRegistry } from "../src/sharedRegistry.js";
import { createSignalingServer } from "../src/server.js";
import type { Registry } from "../src/registry.js";

const listening = (s: { http: { once(event: "listening", fn: () => void): unknown } }) => new Promise<void>((resolve) => s.http.once("listening", () => resolve()));

describe("the telemetry role and the store", () => {
  it("holds no shared registry, so it never writes the store it may only read", async () => {
    const store = new FakeStore();
    const server = createSignalingServer(0, {
      role: "telemetry",
      log: () => undefined,
      sweepIntervalMs: 10,
      registry: (o) => new SharedRegistry(store, { ...o, instance: "T" }),
    });
    await listening(server);
    try {
      await new Promise((r) => setTimeout(r, 60));
      expect(store.ops).toEqual([]);
      const health = await fetch(`http://127.0.0.1:${(server.http.address() as AddressInfo).port}/healthcheck`);
      expect(health.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("survives a sweep the store refuses, and says so", async () => {
    const failures: unknown[] = [];
    const refusing: Registry = {
      create: () => Promise.reject(new Error("no")),
      join: () => Promise.reject(new Error("no")),
      leave: () => Promise.resolve(),
      disconnect: () => Promise.resolve(),
      relay: () => Promise.resolve(),
      info: () => undefined,
      sweep: () => Promise.reject(new Error("7 PERMISSION_DENIED: Missing or insufficient permissions.")),
      close: () => Promise.resolve(),
    };
    const server = createSignalingServer(0, {
      role: "signaling",
      log: () => undefined,
      sweepIntervalMs: 10,
      registry: () => refusing,
      onSweepError: (error) => failures.push(error),
    });
    await listening(server);
    try {
      await new Promise((r) => setTimeout(r, 60));
      expect(failures.length).toBeGreaterThan(0);
      const health = await fetch(`http://127.0.0.1:${(server.http.address() as AddressInfo).port}/healthcheck`);
      expect(health.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
