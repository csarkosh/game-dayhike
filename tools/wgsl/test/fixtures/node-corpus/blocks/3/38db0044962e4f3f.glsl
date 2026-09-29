float computeDistanceLightFalloff_Standard(vec3 lightOffset,float range)
{return max(0.,1.0-length(lightOffset)/range);
}