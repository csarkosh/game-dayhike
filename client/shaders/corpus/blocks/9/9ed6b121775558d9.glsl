vec3 diffuseBRDF_EON(vec3 albedo,float roughness,float NdotL,float NdotV,float LdotV)
{vec3 rho=albedo;
float sigma=roughness;
float mu_i=NdotL;
float mu_o=NdotV;
float s=LdotV-mu_i*mu_o;
float sovertF=s>0.0 ? s/max(mu_i,mu_o) : s;
float AF=1.0/(1.0+constant1_FON*sigma);
vec3 f_ss=(rho*RECIPROCAL_PI)*AF*(1.0+sigma*sovertF);
float EFo=E_FON_approx(mu_o,sigma);
float EFi=E_FON_approx(mu_i,sigma);
float avgEF=AF*(1.0+constant2_FON*sigma);
vec3 rho_ms=(rho*rho)*avgEF/(vec3(1.0)-rho*(1.0-avgEF));
const float eps=1.0e-7;
vec3 f_ms=(rho_ms*RECIPROCAL_PI)*max(eps,1.0-EFo)
* max(eps,1.0-EFi)
/ max(eps,1.0-avgEF);
return (f_ss+f_ms);
}