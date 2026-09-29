float hgPhase(float cosTheta,float g)
{return (1.0/(4.0*pi))*((1.0-pow(g,2.0))/pow(1.0-2.0*g*cosTheta+pow(g,2.0),1.5));
}