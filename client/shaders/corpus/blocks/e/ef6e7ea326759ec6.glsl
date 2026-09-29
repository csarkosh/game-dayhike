layout(location = 0) out vec4 glFragColor;
void main(void) {
                glFragCoord_ = gl_FragCoord;
                if (yFactor_ == 1.) {
                    glFragCoord_.y = textureOutputHeight_ - glFragCoord_.y;
                }
            