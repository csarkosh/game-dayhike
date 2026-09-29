#define pbr_inline
void createReflectionCoords(
in vec3 vPositionW,
in vec3 normalW,
out vec3 reflectionCoords
)
{
vec3 reflectionVector=computeReflectionCoords(vec4(vPositionW,1.0),normalW);
reflectionCoords=reflectionVector;
}