// The lens pass, between FXAA and the finish pass: rain on the glass. A
// field of static droplets from the generated map (lensParams.ts), tiled
// twice across the frame's height and, per tile, mirrored and shifted inside
// the map's margin so no drop repeats in place, and eight procedural drops
// sliding down their columns. Each drop's normal refracts the scene by
// lensStrength times LENS_OFFSET, read once at the moved UV. On high
// (lensFog 1) the glass between the drops and their trails is lerped toward
// the halation chain's quarter-resolution blur; on medium lensFog is 0 and
// blurSampler is bound to the scene, so the second read is the first.
//
// Every texture read is unconditional, so the pass needs no uniformity
// switch on WebGPU. Nothing here gates on the strength: below its floor
// post.ts detaches the pass, since even an idle full-screen pass costs a
// read and a write of the frame.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose. The LENS_ literals mirror
// LENS in lensParams.ts.
precision highp float;

varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D lensSampler;
uniform sampler2D blurSampler;
uniform float lensStrength;
uniform float time;
uniform float aspect;
uniform float lensFog;

const float LENS_TILES = 2.0;
const float LENS_OFFSET = 0.03;
const float LENS_COLUMNS = 8.0;
// A tile's shift, within the margin the map keeps its drops inside.
const float LENS_JITTER = 0.05;
// A sliding drop's radius and its trail's length, of the frame's height.
const float SLIDE_RADIUS = 0.025;
const float SLIDE_TRAIL = 0.2;
// The cap's slope: a sliding drop's normal is its unit offset times this.
const float SLIDE_CAP = 0.8;
const float FOG_GAIN = 0.6;

// Interleaved gradient noise on lattice points, the finish pass's hash.
float lensHash(vec2 p) {
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}

void main(void) {
  // The static field, in a frame space where a drop is round.
  vec2 frame = vec2(vUV.x * aspect, vUV.y) * LENS_TILES;
  vec2 cell = floor(frame);
  vec2 inTile = frame - cell;
  float flip = step(0.5, lensHash(cell + vec2(17.0, 31.0)));
  float tileX = mix(inTile.x, 1.0 - inTile.x, flip);
  vec2 shift = (vec2(lensHash(cell + vec2(5.0, 7.0)), lensHash(cell + vec2(11.0, 13.0))) - 0.5) * 2.0 * LENS_JITTER;
  vec4 d = texture2D(lensSampler, vec2(tileX, inTile.y) + shift);
  vec2 nStatic = (d.rg * 2.0 - 1.0) * vec2(1.0 - 2.0 * flip, 1.0) * d.b;

  // One sliding drop a column: a saw-tooth fall at the column's own speed,
  // from above the top to below the bottom with its trail, a fresh place in
  // the column each cycle, and some cycles empty.
  float column = floor(vUV.x * LENS_COLUMNS);
  float speed = 0.1 + 0.15 * lensHash(vec2(column, 3.0));
  float run = time * speed + lensHash(vec2(column, 5.0));
  float cycle = floor(run);
  float present = step(0.45, lensHash(vec2(column, cycle)));
  float yDrop = 1.0 + SLIDE_RADIUS - fract(run) * (1.0 + 2.0 * SLIDE_RADIUS + SLIDE_TRAIL);
  float xDrop = (column + 0.5 + 0.7 * (lensHash(vec2(column, cycle + 100.0)) - 0.5)) / LENS_COLUMNS
    + 0.004 * sin(yDrop * 50.0 + column);
  vec2 toDrop = vec2((vUV.x - xDrop) * aspect, vUV.y - yDrop);
  float q = length(toDrop) / SLIDE_RADIUS;
  float mSlide = (1.0 - smoothstep(0.8, 1.0, q)) * present;
  vec2 nSlide = toDrop / SLIDE_RADIUS * SLIDE_CAP * mSlide;
  // The trail is above the drop, where it has passed, and narrower than it.
  float above = toDrop.y;
  float tSlide = (1.0 - smoothstep(0.0, SLIDE_TRAIL, above)) * step(0.0, above)
    * (1.0 - smoothstep(0.3, 0.5, abs(toDrop.x) / SLIDE_RADIUS)) * present;

  float mask = max(d.b, mSlide);
  float trail = max(d.a, tSlide);
  vec2 n = nStatic + nSlide;
  vec2 uvR = vUV + lensStrength * LENS_OFFSET * vec2(n.x / aspect, n.y);
  vec4 col = texture2D(textureSampler, uvR);
  float fog = lensFog * lensStrength * (1.0 - mask) * (1.0 - trail) * FOG_GAIN;
  gl_FragColor = mix(col, texture2D(blurSampler, uvR), fog);
}
