// The way down's mist, built by wayLight.ts: how much mist a fragment of a
// sheet, a veil or a fin holds, and its colour. Every sheet reads the one
// field of noise in the world (the ground mist's own map: large shapes in
// its red, small in its green), so together they look like a volume.
//
// Across the way the mist is thin on the path and whole in the banks either
// side: wayPath.x of the banks' on the line, filling to whole between 1 m
// and 3.1 m from it, gone between 4.6 m and 6.4 m. It stands lower on the
// path too (wayPath.y metres, the banks to each vertex's own). The lowest
// sheet is the ground's own glow, a faint core on the path and a band under
// the banks.
//
// It moves. The shapes drift (wayDrift), the small ones another way from the
// large and carried by them (wayMove.y), so they curl and change. The banks'
// tops heave on two crossed waves (wayMove.x of their height, the waves'
// phases in wayMove.z and wayMove.w). A veil's and a fin's mist is held under
// the head its sheet is built to (wayHead times the height it stands to at
// rest), so it always ends before its sheet does.
//
// Near the eye the shapes smooth to a plain veil and the mist thins to
// wayPath.z of itself, so it hangs round a runner and never rushes past. A
// fin seen edge on fades out, and a sheet seen along itself, so neither
// shows as a line. With the metres from the eye everything falls away
// (wayGround.z the ground's glow, wayGround.w the mist).
//
// The blend is premultiplied: the colour goes out times the amount, and the
// alpha is the share of what lies behind that the mist hides (wayMist.w of
// the amount). Thin mist glows a little, thick mist settles at its own
// colour and never whitens.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

uniform vec3 wayTint;
uniform vec3 wayEye;
uniform float wayGain;
uniform float wayStrata;
uniform float wayHead;
uniform vec4 wayMist;
uniform vec4 wayGround;
uniform vec4 wayPath;
uniform vec4 wayMove;
uniform vec4 wayDrift;
uniform sampler2D wayNoise;

varying vec3 vPlace;
varying vec4 vWay;

void main(void) {
  float lateral = vWay.x;
  float up = vWay.y;
  // A veil or a fin stands, a sheet lies, and the lowest sheet is the ground's glow.
  float standing = min(vWay.z, 1.0);
  float isFin = step(1.5, vWay.z);
  float isSheet = (1.0 - standing) * step(0.1, up);
  float d = distance(vPlace, wayEye);
  vec2 plan = vPlace.xz;

  vec4 shapes = texture2D(wayNoise, plan * (1.0 / 11.0) + wayDrift.xy);
  float large = shapes.r;
  vec2 curl = (shapes.gr - 0.5) * wayMove.y;
  // A sheet lying over the ground reads the small shapes in plan, each height its own lie of them. One standing reads them as strata.
  vec2 strata = vec2(dot(plan, vec2(0.8, 0.6)) / 14.0, vPlace.y / wayStrata + dot(plan, vec2(-0.6, 0.8)) / 22.0);
  float small = texture2D(wayNoise, mix(plan * 0.25 + up * vec2(0.37, 0.19), strata, standing) - wayDrift.zw + curl).g;
  large = mix(0.6, large, smoothstep(0.0, 4.0, d));
  small = mix(0.6, small, smoothstep(1.6, 8.0, d));

  float bank = smoothstep(1.0, 3.1, lateral);
  float band = mix(wayPath.x, 1.0, bank) * (1.0 - smoothstep(4.6, 6.4, lateral));
  float core = 1.0 - smoothstep(1.5, 4.0, lateral);
  float close = mix(wayPath.z, 1.0, smoothstep(1.0, 10.0, d));
  float far = exp(-wayGround.w * d);

  float heave = sin(dot(plan, vec2(0.31, 0.22)) - wayMove.z) * sin(dot(plan, vec2(-0.13, 0.19)) + wayMove.w);
  float top = min(mix(wayPath.y, vWay.w, bank) * (0.5 + 0.7 * large) * (1.0 + wayMove.x * heave), mix(1.0e6, vWay.w * wayHead, standing));
  float fall = 1.0 - smoothstep(0.0, 1.0, up / max(top, 0.01));

  float ground = (wayGround.y * core + wayGround.x * band * (0.35 + 0.65 * large) * close) * exp(-wayGround.z * d);
  float veil = wayMist.x * band * smoothstep(0.0, 0.4, up) * fall * mix(wayPath.w, 1.0, small) * mix(1.0, wayMist.y, isFin) * close * far;
  // A sheet is wisps and gaps.
  float sheet = wayMist.z * band * fall * mix(wayPath.w, 1.0, smoothstep(0.3, 0.75, small)) * close * far;

  // How squarely the eye looks at this face, from the face itself, so a sheet lying on a slope is judged by its own lie.
  vec3 face = normalize(cross(dFdx(vPlace), dFdy(vPlace)));
  float facing = abs(dot(face, (vPlace - wayEye) / max(d, 0.001)));
  float edge = mix(mix(1.0, smoothstep(0.04, 0.25, facing), isSheet), smoothstep(0.04, 0.3, facing), isFin);

  float amount = clamp(mix(mix(ground, sheet, isSheet), veil, standing) * edge * smoothstep(0.3, 2.0, d) * wayGain, 0.0, 1.0);
  gl_FragColor = vec4(wayTint * amount, amount * wayMist.w);
}
