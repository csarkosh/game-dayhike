#!/usr/bin/env node
// Writes a small corpus made under Node, for the build's translation to have
// real shaders to translate before a corpus recorded in browsers
// (`?wgsl=record`) is merged in: the game's three post shaders (the halation
// extract, the grade, the finish as WebGPU takes it) and Babylon's PBR and
// Standard materials on a sphere lit by the sun, each effect's two stages as
// Babylon's WebGPU GLSL processing hands them to the engine, composed for the
// first translator as the page composes them (`translatorInput`).
//
// It runs that processing on Babylon's `NullEngine`, as the client suite does
// (`client/test/game/helpers/webgpuProcessing.ts`), with the WebGPU engine's
// platform name and depth range besides. It is not byte for byte what a
// browser's WebGPU engine makes of these effects (the engine's caps, its
// version and the game's own defines differ), so a browser never asks for
// these stages: they exercise the build and the page's source of shipped
// translations end to end, and buy no hit.
//
// Usage: node tools/wgsl/node-corpus.mjs <out.json>
//        then node tools/wgsl/merge-corpus.mjs <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { WebGPUShaderProcessorGLSL } from '@babylonjs/core/Engines/WebGPU/webgpuShaderProcessorsGLSL.js';
import { WebGPUShaderProcessingContext } from '@babylonjs/core/Engines/WebGPU/webgpuShaderProcessingContext.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import '@babylonjs/core/Shaders/postprocess.vertex.js';
import { loadShared } from './lib/shared.mjs';

const out = process.argv[2];
if (!out) throw new Error('usage: node tools/wgsl/node-corpus.mjs <out.json>');
const shared = await loadShared();
const shader = (name) => readFileSync(new URL(`../../client/src/game/shaders/${name}.fragment.fx`, import.meta.url), 'utf8');

const engine = new NullEngine();
engine._shaderProcessor = new WebGPUShaderProcessorGLSL();
engine._getShaderProcessingContext = (language) => new WebGPUShaderProcessingContext(language, false);
engine._shaderPlatformName = 'WEBGPU';
engine.isNDCHalfZRange = true;
const caps = engine.getCaps();
caps.standardDerivatives = true;
caps.textureLOD = true;
Object.defineProperty(engine, 'supportsUniformBuffers', { get: () => true });

// Every stage the engine is handed, as the page's lookup keys it.
const stages = [];
const prepare = engine._preparePipelineContextAsync.bind(engine);
engine._preparePipelineContextAsync = (context, vertex, fragment, createAsRaw, rawVertex, rawFragment, rebuild, defines, ...rest) => {
  if (!createAsRaw) {
    for (const [stage, code] of [['vertex', vertex], ['fragment', fragment]]) {
      stages.push({ stage, flag: shared.uniformityOff(code), glsl: shared.translatorInput(code, defines) });
    }
  }
  return prepare(context, vertex, fragment, createAsRaw, rawVertex, rawFragment, rebuild, defines, ...rest);
};

const scene = new Scene(engine);
const camera = new FreeCamera('camera', new Vector3(0, 2, -6), scene);
camera.setTarget(Vector3.Zero());
const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.3), scene);
sun.intensity = 3;
const pbr = new PBRMaterial('pbr', scene);
pbr.albedoColor = new Color3(0.5, 0.45, 0.4);
pbr.metallic = 0;
pbr.roughness = 0.8;
const standard = new StandardMaterial('standard', scene);
standard.diffuseColor = new Color3(0.4, 0.5, 0.3);
const spheres = [pbr, standard].map((material, i) => {
  const sphere = CreateSphere(`sphere${i}`, { segments: 8 }, scene);
  sphere.material = material;
  return sphere;
});

// The game's post shaders, named and bound as `client/src/game/post.ts` makes them.
Effect.ShadersStore.halationExtractFragmentShader = shader('halationExtract');
Effect.ShadersStore.gradeFragmentShader = shader('grade');
Effect.ShadersStore.finishFragmentShader = `#define DISABLE_UNIFORMITY_ANALYSIS\n${shader('finish')}`;
const posts = [
  new PostProcess('halationExtract', 'halationExtract', ['exposure'], [], 0.25, camera, 1, engine),
  new PostProcess('grade', 'grade', [
    'exposure', 'whitePoint', 'purkinje', 'purkinjeThreshold', 'purkinjeStrength', 'shadowTint', 'shadowAmount',
    'midtoneTint', 'midtoneAmount', 'highlightTint', 'highlightAmount', 'saturation', 'lift', 'vignetteWeight',
    'vignetteColour', 'halationStrength',
  ], ['halationSampler'], 1, camera, 1, engine),
  new PostProcess('finish', 'finish', ['texelSize', 'overlapGain', 'overlapPhase', 'grainGain', 'time'], [], 1, camera, 1, engine),
];

for (let tick = 0; tick < 100; tick++) {
  const ready = [
    ...spheres.map((sphere) => sphere.material.isReadyForSubMesh(sphere, sphere.subMeshes[0], false)),
    ...posts.map((post) => post.isReady()),
  ];
  if (ready.every(Boolean)) break;
  await new Promise((done) => setTimeout(done, 10));
}
const made = new Set(stages.map((entry) => shared.corpusId(entry))).size;
if (made < 10) throw new Error(`only ${made} stages were prepared; expected the five effects' ten`);
writeFileSync(resolve(out), shared.corpusText(stages));
console.log(`wrote ${made} stages to ${out}`);
engine.dispose();
