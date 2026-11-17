import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyCloudUniforms } from "../../../src/game/cloudParams.js";
import {
  composeUniforms, emptyFarSoftUniforms, emptyGradeUniforms, emptyTaaUniforms, lensUniforms, paintUniforms, sharpenUniforms,
} from "../../../src/game/postFrame.js";
import { DITHER_LSB, HALATION_CAP, HALATION_THRESHOLD, PAINT_JOINT_SHARPNESS, PAINT_REACH } from "../../../src/game/postParams.js";
import {
  FAR_SOFT_WGSL, HALATION_EXTRACT_WGSL, LENS_WGSL, PAINT_WGSL, POST_VERTEX_WGSL, TAA_SHARPEN_WGSL, TAA_WGSL, blurKernel, blurTaps, blurWgsl, depthResolveWgsl, gradeWgsl, passLayout, writePass,
} from "../../../src/game/lite/postWgsl.js";
import { HALATION_KERNEL, HALATION_RATIO } from "../../../src/game/postFrame.js";
import { babylonValues } from "../../helpers/babylonFixture.js";
import { inOrder, tight } from "./wgslText.js";

const glsl = (name: string): string => readFileSync(new URL(`../../../src/game/shaders/${name}.fragment.fx`, import.meta.url), "utf8");
/** The uniforms a GLSL stage declares that are not samplers, by name. */
const uniformsOf = (text: string): string[] => [...text.matchAll(/^uniform (?!sampler)\w+ (\w+);/gm)].map((m) => m[1] as string);
/** The names a WGSL stage reads from its uniforms. */
const readsOf = (text: string): string[] => [...new Set([...text.matchAll(/\bu\.(\w+)/g)].map((m) => m[1] as string))];

describe("a pass's uniforms as WGSL lays them out", () => {
  it("places each field at its type's alignment, in the record's order, and rounds the whole to sixteen bytes", () => {
    const layout = passLayout({ a: [0], b: [0, 0], c: [0, 0, 0], d: [0], e: [0, 0, 0, 0], m: [0, 0, 0, 0, 0, 0, 0, 0, 0], z: [0] });
    expect(layout.struct).toBe("struct U{a:f32,b:vec2<f32>,c:vec3<f32>,d:f32,e:vec4<f32>,m:mat3x3<f32>,z:f32}");
    // Bytes: a 0, b 8, c 16 (a vec3 is twelve bytes at a sixteen's start), d 28 in its tail, e 32, m 48 (three columns of sixteen), z 96.
    expect([...layout.offsets]).toEqual([["a", 0], ["b", 2], ["c", 4], ["d", 7], ["e", 8], ["m", 12], ["z", 24]]);
    expect(layout.bytes).toBe(112);
    expect(() => passLayout({ bad: [0, 0, 0, 0, 0] })).toThrow(/5 floats/);
  });

  it("writes a matrix a column every four floats, and everything else as it stands", () => {
    const record = { a: [1], m: [1, 2, 3, 4, 5, 6, 7, 8, 9], v: [10, 11, 12] };
    const layout = passLayout(record);
    const data = new Float32Array(4 + layout.bytes / 4);
    writePass(data, 4, layout, record);
    expect([...data.subarray(4)]).toEqual([1, 0, 0, 0, 1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 10, 11, 12, 0]);
    expect(() => writePass(data, 0, layout, { other: [1] })).toThrow(/other/);
  });
});

describe("the post chain's passes in WGSL", () => {
  const RECORDS = {
    farSoft: { text: FAR_SOFT_WGSL, record: { ...emptyFarSoftUniforms(), atmSunDir: [0, 0, 0], atmSunColour: [0, 0, 0], ...emptyCloudUniforms() } },
    taa: { text: TAA_WGSL, record: emptyTaaUniforms() },
    taaSharpen: { text: TAA_SHARPEN_WGSL, record: sharpenUniforms(1, 1) },
    paint: { text: PAINT_WGSL, record: paintUniforms(2, 2, 2) },
    lens: { text: LENS_WGSL, record: lensUniforms(0, 0, 1, 1) },
  } as const;

  it("reads in each pass exactly the uniforms the game's stage declares, which are the record's", () => {
    for (const [name, { text, record }] of Object.entries(RECORDS)) {
      const declared = uniformsOf(glsl(name)).sort();
      expect(readsOf(text).sort(), name).toEqual(declared);
      expect(Object.keys(record).sort(), name).toEqual(declared);
    }
    // The grade reads its own and the compose's two, which it runs first; the halation's strength only where a tier makes one.
    const grade = uniformsOf(glsl("grade")).sort();
    expect(readsOf(gradeWgsl(true)).sort()).toEqual([...grade, ...uniformsOf(glsl("paintCompose"))].sort());
    expect(readsOf(gradeWgsl(false)).sort()).toEqual([...grade, ...uniformsOf(glsl("paintCompose"))].filter((name) => name !== "halationStrength").sort());
    expect(Object.keys({ ...emptyGradeUniforms(), ...composeUniforms(2, 2) }).sort()).toEqual([...grade, ...uniformsOf(glsl("paintCompose"))].sort());
  });

  it("reads a texture with its rows turned over, and never anything else: the passes compute in the game's own coordinates", () => {
    expect(tight(POST_VERTEX_WGSL)).toContain("fntx(uv:vec2<f32>)->vec2<f32>{returnvec2<f32>(uv.x,1.0-uv.y);}");
    for (const text of [FAR_SOFT_WGSL, TAA_WGSL, TAA_SHARPEN_WGSL, PAINT_WGSL, gradeWgsl(true), HALATION_EXTRACT_WGSL]) {
      // Every read of a frame goes through `tx`; the cloud's map alone is read by the world's own coordinates.
      for (const read of text.matchAll(/textureSampleLevel\((\w+),\w+,([^;]*?),0\.0\)/g)) {
        if (read[1] === "atmCloudMap") continue;
        expect(read[2], read[0]).toMatch(/^tx\(/);
      }
    }
    // The lens's droplet map is laid by its own rows, as the game uploads it.
    expect(tight(LENS_WGSL)).toContain("letd=textureSampleLevel(lensSampler,lensRepeat,vec2<f32>(tileX,inTile.y)+shift,0.0);");
  });

  it("softens the far field as the game's stage does, and marches the cloud on the pixel's own ray", () => {
    const g = tight(glsl("farSoft"));
    const w = tight(FAR_SOFT_WGSL);
    for (const [a, b] of [
      ["floatr=smoothstep(soft.x,soft.y,d)*soft.z;if(r<0.2){returnc;}", "letr=smoothstep(u.soft.x,u.soft.y,d)*u.soft.z;if(r<0.2){returnc;}"],
      ["floata=i<8?float(i)*0.7853982:float(i-8)*1.5707963+0.7853982;", "leta=select(f32(i-8)*1.5707963+0.7853982,f32(i)*0.7853982,i<8);"],
      ["floatring=i<8?r:r*0.5;", "letring=select(r*0.5,r,i<8);"],
      ["floatw=step(d*0.8,dn);", "letw=step(d*0.8,dn);"],
      ["returnd>0.0?d:FAR_SOFT_SKY;", "returnselect(FAR_SOFT_SKY,d,d>0.0);"],
      ["if(atmCloudSteps>0.5&&d<FAR_SOFT_SKY){", "if(u.atmCloudSteps>0.5&&d<FAR_SOFT_SKY){"],
      ["vec3rd=normalize(farForward+ndc.x*farRight+ndc.y*farUp);", "letrd=normalize(u.farForward+ndc.x*u.farRight+ndc.y*u.farUp);"],
      ["floatt=d/max(dot(rd,farForward),1.0e-4);", "lett=d/max(dot(rd,u.farForward),1.0e-4);"],
      ["col=mix(cloud,col,exp(-od));", "col=mix(cloud,col,exp(-od));"],
      ["floats=reach*f*f;floatmid=0.5*(prev+s);od+=atmCloudAt(ro+rd*mid,mid)*(s-prev);", "lets=reach*f*f;letmid=0.5*(prev+s);od+=atmCloudAt(ro+rd*mid,mid)*(s-prev);"],
      ["floatn=clamp(large*small*2.4-0.2,0.0,1.0);", "letn=clamp(large*small*2.4-0.2,0.0,1.0);"],
    ] as const) {
      expect(g, a).toContain(a);
      expect(w, b).toContain(b);
    }
    expect(g).toContain("constfloatFAR_SOFT_SKY=100000.0;constfloatATM_CLOUD_EDGE=0.5/64.0;constintATM_CLOUD_STEPS_MAX=12;");
    expect(w).toContain("constFAR_SOFT_SKY:f32=100000.0;constATM_CLOUD_EDGE:f32=0.5/64.0;constATM_CLOUD_STEPS_MAX:i32=12;");
  });

  it("blends the frame into its history as the game's stage does", () => {
    const g = tight(glsl("taa"));
    const w = tight(TAA_WGSL);
    for (const [a, b] of [
      ["vec2w0=f*(-0.5+f*(1.0-0.5*f));vec2w1=1.0+f*f*(-2.5+1.5*f);vec2w2=f*(0.5+f*(2.0-1.5*f));vec2w3=f*f*(-0.5+0.5*f);", "letw0=f*(-0.5+f*(1.0-0.5*f));letw1=1.0+f*f*(-2.5+1.5*f);letw2=f*(0.5+f*(2.0-1.5*f));letw3=f*f*(-0.5+0.5*f);"],
      ["vec3lo=max(nmin,mean-taaParams.y*sigma);vec3hi=min(nmax,mean+taaParams.y*sigma);", "letlo=max(nmin,mean-u.taaParams.y*sigma);lethi=min(nmax,mean+u.taaParams.y*sigma);"],
      ["vec3v=d>0.0?taaEye+ray*d-taaPrevEye:ray;", "letv=select(ray,u.taaEye+ray*d-u.taaPrevEye,d>0.0);"],
      ["floatok=taaParams.z*step(1.0e-4,z)*step(0.0,puv.x)*step(puv.x,1.0)*step(0.0,puv.y)*step(puv.y,1.0);", "letok=u.taaParams.z*step(1.0e-4,z)*step(0.0,puv.x)*step(puv.x,1.0)*step(0.0,puv.y)*step(puv.y,1.0);"],
      ["vec3blended=mix(hist,cur.rgb,taaParams.x);", "letblended=mix(hist,cur.rgb,u.taaParams.x);"],
      ["returnm>1.0?centre+v/m:p;", "if(m>1.0){returncentre+v/m;}returnp;"],
    ] as const) {
      expect(g, a).toContain(a);
      expect(w, b).toContain(b);
    }
    const sharpen = tight(TAA_SHARPEN_WGSL);
    expect(tight(glsl("taaSharpen"))).toContain("vec3lifted=c.rgb+sharpen*(c.rgb-0.25*(n+s+e+w));gl_FragColor=vec4(clamp(lifted,lo,hi),c.a);");
    expect(sharpen).toContain("letlifted=c.rgb+u.sharpen*(c.rgb-0.25*(n+s+e+w));returnvec4<f32>(clamp(lifted,lo,hi),c.a);");
  });

  it("paints and composes as the game's stages do", () => {
    const g = tight(glsl("paint"));
    const w = tight(PAINT_WGSL);
    expect(g).toContain(`constintPAINT_REACH=${PAINT_REACH};constfloatPAINT_SECTOR_OVERLAP=0.5;constfloatPAINT_SECTOR_SPREAD=2.5;constfloatPAINT_SHARPNESS=8.0;constfloatPAINT_VARIANCE_SCALE=40.0;constfloatPAINT_KEEP=24.0;constfloatPAINT_CAP=64.0;`);
    expect(w).toContain(`constPAINT_REACH:i32=${PAINT_REACH};constPAINT_SECTOR_OVERLAP:f32=0.5;constPAINT_SECTOR_SPREAD:f32=2.5;constPAINT_SHARPNESS:f32=8.0;constPAINT_VARIANCE_SCALE:f32=40.0;constPAINT_KEEP:f32=24.0;constPAINT_CAP:f32=64.0;`);
    for (const [a, b] of [
      ["floats=max(0.0,along+zeta-PAINT_SECTOR_OVERLAP*across*across);s=s*s*w;", "vars=max(0.0,along+zeta-PAINT_SECTOR_OVERLAP*across*across);s=s*s*fall;"],
      ["floatw=1.0/(1.0+pow(PAINT_VARIANCE_SCALE*sigma,PAINT_SHARPNESS));", "varw=1.0/(1.0+pow(PAINT_VARIANCE_SCALE*sigma,PAINT_SHARPNESS));"],
      ["w*=exp(-PAINT_KEEP*dot(away,away));", "w*=exp(-PAINT_KEEP*dot(away,away));"],
      ["if(dot(o,o)>r*r)continue;", "if(dot(o,o)>r*r){continue;}"],
    ] as const) {
      expect(g, a).toContain(a);
      expect(w, b).toContain(b);
    }
    // The eight sectors' directions, in the game's order.
    const dirs = [...glsl("paint").matchAll(/zeta, vec2\(([-0-9.]+), ([-0-9.]+)\)/g)].map((m) => `vec2<f32>(${m[1]},${m[2]})`);
    expect(dirs).toHaveLength(8);
    expect(inOrder(w, dirs)).toBe(true);
    const compose = tight(glsl("paintCompose"));
    const grade = tight(gradeWgsl(false));
    expect(compose).toContain(`constfloatPAINT_JOINT_SHARPNESS=${PAINT_JOINT_SHARPNESS}.0;`);
    expect(grade).toContain(`constPAINT_JOINT_SHARPNESS:f32=${PAINT_JOINT_SHARPNESS}.0;`);
    expect(compose).toContain("returnbilinear*exp(-PAINT_JOINT_SHARPNESS*dot(d,d))+1.0e-5;");
    expect(grade).toContain("returnbilinear*exp(-PAINT_JOINT_SHARPNESS*dot(d,d))+1.0e-5;");
    expect(compose).toContain("gl_FragColor=vec4(mix(scene,painted,strength),1.0);");
    expect(grade).toContain("returnmix(scene,painted,u.strength);");
    // The grade's first statement is the composed pixel at its own place, where the game's reads the compose's target.
    expect(tight(glsl("grade"))).toContain("vec3c=texture2D(textureSampler,vUV).rgb*exposure;");
    expect(grade).toContain("varc=composed(vUV)*u.exposure;");
  });

  it("grades as the game's stage does, in its order", () => {
    const g = tight(glsl("grade"));
    const w = tight(gradeWgsl(true));
    for (const name of ["SRGB_TO_REC2020", "REC2020_TO_SRGB", "AGX_INSET", "AGX_OUTSET"]) {
      const numbers = new RegExp(`${name}=mat3\\(([^)]*)\\)`).exec(g)?.[1];
      expect(numbers, name).toBeDefined();
      expect(w, name).toContain(`const${name}:mat3x3<f32>=mat3x3<f32>(${numbers})`);
    }
    expect(w).toContain(`constDITHER_LSB:f32=${DITHER_LSB};`);
    expect(inOrder(g, [
      "c=agxToneMap(c);", "c=clamp(whitePoint*c,0.0,1.0);", "c=mix(c,purkinje*c,rod);", "c=gradeBand(c,shadowMask,paintShadowTint,paintShadowAmount);",
      "c=paintLift+c*(1.0-paintLift);", "c=gradeBand(c,highlightMask,highlightTint,highlightAmount);", "c=mix(vec3(gradeLuma(c)),c,1.0+saturation);", "c=lift+c*(1.0-lift);",
      "c=mix(c,c*chaseTint.xyz+chaseLift,chaseTint.w);", "c*=1.0-min(1.0,shadeRGB.x*shadeShape.y+shadeReal*shadeMonster)*shadeKeep;", "c=mix(vignetteColour,c,vig);",
      "c=1.0-(1.0-c)*(1.0-clamp(halo,0.0,1.0));", "c*=1.0-0.97*dark;", "vec3shown=toSrgb(clamp(c,0.0,1.0));", "shown+=(d1+d2-1.0)*DITHER_LSB;",
    ])).toBe(true);
    expect(inOrder(w, [
      "c=agxToneMap(c);", "c=clamp(u.whitePoint*c,vec3<f32>(0.0),vec3<f32>(1.0));", "c=mix(c,u.purkinje*c,rod);",
      "c=gradeBand(c,shadowMask,u.paintShadowTint,u.paintShadowAmount);", "c=u.paintLift+c*(1.0-u.paintLift);",
      "c=gradeBand(c,highlightMask,u.highlightTint,u.highlightAmount);", "c=mix(vec3<f32>(gradeLuma(c)),c,1.0+u.saturation);", "c=u.lift+c*(1.0-u.lift);",
      "c=mix(c,c*u.chaseTint.xyz+u.chaseLift,u.chaseTint.w);", "c*=1.0-min(1.0,shadeRGB.x*u.shadeShape.y+shadeReal*u.shadeMonster)*shadeKeep;",
      "c=mix(u.vignetteColour,c,vig);", "c=1.0-(1.0-c)*(1.0-clamp(halo,vec3<f32>(0.0),vec3<f32>(1.0)));", "c*=1.0-0.97*dark;",
      "varshown=toSrgb(clamp(c,vec3<f32>(0.0),vec3<f32>(1.0)));", "shown+=(d1+d2-1.0)*DITHER_LSB;",
    ])).toBe(true);
    for (const [a, b] of [
      ["return15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+0.4298*x2+0.1191*x-0.00232;", "return15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+0.4298*x2+0.1191*x-0.00232;"],
      ["floatpaintLit=smoothstep(0.02,0.25,paintLuma)*(1.0-smoothstep(0.55,0.9,paintLuma));", "letpaintLit=smoothstep(0.02,0.25,paintLuma)*(1.0-smoothstep(0.55,0.9,paintLuma));"],
      ["floatvig=1.0-smoothstep(0.55,1.0,vr)*clamp(vignetteWeight*0.22,0.0,0.8);", "letvig=1.0-smoothstep(0.55,1.0,vr)*clamp(u.vignetteWeight*0.22,0.0,0.8);"],
      ["floatcrawl=0.5*sin(sa*2.0+st*0.37)+0.3*sin(sa*3.0-st*0.56+1.7)+0.2*sin(sa*7.0+st*0.94+4.1);", "letcrawl=0.5*sin(sa*2.0+st*0.37)+0.3*sin(sa*3.0-st*0.56+1.7)+0.2*sin(sa*7.0+st*0.94+4.1);"],
      ["floatdark=smoothstep(openTo-0.42,openTo+0.14,sr)*min(1.0,stareShade.z*3.0);", "letdark=smoothstep(openTo-0.42,openTo+0.14,sr)*min(1.0,u.stareShade.z*3.0);"],
      ["floatshadeBlot=shadeNoise(vUV*vec2(shadeShape.z,1.0)*9.0+stareShade.w*0.12);", "letshadeBlot=shadeNoise(vUV*vec2<f32>(u.shadeShape.z,1.0)*9.0+u.stareShade.w*0.12);"],
      ["vec3shadeRGB=(shadeInner+shadeOuter)*shadeShape.w/18.0;floatshadeReal=shadeInner.z*shadeShape.w/10.0;", "letshadeRGB=(shadeInner+shadeOuter)*u.shadeShape.w/18.0;letshadeReal=shadeInner.z*u.shadeShape.w/10.0;"],
    ] as const) {
      expect(g, a).toContain(a);
      expect(w, b).toContain(b);
    }
    // The mask's seventeen reads, at the game's places.
    const taps = [...glsl("grade").matchAll(/shadeStep \* vec2\(([-0-9.]+), ([-0-9.]+)\)/g)].map((m) => `shadeRead(vUV+shadeStep*vec2<f32>(${m[1]},${m[2]}))`);
    expect(taps).toHaveLength(16);
    expect(inOrder(w, taps)).toBe(true);
  });

  it("works out only what a frame shows: the shades while a figure is in the mask, the stare while it has closed, the cast while it is in, the halation on its tier", () => {
    const w = tight(gradeWgsl(false));
    expect(w).toContain("if(u.chaseTint.w>0.0){c=mix(c,c*u.chaseTint.xyz+u.chaseLift,u.chaseTint.w);}");
    expect(w).toContain("if(u.shadeShape.w>0.0){letshadeStep=");
    expect(w).toContain("if(u.stareShade.z>0.0){letsp=centred-u.stareShade.xy;");
    expect(w).not.toContain("halationSampler");
    expect(tight(gradeWgsl(true))).toContain("lethalo=textureSampleLevel(halationSampler,postSampler,tx(vUV),0.0).rgb*u.halationStrength;");
  });

  it("lays rain on the lens as the game's stage does", () => {
    const g = tight(glsl("lens"));
    const w = tight(LENS_WGSL);
    for (const name of ["LENS_TILES", "LENS_OFFSET", "LENS_COLUMNS", "LENS_JITTER", "SLIDE_RADIUS", "SLIDE_TRAIL", "SLIDE_CAP", "FOLD", "FROST_TEXELS", "FOG_GAIN"]) {
      const value = new RegExp(`constfloat${name}=([0-9.]+);`).exec(g)?.[1];
      expect(value, name).toBeDefined();
      expect(w, name).toContain(`const${name}:f32=${value};`);
    }
    for (const [a, b] of [
      ["floatspeed=floor((0.1+0.15*lensHash(vec2(column,3.0)))*FOLD)/FOLD;", "letspeed=floor((0.1+0.15*lensHash(vec2<f32>(column,3.0)))*FOLD)/FOLD;"],
      ["floatyDrop=1.0+SLIDE_RADIUS-fract(run)*(1.0+2.0*SLIDE_RADIUS+SLIDE_TRAIL);", "letyDrop=1.0+SLIDE_RADIUS-fract(run)*(1.0+2.0*SLIDE_RADIUS+SLIDE_TRAIL);"],
      ["vec2uvR=vUV-lensStrength*LENS_OFFSET*vec2(n.x/aspect,n.y);", "letuvR=vUV-u.lensStrength*LENS_OFFSET*vec2<f32>(n.x/u.aspect,n.y);"],
      ["floatfog=lensStrength*(1.0-mask)*(1.0-trail)*FOG_GAIN;gl_FragColor=mix(col,soft,fog);", "letfog=u.lensStrength*(1.0-mask)*(1.0-trail)*FOG_GAIN;returnmix(col,soft,fog);"],
    ] as const) {
      expect(g, a).toContain(a);
      expect(w, b).toContain(b);
    }
  });

  it("extracts the halation from the composed frame's four texels under each of its own", () => {
    const g = tight(glsl("halationExtract"));
    const w = tight(HALATION_EXTRACT_WGSL);
    expect(g).toContain(`constfloatHALATION_THRESHOLD=${HALATION_THRESHOLD}.0;constfloatHALATION_CAP=${HALATION_CAP}.0;constvec3HALATION_TINT=vec3(1.0,0.45,0.2);`);
    expect(w).toContain(`constHALATION_THRESHOLD:f32=${HALATION_THRESHOLD}.0;constHALATION_CAP:f32=${HALATION_CAP}.0;constHALATION_TINT:vec3<f32>=vec3<f32>(1.0,0.45,0.2);`);
    expect(g).toContain("floatover=clamp(l-HALATION_THRESHOLD,0.0,HALATION_CAP)/HALATION_CAP;gl_FragColor=vec4(exposed/max(l,1.0e-4)*HALATION_TINT*over,1.0);");
    expect(w).toContain("letover=clamp(l-HALATION_THRESHOLD,0.0,HALATION_CAP)/HALATION_CAP;returnvec4<f32>(exposed/max(l,1.0e-4)*HALATION_TINT*over,1.0);");
    expect(w).toContain("letframe=0.25*(composed(vUV+vec2<f32>(-h.x,-h.y))+composed(vUV+vec2<f32>(h.x,-h.y))+composed(vUV+vec2<f32>(-h.x,h.y))+composed(vUV+vec2<f32>(h.x,h.y)));");
  });

  it("blurs the halation with the kernel and the reads Babylon.js's blur pass makes for the game's", () => {
    // Babylon.js's own pass, made as the game makes the halation's (`new BlurPostProcess` along x with the game's
    // kernel and ratio), says its reads in its shader's defines: the kernel it then said it had and those defines,
    // recorded.
    const blur = babylonValues<{ asked: { kernel: number; ratio: number }; kernel: number; defines: string }>("numbers/halationBlur.json");
    expect(blur.asked).toEqual({ kernel: HALATION_KERNEL, ratio: HALATION_RATIO });
    expect(blur.kernel).toBe(HALATION_KERNEL);
    const defines = blur.defines;
    const number = (name: string): number[] => [...defines.matchAll(new RegExp(`#define ${name}(\\d+) ([-0-9.]+)`, "g"))].map((m) => Number(m[2]));
    const offsets = [...number("KERNEL_OFFSET"), ...number("KERNEL_DEP_OFFSET")];
    const weights = [...number("KERNEL_WEIGHT"), ...number("KERNEL_DEP_WEIGHT")];
    expect(offsets.length).toBeGreaterThan(8);
    const ours = blurTaps(HALATION_KERNEL);
    expect(blurKernel(HALATION_KERNEL)).toBe(33);
    expect(ours.offsets.map((v) => Number(v.toFixed(8)))).toEqual(offsets);
    expect(ours.weights.map((v) => Number(v.toFixed(8)))).toEqual(weights);
    // Each read is in the pass, at its offset along the axis and with its weight, to the eight decimals Babylon.js writes.
    const wgsl = blurWgsl(HALATION_KERNEL);
    expect(wgsl.match(/blend\+=textureSampleLevel\(textureSampler,postSampler,tx\(vUV\+u\.delta\*/g)).toHaveLength(offsets.length);
    expect(wgsl).toContain(`tx(vUV+u.delta*${(ours.offsets[0] as number).toFixed(8)}),0.0)*${(ours.weights[0] as number).toFixed(8)};`);
  });

  it("resolves the depth as the mean of a pixel's samples, each its distance along the view and nothing where nothing was drawn", () => {
    const w = tight(depthResolveWgsl(4));
    expect(w).toContain("vardepthSamples:texture_depth_multisampled_2d;");
    expect(w).toContain("for(vari:i32=0;i<4;i++){letd=textureLoad(depthSamples,at,i);if(d>0.0){sum+=u.depthTerms.y/(d-u.depthTerms.x);}}returnvec4<f32>(sum/4.0,0.0,0.0,1.0);");
  });
});
