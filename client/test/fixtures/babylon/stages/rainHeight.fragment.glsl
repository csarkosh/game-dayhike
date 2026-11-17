// The game's shell on Babylon.js 9.18.0: RAIN_HEIGHT_FRAGMENT (rainMap.ts)

varying float vHeight;
#ifdef RAIN_HEIGHT_TERRAIN
varying float vCanopy;
#endif
void main(void) {
#ifdef RAIN_HEIGHT_TERRAIN
  float transmission = 1.0 - 0.65 * vCanopy;
  float lift = 10.0 * step(0.01, vCanopy);
#elif defined(RAIN_HEIGHT_WATER)
  float transmission = 1.0;
  float lift = 0.0;
#else
  float transmission = 0.0;
  float lift = 0.0;
#endif
  gl_FragColor = vec4(vHeight, transmission, lift, 1.0);
}
