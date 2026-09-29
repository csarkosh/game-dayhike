const float constant1_FON=0.5-2.0/(3.0*PI);
const float constant2_FON=2.0/3.0-28.0/(15.0*PI);
float E_FON_approx(float mu,float roughness)
{float sigma=roughness;
float mucomp=1.0-mu;
float mucomp2=mucomp*mucomp;
const mat2 Gcoeffs=mat2(0.0571085289,-0.332181442,
0.491881867,0.0714429953);
float GoverPi=dot(Gcoeffs*vec2(mucomp,mucomp2),vec2(1.0,mucomp2));
return (1.0+sigma*GoverPi)/(1.0+constant1_FON*sigma);
}