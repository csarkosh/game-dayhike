#define MINIMUMVARIANCE 0.0005
float convertRoughnessToAverageSlope(float roughness)
{return square(roughness)+MINIMUMVARIANCE;
}