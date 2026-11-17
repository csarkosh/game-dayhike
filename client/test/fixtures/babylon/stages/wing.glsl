// The game's shell on Babylon.js 9.18.0: WING_GLSL (wingPlugin.ts)

#ifdef WING
#ifdef THIN_INSTANCES
float wingSide = positionUpdated.x < 0.0 ? -1.0 : 1.0;
float wingAbsX = abs(positionUpdated.x);
float wingSpan = clamp(wingAbsX / wingHalfSpan, 0.0, 1.0);
float wingA = wing.y * sin(wingTime * wingOmega + wing.x) * wingSpan;
float wingC = cos(wingA);
float wingS = sin(wingA);
float wingY0 = positionUpdated.y;
positionUpdated.y = wingY0 * wingC + wingAbsX * wingS;
positionUpdated.x = wingSide * (wingAbsX * wingC - wingY0 * wingS);
#endif
#endif
