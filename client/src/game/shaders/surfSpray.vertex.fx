// The surf's spray, spliced by SprayPlugin (surfSpray.ts) at
// CUSTOM_VERTEX_DEFINITIONS: each sprite's seed and burst slot, the
// constants surfSpray.ts mirrors one for one (a lockstep test holds them),
// and the sprite's place.
//
// A slot is two vec4s of surfSprayBursts: its origin and its age, then the
// direction it is thrown along (level, unit) and its speed. A sprite starts
// on the stretch across that direction, spread over SURF_SPRAY_STRETCH by
// its first hash, is thrown at an elevation by its second and at a share of
// the slot's speed by its third, and lives a span by its fourth. Its path is
// a throw under gravity with linear drag toward the wind, in closed form:
// p0 + w t + (v0 - w)(1 - exp(-c t)) / c, with w the wind's velocity and the
// fall's terminal speed below it. It faces the eye, grows to its full size
// over its life and fades out over it. Before its slot's start or past its
// life it collapses to a point and draws nothing, chosen by step, never by a
// branch.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
#ifdef SPRAY
attribute vec4 spraySeed;
attribute float sprayBurst;
varying float vSprayAlpha;
varying vec2 vSprayUv;

const float SURF_SPRAY_G = 9.81;
const float SURF_SPRAY_DRAG = 1.5;
const float SURF_SPRAY_LIFE_MIN = 1.0;
const float SURF_SPRAY_LIFE_MAX = 2.0;
const float SURF_SPRAY_SIZE = 0.6;
const float SURF_SPRAY_STRETCH = 20.0;
const float SURF_SPRAY_ELEVATION_MIN = 0.35;
const float SURF_SPRAY_ELEVATION_MAX = 1.2;
const float SURF_SPRAY_SPEED_MIN = 0.5;

// The corner of the sprite's quad in the world, and its alpha in w.
vec4 sprayPlace(vec2 corner) {
  int slot = 2 * int(sprayBurst + 0.5);
  vec4 origin = surfSprayBursts[slot];
  vec4 launch = surfSprayBursts[slot + 1];
  float life = mix(SURF_SPRAY_LIFE_MIN, SURF_SPRAY_LIFE_MAX, spraySeed.w);
  float alive = step(0.0, origin.w) * (1.0 - step(life, origin.w));
  float t = clamp(origin.w, 0.0, life);
  vec3 ahead = vec3(launch.x, 0.0, launch.y);
  vec3 across = vec3(-launch.y, 0.0, launch.x);
  vec3 start = origin.xyz + across * (spraySeed.x - 0.5) * SURF_SPRAY_STRETCH;
  float elevation = mix(SURF_SPRAY_ELEVATION_MIN, SURF_SPRAY_ELEVATION_MAX, spraySeed.y);
  float speed = launch.z * mix(SURF_SPRAY_SPEED_MIN, 1.0, spraySeed.z);
  vec3 v0 = (ahead * cos(elevation) + vec3(0.0, sin(elevation), 0.0)) * speed;
  vec3 drift = vec3(surfSprayWind.x, -SURF_SPRAY_G / SURF_SPRAY_DRAG, surfSprayWind.y);
  vec3 p = start + drift * t + (v0 - drift) * (1.0 - exp(-SURF_SPRAY_DRAG * t)) / SURF_SPRAY_DRAG;
  vec3 toEye = surfSprayCam - p;
  vec3 view = toEye / max(length(toEye), 0.001);
  vec3 side = cross(vec3(0.0, 1.0, 0.0), view);
  vec3 right = side / max(length(side), 0.001);
  vec3 up = cross(view, right);
  float lived = t / life;
  float size = SURF_SPRAY_SIZE * (0.5 + 0.5 * lived) * alive;
  return vec4(p + (right * corner.x + up * corner.y) * size, (1.0 - lived) * alive);
}
#endif
