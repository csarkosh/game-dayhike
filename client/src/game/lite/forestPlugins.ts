/**
 * The forest's, the ground cover's and the cliffs' materials as plugins on
 * Babylon Lite's PBR material: the foliage (the wind in the vertex stage, a
 * blade clump's collapse to its roots, the colour block, the canopy's cut of
 * the sky and the per-light term), the distance dither with its widening,
 * the base conform, the trunks' moss, the dead trees' dressing, a rock
 * wall's tint toward the ground under it, the wet look, and two corrections
 * of how Lite lights a surface where the game lights it otherwise. The
 * numbers each is drawn with are the game's own, computed with no engine
 * (`foliageUniforms.ts`, `distanceFade.ts`, `groundConform.ts`,
 * `deadwoodParams.ts`, `mossParams.ts`, `cliffInstances.ts`,
 * `wetSurface.ts`).
 *
 * The WGSL is, statement for statement, GLSL written for Babylon.js's PBR
 * material, of which the tests read a record
 * (`client/test/fixtures/babylon/stages/`).
 * What differs is where it goes into the material:
 *
 * - The foliage, the fade's widening and the conform are ONE plugin
 *   (`vegetationPlugin`). Babylon.js has a point of the vertex stage where
 *   each plugin moves the same world position in turn, by priority; a Lite
 *   plugin writes the clip position at the vertex stage's end, so the three
 *   run there on one running position and the clip position is made from it
 *   once. The moss and the dead trees' dressing ride with them, for their
 *   varyings are written in the same place.
 * - The foliage makes the world normal a unit one. Lite's tangent frame
 *   takes that varying for its third axis, so the length it had is kept.
 * - The canopy's cut of the sky scales the image-based light before the
 *   colour is composed. Lite has composed it by the plugin's point, so the
 *   cut share is taken out of the composed colour, and only where the scene
 *   has an image-based light (`sky`).
 * - Babylon.js runs the colour block before its reflectivity block, on the
 *   base colour; Lite has split the base colour by its point. A forest
 *   material's block starts again from the base colour (`baseColourPlugin`)
 *   and the split is made after it, with the weather's darkening
 *   (`surfaceWetPlugin`).
 * - The per-light foliage term is at Lite's point inside its light loop,
 *   after the light's own Lambert term is added: the sum takes the
 *   difference.
 * - A per-instance attribute rides in the mesh's interleaved plugin instance
 *   data (`vegetationInstanceLayout`), declared only by a material whose
 *   plugin reads it; a blade's root and draw, a per-vertex attribute, in the
 *   mesh's plugin vertex data.
 *
 * With them, the plugin a far tree's bake draws its two pictures with
 * (`impostorBakePlugin`).
 */
import type { MaterialPlugin, PluginUniformBlock, Texture2D } from "@babylonjs/lite";
import { BLADE_SOFT } from "../bladeClump.js";
import { COVER_GREEN, FOLIAGE_ALBEDO_FLOOR } from "../coverAlbedoParams.js";
import { DEADWOOD_CONTACT, DEADWOOD_CONTACT_BAND, DEADWOOD_LOG_DRAW, DEADWOOD_UP, deadwoodUniforms, emptyDeadwoodUniforms } from "../deadwoodParams.js";
import { WIDEN_NONE, emptyFadeUniforms, fadeUniforms, type DistanceWiden } from "../distanceFade.js";
import {
  FOLIAGE_BEND, FOLIAGE_BEND_R, FOLIAGE_CANOPY_SKY, FOLIAGE_CLUMP_CELL, FOLIAGE_CLUMP_LUMA, FOLIAGE_PLAYERS, FOLIAGE_SINK, FOLIAGE_TILT,
  emptyFoliageUniforms, foliageUniforms, type FoliageLook, type FoliageUniforms,
} from "../foliageUniforms.js";
import { conformUniforms } from "../groundConform.js";
import { MOSS_AMOUNT, MOSS_BAND, MOSS_EDGE, MOSS_LUMA, MOSS_ROUGHNESS, MOSS_SIDE, MOSS_SIDE_EDGE, MOSS_TILE, MOSS_TINT } from "../mossParams.js";
import type { ImpostorBakeMode } from "../impostorBake.js";
import type { WetUniforms } from "../wetSurface.js";
import { WIND_K1, WIND_K2, WIND_OMEGA_FLUTTER, WIND_OMEGA_GUST, WIND_OMEGA_GUST2, WIND_RAGGED, WIND_RAGGED_CELL } from "../windParams.js";
import { FADE_ROWS_NAME, frameReads, ownFields, ownValues } from "./frameBlock.js";
import { uniformFields, writeUniforms, type UniformField, type UniformRecord } from "./pluginUniforms.js";
import { WET_FIELDS, WET_LIGHTS, WET_WGSL, writeWetUniforms } from "./wetWgsl.js";

/**
 * The eye the foliage and the fade measure from, as the scene's own uniforms hold it for the pass being drawn. The
 * bindings recorded on Babylon.js (`foliage.bind.txt`, `distanceFade.bind.txt`) take the position of the camera the
 * scene is then drawn through (`scene.activeCamera`), so a pass with a camera of its own (a lake's shore panorama, from the lake's centre)
 * measures from that camera; the frame's block is written once a frame and holds the hike's own eye for every pass.
 */
export const PASS_EYE = "scene.vEyePosition";
const PASS_EYE_READS = /\bmaterial\.(windEye|fadeEye)\b/g;

/**
 * `wgsl` as a plugin given the frame's block reads it (`frameBlock.ts`), or as it is: the frame's uniforms from the
 * block, but the eye, which is the pass's (`PASS_EYE`).
 */
const reads = (wgsl: string, shared: PluginUniformBlock | undefined): string => (shared === undefined ? wgsl : frameReads(wgsl.replace(PASS_EYE_READS, PASS_EYE)));

/** A number as a WGSL float literal: a whole number takes its point. */
export function wgslFloat(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}
const f = wgslFloat;
const vec3 = (c: { r: number; g: number; b: number }): string => `vec3<f32>(${f(c.r)},${f(c.g)},${f(c.b)})`;

/** What of the forest's stack a material carries. */
export type Vegetation = {
  /** The eye the foliage and the fade measure from: one object, moved in place each frame. */
  eye: { readonly x: number; readonly y: number; readonly z: number };
  /** The foliage's own numbers (`foliageLook`), or null for a material that neither sways nor takes the foliage's colour block. */
  foliage: FoliageLook | null;
  /** Matched to the ground (`foliageMatched`): the card's colour drawn toward the ground's over its whole height. */
  match: boolean;
  /** The foliage's own answer to the sun: wrapped and lit from behind, under the canopy's cut. */
  light: boolean;
  /** The distance dither, by the instance's `fadeBands`. */
  fade: boolean;
  /** How the material's instances widen with eye distance; none when absent. */
  widen?: DistanceWiden;
  /** The frame the fade's noise is laid on: its height in pixels, read at each write of the material's uniforms. */
  frame: { readonly height: number };
  /** The base conform, by the instance's `groundGrad`. */
  conform: boolean;
  /** The trunks' moss map, or null for a material that carries no moss. */
  moss: Texture2D | null;
  /** The dead trees' dressing (needs `moss`): `base` is the snag's base along the model's x, set once the model is measured. */
  deadwood: { base: number } | null;
  /** Whether the scene has an image-based light, which the canopy cuts. */
  sky: boolean;
  /** The share of the ground's colour under the instance mixed into the albedo, by the
   * instance's `foliage`: a rock wall's, which wears no foliage. None when absent. */
  ground?: number;
  /** The frame's block (`frameBlock.ts`): given it, the wind, the eye and the frame's height are read from it, and
   * the material's own buffer holds only the look's numbers, which are written when it is made. */
  shared?: PluginUniformBlock;
};

/** A per-instance attribute's place in the interleaved plugin instance data: the float it starts at, or -1 where the material reads none. */
export type VegetationInstanceLayout = { fadeBands: number; groundGrad: number; foliage: number; deadwoodRole: number; bladeStrength: number; floats: number };

/** Where each per-instance attribute `v` reads sits in an instance's data, and the floats an instance. */
export function vegetationInstanceLayout(v: Pick<Vegetation, "foliage" | "fade" | "conform" | "deadwood" | "ground">): VegetationInstanceLayout {
  const layout: VegetationInstanceLayout = { fadeBands: -1, groundGrad: -1, foliage: -1, deadwoodRole: -1, bladeStrength: -1, floats: 0 };
  const take = (name: "fadeBands" | "groundGrad" | "foliage" | "deadwoodRole" | "bladeStrength", floats: number): void => {
    layout[name] = layout.floats;
    layout.floats += floats;
  };
  if (v.fade) take("fadeBands", 4);
  if (v.conform) take("groundGrad", 2);
  if ((v.foliage !== null && v.foliage.profile.groundTint > 0) || v.ground !== undefined) take("foliage", 4);
  if (v.deadwood !== null) take("deadwoodRole", 1);
  if (v.foliage !== null && v.foliage.profile.blades) take("bladeStrength", 1);
  return layout;
}

/**
 * A bucket's plugin instance data: each attribute `layout` places, taken
 * from its own array (`fadeBands` four floats an instance, `groundGrad`
 * two, `foliage` four, `deadwoodRole` and `bladeStrength` one each),
 * interleaved an instance into `out`, which holds at least `count`
 * instances.
 */
export function writeVegetationInstances(
  layout: VegetationInstanceLayout,
  count: number,
  from: { fadeBands?: Float32Array; groundGrad?: Float32Array; foliage?: Float32Array; deadwoodRole?: Float32Array; bladeStrength?: Float32Array },
  out: Float32Array,
): void {
  const parts: [number, number, Float32Array | undefined, string][] = [
    [layout.fadeBands, 4, from.fadeBands, "fadeBands"],
    [layout.groundGrad, 2, from.groundGrad, "groundGrad"],
    [layout.foliage, 4, from.foliage, "foliage"],
    [layout.deadwoodRole, 1, from.deadwoodRole, "deadwoodRole"],
    [layout.bladeStrength, 1, from.bladeStrength, "bladeStrength"],
  ];
  for (const [at, floats, source, name] of parts) {
    if (at < 0) continue;
    if (source === undefined || source.length < count * floats) throw new Error(`a bucket whose material reads ${name} was handed none`);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < floats; k++) out[i * layout.floats + at + k] = source[i * floats + k] as number;
    }
  }
}

// foliage.vertex.glsl: two octaves whose phase is the position projected onto the wind's direction, and a lattice hash.
const GUST = /* wgsl */ `fn foliageGust(p:vec2<f32>,t:f32)->f32{
  let u=material.windDir.x*p.x+material.windDir.y*p.y;
  let c=floor(p/${f(WIND_RAGGED_CELL)});
  let ragged=${f(WIND_RAGGED)}*(fract(c.x*0.618034+c.y*0.381966)-0.5);
  return sin(${f(WIND_K1)}*u-${f(WIND_OMEGA_GUST)}*t+ragged)+0.5*sin(${f(WIND_K2)}*u-${f(WIND_OMEGA_GUST2)}*t+1.7*ragged);
}`;
// The moss: a tree's draw, hashed from its foot.
const MOSS_HASH = /* wgsl */ `fn mossHash(p:vec2<f32>)->f32{var p3=fract(vec3<f32>(p.x,p.y,p.x)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}`;

/** The vertex stage: one running world position, as Babylon's `worldPos` is, and the clip position from it at the end.
 * The varying `worldPos` keeps the place before any of it, as Babylon's `vPositionW` does. */
function vertexCode(v: Vegetation): string {
  const tint = v.foliage !== null && v.foliage.profile.groundTint > 0;
  const blades = v.foliage !== null && v.foliage.profile.blades;
  // The foliage's blades: a blade clump's motion ignores the outer edge, and in place of the far sink each of
  // its blades is pulled to its root by its share of the tier's band and of the cell's strength, last, so a
  // collapsed blade's vertices coincide.
  const collapse = /* wgsl */ `{
  let bRoot=(finalWorld*vec4<f32>(blade.x,0.0,blade.y,1.0)).xyz;
  let bGrow=smoothstep(material.foliageBladeEdges.x,material.foliageBladeEdges.y,fDist);
  let bThin=smoothstep(material.foliageBladeEdges.z,material.foliageBladeEdges.w,fDist);
  let bIn=clamp((${f(1 + BLADE_SOFT)}*bGrow-blade.z)/${f(BLADE_SOFT)},0.0,1.0);
  let bOut=clamp((blade.z-bThin*${f(1 + BLADE_SOFT)})/${f(BLADE_SOFT)}+1.0,0.0,1.0);
  let bAlive=bIn*bOut*step(fract(blade.x*37.31+blade.y*91.17+0.37),bladeStrength);
  w=bRoot+(w-bRoot)*bAlive;}`;
  const foliage = v.foliage === null ? "" : /* wgsl */ `
  let fH=clamp(position.y/material.foliageHeight,0.0,1.0);
  let fH2=fH*fH;
  let fDist=distance(o,material.windEye.xz);
  let fCell=floor(o/${f(FOLIAGE_CLUMP_CELL)});
  let fClump=fract(fCell.x*0.618034+fCell.y*0.381966);
  let fScale=length(finalWorld[1].xyz);
  let fNl=length(out.worldNormal);
  let fUp=out.worldNormal/max(fNl,1.0e-6)+vec3<f32>(0.0,material.foliageNormalUp,0.0);
  let fUl=length(fUp);
  if(fUl>1.0e-4){out.worldNormal=fUp/fUl*fNl;}else{out.worldNormal=vec3<f32>(0.0,fNl,0.0);}
  let fEdge=${blades ? "1.0" : "1.0-smoothstep(material.foliageEdges.x,material.foliageEdges.y,fDist)"};
  let fM=material.foliageAmp*fH2*material.foliageHeight*fScale*fEdge;
  let fDir=vec3<f32>(material.windDir.x,0.0,material.windDir.y);
  let fGust=foliageGust(o,material.windTime+0.6*(fClump-0.5));
  w+=fDir*(material.windLean+material.windGust*fGust)*fM;
  let fFlutter=sin(2.1*w.x+1.7*w.z+${f(WIND_OMEGA_FLUTTER)}*material.windTime);
  let fF=material.windFlutter*fM*fFlutter*vec2<f32>(0.75,-0.35);
  w=vec3<f32>(w.x+fF.x,w.y,w.z+fF.y);
  if(material.foliageFlags.x>0.5){
    let fAway=o-material.windEye.xz;
    let fT=${f(FOLIAGE_TILT)}*fH2*fAway/max(length(fAway),1.0e-3);
    w=vec3<f32>(w.x+fT.x,w.y,w.z+fT.y);
  }
  if(material.foliageFlags.y>0.5){
    for(var i:i32=0;i<${FOLIAGE_PLAYERS};i++){
      let fD=o-bitcast<vec4<f32>>(material.windPlayers[i]).xz;
      let fL=length(fD);
      let fWt=1.0-clamp(fL/${f(FOLIAGE_BEND_R)},0.0,1.0);
      let fB=(fD/max(fL,1.0e-3))*(${f(FOLIAGE_BEND)}*fH2*fWt*fWt);
      w=vec3<f32>(w.x+fB.x,w.y,w.z+fB.y);
    }
  }
  ${tint
    ? `${blades ? "" : `w.y-=${f(FOLIAGE_SINK)}*material.foliageHeight*smoothstep(material.foliageEdges.x,material.foliageEdges.y,fDist);`}out.vFoliage=foliage;`
    : `out.vFoliage=vec4<f32>(0.0,0.0,0.0,1.0);`}${blades ? collapse : ""}
  out.vFoliageH=fH;out.vFoliageClump=fClump;out.vFoliageDist=fDist;`;
  // The distance fade: the bands and the distance handed on, the instance widened about its origin.
  const fade = !v.fade ? "" : /* wgsl */ `
  out.vFadeBands=fadeBands;
  let dfD=distance(o,material.fadeEye.xz);
  out.vFadeDist=dfD;
  let dfK=1.0+material.fadeWiden.z*smoothstep(material.fadeWiden.x,material.fadeWiden.y,dfD);
  w=vec3<f32>(o.x+(w.x-o.x)*dfK,w.y,o.y+(w.z-o.y)*dfK);`;
  // The base conform.
  const conform = !v.conform ? "" : /* wgsl */ `
  let gcOff=w.xz-o;
  let gcW=1.0-smoothstep(0.0,material.gcRamp,position.y);
  w.y+=gcW*min(0.0,material.gcOvershoot*dot(gcOff,groundGrad));`;
  // The moss's height and draw; or, on dead wood, the bark's coordinates from the position (round the axis, along the
  // length), over the mesh's own, and the varying.
  const moss = v.moss === null ? "" : v.deadwood === null ? `
  out.vMoss=vec2<f32>(position.y,mossHash(o));` : /* wgsl */ `{
  let dwScale=length(finalWorld[0].xyz);
  let dwAlong=position.x*dwScale*material.deadwoodBark.x;
  let dwTurn=atan2(position.y-material.deadwoodAxis.x,position.z-material.deadwoodAxis.y)/6.283185307179586;
  let dwTiles=max(1.0,floor(6.283185307179586*material.deadwoodBark.z*dwScale*material.deadwoodBark.y+0.5));
  out.uv=vec2<f32>(dwTurn*dwTiles,dwAlong);
  out.vDeadwood=vec4<f32>(deadwoodRole,(position.x+material.deadwoodBark.w)*dwScale,position.y,mossHash(o));}`;
  // A rock wall: the ground's colour under the instance, handed on untouched.
  const ground = v.ground === undefined ? "" : `
  out.vCliffTint=foliage;`;
  return `{
  var w=out.worldPos;
  let o=finalWorld[3].xz;${foliage}${fade}${conform}${moss}${ground}
  out.clipPos=scene.viewProjection*vec4<f32>(w,1.0);
}`;
}

/** The colour block before the lights: the foliage's (with its match), then the moss's or
 * the dead wood's with the moss's roughness, which the game sets where Babylon reads its own, then a rock
 * wall's tint toward the ground. */
function lightsCode(v: Vegetation): string {
  const foliage = v.foliage === null ? "" : /* wgsl */ `{
  surfaceAlbedo=mix(FOLIAGE_CARD_GREEN,surfaceAlbedo,material.foliageContrast);
  surfaceAlbedo*=mix(material.foliageRootAO,1.0,input.vFoliageH);
  let fRoot=(1.0-input.vFoliageH)*(1.0-input.vFoliageH);
  let fHas=step(1.0/255.0,max(input.vFoliage.r,max(input.vFoliage.g,input.vFoliage.b)));
  let fTintW=material.foliageTint*fRoot*(1.0+0.5*smoothstep(20.0,80.0,input.vFoliageDist))*fHas;
  surfaceAlbedo=mix(surfaceAlbedo,input.vFoliage.rgb,clamp(fTintW,0.0,0.85));
  surfaceAlbedo*=1.0+${f(FOLIAGE_CLUMP_LUMA)}*(input.vFoliageClump-0.5);
  ${v.match ? `if(fHas>0.5){surfaceAlbedo=mix(surfaceAlbedo,input.vFoliage.rgb*mix(material.foliageRootAO,1.0,input.vFoliageH)/(0.5*(material.foliageRootAO+1.0))*(1.0+${f(FOLIAGE_CLUMP_LUMA)}*(input.vFoliageClump-0.5)),0.7);}` : ""}
  surfaceAlbedo=max(surfaceAlbedo,FOLIAGE_ALBEDO_FLOOR);
  N=normalize(mix(vec3<f32>(0.0,1.0,0.0),N,mix(material.foliageNormalRoot,1.0,input.vFoliageH)));
  N=faceForward(N,-V,N);
}`;
  const mask = v.deadwood === null ? /* wgsl */ `
  let mossBand=1.0-smoothstep(${f(MOSS_BAND[0])},${f(MOSS_BAND[1])},input.vMoss.x);
  let mossSide=smoothstep(0.0,${f(MOSS_SIDE_EDGE)},dot(normalize(input.worldNormal),MOSS_SIDE));
  let mossTree=mix(${f(MOSS_AMOUNT[0])},${f(MOSS_AMOUNT[1])},input.vMoss.y);` : /* wgsl */ `
  let dwN=normalize(input.worldNormal);
  let dwLog=input.vDeadwood.x;
  let mossBand=mix(1.0-smoothstep(${f(MOSS_BAND[0])},${f(MOSS_BAND[1])},input.vDeadwood.y),1.0,dwLog);
  let mossSide=mix(smoothstep(0.0,${f(MOSS_SIDE_EDGE)},dot(dwN,MOSS_SIDE)),smoothstep(${f(DEADWOOD_UP[0])},${f(DEADWOOD_UP[1])},dwN.y),dwLog);
  let mossTree=mix(${f(MOSS_AMOUNT[0])},${f(MOSS_AMOUNT[1])},mix(input.vDeadwood.w,mix(${f(DEADWOOD_LOG_DRAW)},1.0,input.vDeadwood.w),dwLog));`;
  const moss = v.moss === null ? "" : /* wgsl */ `{${mask}
  let mossColour=textureSample(mossSampler,mossSamplerSampler,input.uv*${f(MOSS_TILE)}).rgb;
  let mossLuma=dot(mossColour,${vec3(MOSS_LUMA)});
  let mossW=smoothstep(${f(MOSS_EDGE[0])},${f(MOSS_EDGE[1])},mossBand*mossSide*mossTree*(0.5+mossLuma));
  surfaceAlbedo=mix(surfaceAlbedo,mossColour*${vec3(MOSS_TINT)},mossW);
  roughness=mix(roughness,${f(MOSS_ROUGHNESS)},mossW);
  ${v.deadwood === null ? "" : `surfaceAlbedo*=mix(1.0,mix(${f(DEADWOOD_CONTACT)},1.0,smoothstep(${f(DEADWOOD_CONTACT_BAND[0])},${f(DEADWOOD_CONTACT_BAND[1])},input.vDeadwood.z)),dwLog);`}
}`;
  // A rock wall's tint: the module's own colour and the ground's under it; a black tint is no tint.
  const ground = v.ground === undefined ? "" : `{let cHas=step(1.0/255.0,max(input.vCliffTint.r,max(input.vCliffTint.g,input.vCliffTint.b)));surfaceAlbedo=mix(surfaceAlbedo,input.vCliffTint.rgb,${f(v.ground)}*cHas);}`;
  return foliage + moss + ground;
}

// The foliage's light, inside the light loop: the directional light's Lambert term,
// which Lite has added by this point, replaced by the wrapped and back-lit one under the canopy's cut.
const FOLIAGE_LIGHT = /* wgsl */ `{
  if(u32(lights.lights[lightIndex].vLightData.w)==1u){
    let fNdotL=dot(N,pl.L);
    let fUnit=pl.color/3.14159265;
    let fWrapped=clamp((fNdotL+1.0)/(1.0+1.0),0.0,1.0);
    let fBack=pow(clamp(-dot(V,pl.L),0.0,1.0),4.0);
    let fThick=1.0-0.7*input.vFoliageH;
    let fSun=1.0-material.foliageCanopySun*(1.0-input.vFoliage.a);
    directDiffuse+=surfaceAlbedo*(fUnit*(fWrapped+0.6*fBack*fThick)*fSun-fUnit*max(fNdotL,0.0))*pl.atten*material.directIntensity*sf;
  }
}`;

// The foliage's sky: the image-based light on a card, thinned by the canopy over it.
const FOLIAGE_SKY = `{let fSky=1.0-${f(FOLIAGE_CANOPY_SKY)}*(1.0-input.vFoliage.a);color-=(finalIrradiance+finalRadianceScaled)*(1.0-fSky);}`;

// The distance fade's screen-door, before any texture is read. The noise is a fixed pattern of the pixel, whose row
// the game counts up from the frame's bottom, where a WGSL fragment's counts down
// from its top: the row is turned over by the frame's height, so a seam's two buckets keep the same pixels.
const FADE_MAIN_BEGIN = `{let dfN=dfNoise(vec2<f32>(input.clipPos.x,material.fadeRows-input.clipPos.y));let dfIn=smoothstep(input.vFadeBands.x,input.vFadeBands.y,input.vFadeDist);let dfOut=1.0-smoothstep(input.vFadeBands.z,input.vFadeBands.w,input.vFadeDist);if(dfIn<1.0-dfN||dfOut<dfN){discard;}}`;

/** The floats a vertex of a blade clump's `blade` attribute: the mesh's plugin vertex data. */
export const BLADE_VERTEX_FLOATS = 4;

/** The foliage's uniforms but the players, which are laid out as bits (`PLAYERS_FIELD`). */
function foliageScalars(values: FoliageUniforms): UniformRecord {
  const { windPlayers: _players, ...scalars } = values;
  void _players;
  return scalars;
}

/** The players' field: five positions as vec4s of bits, for Lite lays out a plugin's array only so. */
export const PLAYERS_FIELD: UniformField = { name: "windPlayers", type: `array<vec4<u32>,${FOLIAGE_PLAYERS}>`, visibility: "vertex-fragment" };

/** The fields of the forest's uniforms, by part, each read by both stages. */
const BOTH = "vertex-fragment" as const;
export const FOLIAGE_FIELDS: readonly UniformField[] = (() => {
  const fields = uniformFields(foliageScalars(emptyFoliageUniforms()), BOTH);
  // The players stand where the record has them: after the eye.
  const at = Object.keys(emptyFoliageUniforms()).indexOf("windPlayers");
  fields.splice(at, 0, PLAYERS_FIELD);
  return fields;
})();
/** The frame's height in pixels, which the fade's noise turns a fragment's row over by. */
export const FADE_ROWS_FIELD: UniformField = { name: FADE_ROWS_NAME, type: "f32", visibility: BOTH };
export const FADE_FIELDS: readonly UniformField[] = [...uniformFields(emptyFadeUniforms(), BOTH), FADE_ROWS_FIELD];
export const CONFORM_FIELDS: readonly UniformField[] = uniformFields(conformUniforms(), BOTH);
export const DEADWOOD_FIELDS: readonly UniformField[] = uniformFields(emptyDeadwoodUniforms(), BOTH);

/**
 * The forest's plugin for a material that carries `v`'s parts. Its uniforms
 * are made again at each write of the material's buffer, from the page's
 * wind, `v.eye` as it then stands, and the material's own numbers.
 */
export function vegetationPlugin(v: Vegetation): MaterialPlugin {
  if (v.deadwood !== null && v.moss === null) throw new Error("the dead trees' dressing needs the moss map");
  if (v.light && v.foliage === null) throw new Error("the foliage's light needs the foliage");
  if (v.ground !== undefined && v.foliage !== null) throw new Error("the ground's tint is a wall's, which wears no foliage: both read the instance's `foliage`");
  const layout = vegetationInstanceLayout(v);
  const tint = v.foliage !== null && v.foliage.profile.groundTint > 0;
  const blades = v.foliage !== null && v.foliage.profile.blades;
  const every: UniformField[] = [
    ...(v.foliage !== null ? FOLIAGE_FIELDS : []),
    ...(v.fade ? FADE_FIELDS : []),
    ...(v.conform ? CONFORM_FIELDS : []),
    ...(v.deadwood !== null ? DEADWOOD_FIELDS : []),
  ];
  const shared = v.shared;
  // Given the frame's block, the material declares what is its own, and reads the rest from the block.
  const fields = shared === undefined ? every : ownFields(every);
  const foliageValues = emptyFoliageUniforms();
  const fadeValues = emptyFadeUniforms();
  const conformValues = conformUniforms();
  const deadwoodValues = emptyDeadwoodUniforms();
  const players = new Float32Array(FOLIAGE_PLAYERS * 4);

  const fragment: Record<string, string> = {
    CUSTOM_FRAGMENT_DEFINITIONS:
      (v.foliage !== null ? `const FOLIAGE_CARD_GREEN:vec3<f32>=${vec3(COVER_GREEN)};const FOLIAGE_ALBEDO_FLOOR:vec3<f32>=${vec3(FOLIAGE_ALBEDO_FLOOR)};` : "") +
      (v.fade ? "fn dfNoise(p:vec2<f32>)->f32{return fract(52.9829189*fract(0.06711056*p.x+0.00583715*p.y));}" : "") +
      (v.moss !== null ? `const MOSS_SIDE:vec3<f32>=vec3<f32>(${f(MOSS_SIDE.x)},${f(MOSS_SIDE.y)},${f(MOSS_SIDE.z)});` : ""),
  };
  if (v.fade) fragment.CUSTOM_FRAGMENT_MAIN_BEGIN = reads(FADE_MAIN_BEGIN, shared);
  if (v.foliage !== null || v.moss !== null || v.ground !== undefined) fragment.CUSTOM_FRAGMENT_BEFORE_LIGHTS = reads(lightsCode(v), shared);
  if (v.light) fragment.CUSTOM_FRAGMENT_LIGHT = reads(FOLIAGE_LIGHT, shared);
  if (v.foliage !== null && v.sky) fragment.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION = FOLIAGE_SKY;

  const stride = layout.floats * 4;
  const attributes = [
    ...(layout.fadeBands >= 0 ? [{ name: "fadeBands", type: "vec4<f32>", format: "float32x4" as const, stride, offset: layout.fadeBands * 4 }] : []),
    ...(layout.groundGrad >= 0 ? [{ name: "groundGrad", type: "vec2<f32>", format: "float32x2" as const, stride, offset: layout.groundGrad * 4 }] : []),
    ...(layout.foliage >= 0 ? [{ name: "foliage", type: "vec4<f32>", format: "float32x4" as const, stride, offset: layout.foliage * 4 }] : []),
    ...(layout.deadwoodRole >= 0 ? [{ name: "deadwoodRole", type: "f32", format: "float32" as const, stride, offset: layout.deadwoodRole * 4 }] : []),
    ...(layout.bladeStrength >= 0 ? [{ name: "bladeStrength", type: "f32", format: "float32" as const, stride, offset: layout.bladeStrength * 4 }] : []),
  ];

  const plugin: MaterialPlugin = {
    name: "Vegetation",
    priority: 200,
    // What the plugin compiles differs by its parts alone; the look's numbers are uniforms.
    defines: {
      foliage: v.foliage !== null, tint, blades, match: v.match, light: v.light, fade: v.fade, conform: v.conform,
      moss: v.moss !== null, deadwood: v.deadwood !== null, sky: v.sky, ground: v.ground ?? -1,
    },
    getCustomCode: (stage) =>
      stage === "vertex"
        ? { CUSTOM_VERTEX_DEFINITIONS: reads((v.foliage !== null ? GUST : "") + (v.moss !== null ? MOSS_HASH : ""), shared), CUSTOM_VERTEX_MAIN_END: reads(vertexCode(v), shared) }
        : fragment,
    ...(fields.length > 0 ? { getUniforms: () => ({ ubo: [...fields] }) } : {}),
    ...(shared === undefined ? {} : { getUniformBlocks: () => [shared] }),
    getVaryings: () => [
      ...(v.foliage !== null
        ? [{ name: "vFoliage", type: "vec4<f32>" as const }, { name: "vFoliageH", type: "f32" as const }, { name: "vFoliageClump", type: "f32" as const }, { name: "vFoliageDist", type: "f32" as const }]
        : []),
      ...(v.fade ? [{ name: "vFadeBands", type: "vec4<f32>" as const }, { name: "vFadeDist", type: "f32" as const }] : []),
      ...(v.moss !== null && v.deadwood === null ? [{ name: "vMoss", type: "vec2<f32>" as const }] : []),
      ...(v.deadwood !== null ? [{ name: "vDeadwood", type: "vec4<f32>" as const }] : []),
      ...(v.ground !== undefined ? [{ name: "vCliffTint", type: "vec4<f32>" as const }] : []),
    ],
    writeUbo(data, offsets) {
      if (shared !== undefined) {
        // The material's own: the look's numbers, the fade's widening, the conform's and the dead wood's.
        if (v.foliage !== null) writeUniforms(data, offsets, ownValues(foliageScalars(foliageUniforms(v.foliage, v.eye, foliageValues))));
        if (v.fade) writeUniforms(data, offsets, ownValues(fadeUniforms(v.eye, v.widen ?? WIDEN_NONE, fadeValues)));
        if (v.conform) writeUniforms(data, offsets, conformValues);
        if (v.deadwood !== null) writeUniforms(data, offsets, deadwoodUniforms(v.deadwood.base, deadwoodValues));
        return;
      }
      if (v.foliage !== null) {
        const u = foliageUniforms(v.foliage, v.eye, foliageValues);
        writeUniforms(data, offsets, foliageScalars(u));
        const at = offsets.get(PLAYERS_FIELD.name);
        if (at === undefined) throw new Error(`no uniform ${PLAYERS_FIELD.name} in the material's buffer`);
        for (let i = 0; i < FOLIAGE_PLAYERS; i++) {
          players[i * 4] = u.windPlayers[i * 3] as number;
          players[i * 4 + 1] = u.windPlayers[i * 3 + 1] as number;
          players[i * 4 + 2] = u.windPlayers[i * 3 + 2] as number;
        }
        data.set(players, at / 4);
      }
      if (v.fade) {
        writeUniforms(data, offsets, fadeUniforms(v.eye, v.widen ?? WIDEN_NONE, fadeValues));
        const rows = offsets.get(FADE_ROWS_FIELD.name);
        if (rows === undefined) throw new Error(`no uniform ${FADE_ROWS_FIELD.name} in the material's buffer`);
        data[rows / 4] = v.frame.height;
      }
      if (v.conform) writeUniforms(data, offsets, conformValues);
      if (v.deadwood !== null) writeUniforms(data, offsets, deadwoodUniforms(v.deadwood.base, deadwoodValues));
    },
  };
  if (attributes.length > 0) plugin.getInstanceAttributes = () => attributes;
  // A blade's root in its clump (x, z), its draw and its height: four floats a vertex, the mesh's plugin vertex data.
  if (blades) plugin.getVertexAttributes = () => [{ name: "blade", type: "vec4<f32>", format: "float32x4" as const, stride: BLADE_VERTEX_FLOATS * 4, offset: 0 }];
  if (v.moss !== null) {
    const moss = v.moss;
    plugin.getSamplers = () => [{ texture: "mossSampler", sampler: "mossSamplerSampler" }];
    plugin.bindTextures = (out) => {
      out.push({ texture: moss });
    };
    plugin.getActiveTextures = (out) => {
      out.push(moss);
    };
  }
  return plugin;
}

/**
 * The lights' diffuse under the occlusion a material's packed map holds in
 * its red. Babylon.js multiplies the lights' diffuse by it (with no ambient
 * map, by the whole of it); Lite keeps occlusion to the image-based light,
 * as glTF says. The share is taken out of the composed colour, where Lite's
 * `occlusion` and `directDiffuse` are both in reach. For every material
 * dressed with an occlusion, roughness and metalness map: the barks.
 */
export function directOcclusionPlugin(): MaterialPlugin {
  return {
    name: "DirectOcclusion",
    priority: 150,
    getCustomCode: (stage) => (stage === "fragment" ? { CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `{color-=directDiffuse*(1.0-occlusion);}` } : null),
  };
}

/**
 * A material the game draws on both sides WITHOUT two-sided lighting
 * (culling off, the normal as the mesh has it): Lite's `doubleSided` does
 * both, turning the normal over on a back face. The turn is undone where
 * Lite has just made it, before it reads the normal for anything. For the
 * dead trees, whose logs are mirrored by their draw.
 *
 * `turned` is for the snag's bake alone, whose bark wears a normal map with
 * no vertex tangents. Babylon.js makes such a map's frame from the
 * coordinates turned over on a face it takes for a back one, and in the
 * game's bake of the snag it takes the faces the bake sees for back ones:
 * the bake draws a new mesh under a material that is neither culled nor lit
 * on two sides, and for such a material Babylon does not look up which way
 * a mesh winds. So the far snags' bark is baked with both of the map's axes
 * turned over, where the near snags' is not, and the bake here is the
 * game's as it is. Both axes lie across the mesh's normal, so the turn is
 * the shaded normal taken to the other side of the mesh's, on a front face.
 */
export function oneSidedLightPlugin(turned = false): MaterialPlugin {
  return {
    name: "OneSidedLight",
    priority: 50,
    defines: { turned },
    getCustomCode: (stage) =>
      stage === "fragment"
        ? { CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `if(!frontFacing){N=-N;N_geom=-N_geom;}${turned ? "else{N=2.0*dot(N,N_geom)*N_geom-N;}" : ""}` }
        : null,
  };
}

// The weather's share, where the map's roughness is known: the roughness glossed at
// once, the albedo's factor kept for the split, since the game darkens the colour after the colour block has run.
const WET_WEATHER_KEPT = `var wetShare=1.0;{let wetPorosity=min(material.wetCap,clamp((roughness-0.5)/0.4,0.0,1.0));let wetFactor=mix(1.0,0.2,wetPorosity);wetShare=mix(1.0,wetFactor,material.wetWeather);let wetGloss=mix(1.0,1.0-roughness,mix(1.0,wetFactor,0.5*material.wetWeather));roughness=1.0-wetGloss;}`;

// Babylon's reflectivity block, which follows its point before the lights: the weather's darkening of the colour the
// block left, then the colour split into the albedo and the reflectance at normal incidence, a metal's its own colour.
// The reflectance at normal incidence is `dielectricF0` on every channel: these materials' reflectance colour is white,
// and Lite declares that one name with its reflectance feature and without it (it leaves the feature out of a material
// whose weight is one).
const SPLIT = `{let fBase=surfaceAlbedo*wetShare;colorF0=mix(vec3<f32>(dielectricF0),fBase,metallic);surfaceAlbedo=fBase*(1.0-dielectricF0)*(1.0-metallic);}`;

// The split with no weather's darkening before it: a surface the rain does not wet.
const SPLIT_DRY = `{let fBase=surfaceAlbedo;colorF0=mix(vec3<f32>(dielectricF0),fBase,metallic);surfaceAlbedo=fBase*(1.0-dielectricF0)*(1.0-metallic);}`;

/**
 * The colour a forest material's block before the lights works on: the base
 * colour, as on Babylon.js, whose point before the lights comes ahead of
 * its reflectivity block. Lite has split the base colour into albedo and
 * reflectance by its point, so the block starts again from the base colour
 * here, first at the point, and `surfaceWetPlugin` (or `surfaceSplitPlugin`,
 * on a surface with no wet look), last at it, makes the split. It matters where the block is not a plain factor: the foliage's
 * floor holds a bark's dark channels up, the moss lays its own colour in,
 * and the weather and a metal's share then darken what those left.
 */
export function baseColourPlugin(): MaterialPlugin {
  return {
    name: "BaseColour",
    priority: 100,
    getCustomCode: (stage) => (stage === "fragment" ? { CUSTOM_FRAGMENT_BEFORE_LIGHTS: `surfaceAlbedo=baseColor;` } : null),
  };
}

/**
 * The wet look on a surface that is not the terrain, drawn by `values`
 * (`wetUniforms` for the surface's cap: one record, filled in place and
 * read whenever the material's uniforms are written), and after it the
 * split of the colour into albedo and reflectance (`baseColourPlugin`,
 * which every material with this plugin carries; the material's
 * reflectance colour is white, its weight whatever
 * `setPbrMetallicReflectance` was given).
 */
export function surfaceWetPlugin(values: WetUniforms, shared?: PluginUniformBlock): MaterialPlugin {
  // Given the frame's block, the wet line and the weather are read from it: the material's own is its cap.
  const fields = shared === undefined ? WET_FIELDS : ownFields(WET_FIELDS);
  return {
    name: "Wet",
    priority: 240,
    getCustomCode: (stage) =>
      stage === "fragment"
        ? {
          CUSTOM_FRAGMENT_DEFINITIONS: reads(WET_WGSL, shared),
          CUSTOM_FRAGMENT_UPDATE_DIFFUSE: reads(WET_WEATHER_KEPT, shared),
          CUSTOM_FRAGMENT_BEFORE_LIGHTS: reads(`${WET_LIGHTS}\n${SPLIT}`, shared),
        }
        : null,
    getUniforms: () => ({ ubo: [...fields] }),
    ...(shared === undefined ? {} : { getUniformBlocks: () => [shared] }),
    writeUbo(data, offsets) {
      if (shared === undefined) writeWetUniforms(data, offsets, values);
      else writeUniforms(data, offsets, { wetCap: values.wetCap });
    },
  };
}

/**
 * The split of the colour into albedo and reflectance on a material that
 * wears no wet look (the blade clumps): `surfaceWetPlugin`'s last step
 * alone, at its place, after the colour block. The material carries
 * `baseColourPlugin` and a white reflectance colour, as there.
 */
export function surfaceSplitPlugin(): MaterialPlugin {
  return {
    name: "Split",
    priority: 240,
    getCustomCode: (stage) => (stage === "fragment" ? { CUSTOM_FRAGMENT_BEFORE_LIGHTS: SPLIT_DRY } : null),
  };
}

/** The bake's one uniform: which picture the next draw writes (`ImpostorBakeMode`). */
export const BAKE_MODE_FIELD: UniformField = { name: "bakeMode", type: "f32" };

// The bake's two pictures, in place of the lit colour. The albedo is the surface's own after its maps
// and its split, in gamma space as a colour map is stored; the normal is the shaded one in the world's frame, which is
// the bake camera's (it looks along +z with +y up), written as a map of the card, whose face looks along -z. A
// fragment the material's alpha test kept is whole.
const BAKE_PICTURES = `if(material.bakeMode>1.5){let bakeN=normalize(N);color=vec3<f32>(bakeN.x,bakeN.y,-bakeN.z)*0.5+0.5;alpha=1.0;}else if(material.bakeMode>0.5){color=pow(surfaceAlbedo,vec3<f32>(1.0/2.2));alpha=1.0;}`;

/**
 * What a far tree's bake writes in place of the lit colour, last in the
 * fragment, after the display curve: by `picture.mode` the albedo (1) or the
 * normal (2), and at 0 the material's own colour. `picture` is read whenever
 * the material's uniforms are written, so a bake draws its second picture by
 * setting the mode and marking its materials. On the bake's materials alone,
 * never on one the scene draws.
 */
export function impostorBakePlugin(picture: { mode: ImpostorBakeMode }): MaterialPlugin {
  return {
    name: "ImpostorBake",
    priority: 990,
    getCustomCode: (stage) => (stage === "fragment" ? { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: BAKE_PICTURES } : null),
    getUniforms: () => ({ ubo: [BAKE_MODE_FIELD] }),
    writeUbo(data, offsets) {
      const at = offsets.get(BAKE_MODE_FIELD.name);
      if (at === undefined) throw new Error(`no uniform ${BAKE_MODE_FIELD.name} in the material's buffer`);
      data[at / 4] = picture.mode;
    },
  };
}
