float sunIntensity(float zenithAngleCos)
{return EE*max(0.0,1.0-exp((-(cutoffAngle-acos(zenithAngleCos))/steepness)));
}