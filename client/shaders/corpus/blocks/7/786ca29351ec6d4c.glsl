layout(location = 0)  out vec3 vPositionW;
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
gl_Position=viewProjection*world*vec4(position,1.0);
vec4 worldPos=world*vec4(position,1.0);
vPositionW=vec3(worldPos);
#define CUSTOM_VERTEX_MAIN_END
gl_Position.y *= yFactor_;
}