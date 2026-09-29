    // Fade the offset with the detail strength so the far edge of the fade
    // has no seam, then hand it to the dominant face.
rOff *= strength;
if (bw.y >= bw.x && bw.y >= bw.z) rpY = rOff;
else if (bw.x >= bw.z) rpX = rOff;
else rpZ = rOff;
}