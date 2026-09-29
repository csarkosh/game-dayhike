vec3 toFrag = vPositionW - vEyePosition.xyz;
float d = length(toFrag);
vec3 rd = toFrag / max(d, 1.0e-4);
float y0 = vEyePosition.y - atmReferenceLevel;
float height = atmHeightFog(y0, rd.y, d, atmHeightDensity, atmHeightFalloff);
float transmit = fog * exp(-max(height, 0.0));
vec3 gradient = texture(atmGradient, vec2(clamp(d * atmGradientScale, 0.0, 1.0), 0.5)).rgb;
float glow = pow(max(dot(rd, atmSunDir), 0.0), atmSunPower) * atmSunWeight;
vec3 air = mix(gradient, atmSunColour, glow);
return mix(air, lit, clamp(transmit, 0.0, 1.0));
}