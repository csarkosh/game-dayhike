else if (FOGMODE_EXP2==vFogInfos.x)
{fogCoeff=1.0/pow(E,fogDistance*fogDistance*fogDensity*fogDensity);
}