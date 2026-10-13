import { describe, it, expect } from "vitest";
import type { AddressInfo } from "node:net";
import { FakeStore } from "./fakeStore.js";
import { SharedRegistry } from "../src/sharedRegistry.js";
import { createSignalingServer } from "../src/server.js";
import type { Registry } from "../src/registry.js";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { createAdminAuth } from "../src/adminAuth.js";
import type { AdminData } from "../src/admin.js";

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

  it("serves the admin routes in the telemetry role only, however the process was given them", async () => {
    const data: AdminData = {
      live: () => Promise.resolve({ at: 0, instances: [], rooms: [] }),
      query: () => Promise.resolve([]),
      session: () => Promise.resolve([]),
      kpis: () => Promise.reject(new Error("not asked")),
    };
    // An ID token as the admin host's project (`csarko-sh`) would sign one,
    // with a key made here; `admin.test.ts` covers what the check refuses.
    const pair = await generateKeyPair("RS256");
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    const idToken = await new SignJWT({ email: "me@example.com", email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("https://securetoken.google.com/csarko-sh")
      .setAudience("csarko-sh")
      .setSubject("uid1")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(pair.privateKey);
    const admin = { auth: createAdminAuth({ projectId: "csarko-sh", allowed: ["me@example.com"], keys: createLocalJWKSet({ keys: [jwk] }) }), data };
    const headers = { origin: "https://admin.csarko.sh", authorization: `Bearer ${idToken}` };
    const telemetry = createSignalingServer(0, { role: "telemetry", log: () => undefined, admin });
    const signaling = createSignalingServer(0, { role: "signaling", log: () => undefined, admin });
    await Promise.all([listening(telemetry), listening(signaling)]);
    try {
      const served = await fetch(`http://127.0.0.1:${(telemetry.http.address() as AddressInfo).port}/admin/live`, { headers });
      expect(served.status).toBe(200);
      // The signaling service has the rooms but not the routes: a request there
      // is not found, as any unknown path is, rather than refused.
      const notHere = await fetch(`http://127.0.0.1:${(signaling.http.address() as AddressInfo).port}/admin/live`, { headers });
      expect(notHere.status).toBe(404);
    } finally {
      await Promise.all([telemetry.close(), signaling.close()]);
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
