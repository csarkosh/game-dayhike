vec3 fromRGBD(vec4 rgbd) {rgbd.rgb=toLinearSpace(rgbd.rgb);
return rgbd.rgb/rgbd.a;
}