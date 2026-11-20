import { describe, expect, it } from "vitest";
import { emptyDragonflyList, fillDragonflyList } from "@csarkosh/engine/game/dragonflyShapes";
import type { Dragonflies } from "@csarkosh/engine/game/dragonflyBehaviour";
import { sphereInPlanes } from "@csarkosh/engine/game/lakeSeen";
import { cameraAxes, restAxes, restPlanes, viewPlanes } from "@csarkosh/engine/game/lite/cameraPose";
import { DRAGONFLY_SPHERE_M, dragonflyMatrices, unitInPlanes, vertexAlphaPlugin } from "../../../src/game/lite/dragonflyMeshes.js";
import { SEE_THROUGH_ORDER } from "@csarkosh/engine/game/lite/drawOrder";
import { MIDGE_WGSL } from "../../../src/game/lite/midgeMeshes.js";
import { WING_AMP_AT, WING_COLOURWAY_AT, WING_PHASE_AT } from "../../../src/game/lite/wingPlugin.js";
import { MIDGE_HEAD_FLOATS, swarmSphere } from "../../../src/game/midgeLook.js";
import { MIDGE_SWARMS_MAX, SWARM_ROW_FLOATS, packSwarm } from "../../../src/game/midgeMotion.js";
import { babylonText } from "../../helpers/babylonFixture.js";
import { inOrder, tight } from "./wgslText.js";

/** A stage of the game's GLSL on Babylon.js, whole, as recorded from its `.fx` file. */
const fx = (name: string): string => babylonText(`stages/${name.replace(/\.fx$/, ".glsl")}`);
const code = (name: string): string => fx(name).split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");

/** A GLSL statement of the midges' stages as the WGSL writes it. */
function asWgsl(glsl: string): string {
  return tight(glsl)
    .replace(/^(?:float|vec[234]|int)(?=[A-Za-z_])/, "let")
    .replace(/\bvec([234])\(/g, "vec$1<f32>(")
    .replace(/\bposition\./g, "input.position.")
    .replace(/\bmidgeSwarms\[/g, "midgeData.swarms[")
    .replace(/^(vCorner|vAlpha|vSunGlint|vSkyGlint)=/, "out.$1=")
    .replace(/\b(vCorner|vAlpha|vSunGlint|vSkyGlint)\b(?!=)/g, (name, _n, at, whole: string) => (whole.slice(Math.max(0, at - 4), at) === "out." ? name : `input.${name}`));
}

/** The statements of a GLSL function, one a line. */
function body(source: string, name: string): string[] {
  const start = source.search(new RegExp(`\\b${name}\\(`));
  expect(start, name).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 1, at = open + 1;
  for (; depth > 0; at++) depth += source[at] === "{" ? 1 : source[at] === "}" ? -1 : 0;
  return source.slice(open + 1, at - 1).split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

describe("the midges' stages on Babylon Lite, against the game's GLSL", () => {
  const vertex = code("midge.vertex.fx");
  const fragment = code("midge.fragment.fx");

  it("holds the GLSL's constants at the GLSL's values", () => {
    const wgsl = tight(MIDGE_WGSL.vertex + MIDGE_WGSL.fragment);
    const constants = [...(vertex + fragment).matchAll(/const float ([A-Z0-9_]+) = ([-0-9.e]+);/g)];
    expect(constants).toHaveLength(23);
    for (const [, name, value] of constants) expect(wgsl, name).toContain(`const${name}:f32=${value};`);
  });

  it("places a midge and weighs its glints by the vertex stage's statements, in order", () => {
    const wgsl = tight(MIDGE_WGSL.vertex);
    // Written otherwise by hand: the instance's pair and the uniforms' names, a local written again, the clip position.
    const byHand = /^(int at|float slot = midge|vec3 side = cross|side = normalize|gl_Position|float s = |s \+=|return|vec3 p |p \+=)/;
    const lines = [...body(vertex, "midgeHash"), ...body(vertex, "midgeAxis"), ...body(vertex, "main")].filter((line) => !byHand.test(line));
    expect(lines.length).toBeGreaterThan(25);
    for (const line of lines) expect(wgsl, line).toContain(asWgsl(line));
    expect(inOrder(wgsl, body(vertex, "main").filter((line) => !byHand.test(line)).map(asWgsl))).toBe(true);
    expect(wgsl).toContain("letmidge=input.world0.xy;");
    expect(wgsl).toContain("letat=3*i32(midge.x+0.5);letslot=midge.y;");
    expect(wgsl).toContain("varside=cross(vec3<f32>(0.0,1.0,0.0),view);side=normalize(mix(vec3<f32>(1.0,0.0,0.0),side,step(1.0e-8,dot(side,side))));");
    // The view is the scene's own, which Lite declares ahead of every stage: no copy of it is the midges'.
    expect(wgsl).toContain("out.position=scene.viewProjection*vec4<f32>(corner,1.0);");
    expect(`${MIDGE_WGSL.vertex}${MIDGE_WGSL.fragment}`).not.toMatch(/shaderSystem/);
    expect(tight(vertex)).toContain("gl_Position=viewProjection*vec4(corner,1.0);");
  });

  it("adds the glints and darkens by the speck in the fragment stage's statements, toned by its own copy of the display's curve", () => {
    const wgsl = tight(MIDGE_WGSL.fragment);
    const main = body(fragment, "main");
    const plain = main.filter((line) => !/^(vec2 tent|vec3 toned|toned = |gl_FragColor)/.test(line));
    for (const line of plain) expect(wgsl, line).toContain(asWgsl(line));
    expect(wgsl).toContain("lettent=clamp(1.0-abs(input.vCorner),vec2<f32>(0.0),vec2<f32>(1.0));");
    expect(inOrder(wgsl, [
      "vartoned=midgeNeutral(light*midgeExposure);",
      "toned=clamp(pow(max(toned,vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),vec3<f32>(0.0),vec3<f32>(1.0));",
      "toned=midgeContrastOf(toned,midgeContrast);",
      "returnvec4<f32>(mix(light,toned,step(0.5,midgeToneMap)),speck*a);",
    ])).toBe(true);
    expect(tight(fragment)).toContain("gl_FragColor=vec4(mix(light,toned,step(0.5,midgeToneMap)),speck*a);");
    for (const line of body(fragment, "midgeNeutral").filter((l) => !/^(color -= |return|vec3 compressed)/.test(l))) expect(wgsl, line).toContain(asWgsl(line));
    expect(wgsl).toContain("letcompressed=mix(color*(newPeak/top),vec3<f32>(newPeak),g);returnmix(color,compressed,step(MIDGE_NEUTRAL_START,peak));");
  });

  it("reads the game's uniforms from one run of floats: five vec4s, then the table", () => {
    expect(MIDGE_HEAD_FLOATS).toBe(20);
    const rows = (SWARM_ROW_FLOATS * MIDGE_SWARMS_MAX) / 4;
    expect(tight(vertex)).toContain(`uniformvec4midgeSwarms[${rows}];`);
    for (const stage of [MIDGE_WGSL.vertex, MIDGE_WGSL.fragment]) {
      expect(tight(stage)).toContain(`structMidgeData{eye:vec4<f32>,sun:vec4<f32>,sunLight:vec4<f32>,skyGlow:vec4<f32>,tone:vec4<f32>,swarms:array<vec4<f32>,${rows}>}`);
    }
    const wgsl = tight(MIDGE_WGSL.vertex + MIDGE_WGSL.fragment);
    for (const read of [
      "letmidgeEye=midgeData.eye.xyz;", "letmidgeTime=midgeData.eye.w;", "letmidgeSun=midgeData.sun.xyz;", "letmidgeNight=midgeData.sun.w;",
      "letmidgeSunLight=midgeData.sunLight.xyz;", "letmidgeSkyLuma=midgeData.sunLight.w;", "letmidgeSkyGlow=midgeData.skyGlow.xyz;", "letmidgePixel=midgeData.skyGlow.w;",
      "letmidgeExposure=midgeData.tone.x;", "letmidgeToneMap=midgeData.tone.y;", "letmidgeContrast=midgeData.tone.z;",
    ]) expect(wgsl, read).toContain(read);
  });
});

describe("the dragonflies' instances on Babylon Lite", () => {
  const units: Dragonflies = {
    count: [2, 0, 0],
    poses: [[{ x: 1, y: 2, z: 3, yaw: 0.4, pitch: 0, perched: false, id: 7 }, { x: 4, y: 5, z: 6, yaw: 1, pitch: 0, perched: true, id: 8 }], [], []],
    rustles: [],
    step() {},
  };

  it("carry the wing's phase and beat and the colourway in the matrix's last row, and say when one moved", () => {
    const list = fillDragonflyList(emptyDragonflyList(), units, 0, 42);
    const own = new Float32Array(list.matrices.length);
    expect(dragonflyMatrices(list, own)).toBe(true);
    for (let i = 0; i < 2; i++) {
      expect(own[i * 16 + WING_PHASE_AT]).toBe(list.wing[i * 2]);
      expect(own[i * 16 + WING_AMP_AT]).toBe(list.wing[i * 2 + 1]);
      expect(own[i * 16 + WING_COLOURWAY_AT]).toBe(list.way[i]);
      for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 15]) expect(own[i * 16 + k]).toBe(list.matrices[i * 16 + k]);
    }
    expect(dragonflyMatrices(list, own)).toBe(false);
    (units.poses[0][0] as { x: number }).x = 1.5;
    expect(dragonflyMatrices(fillDragonflyList(list, units, 0, 42), own)).toBe(true);
  });

  it("blend by the card's alpha, a vertex's second coordinate, and stand last of the see-through draws after the midges", () => {
    expect(vertexAlphaPlugin().getCustomCode?.("fragment")).toEqual({ CUSTOM_FRAGMENT_BEFORE_LIGHTS: "alpha*=input.uv.y;" });
    expect(vertexAlphaPlugin().getCustomCode?.("vertex")).toBeNull();
    expect(SEE_THROUGH_ORDER.water).toBeLessThan(SEE_THROUGH_ORDER.midges);
    expect(SEE_THROUGH_ORDER.midges).toBeLessThan(SEE_THROUGH_ORDER.dragonflies);
    // Last of what stands in the world: only the shade veil, laid over the finished frame, follows.
    expect(Math.max(...Object.values(SEE_THROUGH_ORDER).filter((place) => place !== SEE_THROUGH_ORDER.veil))).toBe(SEE_THROUGH_ORDER.dragonflies);
  });
});

/** The view's planes from (x, y, z) at `yaw`, level, through a lens 1.4 rad tall and 1.5 wide. */
function view(x: number, y: number, z: number, yaw: number) {
  return viewPlanes({ x, y, z, yaw, pitch: 0, roll: 0 }, cameraAxes(yaw, 0, 0, restAxes()), 1.4, 1.5, 0.1, 2500, restPlanes());
}

describe("a lake's insects shown by the view on Babylon Lite", () => {
  it("draws a kind of dragonfly while the view holds one of its units", () => {
    const matrices = new Float32Array(32);
    matrices.set([10, 2, 30], 12);
    matrices.set([10, 2, -30], 28);
    const ahead = view(10, 2, 0, 0);
    expect(unitInPlanes(matrices, 2, ahead)).toBe(true);
    expect(unitInPlanes(matrices, 1, view(10, 2, 0, Math.PI))).toBe(false);
    expect(unitInPlanes(matrices, 2, view(10, 2, 0, Math.PI))).toBe(true);
    expect(unitInPlanes(matrices, 0, ahead)).toBe(false);
    expect(DRAGONFLY_SPHERE_M).toBeGreaterThan(0.07 * 3);
  });

  it("gives a swarm with a midge the sphere its midges stray in, and none to an empty row", () => {
    const table = new Float32Array(SWARM_ROW_FLOATS * MIDGE_SWARMS_MAX);
    packSwarm(table, 3, { cx: 5, cy: 6, cz: 7, swirl: 0, flatten: 0 }, 2, 4, 100, 1, true, 9);
    packSwarm(table, 4, { cx: 5, cy: 6, cz: 7, swirl: 0, flatten: 0 }, 2, 4, 0, 1, true, 9);
    packSwarm(table, 5, { cx: 5, cy: 6, cz: 7, swirl: 0, flatten: 0 }, 2, 4, 100, 0, true, 9);
    const sphere: [number, number, number, number] = [0, 0, 0, 0];
    expect(swarmSphere(table, 3, sphere)).toBe(true);
    expect(sphere.slice(0, 3)).toEqual([5, 6, 7]);
    expect(sphere[3]).toBeCloseTo(Math.hypot(2, 2, 4), 6);
    expect(swarmSphere(table, 4, sphere)).toBe(false);
    expect(swarmSphere(table, 5, sphere)).toBe(false);
    expect(swarmSphere(table, 0, sphere)).toBe(false);
    expect(sphereInPlanes(5, 6, 7, sphere[3], view(5, 6, -20, 0))).toBe(true);
    expect(sphereInPlanes(5, 6, 7, Math.hypot(2, 2, 4), view(5, 6, -20, Math.PI))).toBe(false);
  });
});
