// The sun's shadow map under camera motion: is it stable in the world? The game page in a Chrome
// started here (the frame-budget harness's `cdp.mjs`), the camera turned by synthetic mouse-look
// at a constant rate, and every frame a fixed world point is projected into the first cascade. A
// map that is stable keeps that point's texel coordinate still but for whole-texel steps as the
// cascade re-centres, and keeps the cascade's sphere radius constant; a map that re-phases shows
// fractional jumps, and the light on every shadow edge shimmers while the camera moves. See
// `docs/rendering/2026-10-27-shadow-cascade-flicker.md` and `client/src/game/cascadeFrustum.ts`.
//
//   node tools/flicker/probe.mjs [--base http://localhost:5173/dayhike] [--tier medium]
//     [--engine webgl2|webgpu] [--cmd "<?cmd= script>"] [--extra "<more query>"] [--turn 6]
//     [--frames 40] [--settle 20] [--phase 0.01]
//
// Prints one row a frame (whether the map was redrawn, the point's texel x/y, the cascade's
// radius) and a verdict: the largest change of the texel coordinate's fractional part between
// redraws, and the spread of the radius. Exit code 1 when either exceeds its tolerance.
//
// Under a moving sun (`--cmd "mode explore" --turn 0`: the explore day, the camera still) the
// point itself moves across the map as the light turns about the cascade, 0.0003 rad a redraw: a
// point 10 m from the cascade's centre by 0.1 texel. `--phase 0.25` allows that and still catches
// the re-phasing an origin-anchored snap makes, a random fraction of a texel every redraw.
import { randomUUID } from "node:crypto";
import { launchChrome } from "../frame-budget/lib/cdp.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const BASE = (args.base ?? "http://localhost:5173/dayhike").replace(/\/+$/, "");
const TIER = args.tier ?? "medium";
const ENGINE = args.engine ?? "webgl2";
const CMD = args.cmd ?? "seed atmo;mode game;freecam 250 -500 1.09;weather clear;time 15";
const TURN = Number(args.turn ?? 6);
const FRAMES = Number(args.frames ?? 40);
const SETTLE = Number(args.settle ?? 20);
/** A phase change over this, in texels, re-rasterises every shadow edge: the flicker. */
const PHASE_TOLERANCE = Number(args.phase ?? 0.01);
/** Babylon rounds the radius to 1/16 m; a spread under that cannot change the texel size. */
const RADIUS_TOLERANCE = 1 / 16;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A CDP session to a page target: `send(method, params)`. */
async function connectPage(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const waiting = new Map();
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) waiting.get(m.id)?.(m);
  };
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error(`cannot connect to ${wsUrl}`));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, (m) => {
        waiting.delete(n);
        if (m.error) reject(new Error(`${method}: ${m.error.message}`));
        else resolve(m.result);
      });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  send.close = () => ws.close();
  return send;
}

async function evaluate(page, expression) {
  const r = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

const url = `${BASE}/game/${randomUUID()}?cmd=${encodeURIComponent(CMD).replace(/%3B/g, ";")}&tier=${TIER}&telemetry=off&engine=${ENGINE}${args.extra ? `&${args.extra}` : ""}`;
const chrome = await launchChrome({ flags: [] });
let failed = false;
try {
  const { browserContextId } = await chrome.browser("Target.createBrowserContext");
  const { targetId } = await chrome.browser("Target.createTarget", { url: "about:blank", browserContextId, newWindow: true, width: 1300, height: 1135 });
  let target;
  for (let i = 0; !target && i < 50; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${chrome.port}/json/list`)).json();
    target = targets.find((t) => t.id === targetId);
    if (!target) await sleep(200);
  }
  const page = await connectPage(target.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${chrome.port}`));
  await page("Page.enable");
  await page("Runtime.enable");
  await page("Page.bringToFront");
  await page("Emulation.setDeviceMetricsOverride", { width: 1300, height: 1035, deviceScaleFactor: 2, mobile: false });
  await page("Page.navigate", { url });
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    if (await evaluate(page, "document.body.classList.contains('world-ready')").catch(() => false)) break;
  }
  // The engine, caught from the next frame it begins. The page keeps no handle to it.
  const caught = await evaluate(page, `(async () => {
    const u = performance.getEntriesByType("resource").map((e) => e.name).find((n) => /abstractEngine/.test(n));
    if (!u) return false;
    const proto = (await import(u)).AbstractEngine.prototype;
    const saved = ["beginFrame", "endFrame"].map((k) => [k, proto[k]]);
    await Promise.race([new Promise((resolve) => { for (const [k, f] of saved) proto[k] = function (...a) { if (this.scenes && this.scenes.length > 0) { window.__engine = this; for (const [k2, f2] of saved) proto[k2] = f2; resolve(); } return f.apply(this, a); }; }), new Promise((r) => setTimeout(r, 8000))]);
    for (const [k, f] of saved) proto[k] = f;
    return !!window.__engine;
  })()`);
  if (!caught) throw new Error("the page's engine was not caught (is this the dev server, with Babylon served as a module?)");
  await sleep(SETTLE * 1000);
  const out = await evaluate(page, `(async () => {
    const e = window.__engine, scene = e.scenes[0];
    const canvas = document.querySelector("canvas");
    Object.defineProperty(document, "pointerLockElement", { get: () => canvas, configurable: true });
    document.dispatchEvent(new Event("pointerlockchange"));
    const turn = (dx) => canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, movementX: dx, movementY: 0 }));
    const sun = scene.lights.find((l) => l.getClassName() === "DirectionalLight");
    const gen = sun && sun.getShadowGenerator();
    if (!gen) return { error: "no shadow generator on this tier" };
    const map = gen.getShadowMap();
    const cam = scene.activeCamera;
    const V = cam.position.constructor;
    const P = cam.position.add(cam.getDirection(new V(0, 0, 1)).scale(20));
    let drawn = 0;
    map.onAfterRenderObservable.add(() => { drawn++; });
    const rows = [];
    await new Promise((resolve) => {
      let i = 0;
      const step = () => {
        turn(${TURN});
        const d0 = drawn;
        scene.onAfterRenderObservable.addOnce(() => {
          const q = V.TransformCoordinates(P, gen.getCascadeTransformMatrix(0));
          const n = gen.mapSize;
          rows.push({ i, redrawn: drawn > d0, tx: (q.x * 0.5 + 0.5) * n, ty: (q.y * 0.5 + 0.5) * n, radius: gen.getCascadeMaxExtents(0).x, yaw: cam.rotation.y });
          if (++i < ${FRAMES}) requestAnimationFrame(step); else resolve();
        });
      };
      requestAnimationFrame(step);
    });
    return { mapSize: gen.mapSize, cascades: gen.numCascades, refreshRate: map.refreshRate, rows };
  })()`);
  if (out.error) throw new Error(out.error);
  console.log(`map ${out.mapSize}, ${out.cascades} cascade(s), refresh rate ${out.refreshRate}, turning ${TURN} px a frame`);
  const frac = (v) => v - Math.floor(v);
  let phaseJump = 0;
  let last = null;
  for (const r of out.rows) {
    console.log(`${String(r.i).padStart(3)} ${r.redrawn ? "drawn" : "held "} tx ${r.tx.toFixed(3).padStart(9)} ty ${r.ty.toFixed(3).padStart(9)} radius ${r.radius.toFixed(4)} yaw ${r.yaw.toFixed(3)}`);
    if (r.redrawn) {
      if (last !== null) {
        const dx = Math.abs(frac(r.tx) - frac(last.tx));
        const dy = Math.abs(frac(r.ty) - frac(last.ty));
        phaseJump = Math.max(phaseJump, Math.min(dx, 1 - dx), Math.min(dy, 1 - dy));
      }
      last = r;
    }
  }
  const radii = out.rows.map((r) => r.radius);
  const spread = Math.max(...radii) - Math.min(...radii);
  const phaseOk = phaseJump <= PHASE_TOLERANCE;
  const radiusOk = spread <= RADIUS_TOLERANCE;
  console.log(`largest texel phase jump between redraws: ${phaseJump.toFixed(4)} texel (${phaseOk ? "stable" : "RE-PHASED"}); radius spread ${spread.toFixed(4)} m (${radiusOk ? "constant" : "WOBBLES"})`);
  failed = !(phaseOk && radiusOk);
} finally {
  await chrome.close();
}
process.exit(failed ? 1 : 0);
