{let daC=clamp(abs(dot(normalize(out.worldNormal),normalize(scene.vEyePosition.xyz-out.worldPos))),${depthAheadMinCos},1.0);
