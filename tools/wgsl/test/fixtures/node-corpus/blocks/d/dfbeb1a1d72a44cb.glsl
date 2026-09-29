float uint2float(uint i) {return uintBitsToFloat(0x3F800000u | (i>>9u))-1.0;
}