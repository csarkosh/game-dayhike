// The mist beyond the way's banks, built by wayMistField.ts: how much mist a
// fragment of a sheet or a fin holds. It reads the same field of noise as the
// way's own mist (wayLight.fragment.fx), drifts and curls and heaves with it,
// thins near the eye as it does, and is blended as it is, so the two are one
// mist. It comes in from wayFieldReach.x to wayFieldReach.y metres off the
// way's line, where the way's banks go out, and fades out from wayFieldReach.z
// to wayFieldReach.w metres from the eye, short of the mesh's own edge.
//
// wayFieldMist: a sheet's strength, a fin's, the metres the sheets' mist
// stands to, and the share of what lies behind that the mist hides.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

uniform vec3 wayTint;
uniform vec3 wayEye;
uniform float wayGain;
uniform float wayHead;
uniform vec4 wayDrift;
uniform vec4 wayMove;
uniform vec4 wayFieldMist;
uniform vec4 wayFieldReach;
uniform sampler2D wayNoise;

varying vec3 vPlace;
varying vec4 vField;

void main(void) {
  float up = vField.y;
  float standing = vField.z;
  float d = distance(vPlace, wayEye);
  vec2 plan = vPlace.xz;

  vec4 shapes = texture2D(wayNoise, plan * (1.0 / 11.0) + wayDrift.xy);
  float large = mix(0.6, shapes.r, smoothstep(0.0, 4.0, d));
  vec2 curl = (shapes.gr - 0.5) * wayMove.y;
  vec2 strata = vec2(dot(plan, vec2(0.8, 0.6)) / 14.0, vPlace.y / 4.0 + dot(plan, vec2(-0.6, 0.8)) / 22.0);
  float small = texture2D(wayNoise, mix(plan * 0.25 + up * vec2(0.37, 0.19), strata, standing) - wayDrift.zw + curl).g;
  small = mix(0.6, small, smoothstep(1.6, 8.0, d));

  // A place whose ground is not yet known says it is under nothing from the way, and draws nothing.
  float outside = smoothstep(wayFieldReach.x, wayFieldReach.y, vField.x);
  float heave = sin(dot(plan, vec2(0.31, 0.22)) - wayMove.z) * sin(dot(plan, vec2(-0.13, 0.19)) + wayMove.w);
  float lift = (0.5 + 0.7 * large) * (1.0 + wayMove.x * heave);
  float top = mix(wayFieldMist.z * lift, min(vField.w * lift, vField.w * wayHead), standing);
  float fall = 1.0 - smoothstep(0.0, 1.0, up / max(top, 0.01));
  float close = mix(0.3, 1.0, smoothstep(1.0, 10.0, d));
  float rim = 1.0 - smoothstep(wayFieldReach.z, wayFieldReach.w, d);

  float sheet = wayFieldMist.x * fall * mix(0.15, 1.0, smoothstep(0.3, 0.75, small));
  float fin = wayFieldMist.y * smoothstep(0.0, 0.4, up) * fall * mix(0.15, 1.0, small);

  // A face too small to have a lie (a fragment against the eye) is given none, never a division by nothing.
  vec3 face = cross(dFdx(vPlace), dFdy(vPlace));
  float facing = abs(dot(face, vPlace - wayEye)) * inversesqrt(max(dot(face, face), 1.0e-20)) / max(d, 0.001);
  float edge = mix(smoothstep(0.04, 0.25, facing), smoothstep(0.04, 0.3, facing), standing);

  float amount = clamp(mix(sheet, fin, standing) * outside * close * rim * edge * smoothstep(0.3, 2.0, d) * wayGain, 0.0, 1.0);
  gl_FragColor = vec4(wayTint * amount, amount * wayFieldMist.w);
}
